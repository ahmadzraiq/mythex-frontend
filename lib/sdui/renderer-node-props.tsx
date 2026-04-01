/**
 * Renderer node-prop helpers
 *
 * Pure functions and constants that build / mutate the props object passed to
 * React.createElement, and element-wrapping helpers that return new React elements.
 * None of these use React hooks — they take plain arguments and are safe to call
 * in any render context.
 *
 * Kept separate from renderer.tsx so that file stays focused on the rendering
 * lifecycle (hooks, state setup, map expansion, JSX composition).
 */

import React, { useEffect } from 'react';
import type { FormContextValue } from './form-context';
import type { SDUINode, SDUIContext } from './types';
import { evaluateFormula } from './formula-evaluator';
import { mergeTailwindClasses } from './tailwind-merge';
import { AUTOFILL_SUPPRESS_TYPES } from './controlled-component-registry';

// ── Module-level component type Sets ─────────────────────────────────────────
// Defined at module level so they are not recreated on every render.

/** Components that use onPress (not onClick) for their primary interaction */
export const PRESS_ONLY_TYPES = new Set(['MenuItem', 'MenuItemLabel']);

/** Components that natively handle their own press/click (no transparent wrapper needed) */
export const SUBMIT_BUTTON_TYPES = new Set<string>(['Box', 'HStack', 'VStack', 'Center']);

/** Interactive components that receive a `disabled` prop for preview-state dimming */
export const INTERACTIVE_TYPES = new Set(['Input', 'Select', 'InputField']);

/** Components that legitimately accept onChangeText (React Native TextInput-based).
 *  All other components strip it to avoid React's "Unknown event handler property" warning
 *  when they render as <div> on web. */
export const CHANGE_TEXT_TYPES = new Set(['Input', 'InputField', 'TextareaInput']);

/** Components that are already clickable — no transparent click-wrapper div needed */
export const ALREADY_CLICKABLE = new Set([
  'MenuItem',
  'MenuItemLabel',
  'FormContainer',
  // Layout primitives render as div (web) / View — they receive bubbled clicks directly.
  // Wrapping them duplicates onClick on an outer display:contents div → double workflow runs.
  'Box',
  'HStack',
  'VStack',
  'Center',
]);

// ── Standalone React component ────────────────────────────────────────────────

/** Wrapper that triggers a data fetch when mounted */
export function DataSourceWrapper({
  dataSource,
  fetchData,
  children,
}: {
  dataSource: NonNullable<SDUINode['dataSource']>;
  fetchData: SDUIContext['fetchData'];
  children: React.ReactNode;
}) {
  useEffect(() => {
    fetchData(dataSource);
  }, [dataSource.url, dataSource.key, fetchData]);
  return <>{children}</>;
}

// ── Form-context binding helpers ──────────────────────────────────────────────

/**
 * Returns true if any workflow in `actions` contains a step of `stepType`.
 * Checks both inline element-workflow items (which have a steps array) and
 * named action references resolved via actionsConfig (page/global workflows).
 */
function detectWorkflowStepType(
  stepType: string,
  actions: unknown,
  actionsConfig: Record<string, unknown> | undefined,
): boolean {
  if (!Array.isArray(actions)) return false;
  const has = (steps: unknown[]) =>
    (steps as Array<{ type?: string }>).some(s => s.type === stepType);
  for (const item of actions as Array<Record<string, unknown>>) {
    // Inline element-workflow: item has a steps array directly
    if (Array.isArray(item.steps) && has(item.steps)) return true;
    if (typeof item.action === 'string' && item.action) {
      const def = actionsConfig?.[item.action] as Record<string, unknown> | undefined;
      if (Array.isArray(def?.steps) && has(def!.steps as unknown[])) return true;
    }
  }
  return false;
}

/**
 * Rewires click/press handlers on non-FormContainer nodes that are inside a FormContainer
 * so that form-related workflow steps correctly call into the FormContext API.
 *
 * Precedence (first match wins):
 *  1. submitForm step    → formCtx.submit()           — FormContainer's chain runs (validate → mutation)
 *  2. resetForm step     → formCtx.reset()            — clears FormContainer's local state
 *  3. onSubmit trigger   → formCtx.submit(handler)    — trigger:"submit" workflow redirected from onSubmit
 *  4. type="submit" btn  → chains formCtx.submit() after existing handler (legacy JSON approach)
 */
export function applyFormContextBindings(
  node: SDUINode,
  cleanProps: Record<string, unknown>,
  formCtx: FormContextValue | null,
  actionsConfig: Record<string, unknown> | undefined,
): void {
  if (!formCtx || (node.type as string) === 'FormContainer') return;

  const isPressType = PRESS_ONLY_TYPES.has(node.type as string);

  /** Set the primary handler for the node's component type.
   * Press-type components (Button, Link, etc.) use onPress.
   * All other elements use onClick only — never set onPress on DOM elements,
   * as React logs "Unknown event handler property `onPress`" for them. */
  const setHandlers = (fn: () => void) => {
    if (isPressType) {
      cleanProps.onPress = fn;
      cleanProps.onClick ??= fn;
    } else {
      cleanProps.onClick = fn;
    }
  };

  if (detectWorkflowStepType('submitForm', node.actions, actionsConfig)) {
    setHandlers(() => formCtx.submit());
  } else if (detectWorkflowStepType('resetForm', node.actions, actionsConfig)) {
    // Chain: reset form first, then run the bound workflow (e.g. waResetForm's changeVariableValue steps)
    const existingFn = (cleanProps.onPress ?? cleanProps.onClick) as (() => void) | undefined;
    setHandlers(() => {
      formCtx.reset();
      existingFn?.();
    });
  } else if (cleanProps.onSubmit) {
    const submitHandler = cleanProps.onSubmit as () => void;
    delete cleanProps.onSubmit;
    setHandlers(() => formCtx.submit(submitHandler));
  } else if (SUBMIT_BUTTON_TYPES.has(node.type as string) && cleanProps.type === 'submit') {
    const existingFn = (cleanProps.onPress ?? cleanProps.onClick) as ((...a: unknown[]) => void) | undefined;
    setHandlers(existingFn ? () => { existingFn(); formCtx.submit(); } : () => formCtx.submit());
  }
}

// ── Renderer prop-mutation helpers ────────────────────────────────────────────
// Each function mutates `cleanProps` in place for a single, named concern.

/**
 * Merges the active preview-state className override into `cleanProps.className`.
 * Only active in builder mode when a non-normal preview state is selected.
 */
export function applyStateOverrides(
  node: SDUINode,
  cleanProps: Record<string, unknown>,
  previewState: string | undefined,
  builderMode: boolean,
): void {
  if (!builderMode || !previewState || previewState === 'normal') return;
  const overrides = (node as { _stateOverrides?: Record<string, { className?: string }> })._stateOverrides;
  const overrideClass = overrides?.[previewState]?.className;
  if (overrideClass) {
    const base = (cleanProps.className as string | undefined) ?? '';
    cleanProps.className = mergeTailwindClasses(base, overrideClass);
  }
}

/**
 * Evaluates any `classFormulas` sidecar on the node and appends the resulting
 * Tailwind classes to `cleanProps.className`.
 * classFormulas is a builder-side sidecar (node.props.classFormulas) that stores
 * { formula } objects for class-based FieldWithBinding fields (selfAlignment, textAlign, etc.).
 */
export function applyClassFormulas(
  node: SDUINode,
  cleanProps: Record<string, unknown>,
  sduiContext: SDUIContext,
): void {
  const classFormulas = node.props?.classFormulas as Record<string, { formula?: string }> | undefined;
  if (!classFormulas) return;
  let extraCls = '';
  for (const [, fv] of Object.entries(classFormulas)) {
    if (fv && typeof fv === 'object' && typeof fv.formula === 'string') {
      const { value } = evaluateFormula(fv.formula, (sduiContext as { state?: Record<string, unknown> }).state ?? {});
      if (typeof value === 'string' && value) extraCls += ' ' + value;
    }
  }
  if (extraCls) {
    cleanProps.className = mergeTailwindClasses(
      (cleanProps.className as string) ?? '',
      extraCls.trim()
    );
  }
}

/**
 * Disables browser autofill on text inputs in builder mode so saved credentials
 * don't prefill form fields in the canvas.
 * Uses AUTOFILL_SUPPRESS_TYPES from the registry — no hardcoded type strings.
 */
export function applyAutofill(
  node: SDUINode,
  cleanProps: Record<string, unknown>,
  builderMode: boolean,
): void {
  if (!builderMode || !AUTOFILL_SUPPRESS_TYPES.has(node.type)) return;
  cleanProps.autoComplete = 'off';
  // Chrome ignores autoComplete="off" on password fields; "new-password" reliably suppresses it.
  if (cleanProps.type === 'password' || (node.props as Record<string, unknown>)?.type === 'password') {
    cleanProps.autoComplete = 'new-password';
  }
}

/**
 * Injects controlled `value` and `isChecked` props from the variable store onto
 * the component. Only sets them when not already provided by the node's own props.
 */
export function injectControlledProps(
  cleanProps: Record<string, unknown>,
  externalValue: string | undefined,
  externalIsChecked: boolean | undefined,
): void {
  if (externalValue !== undefined && cleanProps.value == null) {
    cleanProps.value = externalValue;
  }
  if (externalIsChecked !== undefined && cleanProps.isChecked == null) {
    cleanProps.isChecked = externalIsChecked;
  }
}

/**
 * Attaches a ref callback to the node's DOM element that writes `data-builder-id`
 * and `data-builder-type` attributes. Gluestack/NativeWind's cssInterop chain
 * strips unknown data-* props before they reach the DOM, so a ref callback is the
 * only reliable way to set them.
 * Nodes without an explicit id get NO annotation so clicking the page background
 * correctly deselects.
 */
export function applyBuilderAnnotation(
  node: SDUINode,
  cleanProps: Record<string, unknown>,
  builderMode: boolean,
): void {
  if (!builderMode || !node.id) return;
  const _bId   = node.id;
  const _bType = node.type;
  const _prevRef = cleanProps.ref as React.Ref<unknown> | undefined;
  cleanProps.ref = (el: unknown) => {
    if (el && typeof (el as Element).setAttribute === 'function') {
      (el as Element).setAttribute('data-builder-id',   _bId);
      (el as Element).setAttribute('data-builder-type', _bType);
    }
    if (typeof _prevRef === 'function') {
      _prevRef(el);
    } else if (_prevRef && typeof _prevRef === 'object' && 'current' in _prevRef) {
      (_prevRef as React.MutableRefObject<unknown>).current = el;
    }
  };
}

// ── Render-wrapping helpers ───────────────────────────────────────────────────

/**
 * If the element has a click handler but is not natively clickable, wraps it in a
 * transparent `display:contents` div so the click is reachable without affecting layout.
 * Skipped in builder mode — the capture overlay handles all pointer events there.
 */
export function wrapWithClickHandler(
  element: React.ReactElement,
  cleanProps: Record<string, unknown>,
  nodeType: string,
  builderMode: boolean,
): React.ReactElement {
  const hasClickHandler = !!(cleanProps.onClick || cleanProps.onPress);
  if (!hasClickHandler || ALREADY_CLICKABLE.has(nodeType) || builderMode) return element;
  const clickHandler = (cleanProps.onClick ?? cleanProps.onPress) as React.MouseEventHandler;
  return React.createElement(
    'div',
    { onClick: clickHandler, style: { display: 'contents', cursor: 'pointer' }, 'data-clickable': 'true' },
    element
  );
}

/**
 * If the node has a disabled overlay config (or _forceDisabledInEditor), wraps the
 * element with a relative container and an absolutely positioned overlay div.
 * Returns null when no overlay is needed so the caller can skip the replacement.
 */
export function renderWithDisabledOverlay(
  element: React.ReactElement,
  node: SDUINode,
  resolvedProps: Record<string, unknown>,
  builderMode: boolean,
): React.ReactElement | null {
  const showDisabledOverlay =
    resolvedProps.disabled === true ||
    (node as { _forceDisabledInEditor?: boolean })._forceDisabledInEditor === true;
  if (!showDisabledOverlay) return null;

  const ov = node._disabledOverlay;
  // Use rgba() so backdrop-filter isn't composited at the same opacity level.
  const hex = ov?.color ?? '#000000';
  const alpha = ov?.opacity ?? 0.3;
  const r = parseInt(hex.slice(1, 3) || '00', 16) || 0;
  const g = parseInt(hex.slice(3, 5) || '00', 16) || 0;
  const b = parseInt(hex.slice(5, 7) || '00', 16) || 0;
  const blurVal = ov?.blur ? `blur(${ov.blur}px)` : undefined;
  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 10,
    pointerEvents: builderMode ? 'none' : 'all',
    backgroundColor: `rgba(${r}, ${g}, ${b}, ${alpha})`,
    backdropFilter: blurVal,
    WebkitBackdropFilter: blurVal,
    borderRadius: 'inherit',
  };
  return React.createElement(
    'div',
    { style: { position: 'relative' }, 'data-disabled': 'true' },
    element,
    React.createElement('div', { style: overlayStyle })
  );
}
