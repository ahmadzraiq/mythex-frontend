'use client';

/**
 * SDUI Renderer - Fine-grained reactivity
 * Each node subscribes only to the variables it uses - no unnecessary re-renders
 */

import React, { useEffect, memo } from 'react';
import jsonLogic from 'json-logic-js';
import { getComponent } from './component-registry';
import { evaluateCondition, interpolate, resolveProps, resolveText } from './utils';
import { createVariableStore, useVariablePaths, type VariableStoreConfig } from './variable-store';
import { extractNodeDependencies } from './dependency-extractor';
import type { SDUINode, SDUIContext } from './types';
import { isScreenScopedPath } from './path-utils';
import { createGet } from './create-get';
import { bindActionsToProps } from './action-binding';
import { useBuilderMode } from './builder-context';

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
  const { store, mergedStore, storeConfig, mergedState, runAction, fetchData, actionsConfig, screenName, screenScopedAliases = [] } = context;
  const merged = mergedStore?.getState().merged ?? mergedState;
  const rawDeps = extractNodeDependencies(node);
  const deps =
    screenName && rawDeps.some((p) => isScreenScopedPath(p, screenScopedAliases))
      ? rawDeps.map((p) => (isScreenScopedPath(p, screenScopedAliases) ? `screens.${screenName}.${p}` : p))
      : rawDeps;
  useVariablePaths(store, deps, scope, mergedStore);
  const get = createGet(store, merged, scope, mergedStore, screenName, screenScopedAliases);
  const storeState = store.getState().getFullState();
  const state = merged ? { ...storeState, ...merged } : storeState;
  const stateWithScope = scope ? { ...state, $item: scope.$item, $index: scope.$index, $parent: scope.$parent } : state;
  const sduiContext: SDUIContext = {
    state: stateWithScope,
    setState: (updater) => store.getState().setState(updater),
    get,
    runAction,
    fetchData,
  };

  if (!node) return null;

  // In builder mode: bypass conditions — show all nodes but flag hidden ones
  if (!builderMode) {
    if (node.condition === false) return null;
    if (node.condition != null && !evaluateCondition(node.condition, sduiContext)) {
      return null;
    }
  }

  if (node.map) {
    let arr: unknown[];
    if (typeof node.map === 'string') {
      arr = (get(node.map) as unknown[]) ?? [];
    } else if (node.map && typeof node.map === 'object' && 'expr' in node.map) {
      const expr = (node.map as { expr: object }).expr;
      arr = (jsonLogic.apply(expr, stateWithScope) as unknown[]) ?? [];
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
            scope={{ ...scope, $item: item, $index: index, $parent: scope?.$item }}
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

  Object.assign(cleanProps, bindActionsToProps(node.actions, runAction, actionsConfig, scope, node.type));

  // Builder mode: annotate nodes via a ref callback that writes directly onto
  // the real DOM element. We cannot use cleanProps['data-builder-id'] because
  // Gluestack/NativeWind's cssInterop chain strips unknown data-* props before
  // they reach the DOM. A ref callback bypasses all that and is guaranteed to
  // land on the actual rendered element.
  //
  // Nodes without an explicit id (e.g. the synthetic root Box from pageConfig.ui)
  // get NO data-builder-id so clicking the page background correctly deselects.
  if (builderMode) {
    if (node.id) {
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
    // Flag nodes whose condition would be false in normal rendering
    if (node.condition != null && !evaluateCondition(node.condition, sduiContext)) {
      cleanProps['data-builder-hidden'] = 'true';
    }
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
