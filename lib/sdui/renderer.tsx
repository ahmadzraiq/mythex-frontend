'use client';

/**
 * SDUI Renderer - Fine-grained reactivity
 * Each node subscribes only to the variables it uses - no unnecessary re-renders
 */

import React, { useEffect, memo, useSyncExternalStore } from 'react';

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
        // New context object — mirrors weWeb's context.item / context.index / context.parent
        // Also available directly on scope so createGet / isScopeVariable can resolve context.item.*
        context: { item: scope.$item, index: scope.$index, parent: scope.$parent },
      }
    : state;
  const sduiContext: SDUIContext = {
    state: stateWithScope,
    setState: (updater) => store.getState().setState(updater),
    get,
    runAction,
    fetchData,
  };

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
    return (
      <>
        {arr.map((item, index) => (
          <SDURendererInner
            key={node.key ? `${node.key}-${index}` : index}
            node={{ ...node, map: undefined, key: node.key ? `${node.key}-${index}` : String(index) }}
            context={context}
            scope={{ ...scope, $item: item, $index: index, $parent: scope?.$item, context: { item, index, parent: scope?.$item } }}
            builderPath={`${builderPath}-m${index}`}
          />
        ))}
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

  return element;
});

export function SDURenderer({ node, context }: Omit<RendererProps, 'scope'>) {
  return <SDURendererInner node={node} context={context} />;
}
