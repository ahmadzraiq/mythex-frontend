/**
 * In-memory popup model store.
 *
 * Initialised from the static config/popups.json at module load time.
 * All mutations live entirely in memory — no server or file-system involved.
 * Changes are lost on page reload (dev-tool behaviour).
 */

import initialData from '@/config/popups.json';

export interface PopupProperty {
  id: string;
  name: string;
  type: string;
  defaultValue?: unknown;
}

export interface PopupModel {
  id: string;
  name: string;
  type: 'Blank' | 'Modal' | 'Sheet' | 'Alert' | 'StackedAlert';
  allowStacking: boolean;
  properties: PopupProperty[];
  content: Record<string, unknown>;
}

// ── In-memory store ────────────────────────────────────────────────────────────

let _store: Record<string, PopupModel> = { ...(initialData as unknown as Record<string, PopupModel>) };
const _subscribers = new Set<() => void>();

function _notify() {
  _subscribers.forEach(cb => cb());
}

// ── Subscribe ─────────────────────────────────────────────────────────────────

/** Subscribe to any change in the popup store. Returns an unsubscribe function. */
export function subscribePopups(cb: () => void): () => void {
  _subscribers.add(cb);
  return () => _subscribers.delete(cb);
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** Returns a shallow copy of the current popup map (keyed by id). */
export function getPopups(): Record<string, PopupModel> {
  return { ..._store };
}

/** Returns all popup models as an array. */
export function getPopupList(): PopupModel[] {
  return Object.values(_store);
}

// ── Write ─────────────────────────────────────────────────────────────────────

/** Creates a new popup model. Returns the created model. */
export function createPopup(data: {
  id: string;
  name: string;
  type: PopupModel['type'];
  allowStacking?: boolean;
  properties?: PopupProperty[];
  content?: Record<string, unknown>;
}): PopupModel {
  const model: PopupModel = {
    id: data.id,
    name: data.name,
    type: data.type ?? 'Blank',
    allowStacking: data.allowStacking ?? false,
    properties: data.properties ?? [],
    content: data.content ?? { type: 'Box', props: { className: 'flex-1' }, children: [] },
  };
  _store = { ..._store, [model.id]: model };
  _notify();
  return model;
}

/** Merges a partial update into an existing popup model. Returns the updated model or null if not found. */
export function updatePopup(data: Partial<PopupModel> & { id: string }): PopupModel | null {
  const existing = _store[data.id];
  if (!existing) return null;
  const updated: PopupModel = { ...existing, ...data };
  _store = { ..._store, [data.id]: updated };
  _notify();
  return updated;
}

/** Deletes a popup model by id. Returns true if it existed. */
export function deletePopup(id: string): boolean {
  if (!_store[id]) return false;
  const { [id]: _removed, ...rest } = _store;
  _store = rest;
  _notify();
  return true;
}

/**
 * Replaces the entire in-memory store with `models`.
 * Use in preview contexts (new tabs) to seed the store from localStorage data
 * so `openPopupHandler` can resolve models that were created dynamically in
 * the builder session and are not yet in config/popups.json.
 */
export function loadPopups(models: Record<string, unknown>): void {
  _store = models as Record<string, PopupModel>;
  _notify();
}

/**
 * Clears all popup models — used when opening a real (non-admin) project so
 * the popups panel starts blank rather than showing the static config defaults.
 */
export function clearPopups(): void {
  _store = {};
  _notify();
}

/**
 * Resets the popup store back to the initial data from config/popups.json.
 * Used when entering admin / dev mode so the static showcase popups reappear.
 */
export function resetToConfigPopups(): void {
  _store = { ...(initialData as unknown as Record<string, PopupModel>) };
  _notify();
}
