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
    pageWorkflows: store.pageWorkflows,
    pageWorkflowMeta: store.pageWorkflowMeta,
    globalWorkflows: store.globalWorkflows,
    globalWorkflowMeta: store.globalWorkflowMeta,
    customVars: store.customVars,
    varFolders: store.varFolders,
    pageDataSources: store.pageDataSources,
    dsFolders: store.dsFolders,
    customColors: store.customColors,
    colorFolders: store.colorFolders,
    themeOverrides: store.themeOverrides,
    themeDarkOverrides: store.themeDarkOverrides,
    sharedComponents: getUserSharedComponents(),
  };
  const pm = serializeProjectMeta(store);
  if (pm) result.projectMeta = pm;
  if (store.authConfig) result.authConfig = store.authConfig;
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
    customColors: store.customColors,
    colorFolders: store.colorFolders,
    themeOverrides: store.themeOverrides,
    themeDarkOverrides: store.themeDarkOverrides,
    sharedComponents: getUserSharedComponents(),
    pages: store.pages.map(({ id, name, route }) => ({ id, name, route })),
  };
  const pm = serializeProjectMeta(store);
  if (pm) result.projectMeta = pm;
  if (store.authConfig) result.authConfig = store.authConfig;
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
  const isFirstRender  = useRef(true);
  const onStatusRef    = useRef(onStatus);
  onStatusRef.current  = onStatus;

  const pageSnapshotsRef = useRef<Map<string, string>>(new Map());
  const metaSnapshotRef  = useRef('');

  const seedBaseline = useCallback((s: BuilderStore) => {
    pageSnapshotsRef.current.clear();
    for (const page of s.pages) {
      pageSnapshotsRef.current.set(page.id, JSON.stringify(page));
    }
    metaSnapshotRef.current = JSON.stringify(serializeMeta(s));
  }, []);

  const save = useCallback(async () => {
    if (!projectId) return;
    const s = useBuilderStore.getState() as BuilderStore;

    // ── Find dirty pages ─────────────────────────────────────────────────────
    const dirtyPages: BuilderPage[] = [];
    for (const page of s.pages) {
      const currentJson = JSON.stringify(page);
      const prevJson = pageSnapshotsRef.current.get(page.id) ?? '';
      if (currentJson === prevJson) continue;

      // Integrity guard: if the saved baseline had real content but the outgoing
      // state has almost nothing, this is a hot-reload stale-state flush, not a
      // user action. Block it to prevent overwriting the user's work.
      if (prevJson) {
        const baselineNodeCount = (JSON.stringify(JSON.parse(prevJson).nodes ?? []).match(/"id"/g) ?? []).length;
        const currentNodeCount  = (JSON.stringify(page.nodes ?? []).match(/"id"/g) ?? []).length;
        if (baselineNodeCount > 3 && currentNodeCount <= 1) continue;
      }

      dirtyPages.push(page);
    }

    // ── Check if metadata changed ────────────────────────────────────────────
    const currentMeta = JSON.stringify(serializeMeta(s));
    const metaDirty = currentMeta !== metaSnapshotRef.current;

    // Integrity guard: never overwrite non-empty customVars/dataSources with empty.
    const metaSafe = !metaDirty ? false : (() => {
      if (!metaSnapshotRef.current) return true;
      const prev = JSON.parse(metaSnapshotRef.current) as Record<string, unknown>;
      const next = JSON.parse(currentMeta) as Record<string, unknown>;
      const prevVars = (prev.customVars as unknown[] | undefined)?.length ?? 0;
      const nextVars = (next.customVars as unknown[] | undefined)?.length ?? 0;
      const prevDS   = (prev.pageDataSources as unknown[] | undefined)?.length ?? 0;
      const nextDS   = (next.pageDataSources as unknown[] | undefined)?.length ?? 0;
      if ((prevVars > 0 && nextVars === 0) || (prevDS > 0 && nextDS === 0)) return false;
      return true;
    })();

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

      // Warm the node embedding cache so semantic_search in AI messages is instant.
      // Send ALL pages (not just current) — any page's nodes may have changed.
      // Fire-and-forget — non-blocking, safe to fail silently.
      if (dirtyPages.length > 0) {
        try {
          const store = useBuilderStore.getState() as BuilderStore;
          const pages = (store.pages as Array<{ id: string; route?: string; nodes: unknown[] }>)
            .filter(p => p.nodes?.length > 0)
            .map(p => ({ pageRoute: p.route ?? '/', nodes: p.nodes }));
          if (pages.length > 0) {
            fetch('/api/ai/retrieval/ensure-index', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                pages,
                theme: store.themeOverrides ?? {},
              }),
            }).catch(() => {/* non-fatal */});
          }
        } catch {/* non-fatal */}
      }
    }
  }, [projectId]);

  const saveRef = useRef(save);
  saveRef.current = save;

  const prevSliceRef = useRef<unknown[]>([]);

  useEffect(() => {
    if (!projectId) return;
    const selectSlice = (s: BuilderStore) => [
      s.pages, s.pageWorkflows, s.pageWorkflowMeta,
      s.globalWorkflows, s.globalWorkflowMeta,
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

      if (isFirstRender.current) { isFirstRender.current = false; return; }
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
