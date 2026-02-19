'use client';

/**
 * SDUI Renderer - Fine-grained reactivity
 * Each node subscribes only to the variables it uses - no unnecessary re-renders
 */

import React, { useEffect, memo } from 'react';
import { getComponent } from './component-registry';
import { evaluateCondition, interpolate, resolveProps } from './utils';
import {
  createVariableStore,
  extractNodeDependencies,
  useVariablePaths,
  type VariableStoreConfig,
} from './variable-store';
import type { SDUINode, SDUIContext } from './types';

interface RendererContext {
  store: ReturnType<typeof createVariableStore>;
  storeConfig: VariableStoreConfig;
  runAction: SDUIContext['runAction'];
  fetchData: SDUIContext['fetchData'];
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

/** Create a context-like get that reads from store with scope */
function createGet(store: ReturnType<typeof createVariableStore>, scope?: Record<string, unknown>) {
  return (path: string, s?: Record<string, unknown>) => store.getState().get(path, s ?? scope);
}

const SDURendererInner = memo(function SDURendererInner({ node, context, scope }: RendererProps) {
  const { store, storeConfig, runAction, fetchData } = context;
  const deps = extractNodeDependencies(node);
  useVariablePaths(store, deps, scope);
  const get = createGet(store, scope);
  const state = store.getState().getFullState();
  const stateWithScope = scope ? { ...state, $item: scope.$item, $index: scope.$index } : state;
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
            scope={{ $item: item, $index: index }}
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

  if ((node.type as string) === 'Form') {
    cleanProps.runAction = runAction;
    cleanProps.setState = (updater: (prev: Record<string, unknown>) => Record<string, unknown>) =>
      store.getState().setState(updater);
  }

  if (node.actions) {
    for (const [event, action] of Object.entries(node.actions)) {
      const handler = (e?: unknown) => runAction(action, e, scope);
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
      } else {
        const propName = `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;
        cleanProps[propName] = handler;
      }
    }
  }

  const textContent = node.text ? interpolate(node.text, sduiContext, scope) : undefined;

  let children: React.ReactNode = null;
  if (node.children?.length) {
    children = node.children.map((child, i) => (
      <SDURendererInner key={child.key ?? i} node={child} context={context} scope={scope} />
    ));
  } else if (textContent !== undefined) {
    children = textContent;
  }

  if (node.type === 'Button' && textContent && !node.children?.length) {
    const { Button: Btn, ButtonText: BtnText } = require('@/components/ui/button');
    return React.createElement(Btn, cleanProps, React.createElement(BtnText, null, textContent));
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
