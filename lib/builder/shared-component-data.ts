/**
 * In-memory shared component model store.
 *
 * Initialised from the static config/shared-components.json at module load time.
 * All mutations live entirely in memory — no server or file-system involved.
 * Changes are lost on page reload (dev-tool behaviour).
 *
 * Mirrors the pattern established by lib/builder/popup-data.ts.
 */

import initialData from '@/config/shared-components.json';
import type { SharedComponentModel, SharedComponentProperty } from '@/config/shared-component-types';

export type { SharedComponentModel, SharedComponentProperty };

// ── In-memory store ────────────────────────────────────────────────────────────

let _store: Record<string, SharedComponentModel> = {
  ...(initialData as unknown as Record<string, SharedComponentModel>),
};
const _subscribers = new Set<() => void>();

function _notify() {
  _subscribers.forEach(cb => cb());
}

// ── Subscribe ─────────────────────────────────────────────────────────────────

/** Subscribe to any change in the shared component store. Returns an unsubscribe function. */
export function subscribeSharedComponents(cb: () => void): () => void {
  _subscribers.add(cb);
  return () => _subscribers.delete(cb);
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** Returns a shallow copy of the current shared component map (keyed by id). */
export function getSharedComponents(): Record<string, SharedComponentModel> {
  return { ..._store };
}

/** Returns all shared component models as an array. */
export function getSharedComponentList(): SharedComponentModel[] {
  return Object.values(_store);
}

// ── Write ─────────────────────────────────────────────────────────────────────

/** Creates a new shared component model. Returns the created model. */
export function createSharedComponent(data: {
  id: string;
  name: string;
  properties?: SharedComponentProperty[];
  content?: Record<string, unknown>;
}): SharedComponentModel {
  const model: SharedComponentModel = {
    id: data.id,
    name: data.name,
    properties: data.properties ?? [],
    content: data.content ?? { type: 'Box', props: { className: 'flex flex-col' }, children: [] },
  };
  _store = { ..._store, [model.id]: model };
  _notify();
  return model;
}

/** Merges a partial update into an existing shared component model. Returns the updated model or null if not found. */
export function updateSharedComponent(data: Partial<SharedComponentModel> & { id: string }): SharedComponentModel | null {
  const existing = _store[data.id];
  if (!existing) return null;
  const updated: SharedComponentModel = { ...existing, ...data };
  _store = { ..._store, [data.id]: updated };
  _notify();
  return updated;
}

/** Deletes a shared component model by id. Returns true if it existed. */
export function deleteSharedComponent(id: string): boolean {
  if (!_store[id]) return false;
  const { [id]: _removed, ...rest } = _store;
  _store = rest;
  _notify();
  return true;
}

/**
 * Replaces the entire in-memory store with `models`.
 * Use to seed the store from localStorage in preview contexts.
 */
export function loadSharedComponents(models: Record<string, unknown>): void {
  _store = models as Record<string, SharedComponentModel>;
  _notify();
}

/**
 * Clears all shared component models.
 */
export function clearSharedComponents(): void {
  _store = {};
  _notify();
}

/**
 * Resets the store back to the initial data from config/shared-components.json.
 */
export function resetToConfigSharedComponents(): void {
  _store = { ...(initialData as unknown as Record<string, SharedComponentModel>) };
  _notify();
}
