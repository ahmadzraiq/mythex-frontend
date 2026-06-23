/**
 * SDUI Store - Zustand-based state for JSON-driven UI
 * Initial state seeded from screen config on first render.
 * Variable-level localStorage persistence is handled in global-variable-store.ts
 * via the saveInLocalStorage field on variable definitions.
 */

import { create } from 'zustand';

export interface SduiState {
  data: Record<string, unknown>;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;
  setLoading: (path: string, loading: boolean) => void;
  setData: (path: string, value: unknown) => void;
  setError: (path: string, error: string | null) => void;
  append: (path: string, value: unknown) => void;
}

export const useSduiStore = create<SduiState>()((set) => ({
  data: {},
  loading: {},
  error: {},

  setLoading: (path, loading) =>
    set((state) => ({
      loading: { ...state.loading, [path]: loading },
      ...(loading ? { error: { ...state.error, [path]: null } } : {}),
    })),

  setData: (path, value) =>
    set((state) => ({
      data: { ...state.data, [path]: value },
      loading: { ...state.loading, [path]: false },
      error: { ...state.error, [path]: null },
    })),

  setError: (path, error) =>
    set((state) => ({
      error: { ...state.error, [path]: error },
      loading: { ...state.loading, [path]: false },
    })),

  append: (path, value) =>
    set((state) => {
      const current = state.data[path];
      const arr = Array.isArray(current) ? [...current, value] : [value];
      return { data: { ...state.data, [path]: arr } };
    }),
}));
