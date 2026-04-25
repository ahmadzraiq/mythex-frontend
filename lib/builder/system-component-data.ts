/**
 * In-memory system component store.
 *
 * Layered model:
 *   - `_defaults`  — shipped with the app in TypeScript, loaded from
 *                    `lib/builder/system-components/index.ts`.
 *   - `_overrides` — user edits persisted via the existing autosave snapshot
 *                    pipeline. Only overrides are written; definitions stay in
 *                    code.
 *
 * The merged view `{ ..._defaults, ..._overrides }` is what the builder and
 * canvas consume via `getSystemComponents()`. Resetting a system component
 * simply drops its override, falling back to the code-shipped definition.
 */

import type {
  SharedComponentProperty,
  ScopedVarDef,
  ScopedFormulaDef,
  ScopedWorkflow,
  ComponentTrigger,
} from '@/config/shared-component-types';
import type { SystemComponentModel } from './system-component-types';
import { SYSTEM_COMPONENT_DEFAULTS } from './system-components';

// ── Node-key stamping ─────────────────────────────────────────────────────────
//
// System-component instances share the Figma-style "stable key" tracking the
// Shared Component sync engine uses: every node in the model content carries
// a `_sharedKey` that persists across id re-minting at drop time. Instances
// mint fresh descendant `id`s but KEEP the same `_sharedKey`, which lets
// `_syncSharedInstances` pair instance nodes to model nodes even after the
// user deletes, reorders, or inserts children locally.
//
// We stamp keys once on every defaults entry at module init, and re-stamp on
// updates/override-loads so anything round-tripped through the autosave
// snapshot is self-healed. Stamping is idempotent — existing keys are kept.
function _stampSharedKeys(node: Record<string, unknown>): void {
  if (!node || typeof node !== 'object') return;
  if (typeof node._sharedKey !== 'string' || !node._sharedKey) {
    node._sharedKey = crypto.randomUUID();
  }
  const children = (node.children ?? []) as Record<string, unknown>[];
  if (Array.isArray(children)) {
    for (const c of children) _stampSharedKeys(c);
  }
}

// ── In-memory state ───────────────────────────────────────────────────────────

const _defaults: Record<string, SystemComponentModel> = (() => {
  const out: Record<string, SystemComponentModel> = {};
  for (const [id, def] of Object.entries(SYSTEM_COMPONENT_DEFAULTS)) {
    const content = def.content as Record<string, unknown> | undefined;
    if (content) _stampSharedKeys(content);
    out[id] = def;
  }
  return out;
})();
let _overrides: Record<string, SystemComponentModel> = {};
const _subscribers = new Set<() => void>();

function _notify() {
  _subscribers.forEach(cb => cb());
}

function _merged(): Record<string, SystemComponentModel> {
  const out: Record<string, SystemComponentModel> = {};
  for (const [id, def] of Object.entries(_defaults)) {
    out[id] = _overrides[id] ? { ..._overrides[id], isBuiltIn: true } : def;
  }
  return out;
}

// ── Normalisation ─────────────────────────────────────────────────────────────

function normaliseSystemComponentModel(raw: Record<string, unknown>): SystemComponentModel {
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
    content: (raw.content ?? { type: 'Box', props: { className: 'flex flex-col' }, children: [] }) as Record<string, unknown>,
    isBuiltIn: true,
    icon: raw.icon != null ? String(raw.icon) : undefined,
  };
}

// ── Subscribe ─────────────────────────────────────────────────────────────────

export function subscribeSystemComponents(cb: () => void): () => void {
  _subscribers.add(cb);
  return () => _subscribers.delete(cb);
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** Returns the merged (defaults + overrides) system component map keyed by id. */
export function getSystemComponents(): Record<string, SystemComponentModel> {
  return _merged();
}

/** Returns every merged system component as an array. */
export function getSystemComponentList(): SystemComponentModel[] {
  return Object.values(_merged());
}

/** Returns the raw override map (only ids that have been user-edited). */
export function getSystemComponentOverrides(): Record<string, SystemComponentModel> {
  return { ..._overrides };
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Merges a partial update into the system component with the given id.
 * The update is stored as an override — the built-in definition is never
 * mutated, so `resetSystemComponent(id)` can restore it.
 */
export function updateSystemComponent(data: Partial<SystemComponentModel> & { id: string }): SystemComponentModel | null {
  const base = _overrides[data.id] ?? _defaults[data.id];
  if (!base) return null;
  const updated: SystemComponentModel = { ...base, ...data, isBuiltIn: true };
  if (updated.content) _stampSharedKeys(updated.content as Record<string, unknown>);
  _overrides = { ..._overrides, [data.id]: updated };
  _notify();
  return updated;
}

/** Drops the override for `id`, realigning it with the code-shipped default. */
export function resetSystemComponent(id: string): boolean {
  if (!_overrides[id]) return false;
  const { [id]: _removed, ...rest } = _overrides;
  _overrides = rest;
  _notify();
  return true;
}

/**
 * Replaces the entire override map (e.g. when hydrating from an autosave
 * snapshot). Entries are normalised so older/partial data still loads safely.
 */
export function loadSystemComponentOverrides(models: Record<string, unknown> | undefined | null): void {
  const normalised: Record<string, SystemComponentModel> = {};
  if (models && typeof models === 'object') {
    for (const [id, raw] of Object.entries(models)) {
      if (raw && typeof raw === 'object') {
        const m = normaliseSystemComponentModel(raw as Record<string, unknown>);
        if (m.content) _stampSharedKeys(m.content as Record<string, unknown>);
        normalised[id] = m;
      }
    }
  }
  _overrides = normalised;
  _notify();
}

/** Drops every override (all system components revert to their defaults). */
export function clearSystemComponentOverrides(): void {
  _overrides = {};
  _notify();
}
