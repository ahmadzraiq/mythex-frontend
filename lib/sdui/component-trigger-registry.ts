/**
 * Component trigger registry (WeWeb-parity custom component events).
 *
 * A Shared/System Component instance registers a `dispatcher` on mount that
 * knows how to fan out a custom trigger to the instance's listener workflows
 * (entries on `node.actions` whose resolved workflow has `trigger === triggerId`).
 *
 * The `emitComponentTrigger` workflow step calls `emitComponentTriggerToInstance`
 * with `(instanceId, triggerId, payload)` from inside the component's own
 * workflow. The instance-local dispatcher — which closes over the current
 * `runAction`, `actionsConfig`, `node.actions`, and `effectiveScope` — is
 * responsible for running each matching listener with `context.event = payload`
 * in scope.
 *
 * This module-level registry is intentionally tiny: it's the only channel
 * between the handler (which lives outside React) and the instance node (which
 * lives inside React). Everything else (scope merging, runAction, listener
 * filtering) stays at the call site where the correct closures are in hand.
 */

/**
 * Dispatcher callback invoked when `emitComponentTriggerToInstance` is called
 * for a registered instance.
 */
export type ComponentTriggerDispatcher = (triggerId: string, payload: unknown) => void;

const _dispatchersByInstance = new Map<string, ComponentTriggerDispatcher>();

/**
 * Register a dispatcher for an SC instance. Returns an unregister function;
 * callers should invoke it on unmount. Safe to call multiple times for the
 * same `instanceId` — only the latest dispatcher is retained.
 */
export function registerInstanceTriggerDispatcher(
  instanceId: string,
  dispatcher: ComponentTriggerDispatcher,
): () => void {
  _dispatchersByInstance.set(instanceId, dispatcher);
  return () => {
    if (_dispatchersByInstance.get(instanceId) === dispatcher) {
      _dispatchersByInstance.delete(instanceId);
    }
  };
}

/**
 * Fire a custom trigger on a registered SC instance. Returns `true` if the
 * instance was found and dispatched (listeners may or may not exist for the
 * trigger), `false` if no instance is registered with that id.
 */
export function emitComponentTriggerToInstance(
  instanceId: string,
  triggerId: string,
  payload: unknown,
): boolean {
  const dispatcher = _dispatchersByInstance.get(instanceId);
  if (!dispatcher) return false;
  try {
    dispatcher(triggerId, payload);
  } catch (err) {
    if (typeof window !== 'undefined') {
      console.warn('[component-trigger-registry] dispatcher error', instanceId, triggerId, err);
    }
  }
  return true;
}
