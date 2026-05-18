/**
 * In-memory shared component model store.
 *
 * Initialised from the static config/shared-components.json at module load time.
 * All mutations live entirely in memory — no server or file-system involved.
 * Changes are lost on page reload (dev-tool behaviour).
 *
 * In-memory store for shared component models used by the builder.
 */

import initialData from '@/config/shared-components.json';
import type {
  SharedComponentModel,
  SharedComponentProperty,
  ScopedVarDef,
  ScopedFormulaDef,
  ScopedWorkflow,
  ComponentTrigger,
} from '@/config/shared-component-types';

export type { SharedComponentModel, SharedComponentProperty, ScopedVarDef, ScopedFormulaDef, ScopedWorkflow, ComponentTrigger };

// ── In-memory store ────────────────────────────────────────────────────────────

// Normalise initial data from config so all models have the new optional fields.
const _initialNormalised: Record<string, SharedComponentModel> = {};
for (const [id, raw] of Object.entries(initialData as Record<string, Record<string, unknown>>)) {
  _initialNormalised[id] = {
    id,
    name: String((raw as Record<string, unknown>).name ?? 'Unnamed'),
    folder: (raw as Record<string, unknown>).folder != null ? String((raw as Record<string, unknown>).folder) : undefined,
    description: (raw as Record<string, unknown>).description != null ? String((raw as Record<string, unknown>).description) : undefined,
    properties: Array.isArray((raw as Record<string, unknown>).properties) ? ((raw as Record<string, unknown>).properties as SharedComponentProperty[]) : [],
    variables: ((raw as Record<string, unknown>).variables ?? {}) as Record<string, ScopedVarDef>,
    formulas: ((raw as Record<string, unknown>).formulas ?? {}) as Record<string, ScopedFormulaDef>,
    workflows: ((raw as Record<string, unknown>).workflows ?? {}) as Record<string, ScopedWorkflow>,
    triggers: Array.isArray((raw as Record<string, unknown>).triggers) ? ((raw as Record<string, unknown>).triggers as ComponentTrigger[]) : undefined,
    templateId: (raw as Record<string, unknown>).templateId != null ? String((raw as Record<string, unknown>).templateId) : undefined,
    content: ((raw as Record<string, unknown>).content ?? { type: 'Box', props: { className: 'flex flex-col' }, children: [] }) as Record<string, unknown>,
    ...((raw as Record<string, unknown>).valueVariable != null ? { valueVariable: String((raw as Record<string, unknown>).valueVariable) } : {}),
  };
}
let _store: Record<string, SharedComponentModel> = _initialNormalised;
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

/** Normalises a raw model object so all new optional fields have safe defaults. */
export function normaliseSharedComponentModel(raw: Record<string, unknown>): SharedComponentModel {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? 'Unnamed'),
    folder: raw.folder != null ? String(raw.folder) : undefined,
    description: raw.description != null ? String(raw.description) : undefined,
    properties: Array.isArray(raw.properties) ? (raw.properties as SharedComponentProperty[]) : [],
    variables: (raw.variables ?? {}) as Record<string, ScopedVarDef>,
    formulas: (raw.formulas ?? {}) as Record<string, ScopedFormulaDef>,
    workflows: (raw.workflows ?? {}) as Record<string, ScopedWorkflow>,
    triggers: Array.isArray(raw.triggers) ? (raw.triggers as ComponentTrigger[]) : undefined,
    templateId: raw.templateId != null ? String(raw.templateId) : undefined,
    content: (raw.content ?? { type: 'Box', props: { className: 'flex flex-col' }, children: [] }) as Record<string, unknown>,
    ...(raw.valueVariable != null ? { valueVariable: String(raw.valueVariable) } : {}),
  };
}

/** Creates a new shared component model. Returns the created model. */
export function createSharedComponent(data: {
  id: string;
  name: string;
  folder?: string;
  description?: string;
  properties?: SharedComponentProperty[];
  variables?: Record<string, ScopedVarDef>;
  formulas?: Record<string, ScopedFormulaDef>;
  workflows?: Record<string, ScopedWorkflow>;
  triggers?: ComponentTrigger[];
  templateId?: string;
  content?: Record<string, unknown>;
}): SharedComponentModel {
  const model: SharedComponentModel = {
    id: data.id,
    name: data.name,
    folder: data.folder,
    description: data.description,
    properties: data.properties ?? [],
    variables: data.variables ?? {},
    formulas: data.formulas ?? {},
    workflows: data.workflows ?? {},
    triggers: data.triggers,
    templateId: data.templateId,
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
 * Replaces the entire in-memory store with `models`, normalising each entry
 * so new optional fields (variables, formulas, workflows, folder, description)
 * have safe defaults even when loading older data.
 */
export function loadSharedComponents(models: Record<string, unknown>): void {
  const normalised: Record<string, SharedComponentModel> = {};
  for (const [id, raw] of Object.entries(models)) {
    normalised[id] = normaliseSharedComponentModel(raw as Record<string, unknown>);
  }
  _store = normalised;
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
  _store = { ..._initialNormalised };
  _notify();
}
