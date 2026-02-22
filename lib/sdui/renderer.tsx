'use client';

/**
 * SDUI Renderer - Fine-grained reactivity
 * Each node subscribes only to the variables it uses - no unnecessary re-renders
 */

import React, { useEffect, memo } from 'react';
import { getComponent } from './component-registry';
import { evaluateCondition, interpolate, resolveProps, resolveText } from './utils';
import {
  createVariableStore,
  extractNodeDependencies,
  useVariablePaths,
  type VariableStoreConfig,
} from './variable-store';
import type { SDUINode, SDUIContext } from './types';
import { getNestedValue, setNestedValue } from './nested-utils';

function isScreenScopedPath(path: string, aliases: string[]): boolean {
  return aliases.some((a) => path === a || path.startsWith(`${a}.`));
}

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

/** Create a combined get that reads from merged store/state first, then variable store */
function createGet(
  store: ReturnType<typeof createVariableStore>,
  mergedState: Record<string, unknown> | undefined,
  scope: Record<string, unknown> | undefined,
  mergedStore: { getState: () => { merged: Record<string, unknown> } } | undefined,
  screenName: string | undefined,
  screenScopedAliases: string[]
) {
  return (path: string, s?: Record<string, unknown>) => {
    const sc = s ?? scope;
    if (sc && (path.startsWith('$item') || path.startsWith('$index') || path.startsWith('$parent') || path === '$item' || path === '$index' || path === '$parent')) {
      return getNestedValue(sc, path);
    }
    const resolvedPath =
      screenName && isScreenScopedPath(path, screenScopedAliases)
        ? `screens.${screenName}.${path}`
        : path;
    const merged = mergedStore?.getState().merged ?? mergedState;
    if (merged) {
      const fromMerged = getNestedValue(merged, resolvedPath);
      if (fromMerged !== undefined) return fromMerged;
    }
    return store.getState().get(resolvedPath, sc);
  };
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

  if (node.condition && !evaluateCondition(node.condition, sduiContext)) {
    return null;
  }

  if (node.map) {
    const arr = get(node.map) as unknown[];
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
      ...(className && { className }),
      ...(node.src && { src: node.src }),
      ...(node.alt && { alt: node.alt }),
    },
    sduiContext,
    runAction,
    scope
  );

  const cleanProps = Object.fromEntries(
    Object.entries(resolvedProps).filter(([k]) => !k.startsWith('$'))
  ) as Record<string, unknown>;

  if (node.actions) {
    for (const [event, action] of Object.entries(node.actions)) {
      const actionName = typeof action === 'object' && action && 'action' in action ? String((action as { action: string }).action) : '';
      const actionDef = actionName && actionsConfig?.[actionName] as Record<string, unknown> | undefined;
      const shouldStop = !!(actionDef && actionDef.stopPropagation === true);
      const handler = (e?: unknown) => {
        if (shouldStop && e && typeof e === 'object' && 'stopPropagation' in e && typeof (e as { stopPropagation: () => void }).stopPropagation === 'function') {
          (e as { stopPropagation: () => void }).stopPropagation();
        }
        runAction(action, e, scope);
      };
      if (event === 'click') {
        cleanProps.onPress = handler;
        cleanProps.onClick = handler;
      } else if (event === 'change') {
        cleanProps.onChangeText = handler;
        cleanProps.onChange = (e: unknown) => {
          const val =
            e && typeof e === 'object' && 'target' in e
              ? (e as { target: { value?: unknown } }).target?.value
              : e;
          handler(val);
        };
      } else if (event === 'keyDown') {
        const keyHandler = (e: React.KeyboardEvent | { key?: string; keyCode?: number; nativeEvent?: { key?: string; keyCode?: number }; preventDefault?: () => void }) => {
          const key = e.key ?? (e.nativeEvent as { key?: string })?.key;
          const code = e.keyCode ?? (e.nativeEvent as { keyCode?: number })?.keyCode;
          if (key === 'Enter' || code === 13) {
            e.preventDefault?.();
            handler(e);
          }
        };
        cleanProps.onKeyDown = keyHandler;
        cleanProps.onKeyPress = keyHandler;
        cleanProps.onSubmitEditing = () => handler(undefined);
      } else if (event === 'valueChange') {
        cleanProps.onValueChange = (value: unknown) => handler(value);
      } else {
        const propName = `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;
        cleanProps[propName] = handler;
      }
    }
  }

  const textContent = node.text != null ? resolveText(node.text, sduiContext, scope) : undefined;

  let children: React.ReactNode = null;
  if (node.children?.length) {
    children = node.children.map((child, i) => {
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
