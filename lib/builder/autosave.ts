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
 *   pageWorkflows:      Record<id, workflow>
 *   pageWorkflowMeta:   Record<id, meta>
 *   globalWorkflows:    Record<id, workflow>
 *   globalWorkflowMeta: Record<id, meta>
 *   customVars:         CustomVar[]
 *   varFolders:         Folder[]
 *   pageDataSources:    DataSourceConfig[]
 *   dsFolders:          Folder[]
 *   themeOverrides:     Record<string, string>
 *   themeDarkOverrides: Record<string, string>
 * }
 */

import { useEffect, useRef, useCallback } from 'react';
import type { BuilderStore, BuilderPage } from '@/app/dev/builder/_store-types';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 1000;

/** Build the projectMeta block (wizard context) from the store. */
function serializeProjectMeta(store: BuilderStore): Record<string, unknown> | undefined {
  // Only include if at least one field is non-default
  if (!store.projectMood && !store.projectDescription && !store.projectAppName) return undefined;
  return {
    mood:           store.projectMood,
    animationLevel: store.projectAnimationLevel,
    description:    store.projectDescription,
    appName:        store.projectAppName,
    category:       store.projectCategory,
  };
}

/** Extract the saveable subset of the builder store (for the legacy full-blob endpoint). */
export function serializeBuilderState(store: BuilderStore): Record<string, unknown> {
  const result: Record<string, unknown> = {
    pages: store.pages,
    pageWorkflows: store.pageWorkflows,
    pageWorkflowMeta: store.pageWorkflowMeta,
    globalWorkflows: store.globalWorkflows,
    globalWorkflowMeta: store.globalWorkflowMeta,
    customVars: store.customVars,
    varFolders: store.varFolders,
    pageDataSources: store.pageDataSources,
    dsFolders: store.dsFolders,
    themeOverrides: store.themeOverrides,
    themeDarkOverrides: store.themeDarkOverrides,
  };
  const pm = serializeProjectMeta(store);
  if (pm) result.projectMeta = pm;
  return result;
}

/** Serialise only the non-page metadata fields. */
function serializeMeta(store: BuilderStore): Record<string, unknown> {
  const result: Record<string, unknown> = {
    pageWorkflows: store.pageWorkflows,
    pageWorkflowMeta: store.pageWorkflowMeta,
    globalWorkflows: store.globalWorkflows,
    globalWorkflowMeta: store.globalWorkflowMeta,
    customVars: store.customVars,
    varFolders: store.varFolders,
    pageDataSources: store.pageDataSources,
    dsFolders: store.dsFolders,
    themeOverrides: store.themeOverrides,
    themeDarkOverrides: store.themeDarkOverrides,
    // Include a thin page list (id/name/route) so the backend knows the ordering
    pages: store.pages.map(({ id, name, route }) => ({ id, name, route })),
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
  store: BuilderStore,
  onStatus: (s: SaveStatus) => void,
): (s: BuilderStore) => void {
  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender  = useRef(true);
  const onStatusRef    = useRef(onStatus);
  onStatusRef.current  = onStatus;

  // Snapshot maps — updated after each successful save tick
  const pageSnapshotsRef = useRef<Map<string, string>>(new Map()); // pageId → JSON(page)
  const metaSnapshotRef  = useRef('');

  /**
   * Pre-populate snapshots from the given store state.
   * Call this once after the initial backend load so that the first debounced
   * tick sees no diffs and does not trigger an erroneous save.
   */
  const seedBaseline = useCallback((s: BuilderStore) => {
    pageSnapshotsRef.current.clear();
    for (const page of s.pages) {
      pageSnapshotsRef.current.set(page.id, JSON.stringify(page));
    }
    metaSnapshotRef.current = JSON.stringify(serializeMeta(s));
  }, []);

  // Keep a stable reference to the store that the save closure captures
  const storeRef = useRef(store);
  storeRef.current = store;

  const save = useCallback(async () => {
    if (!projectId) return;
    const s = storeRef.current;

    // ── Find dirty pages ─────────────────────────────────────────────────────
    const dirtyPages: BuilderPage[] = [];
    for (const page of s.pages) {
      const currentJson = JSON.stringify(page);
      const prevJson = pageSnapshotsRef.current.get(page.id) ?? '';
      if (currentJson !== prevJson) {
        dirtyPages.push(page);
      }
    }

    // ── Check if metadata changed ────────────────────────────────────────────
    const currentMeta = JSON.stringify(serializeMeta(s));
    const metaDirty = currentMeta !== metaSnapshotRef.current;

    if (dirtyPages.length === 0 && !metaDirty) return; // nothing to save

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
    if (metaDirty) {
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

  useEffect(() => {
    // Skip the very first render — we don't want to save on mount before
    // the store has loaded project data from the backend.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!projectId) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void save(); }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [
    projectId,
    // Watch all saveable fields individually so the effect fires on any change
    store.pages,
    store.pageWorkflows,
    store.pageWorkflowMeta,
    store.globalWorkflows,
    store.globalWorkflowMeta,
    store.customVars,
    store.varFolders,
    store.pageDataSources,
    store.dsFolders,
    store.themeOverrides,
    store.themeDarkOverrides,
    save,
  ]);

  return seedBaseline;
}
