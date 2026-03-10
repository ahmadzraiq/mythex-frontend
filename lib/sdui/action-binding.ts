/**
 * Binds SDUI node actions to React event props (onPress, onChange, etc.)
 * Uses onClick for View-based components (avoids "Unknown event handler onPress" on DOM).
 * Uses onPress for Pressable-based components (Button, Link, Pressable).
 *
 * Supports two action formats:
 * - Array format (preferred): `actions: [{ action: "workflowName" }, ...]`
 *   The trigger event is read from the workflow definition's `trigger` field.
 *   This removes the need to hard-code the event name on the node — the workflow owns its trigger.
 * - Object format (legacy): `actions: { click: { action: "..." }, change: { action: "..." } }`
 */

import type React from 'react';

type RunAction = (action: unknown, event?: unknown, scope?: Record<string, unknown>) => void | Promise<void>;

const PRESS_HANDLER_TYPES = new Set(['Pressable', 'Button', 'Link', 'MenuItem', 'MenuItemLabel']);

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
    runAction(action, e, scope);
  };

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
  } else if (event === 'valueChange') {
    result.onValueChange = (value: unknown) => handler(value);
  } else if (event === 'submit') {
    // FormContainer exposes onSubmitAction; for any other component use the standard onSubmit prop
    if (componentType === 'FormContainer') {
      result.onSubmitAction = handler;
    } else {
      result.onSubmit = handler;
    }
  } else {
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
  if (Array.isArray(actions)) {
    for (const item of actions) {
      if (!item || typeof item !== 'object') continue;
      const actionRef = item as Record<string, unknown>;
      const workflowName = typeof actionRef.action === 'string' ? actionRef.action : '';
      const workflowDef = workflowName ? actionsConfig?.[workflowName] as Record<string, unknown> | undefined : undefined;
      // Resolve trigger: named workflow def > item's own trigger field > default 'click'
      // The item's own trigger field is set by the workflow canvas for element workflows
      // (format: { type: 'workflowSteps', trigger: 'click', steps: [...] })
      const trigger = (typeof workflowDef?.trigger === 'string' ? workflowDef.trigger : null)
        ?? (typeof actionRef.trigger === 'string' ? actionRef.trigger : null)
        ?? 'click';
      bindEventHandler(trigger, item, result, runAction, actionsConfig, scope, componentType);
    }
    return result;
  }

  // ── Object format: legacy event-keyed bindings ────────────────────────────
  for (const [event, action] of Object.entries(actions)) {
    bindEventHandler(event, action, result, runAction, actionsConfig, scope, componentType);
  }

  return result;
}
