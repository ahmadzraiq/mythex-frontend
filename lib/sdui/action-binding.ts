/**
 * Binds SDUI node actions to React event props (onPress, onChange, etc.)
 * Uses onClick for View-based components (avoids "Unknown event handler onPress" on DOM).
 * Uses onPress for press-based components (Button, Link, MenuItem).
 *
 * Supports two action formats:
 * - Array format (preferred): `actions: [{ action: "workflowName" }, ...]`
 *   The trigger event is read from the workflow definition's `trigger` field.
 *   This removes the need to hard-code the event name on the node — the workflow owns its trigger.
 * - Object format (legacy): `actions: { click: { action: "..." }, change: { action: "..." } }`
 */

import type React from 'react';
import { normalizeEvent } from './actions/normalize-event';

type RunAction = (action: unknown, event?: unknown, scope?: Record<string, unknown>) => void | Promise<void>;

const PRESS_HANDLER_TYPES = new Set(['MenuItem', 'MenuItemLabel']);

/**
 * Lifecycle triggers that are handled by the engine/renderer via useEffect or FormContainer —
 * they must NOT be converted to DOM event props (e.g. onCreated, onMounted) because React will
 * log "Unknown event handler property" and silently discard them.
 * Note: submitValidationError is handled explicitly below before this set is checked.
 */
const LIFECYCLE_TRIGGERS = new Set(['created', 'mounted']);

/** Attach a single action to the appropriate React event prop based on the trigger event name */
function bindEventHandler(
  event: string,
  action: unknown,
  result: Record<string, (...args: unknown[]) => void>,
  runAction: RunAction,
  actionsConfig: Record<string, unknown> | undefined,
  scope: Record<string, unknown> | undefined,
  componentType?: string
): void {
  // Lifecycle triggers are handled separately (engine useEffect / FormContainer).
  // They must not become DOM event props or React will warn and silently drop them.
  if (LIFECYCLE_TRIGGERS.has(event)) return;

  const actionName = typeof action === 'object' && action && 'action' in action ? String((action as { action: string }).action) : '';
  const actionDef = actionName && actionsConfig?.[actionName] as Record<string, unknown> | undefined;
  const shouldStop = !!(
    (actionDef && actionDef.stopPropagation === true) ||
    (typeof action === 'object' && action && 'stopPropagation' in action && (action as Record<string, unknown>).stopPropagation === true)
  );

  const handler = (e?: unknown) => {
    if (shouldStop && e && typeof e === 'object' && 'stopPropagation' in e && typeof (e as { stopPropagation: () => void }).stopPropagation === 'function') {
      (e as { stopPropagation: () => void }).stopPropagation();
    }
    const normalizedEvt = normalizeEvent(e, event);
    runAction(action, normalizedEvt, scope);
  };

  // submitValidationError is a FormContainer-specific trigger.
  // Wire it to onValidationErrorAction; ignore for all other nodes.
  if (event === 'submitValidationError') {
    if (componentType === 'FormContainer') result.onValidationErrorAction = handler;
    return;
  }

  if (event === 'click') {
    if (componentType && PRESS_HANDLER_TYPES.has(componentType)) {
      result.onPress = handler;
    } else {
      result.onClick = handler;
    }
  } else if (event === 'change') {
    result.onChangeText = handler;
    result.onChange = (e: unknown) => {
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
    result.onKeyDown = keyHandler;
    result.onKeyPress = keyHandler;
    result.onSubmitEditing = () => handler(undefined);
  } else if (event === 'enterKey') {
    const enterHandler = (e: React.KeyboardEvent | { key?: string; keyCode?: number; nativeEvent?: { key?: string; keyCode?: number }; preventDefault?: () => void }) => {
      const key = e.key ?? (e.nativeEvent as { key?: string })?.key;
      const code = e.keyCode ?? (e.nativeEvent as { keyCode?: number })?.keyCode;
      if (key === 'Enter' || code === 13) {
        e.preventDefault?.();
        handler(e);
      }
    };
    result.onKeyDown = enterHandler;
    result.onKeyPress = enterHandler;
    result.onSubmitEditing = () => handler(undefined);
  } else if (event === 'doubleClick') {
    result.onDoubleClick = handler;
    // For press-type components (Button, Link), onPress may not forward onDoubleClick
    // to the underlying DOM div. Implement a manual double-press detector via onPress as fallback.
    if (componentType && PRESS_HANDLER_TYPES.has(componentType)) {
      let lastPressTime = 0;
      result.onPress = (...args: unknown[]) => {
        const now = Date.now();
        if (now - lastPressTime < 400) {
          handler(...args);
          lastPressTime = 0;
        } else {
          lastPressTime = now;
        }
      };
    }
  } else if (event === 'valueChange') {
    result.onValueChange = (value: unknown) => handler(value);
  } else if (event === 'submit') {
    // FormContainer exposes onSubmitAction; for any other component use the standard onSubmit prop
    if (componentType === 'FormContainer') {
      result.onSubmitAction = handler;
    } else {
      result.onSubmit = handler;
    }
  } else if (!event.includes('-')) {
    // Only map pure camelCase event names (no hyphens) to DOM props.
    // SC custom trigger IDs (e.g. "btn-t-on-click") contain hyphens and are
    // handled exclusively by the ComponentTriggerDispatcher — they must never
    // become DOM event props or React will warn and silently drop them.
    const propName = `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;
    result[propName] = handler;
  }
}

/**
 * Binds node.actions to event handler props.
 * Returns a record of prop names to handler functions to merge into component props.
 */
export function bindActionsToProps(
  actions: Record<string, unknown> | unknown[] | undefined,
  runAction: RunAction,
  actionsConfig: Record<string, unknown> | undefined,
  scope: Record<string, unknown> | undefined,
  componentType?: string
): Record<string, (...args: unknown[]) => void> {
  const result: Record<string, (...args: unknown[]) => void> = {};
  if (!actions) return result;

  // ── Array format: trigger-based binding (preferred) ──────────────────────
  // Each item in the array is a workflow reference. The trigger event is read
  // from the workflow definition so UI nodes don't need to hard-code it.
  // When multiple actions share the same trigger, their handlers are chained
  // sequentially rather than the last one overwriting the previous ones.
  if (Array.isArray(actions)) {
    for (const item of actions) {
      if (!item || typeof item !== 'object') continue;
      const actionRef = item as Record<string, unknown>;
      const workflowName = typeof actionRef.action === 'string' ? actionRef.action : '';
      const workflowDef = workflowName
        ? (actionsConfig?.[workflowName] as Record<string, unknown> | undefined)
        : undefined;
      // Resolve trigger: named workflow def > item's own trigger field > default 'click'
      // The item's own trigger field is set by the workflow canvas for element workflows
      // (format: { trigger: 'click', steps: [...] })
      const trigger = (typeof workflowDef?.trigger === 'string' ? workflowDef.trigger : null)
        ?? (typeof actionRef.trigger === 'string' ? actionRef.trigger : null)
        ?? 'click';
      // Capture handlers for this action into a temp object, then merge-chain into result
      const temp: Record<string, (...args: unknown[]) => void> = {};
      bindEventHandler(trigger, item, temp, runAction, actionsConfig, scope, componentType);
      for (const [propName, newHandler] of Object.entries(temp)) {
        const prevHandler = result[propName];
        if (prevHandler) {
          result[propName] = (...args: unknown[]) => { prevHandler(...args); newHandler(...args); };
        } else {
          result[propName] = newHandler;
        }
      }
    }
    return result;
  }

  // ── Object format: legacy event-keyed bindings ────────────────────────────
  for (const [event, action] of Object.entries(actions)) {
    bindEventHandler(event, action, result, runAction, actionsConfig, scope, componentType);
  }

  return result;
}
