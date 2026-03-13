'use client';

/**
 * SDUI Renderer - Fine-grained reactivity
 * Each node subscribes only to the variables it uses - no unnecessary re-renders
 *
 * Prop-mutation helpers and element-wrapping utilities live in renderer-node-props.tsx.
 * This file is responsible only for the rendering lifecycle: state setup, map expansion,
 * hook orchestration, and JSX composition.
 */

import React, { memo, useSyncExternalStore, useContext, useEffect, useRef, useMemo } from 'react';
import { FormContext, FormScopeContext } from './form-context';
import { getNestedValue } from './nested-utils';
import { trackFormFieldProps, useFormFieldRegistration, useExternalNodeValueSync, useExternalFormSync } from './form-field-tracker';
import { evaluateFormula } from './formula-evaluator';
import { getComponent } from './component-registry';
import { evaluateCondition, resolveProps, resolveText } from './utils';
import { createVariableStore, useVariablePaths } from './variable-store';
import { extractNodeDependencies } from './dependency-extractor';
import type { SDUINode, SDUIContext } from './types';
import { isScreenScopedPath } from './path-utils';
import { createGet } from './create-get';
import { bindActionsToProps } from './action-binding';
import { useBuilderMode } from './builder-context';
import { InputParentContext, useParentInputId } from './input-parent-context';
import { PARENT_CONTEXT_PROVIDER_TYPES } from './controlled-component-registry';
import {
  PRESS_ONLY_TYPES,
  applyFormContextBindings, applyStateOverrides, applyClassFormulas, applyAutofill,
  applyDisabledPreview, injectControlledProps, applyBuilderAnnotation,
  wrapWithClickHandler, renderWithDisabledOverlay,
  DataSourceWrapper,
} from './renderer-node-props';

/** Stable empty object for useSyncExternalStore fallback — avoids infinite loop from new {} each call */
const STABLE_EMPTY_OBJECT: Record<string, unknown> = {};

/** No-op subscribe — used by useSyncExternalStore when we don't need a subscription */
const NOOP_SUBSCRIBE_FN = (_cb: () => void) => () => {};

interface RendererContext {
  store: ReturnType<typeof createVariableStore>;
  mergedStore?: { getState: () => { merged: Record<string, unknown> }; subscribe: (cb: () => void) => () => void };
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

const SDURendererInner = memo(function SDURendererInner({ node, context, scope, builderPath = '0' }: RendererProps) {
  const { builderMode } = useBuilderMode();
  const { store, mergedStore, mergedState, runAction, fetchData, actionsConfig, screenName, screenScopedAliases = [], previewState } = context;

  // Builder needs full subscription so preview-state patches (loading/error/disabled overlays
  // applied in applyBuilderPatches) immediately trigger a re-render on every setMerged call.
  //
  // Production: skip the blanket subscription — it causes O(N) re-renders per rAF tick because
  // Zustand always creates a new { merged: newObj } reference, making Object.is always fail for
  // every mounted SDURendererInner regardless of whether its deps changed. Instead, read merged
  // directly at render time; useVariablePaths (below) is the sole re-render scheduler and only
  // fires for components whose specific dep values actually changed.
  const mergedFromStore = useSyncExternalStore(
    builderMode && mergedStore ? mergedStore.subscribe : NOOP_SUBSCRIBE_FN,
    () => builderMode && mergedStore ? mergedStore.getState().merged : STABLE_EMPTY_OBJECT,
    () => STABLE_EMPTY_OBJECT,
  );
  const merged = mergedStore
    ? (builderMode ? mergedFromStore : mergedStore.getState().merged)
    : (mergedState ?? STABLE_EMPTY_OBJECT);

  // FormScopeContext: set by FormContainer — scopes local.data.form.* to the
  // nearest enclosing FormContainer's isolated store instead of the shared singleton.
  const activeFormKey = useContext(FormScopeContext);

  const rawDeps = extractNodeDependencies(node);
  const screenMappedDeps =
    screenName && rawDeps.some((p) => isScreenScopedPath(p, screenScopedAliases))
      ? rawDeps.map((p) => (isScreenScopedPath(p, screenScopedAliases) ? `screens.${screenName}.${p}` : p))
      : rawDeps;
  // When inside a FormContainer, redirect local.data.form.* subscriptions to the
  // per-container isolated store (variables['formKey'].*) so only this container's
  // state changes trigger re-renders for this node — not other containers' submits.
  const LOCAL_FORM = 'local.data.form';
  const deps = activeFormKey
    ? screenMappedDeps.map(p => {
        if (p === LOCAL_FORM) return `variables['${activeFormKey}']`;
        if (p.startsWith(LOCAL_FORM + '.')) return `variables['${activeFormKey}'].${p.slice(LOCAL_FORM.length + 1)}`;
        return p;
      })
    : screenMappedDeps;

  useVariablePaths(store, deps, scope, mergedStore);
  const get = createGet(store, merged, scope, mergedStore, screenName, screenScopedAliases);
  const storeState = store.getState().getFullState();
  const state = merged ? { ...storeState, ...merged } : storeState;
  const stateBase = scope
    ? {
        ...state,
        // Legacy scope vars — kept for backward compat
        $item: scope.$item, $index: scope.$index, $parent: scope.$parent,
        // Pass through the already-structured context.item built by the map loop above,
        // so context.item.data / context.item.parent / context.item.index all resolve correctly.
        context: scope.context ?? { item: scope.$item, index: scope.$index, parent: scope.$parent },
      }
    : state;

  // Inject per-FormContainer local scope: override state.local so that any formula
  // or template expression using local.data.form.* resolves against THIS container's
  // isolated store (variables[formKey]) rather than the shared singleton.
  const formStateForScope = activeFormKey
    ? ((state.variables as Record<string, unknown> | undefined)?.[activeFormKey] as Record<string, unknown> | undefined) ?? null
    : null;
  const stateWithScope = formStateForScope
    ? { ...stateBase, local: { data: { form: formStateForScope } } }
    : stateBase;

  // Scoped getter: redirect local.data.form.* to the per-FC isolated store
  // so {{local.data.form.formData.x}} template interpolation also resolves correctly.
  const scopedGet = formStateForScope
    ? (path: string, s?: Record<string, unknown>) => {
        if (path === LOCAL_FORM) return formStateForScope;
        if (path.startsWith(LOCAL_FORM + '.')) return getNestedValue(formStateForScope, path.slice(LOCAL_FORM.length + 1));
        return get(path, s);
      }
    : get;

  const sduiContext: SDUIContext = {
    state: stateWithScope,
    setState: (updater) => store.getState().setState(updater),
    get: scopedGet,
    runAction,
    fetchData,
  };

  // Form field registration: handles all controlled components generically.
  // See lib/sdui/form-field-tracker.ts for the full implementation.
  const formCtx = useContext(FormContext);
  const parentInputId = useParentInputId();
  useFormFieldRegistration(node, formCtx, parentInputId);

  // External value sync: subscribes to the node's variable-store slot and returns
  // controlled React props. Active for all controlled types including those inside
  // FormContainer so that workflow writes (changeVariableValue) update every type.
  const { value: externalValue, isChecked: externalIsChecked } = useExternalNodeValueSync(node, formCtx, parentInputId);
  // Sync external writes back into FormContainer state (local.data.form.formData.*)
  // so form submission and formulas always read the latest value.
  useExternalFormSync(node, formCtx, parentInputId, externalValue, externalIsChecked);

  // Lifecycle triggers: collect actions with trigger "created" or "mounted" and run
  // them once on mount via useEffect. Skipped in builder mode to avoid side-effects.
  const lifecycleRefs = useMemo(() => {
    if (!node?.actions || !Array.isArray(node.actions)) return null;
    const out: unknown[] = [];
    for (const item of node.actions as Array<unknown>) {
      if (!item || typeof item !== 'object') continue;
      const actionRef = item as Record<string, unknown>;
      const wfName = typeof actionRef.action === 'string' ? actionRef.action : '';
      const wfDef = wfName ? actionsConfig?.[wfName] as Record<string, unknown> | undefined : undefined;
      const trigger = typeof wfDef?.trigger === 'string' ? wfDef.trigger : null;
      if (trigger === 'created' || trigger === 'mounted') out.push(item);
    }
    return out.length ? out : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.actions, actionsConfig]);

  const lifecycleRanRef = useRef(false);
  useEffect(() => {
    if (!lifecycleRefs || builderMode || lifecycleRanRef.current) return;
    lifecycleRanRef.current = true;
    for (const a of lifecycleRefs) {
      Promise.resolve(runAction(a as Parameters<typeof runAction>[0], undefined, scope)).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-once: lifecycle triggers fire exactly once when the node mounts

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

  // Map data-testid → testID so Gluestack Button/Pressable surfaces it in the DOM.
  // React Native uses testID (rendered as data-testid by RN-Web); plain HTML elements
  // (e.g. Text → span) forward data-* directly, but Pressable-based components do not.
  if ('data-testid' in cleanProps && !('testID' in cleanProps)) {
    cleanProps.testID = cleanProps['data-testid'];
  }

  // Apply each concern via named helpers — one function per responsibility.
  applyStateOverrides(node, cleanProps, previewState, builderMode);
  applyClassFormulas(node, cleanProps, sduiContext);
  applyAutofill(node, cleanProps, builderMode);
  applyDisabledPreview(node, cleanProps, merged, builderMode);

  Object.assign(cleanProps, bindActionsToProps(node.actions, runAction, actionsConfig, scope, node.type));
  applyFormContextBindings(node, cleanProps, formCtx, actionsConfig);
  trackFormFieldProps(node, cleanProps, formCtx, parentInputId);
  injectControlledProps(cleanProps, externalValue, externalIsChecked);

  // Pass the SDUI node ID to FormContainer so it can sync to variables['{id}-form'].
  // When the node has no explicit id (e.g. screen JSON loaded from config), pass an empty
  // string so FormContainer falls back to its own stable internal ID (see FormContainer.tsx).
  if ((node.type as string) === 'FormContainer') {
    cleanProps._formNodeId = node.id ?? '';
  }

  applyBuilderAnnotation(node, cleanProps, builderMode);

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
    // Uses PARENT_CONTEXT_PROVIDER_TYPES from registry — no hardcoded 'Input' string.
    children = PARENT_CONTEXT_PROVIDER_TYPES.has(node.type as string) && node.id
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

  // Wrap non-interactive elements that have click handlers in a transparent div.
  const wrapped = wrapWithClickHandler(element, cleanProps, node.type as string, builderMode);
  if (wrapped !== element) return wrapped;

  if (node.dataSource) {
    return (
      <DataSourceWrapper dataSource={node.dataSource} fetchData={fetchData}>
        {element}
      </DataSourceWrapper>
    );
  }

  // Disabled overlay — when props.disabled is truthy wrap with a relative container
  // and an absolutely positioned tinted/blurred overlay div.
  const disabledElement = renderWithDisabledOverlay(element, node, resolvedProps, builderMode);
  if (disabledElement) return disabledElement;

  return element;
});

export function SDURenderer({ node, context }: Omit<RendererProps, 'scope'>) {
  return <SDURendererInner node={node} context={context} />;
}
