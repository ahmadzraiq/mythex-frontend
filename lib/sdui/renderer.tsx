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

const SDURendererInner = memo(function SDURendererInner({ node, context, scope }: RendererProps) {
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

  if (node.condition === false) return null;
  if (node.condition != null && !evaluateCondition(node.condition, sduiContext)) {
    return null;
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

  const textContent = node.text != null ? resolveText(node.text, sduiContext, scope) : undefined;

  let children: React.ReactNode = null;
  if (node.children?.length) {
    children = node.children.map((child, i) => {
      if (child == null) return null;
      const childKey = child.key;
      const isScopeVar = childKey === '$index' || childKey === '$item';
      const key = childKey && !isScopeVar ? childKey : `child-${i}`;
      return <SDURendererInner key={key} node={child} context={context} scope={scope} />;
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
