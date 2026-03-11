'use client';

/**
 * SDUI Renderer - Fine-grained reactivity
 * Each node subscribes only to the variables it uses - no unnecessary re-renders
 */

import React, { useEffect, memo, useSyncExternalStore, useContext } from 'react';
import { FormContext, type FormContextValue } from './form-context';
import { getGlobalVariableStore } from './global-variable-store';
import { trackFormFieldProps, useFormFieldRegistration } from './form-field-tracker';

/** Stable empty object for useSyncExternalStore fallback — avoids infinite loop from new {} each call */
const STABLE_EMPTY_OBJECT: Record<string, unknown> = {};

// ── Form-context binding helpers ──────────────────────────────────────────────

/** Components that use onPress (not onClick) for their primary interaction */
const PRESS_ONLY_TYPES = new Set(['Button', 'Pressable', 'Link', 'MenuItem', 'MenuItemLabel']);

/** Components that natively handle their own press/click (no transparent wrapper needed) */
const SUBMIT_BUTTON_TYPES = new Set(['Button', 'Pressable']);

/**
 * Returns true if any workflow in `actions` contains a step of `stepType`.
 * Checks both inline workflowSteps wrappers (element workflows) and named
 * action references resolved via actionsConfig (page/global workflows).
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
    if (item.type === 'workflowSteps' && Array.isArray(item.steps) && has(item.steps)) return true;
    if (typeof item.action === 'string' && item.action) {
      const def = actionsConfig?.[item.action] as Record<string, unknown> | undefined;
      if (def?.type === 'workflowSteps' && Array.isArray(def.steps) && has(def.steps as unknown[])) return true;
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
function applyFormContextBindings(
  node: SDUINode,
  cleanProps: Record<string, unknown>,
  formCtx: FormContextValue | null,
  actionsConfig: Record<string, unknown> | undefined,
): void {
  if (!formCtx || (node.type as string) === 'FormContainer') return;

  const isPressType = PRESS_ONLY_TYPES.has(node.type as string);

  /** Set the primary handler for the node's component type.
   * Press-type components (Button, Pressable, etc.) use onPress.
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
    setHandlers(() => formCtx.reset());
  } else if (cleanProps.onSubmit) {
    const submitHandler = cleanProps.onSubmit as () => void;
    delete cleanProps.onSubmit;
    setHandlers(() => formCtx.submit(submitHandler));
  } else if (SUBMIT_BUTTON_TYPES.has(node.type as string) && cleanProps.type === 'submit') {
    const existingFn = (cleanProps.onPress ?? cleanProps.onClick) as ((...a: unknown[]) => void) | undefined;
    setHandlers(existingFn ? () => { existingFn(); formCtx.submit(); } : () => formCtx.submit());
  }
}

import { evaluateFormula } from './formula-evaluator';
import { getComponent } from './component-registry';
import { evaluateCondition, interpolate, resolveProps, resolveText } from './utils';
import { createVariableStore, useVariablePaths, type VariableStoreConfig } from './variable-store';
import { extractNodeDependencies } from './dependency-extractor';
import type { SDUINode, SDUIContext } from './types';
import { isScreenScopedPath } from './path-utils';
import { createGet } from './create-get';
import { bindActionsToProps } from './action-binding';
import { useBuilderMode } from './builder-context';
import { mergeTailwindClasses } from './tailwind-merge';
import { InputParentContext, useParentInputId } from './input-parent-context';

interface RendererContext {
  store: ReturnType<typeof createVariableStore>;
  mergedStore?: { getState: () => { merged: Record<string, unknown> }; subscribe: (cb: () => void) => () => void };
  storeConfig: VariableStoreConfig;
  mergedState?: Record<string, unknown>;
  runAction: SDUIContext['runAction'];
  fetchData: SDUIContext['fetchData'];
  actionsConfig?: Record<string, unknown>;
  screenName?: string;
  screenScopedAliases?: string[];
  /** Active preview state in builder mode — used to apply _stateOverrides per node */
  previewState?: string;
}

interface RendererProps {
  node: SDUINode;
  context: RendererContext;
  scope?: Record<string, unknown>;
  /** Stable tree path string used for builder node IDs (e.g. "0", "0-1", "0-1-2") */
  builderPath?: string;
}

/** Wrapper that fetches data when mounted */
function DataSourceWrapper({
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

const SDURendererInner = memo(function SDURendererInner({ node, context, scope, builderPath = '0' }: RendererProps) {
  const { builderMode } = useBuilderMode();
  const { store, mergedStore, storeConfig, mergedState, runAction, fetchData, actionsConfig, screenName, screenScopedAliases = [], previewState } = context;

  // Subscribe to mergedStore so preview state patches (applied in useEffect after render)
  // immediately trigger a re-render without needing a manual canvas click.
  const mergedFromStore = useSyncExternalStore(
    mergedStore ? mergedStore.subscribe : (_cb: () => void) => () => {},
    () => mergedStore?.getState().merged ?? mergedState ?? STABLE_EMPTY_OBJECT,
    () => mergedStore?.getState().merged ?? mergedState ?? STABLE_EMPTY_OBJECT,
  );
  const merged = mergedStore ? mergedFromStore : mergedState;
  const rawDeps = extractNodeDependencies(node);
  const deps =
    screenName && rawDeps.some((p) => isScreenScopedPath(p, screenScopedAliases))
      ? rawDeps.map((p) => (isScreenScopedPath(p, screenScopedAliases) ? `screens.${screenName}.${p}` : p))
      : rawDeps;
  useVariablePaths(store, deps, scope, mergedStore);
  const get = createGet(store, merged, scope, mergedStore, screenName, screenScopedAliases);
  const storeState = store.getState().getFullState();
  const state = merged ? { ...storeState, ...merged } : storeState;
  const stateWithScope = scope
    ? {
        ...state,
        // Legacy scope vars — kept for backward compat
        $item: scope.$item, $index: scope.$index, $parent: scope.$parent,
        // Pass through the already-structured context.item built by the map loop above,
        // so context.item.data / context.item.parent / context.item.index all resolve correctly.
        context: scope.context ?? { item: scope.$item, index: scope.$index, parent: scope.$parent },
      }
    : state;
  const sduiContext: SDUIContext = {
    state: stateWithScope,
    setState: (updater) => store.getState().setState(updater),
    get,
    runAction,
    fetchData,
  };

  // Form field registration: handles all controlled components generically.
  // See lib/sdui/form-field-tracker.ts for the full implementation.
  const formCtx = useContext(FormContext);
  const parentInputId = useParentInputId();
  useFormFieldRegistration(node, formCtx);

  if (!node) return null;

  // In builder mode, _forceShowInEditor bypasses any condition so the node is
  // always visible on the canvas regardless of its runtime condition.
  const forceShow = builderMode && (node as { _forceShowInEditor?: boolean })._forceShowInEditor === true;

  if (!forceShow) {
    // Cast to unknown first — condition can be false at runtime (builder sets it) even though
    // the ConditionValue type doesn't include boolean.
    if ((node.condition as unknown) === false) return null;
    if (node.condition != null && !evaluateCondition(node.condition, sduiContext)) {
      return null;
    }
  }

  if (node.map) {
    let arr: unknown[];
    if (typeof node.map === 'string') {
      arr = (get(node.map) as unknown[]) ?? [];
    } else if (node.map && typeof node.map === 'object' && ('expr' in node.map || 'formula' in node.map)) {
      const m = node.map as { expr?: string | object; formula?: string };
      const expr = 'expr' in m ? m.expr! : m.formula!;
      arr = (evaluateFormula(expr, stateWithScope).value as unknown[]) ?? [];
    } else {
      arr = [];
    }
    if (!Array.isArray(arr)) return null;

    // The outer repeat's context.item becomes the `parent` for nested repeats
    const outerItemCtx = (scope?.context as { item?: unknown } | undefined)?.item ?? null;

    return (
      <>
        {arr.map((item, index) => {
          // `data` = raw item fields + all repeat metadata under one key.
          // Canonical access: context.item?.['data']?.['productName'], context.item?.['data']?.['index'], etc.
          // Backward compat: raw item fields are also spread on context.item root so
          //   existing context.item?.['productName'] formulas still resolve.
          const dataCtx = {
            ...(typeof item === 'object' && item !== null ? (item as object) : {}),
            index,
            repeatIndex: index,
            isACopy: false,
            parent: outerItemCtx,
            repeatedItems: arr,
          };
          const itemCtx = {
            ...(typeof item === 'object' && item !== null ? (item as object) : {}),
            data: dataCtx,
            // top-level aliases kept for backward compat
            parent: outerItemCtx,
            index,
            repeatIndex: index,
            isACopy: false,
            repeatedItems: arr,
          };
          return (
            <SDURendererInner
              key={node.key ? `${node.key}-${index}` : index}
              node={{ ...node, map: undefined, key: node.key ? `${node.key}-${index}` : String(index) }}
              context={context}
              scope={{ ...scope, $item: item, $index: index, $parent: scope?.$item, context: { item: itemCtx, index, parent: outerItemCtx } }}
              builderPath={`${builderPath}-m${index}`}
            />
          );
        })}
      </>
    );
  }

  const Component = getComponent(node.type);
  if (!Component) {
    console.warn(`[SDUI] Unknown component type: ${node.type}`);
    return null;
  }

  const className = node.className ?? node.props?.className;
  const resolvedProps = resolveProps(
    {
      ...node.props,
      ...(node.id && { id: node.id }),
      ...(className && { className }),
      ...(node.src && { src: node.src }),
      ...(node.alt && { alt: node.alt }),
    },
    sduiContext,
    runAction,
    scope
  );

  const cleanProps = Object.fromEntries(
    Object.entries(resolvedProps).filter(([k]) => !k.startsWith('$') && k !== '_meta')
  ) as Record<string, unknown>;

  // Apply _stateOverrides className for the active preview state in builder mode
  if (builderMode && previewState && previewState !== 'normal') {
    const overrides = (node as { _stateOverrides?: Record<string, { className?: string }> })._stateOverrides;
    const overrideClass = overrides?.[previewState]?.className;
    if (overrideClass) {
      const base = (cleanProps.className as string | undefined) ?? '';
      cleanProps.className = mergeTailwindClasses(base, overrideClass);
    }
  }

  // Merge classFormulas into className so formula-bound class fields survive React re-renders.
  // classFormulas is a builder-side sidecar (node.props.classFormulas) that stores { formula } objects
  // for class-based FieldWithBinding fields (selfAlignment, textAlign, shadow, etc.).
  {
    const classFormulas = node.props?.classFormulas as Record<string, { formula?: string }> | undefined;
    if (classFormulas) {
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
  }

  // Disabled preview state: apply visual disabled styling to interactive nodes
  const INTERACTIVE_TYPES = new Set(['Button', 'Input', 'Select', 'Pressable', 'InputField', 'ButtonText']);
  if (builderMode && (merged as Record<string, unknown> | null | undefined)?._preview_disabled && INTERACTIVE_TYPES.has(node.type)) {
    cleanProps.disabled = true;
    cleanProps.className = mergeTailwindClasses(
      (cleanProps.className as string) ?? '',
      'opacity-50 pointer-events-none'
    );
  }

  Object.assign(cleanProps, bindActionsToProps(node.actions, runAction, actionsConfig, scope, node.type));
  applyFormContextBindings(node, cleanProps, formCtx, actionsConfig);
  trackFormFieldProps(node, cleanProps, formCtx, parentInputId);

  // Pass the SDUI node ID to FormContainer so it can sync to variables['{id}-form'].
  // When the node has no explicit id (e.g. screen JSON loaded from config), pass an empty
  // string so FormContainer falls back to its own stable internal ID (see FormContainer.tsx).
  if ((node.type as string) === 'FormContainer') {
    cleanProps._formNodeId = node.id ?? '';
  }

  // Builder mode: annotate nodes via a ref callback that writes directly onto
  // the real DOM element. We cannot use cleanProps['data-builder-id'] because
  // Gluestack/NativeWind's cssInterop chain strips unknown data-* props before
  // they reach the DOM. A ref callback bypasses all that and is guaranteed to
  // land on the actual rendered element.
  //
  // Nodes without an explicit id (e.g. the synthetic root Box from pageConfig.ui)
  // get NO data-builder-id so clicking the page background correctly deselects.
  if (builderMode && node.id) {
    const _bId   = node.id;
    const _bType = node.type;
    const _prevRef = cleanProps.ref as React.Ref<unknown> | undefined;
    cleanProps.ref = (el: unknown) => {
      if (el && typeof (el as Element).setAttribute === 'function') {
        (el as Element).setAttribute('data-builder-id',   _bId);
        (el as Element).setAttribute('data-builder-type', _bType);
      }
      // Compose with any existing ref on the node
      if (typeof _prevRef === 'function') {
        _prevRef(el);
      } else if (_prevRef && typeof _prevRef === 'object' && 'current' in _prevRef) {
        (_prevRef as React.MutableRefObject<unknown>).current = el;
      }
    };
  }

  const textContent = node.text != null ? resolveText(node.text, sduiContext, scope) : undefined;

  let children: React.ReactNode = null;
  if (node.children?.length) {
    const childElements = node.children.map((child, i) => {
      if (child == null) return null;
      const childKey = child.key;
      const isScopeVar = childKey === '$index' || childKey === '$item';
      const key = childKey && !isScopeVar ? childKey : `child-${i}`;
      return <SDURendererInner key={key} node={child} context={context} scope={scope} builderPath={`${builderPath}-${i}`} />;
    });
    // Provide parent Input ID to descendant InputField nodes so they can write to
    // variables['{inputId}-value'] on change (formula live-binding).
    children = (node.type as string) === 'Input' && node.id
      ? <InputParentContext.Provider value={node.id}>{childElements}</InputParentContext.Provider>
      : childElements;
  } else if (textContent !== undefined) {
    children = textContent;
  }

  // Guard: strip onPress from any component that is NOT a press-type.
  // This prevents React from logging "Unknown event handler property `onPress`" when
  // onPress accidentally ends up in cleanProps (e.g. from node.props JSON or any other path).
  if (!PRESS_ONLY_TYPES.has(node.type as string)) {
    delete cleanProps.onPress;
  }

  const element = React.createElement(Component, { ...cleanProps, key: node.key }, children);

  // Wrap any non-interactive element that has a click handler in a transparent div.
  // display:contents makes the wrapper invisible to layout (no size, padding, margin, background)
  // so the inner element's styles are completely unaffected.
  // Skipped in builder mode — the capture overlay handles all pointer events there.
  const ALREADY_CLICKABLE = new Set([
    'Pressable', 'Button', 'Link', 'MenuItem', 'MenuItemLabel', 'FormContainer',
  ]);
  const hasClickHandler = !!(cleanProps.onClick || cleanProps.onPress);
  const needsClickWrapper = hasClickHandler
    && !ALREADY_CLICKABLE.has(node.type as string)
    && !builderMode;

  if (needsClickWrapper) {
    const clickHandler = (cleanProps.onClick ?? cleanProps.onPress) as React.MouseEventHandler;
    return React.createElement(
      'div',
      { onClick: clickHandler, style: { display: 'contents', cursor: 'pointer' }, 'data-clickable': 'true' },
      element
    );
  }

  if (node.dataSource) {
    return (
      <DataSourceWrapper dataSource={node.dataSource} fetchData={fetchData}>
        {element}
      </DataSourceWrapper>
    );
  }

  // Disabled overlay: when props.disabled is truthy, wrap the element with a
  // relative container and place a configurable overlay div on top.
  // In builder mode we show it when disabled is literally true or when the user
  // has toggled "Force show in editor" (_forceDisabledInEditor) for formula bindings.
  const showDisabledOverlay =
    resolvedProps.disabled === true ||
    (node as { _forceDisabledInEditor?: boolean })._forceDisabledInEditor === true;
  if (showDisabledOverlay) {
    const ov = node._disabledOverlay;
    // Use rgba() so backdrop-filter isn't composited at the same opacity level.
    // The `opacity` CSS property would make the blur effect itself semi-transparent,
    // which can prevent it from being visually noticeable. rgba() keeps them independent.
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
      // In builder mode the transparent capture overlay handles all pointer events;
      // setting 'none' here lets clicks pass through to the underlying element so
      // the user can still select it in the canvas.
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

  return element;
});

export function SDURenderer({ node, context }: Omit<RendererProps, 'scope'>) {
  return <SDURendererInner node={node} context={context} />;
}
