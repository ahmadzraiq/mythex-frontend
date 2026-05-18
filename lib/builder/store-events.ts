/**
 * Lightweight pub/sub for builder store mutations — used for analytics and
 * future integrations. Server cannot subscribe; the client attaches after store init.
 */

export type StoreEventName =
  | 'node:created'
  | 'node:changed'
  | 'node:deleted'
  | 'subtree:restructured';

export type StoreEventPayload = {
  nodeId?: string;
  rootId?: string;
  pageId?: string;
};

type Listener = (name: StoreEventName, payload: StoreEventPayload) => void;

const listeners = new Set<Listener>();

export function emitStoreEvent(name: StoreEventName, payload: StoreEventPayload = {}): void {
  for (const fn of listeners) {
    try {
      fn(name, payload);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function onStoreEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
