/**
 * bindings.ts — Resolve node.actions into React event-handler props.
 *
 * Takes a node's actions (array or object format) and a workflow emitter,
 * returns a record of propName → JSX handler source string.
 *
 * The result is injected verbatim into the JSX props block.
 */

import type { SymbolMap } from './types';

type ActionRef = { action: string; trigger?: string; stopPropagation?: boolean; __inlineCode?: string };

const LIFECYCLE = new Set(['created', 'mounted']);

/** Map engine event name → React prop name */
function eventToProp(event: string, componentType?: string): string | null {
  if (LIFECYCLE.has(event)) return null; // handled by useEffect
  // submitValidationError on FormContainer — not a DOM event; handled inside the onSubmit error handler via onValidationError ref
  if (event === 'submitValidationError' && componentType === 'FormContainer') return null;
  if (event === 'click') return 'onClick';
  if (event === 'change') return 'onChange';
  if (event === 'keyDown' || event === 'enterKey') return 'onKeyDown';
  if (event === 'doubleClick') return 'onDoubleClick';
  if (event === 'valueChange') return 'onValueChange';
  if (event === 'submit') return componentType === 'FormContainer' ? 'onSubmit' : 'onSubmit';
  if (event === 'focus') return 'onFocus';
  if (event === 'blur') return 'onBlur';
  if (event === 'mouseEnter') return 'onMouseEnter';
  if (event === 'mouseLeave') return 'onMouseLeave';
  // Engine-specific drag/sort/custom events with no DOM equivalent — skip them
  const NO_DOM_EVENTS = new Set([
    'dragUpdate', 'dragStart', 'dragEnd', 'sortUpdate', 'sortStart', 'sortEnd',
    'propertyChange', 'trigger', 'init', 'initCreated', 'beforeUnmount',
  ]);
  if (NO_DOM_EVENTS.has(event)) return null;
  // camelCase catch-all
  if (!event.includes('-')) return `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;
  return null;
}

/**
 * Given an action ref, build the handler body that calls the workflow.
 * When inMapScope=true the handler is inside a .map() iteration, so _item is in scope.
 * We pass context: { item: _item } so workflows can access context?.item?.data?.* formulas.
 */
function buildHandlerBody(actionRef: ActionRef, symbols: SymbolMap, inMapScope = false): string {
  const stop = actionRef.stopPropagation ? 'e.stopPropagation();\n  ' : '';
  // __inlineCode from shared-component workflows takes priority (avoids round-trip through lib/actions/)
  if (actionRef.__inlineCode) {
    return `${stop}${actionRef.__inlineCode}`;
  }
  const wfName = symbols.workflows.get(actionRef.action);
  if (!wfName) {
    // Inline action with no workflow — should not happen in normal flow
    return `/* unknown workflow: ${actionRef.action} */`;
  }
  // Pass item + parentItemId so workflows can access $parent.id via context.parentItemId
  const contextArg = inMapScope ? `, context: { item: _item, parentItemId: (_parentItemId ?? null) as unknown }` : '';
  return `${stop}await ${wfName}({ state: useStore.getState(), dispatch: useStore.setState, router, api, form, popover, event: e${contextArg} });`;
}

/**
 * Build event-handler prop strings for a node's actions.
 * Returns an array of strings like: `onClick={async (e) => { ... }}`
 * Pass inMapScope=true when the node is inside a .map() so _item context is forwarded to workflows.
 */
export function buildActionProps(
  actions: Record<string, unknown> | unknown[] | undefined,
  symbols: SymbolMap,
  workflowMeta: Record<string, { trigger?: string }>,
  componentType?: string,
  inMapScope = false,
): string[] {
  if (!actions) return [];
  const props: Record<string, string[]> = {};

  if (Array.isArray(actions)) {
    for (const item of actions) {
      if (!item || typeof item !== 'object') continue;
      const ref = item as ActionRef;
      const workflowDef = workflowMeta[ref.action];
      const trigger = ref.trigger ?? workflowDef?.trigger ?? 'click';
      const propName = eventToProp(trigger, componentType);
      if (!propName) continue;
      if (!props[propName]) props[propName] = [];
      props[propName]!.push(buildHandlerBody(ref, symbols, inMapScope));
    }
  } else if (typeof actions === 'object') {
    for (const [event, action] of Object.entries(actions as Record<string, unknown>)) {
      const propName = eventToProp(event, componentType);
      if (!propName) continue;
      const ref = { action: String((action as ActionRef).action ?? action), ...(action as object) } as ActionRef;
      if (!props[propName]) props[propName] = [];
      props[propName]!.push(buildHandlerBody(ref, symbols, inMapScope));
    }
  }

  return Object.entries(props).map(([propName, bodies]) => {
    // onSubmit handlers must always call preventDefault to prevent native browser form submission
    const prefix = propName === 'onSubmit' ? `(e as Event)?.preventDefault?.();\n  ` : '';
    const body = bodies.join('\n  ');
    return `${propName}={async (e?: unknown) => {\n  ${prefix}${body}\n}}`;
  });
}

/**
 * Extract lifecycle triggers (created/mounted) from node actions.
 * Returns an array of workflow names to call in useEffect.
 */
export function extractLifecycleTriggers(
  actions: Record<string, unknown> | unknown[] | undefined,
  workflowMeta: Record<string, { trigger?: string }>,
  symbols: SymbolMap,
): Array<{ event: string; wfName: string }> {
  const result: Array<{ event: string; wfName: string }> = [];
  if (!actions) return result;

  const items: ActionRef[] = Array.isArray(actions)
    ? (actions as ActionRef[])
    : Object.entries(actions as Record<string, unknown>).map(([event, action]) => ({
        action: String((action as ActionRef).action ?? action),
        trigger: event,
      }));

  for (const item of items) {
    const trigger = item.trigger ?? workflowMeta[item.action]?.trigger ?? 'click';
    if (LIFECYCLE.has(trigger)) {
      const wfName = symbols.workflows.get(item.action);
      if (wfName) result.push({ event: trigger, wfName });
    }
  }

  return result;
}
