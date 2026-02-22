/**
 * Binds SDUI node actions to React event props (onPress, onChange, etc.)
 */

import type React from 'react';

type RunAction = (action: unknown, event?: unknown, scope?: Record<string, unknown>) => void | Promise<void>;

/**
 * Binds node.actions to event handler props.
 * Returns a record of prop names to handler functions to merge into component props.
 */
export function bindActionsToProps(
  actions: Record<string, unknown> | undefined,
  runAction: RunAction,
  actionsConfig: Record<string, unknown> | undefined,
  scope: Record<string, unknown> | undefined
): Record<string, (...args: unknown[]) => void> {
  const result: Record<string, (...args: unknown[]) => void> = {};
  if (!actions) return result;

  for (const [event, action] of Object.entries(actions)) {
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
      result.onPress = handler;
      result.onClick = handler;
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
    } else {
      const propName = `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;
      result[propName] = handler;
    }
  }

  return result;
}
