'use client';

/**
 * SDUI Renderer - Fine-grained reactivity
 * Each node subscribes only to the variables it uses - no unnecessary re-renders
 */

import React, { useEffect, memo, useSyncExternalStore, useContext } from 'react';
import { FormContext, type FieldValidationConfig } from './form-context';
import { getGlobalVariableStore } from './global-variable-store';

/** Stable empty object for useSyncExternalStore fallback — avoids infinite loop from new {} each call */
const STABLE_EMPTY_OBJECT: Record<string, unknown> = {};
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

  // Auto-register form fields — when a node has a setFormField action, declare
  // the field in the nearest FormContainer immediately on mount so the formula
  // editor shows it without requiring user input first.
  // Also register _validation rules when present so FormContainer can validate on submit.
  const formCtx = useContext(FormContext);
  useEffect(() => {
    if (formCtx) {
      let cleanup: (() => void) | undefined;

      // Register _validation rules if declared on this node (e.g. InputField with _validation)
      const nodeName = (node as { name?: string }).name;
      const nodeValidation = (node as { _validation?: unknown })._validation as FieldValidationConfig | undefined;
      if (nodeName && nodeValidation?.rules?.length) {
        formCtx.registerFieldValidation(nodeName, nodeValidation);
        const prev = cleanup;
        cleanup = () => { prev?.(); formCtx.unregisterFieldValidation(nodeName); };
      }

      // Register the field in formData via setFormField action detection
      const actions = node.actions;
      if (actions) {
        // Find setFormField — may be direct or nested inside runMultiple
        const findSetFormField = (a: unknown): Record<string, unknown> | null => {
          if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
          const obj = a as Record<string, unknown>;
          if (obj.type === 'setFormField') return obj;
          if (obj.type === 'runMultiple' && Array.isArray(obj.actions)) {
            for (const nested of obj.actions) {
              const found = findSetFormField(nested);
              if (found) return found;
            }
          }
          return null;
        };
        for (const a of Object.values(actions)) {
          const action = findSetFormField(a);
          if (action) {
            const fieldName = action.field;
            if (typeof fieldName === 'string' && fieldName) {
              const initialValue = node._initialValue ?? '';
              formCtx.registerField(fieldName, initialValue);
              const prev = cleanup;
              cleanup = () => { prev?.(); formCtx.unregisterField(fieldName); };
              break;
            }
          }
        }
      }

      return cleanup;
    }
    // Standalone controlled components (outside FormContainer) — register value at
    // components.nodeId.value so formula editor's "From components" section shows live data.
    const standaloneTypes = new Set(['InputField', 'TextareaInput', 'Checkbox']);
    if (standaloneTypes.has(node.type as string) && node.id) {
      const path = `components.${node.id}.value`;
      getGlobalVariableStore().getState().set(path, '');
      return () => {
        const store = getGlobalVariableStore().getState();
        store.setState((prev) => {
          const next = { ...prev };
          const comp = next.components as Record<string, Record<string, unknown>> | undefined;
          if (comp?.[node.id!]) {
            const nodeData = { ...comp[node.id!] };
            delete nodeData.value;
            if (Object.keys(nodeData).length === 0) {
              const newComp = { ...comp };
              delete newComp[node.id!];
              next.components = Object.keys(newComp).length ? newComp : undefined;
            } else {
              next.components = { ...comp, [node.id!]: nodeData };
            }
          }
          return next;
        });
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.actions, node.id, node.type, formCtx?.registerField, formCtx?.unregisterField, formCtx?.registerFieldValidation, formCtx?.unregisterFieldValidation]);

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

  // When a Button/Pressable with type="submit" is inside a FormContainer, wire its press/click
  // to call formCtx.submit(). Gluestack Button renders as <div role="button"> (not <button>),
  // so the HTML form's onSubmit never fires naturally from a button click.
  const SUBMIT_BUTTON_TYPES = new Set(['Button', 'Pressable']);
  if (SUBMIT_BUTTON_TYPES.has(node.type) && cleanProps.type === 'submit' && formCtx) {
    const existingPress = cleanProps.onPress as ((...args: unknown[]) => void) | undefined;
    const existingClick = cleanProps.onClick as ((...args: unknown[]) => void) | undefined;
    cleanProps.onPress = (...args: unknown[]) => { existingPress?.(...args); formCtx.submit(); };
    cleanProps.onClick = (...args: unknown[]) => { existingClick?.(...args); formCtx.submit(); };
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
    children = node.children.map((child, i) => {
      if (child == null) return null;
      const childKey = child.key;
      const isScopeVar = childKey === '$index' || childKey === '$item';
      const key = childKey && !isScopeVar ? childKey : `child-${i}`;
      return <SDURendererInner key={key} node={child} context={context} scope={scope} builderPath={`${builderPath}-${i}`} />;
    });
  } else if (textContent !== undefined) {
    children = textContent;
  }

  const element = React.createElement(Component, { ...cleanProps, key: node.key }, children);

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
