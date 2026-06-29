'use client';

/**
 * useBackendConfig — shared hook for all builder panels that need backend config.
 *
 * Pattern mirrors the frontend's GET /api/projects/:id/config:
 *   - One in-flight request per projectId (module-level cache).
 *   - All concurrent callers share the same Promise.
 *   - reload() clears the cache and re-fetches, notifying all subscribers.
 *
 * Usage:
 *   const { models, enums, workflows, seeds, loading, reload } = useBackendConfig(projectId);
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { backendConfig, type BackendConfigSnapshot } from '@/lib/platform/api-client';

// ── Module-level cache ──────────────────────────────────────────────────────

interface CacheEntry {
  data: BackendConfigSnapshot | null;
  promise: Promise<BackendConfigSnapshot> | null;
  listeners: Set<() => void>;
}

const cache = new Map<string, CacheEntry>();

function getOrCreate(projectId: string): CacheEntry {
  if (!cache.has(projectId)) {
    cache.set(projectId, { data: null, promise: null, listeners: new Set() });
  }
  return cache.get(projectId)!;
}

function notify(projectId: string) {
  const entry = cache.get(projectId);
  if (entry) entry.listeners.forEach(fn => fn());
}

async function fetchConfig(projectId: string): Promise<BackendConfigSnapshot> {
  const entry = getOrCreate(projectId);
  if (entry.data) return entry.data;
  if (entry.promise) return entry.promise;

  const promise = backendConfig.getAll(projectId).then(result => {
    entry.data = result;
    entry.promise = null;
    notify(projectId);
    return result;
  }).catch(err => {
    // On error, clear the promise so the next call retries.
    entry.promise = null;
    throw err;
  });

  entry.promise = promise;
  return promise;
}

/** Invalidate the cache for a project and refetch. All useBackendConfig subscribers re-render. */
export function reloadBackendConfig(projectId: string) {
  const entry = cache.get(projectId);
  if (entry) {
    entry.data = null;
    entry.promise = null;
  }
  fetchConfig(projectId).catch(() => {});
}

/**
 * Optimistically patch only the workflows array in the cache.
 * Avoids a network round-trip — use after create / update / delete mutations.
 */
export function patchCachedWorkflows(
  projectId: string,
  updater: (prev: BackendConfigSnapshot['workflows']) => BackendConfigSnapshot['workflows'],
) {
  const entry = cache.get(projectId);
  if (!entry?.data) return;
  entry.data = { ...entry.data, workflows: updater(entry.data.workflows) };
  notify(projectId);
}

/**
 * Optimistically patch only the enums array in the cache.
 */
export function patchCachedEnums(
  projectId: string,
  updater: (prev: BackendConfigSnapshot['enums']) => BackendConfigSnapshot['enums'],
) {
  const entry = cache.get(projectId);
  if (!entry?.data) return;
  entry.data = { ...entry.data, enums: updater(entry.data.enums) };
  notify(projectId);
}

/**
 * Optimistically patch only the models array in the cache.
 */
export function patchCachedModels(
  projectId: string,
  updater: (prev: BackendConfigSnapshot['models']) => BackendConfigSnapshot['models'],
) {
  const entry = cache.get(projectId);
  if (!entry?.data) return;
  entry.data = { ...entry.data, models: updater(entry.data.models) };
  notify(projectId);
}

// ── Hook ────────────────────────────────────────────────────────────────────

export interface UseBackendConfigResult {
  models:    BackendConfigSnapshot['models'];
  enums:     BackendConfigSnapshot['enums'];
  workflows: BackendConfigSnapshot['workflows'];
  seeds:     BackendConfigSnapshot['seeds'];
  loading:   boolean;
  error:     string | null;
  reload:    () => void;
}

// Stable empty arrays so callers can safely use these as useEffect dependencies.
const EMPTY_MODELS:    BackendConfigSnapshot['models']    = [];
const EMPTY_ENUMS:     BackendConfigSnapshot['enums']     = [];
const EMPTY_WORKFLOWS: BackendConfigSnapshot['workflows'] = [];
const EMPTY_SEEDS:     BackendConfigSnapshot['seeds']     = [];

export function useBackendConfig(projectId: string | undefined): UseBackendConfigResult {
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Register a listener so we re-render when cache updates.
  useEffect(() => {
    if (!projectId) return;
    const entry = getOrCreate(projectId);
    const listener = () => { if (mountedRef.current) setTick(t => t + 1); };
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  }, [projectId]);

  // Trigger fetch on mount / projectId change.
  useEffect(() => {
    if (!projectId) return;
    const entry = getOrCreate(projectId);
    if (entry.data) return; // already cached
    setLoading(true);
    fetchConfig(projectId)
      .then(() => { if (mountedRef.current) setLoading(false); })
      .catch(e => { if (mountedRef.current) { setError(e?.message ?? 'Failed to load backend config'); setLoading(false); } });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const reload = useCallback(() => {
    if (!projectId) return;
    const entry = getOrCreate(projectId);
    entry.data = null;
    entry.promise = null;
    setLoading(true);
    setError(null);
    fetchConfig(projectId)
      .then(() => { if (mountedRef.current) setLoading(false); })
      .catch(e => { if (mountedRef.current) { setError(e?.message ?? 'Failed to reload'); setLoading(false); } });
  }, [projectId]);

  // Suppress unused tick warning — it's used to trigger re-renders.
  void tick;

  const entry = projectId ? cache.get(projectId) : undefined;
  const data = entry?.data ?? null;

  return {
    models:    data?.models    ?? EMPTY_MODELS,
    enums:     data?.enums     ?? EMPTY_ENUMS,
    workflows: data?.workflows ?? EMPTY_WORKFLOWS,
    seeds:     data?.seeds     ?? EMPTY_SEEDS,
    loading:   loading || (!data && !!projectId),
    error,
    reload,
  };
}
