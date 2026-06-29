/**
 * Builder autosave — diff-based, page-level saves.
 *
 * Instead of sending the entire project config on every change, this module:
 *   1. Keeps a snapshot of each page's nodes as a JSON string.
 *   2. Keeps a snapshot of the project metadata (everything except page nodes).
 *   3. On each debounced tick, diffs against the snapshots.
 *   4. Fires PATCH /pages/:pageId for every dirty page.
 *   5. Fires PATCH /config/meta if metadata changed.
 *
 * This means a single node drag on page 1 sends exactly ONE request — the
 * page-level PATCH for that page — not the full N-page blob.
 *
 * Config blob shape (matches the backend's Project.config JSONB column):
 * {
 *   pages:              BuilderPage[]            — node trees per page (full blob endpoint)
 *   workflows:          Record<id, WorkflowDef>  — unified workflow dict (steps inline)
 *   customVars:         CustomVar[]
 *   varFolders:         Folder[]
 *   pageDataSources:    DataSourceConfig[]
 *   dsFolders:          Folder[]
 *   customColors:       CustomColor[]
 *   colorFolders:       Folder[]
 *   themeOverrides:     Record<string, string>
 *   themeDarkOverrides: Record<string, string>
 * }
 */

import { useEffect, useRef, useCallback } from 'react';
import type { BuilderStore, BuilderPage } from '@/app/dev/builder/_store-types';
import { useBuilderStore } from '@/app/dev/builder/_store';
import { getSharedComponents, initialSharedComponentIds } from '@/lib/builder/shared-component-data';

/** Returns only the SCs the user explicitly created/imported — never the static initial ones. */
function getUserSharedComponents(): Record<string, import('@/lib/builder/shared-component-data').SharedComponentModel> {
  const all = getSharedComponents();
  return Object.fromEntries(Object.entries(all).filter(([id]) => !initialSharedComponentIds.has(id)));
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 1000;

/** Build the projectMeta block (wizard context) from the store. */
function serializeProjectMeta(store: BuilderStore): Record<string, unknown> | undefined {
  // Only include if at least one field is non-default
  if (!store.projectMood && !store.projectDescription && !store.projectAppName) return undefined;
  return {
    mood:            store.projectMood,
    animationLevel:  store.projectAnimationLevel,
    layoutStructure: store.projectLayoutStructure,
    description:     store.projectDescription,
    appName:         store.projectAppName,
    category:        store.projectCategory,
  };
}

/** Extract the saveable subset of the builder store (for the legacy full-blob endpoint). */
export function serializeBuilderState(store: BuilderStore): Record<string, unknown> {
  const result: Record<string, unknown> = {
    pages: store.pages,
    workflows: store.workflows,
    customVars: store.customVars,
    varFolders: store.varFolders,
    pageDataSources: store.pageDataSources,
    dsFolders: store.dsFolders,
    customColors: store.customColors,
    colorFolders: store.colorFolders,
    themeOverrides: store.themeOverrides,
    themeDarkOverrides: store.themeDarkOverrides,
    sharedComponents: getUserSharedComponents(),
    formulas: store.globalFormulas,
  };
  const pm = serializeProjectMeta(store);
  if (pm) result.projectMeta = pm;
  return result;
}

/** Serialise only the non-page metadata fields. */
function serializeMeta(store: BuilderStore): Record<string, unknown> {
  const result: Record<string, unknown> = {
    workflows: store.workflows,
    customVars: store.customVars,
    varFolders: store.varFolders,
    pageDataSources: store.pageDataSources,
    dsFolders: store.dsFolders,
    customColors: store.customColors,
    colorFolders: store.colorFolders,
    themeOverrides: store.themeOverrides,
    themeDarkOverrides: store.themeDarkOverrides,
    sharedComponents: getUserSharedComponents(),
    pages: store.pages.map(({ id, name, route }) => ({ id, name, route })),
    formulas: store.globalFormulas,
  };
  const pm = serializeProjectMeta(store);
  if (pm) result.projectMeta = pm;
  return result;
}

/**
 * Hook: subscribes to relevant builder store fields and fires a debounced diff
 * save whenever they change.
 *
 * Returns a `seedBaseline(store)` callback that must be called once after the
 * initial project load to pre-populate the snapshot refs. Without seeding, the
 * first debounced tick would see every page as "dirty" and save unnecessarily.
 *
 * @param projectId  – project ID from `?projectId=xxx` URL param (null = disabled)
 * @param store      – the full builder store snapshot (changes trigger the effect)
 * @param onStatus   – callback to receive status updates
 */
export function useBuilderAutosave(
  projectId: string | null,
  onStatus: (s: SaveStatus) => void,
): (s: BuilderStore) => void {
  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onStatusRef    = useRef(onStatus);
  onStatusRef.current  = onStatus;

  // null means "not yet seeded" — no save can fire until seedBaseline() is called.
  const pageSnapshotsRef = useRef<Map<string, string> | null>(null);
  const metaSnapshotRef  = useRef<string | null>(null);

  const seedBaseline = useCallback((s: BuilderStore) => {
    const map = new Map<string, string>();
    for (const page of s.pages) {
      map.set(page.id, JSON.stringify(page));
    }
    pageSnapshotsRef.current = map;
    metaSnapshotRef.current  = JSON.stringify(serializeMeta(s));
  }, []);

  const save = useCallback(async () => {
    if (!projectId) return;
    // Baseline not seeded yet — config hasn't finished loading. Never save in
    // this state (covers hot-reload remounts, initial render, and any race).
    if (pageSnapshotsRef.current === null) return;
    const s = useBuilderStore.getState() as BuilderStore;

    // ── Find dirty pages ─────────────────────────────────────────────────────
    const dirtyPages: BuilderPage[] = [];
    for (const page of s.pages) {
      const currentJson = JSON.stringify(page);
      const prevJson = pageSnapshotsRef.current.get(page.id) ?? '';
      if (currentJson !== prevJson) dirtyPages.push(page);
    }

    // ── Check if metadata changed ────────────────────────────────────────────
    const currentMeta = JSON.stringify(serializeMeta(s));
    const metaSafe = currentMeta !== metaSnapshotRef.current;

    if (dirtyPages.length === 0 && !metaSafe) return; // nothing to save

    onStatusRef.current('saving');
    const errors: string[] = [];

    // ── Save dirty pages in parallel ─────────────────────────────────────────
    await Promise.all(dirtyPages.map(async page => {
      try {
        const res = await fetch(`/api/projects/${projectId}/pages/${page.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(page),
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        pageSnapshotsRef.current.set(page.id, JSON.stringify(page));
      } catch (err) {
        errors.push(`page ${page.id}: ${String(err)}`);
      }
    }));

    // ── Save metadata if dirty ────────────────────────────────────────────────
    if (metaSafe) {
      try {
        const res = await fetch(`/api/projects/${projectId}/config/meta`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: currentMeta,
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        metaSnapshotRef.current = currentMeta;
      } catch (err) {
        errors.push(`meta: ${String(err)}`);
      }
    }

    if (errors.length > 0) {
      console.error('[autosave] Save errors:', errors);
      onStatusRef.current('error');
    } else {
      onStatusRef.current('saved');
    }
  }, [projectId]);

  const saveRef = useRef(save);
  saveRef.current = save;

  const prevSliceRef = useRef<unknown[]>([]);

  useEffect(() => {
    if (!projectId) return;
    const selectSlice = (s: BuilderStore) => [
      s.pages, s.workflows,
      s.customVars, s.varFolders,
      s.pageDataSources, s.dsFolders,
      s.customColors, s.colorFolders,
      s.themeOverrides, s.themeDarkOverrides,
    ];
    prevSliceRef.current = selectSlice(useBuilderStore.getState() as BuilderStore);

    const unsub = useBuilderStore.subscribe(() => {
      const next = selectSlice(useBuilderStore.getState() as BuilderStore);
      const prev = prevSliceRef.current;
      if (next.length === prev.length && next.every((v, i) => v === prev[i])) return;
      prevSliceRef.current = next;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { void saveRef.current(); }, DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [projectId]);

  return seedBaseline;
}
