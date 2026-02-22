/**
 * SDUI Store - Zustand-based state for JSON-driven UI
 * Replaces Redux config slice. Initial state from config/store.json.
 */

import { create } from 'zustand';
import storeConfig from '@/config/store-config';

export interface SduiState {
  data: Record<string, unknown>;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;
  setLoading: (path: string, loading: boolean) => void;
  setData: (path: string, value: unknown) => void;
  setError: (path: string, error: string | null) => void;
  append: (path: string, value: unknown) => void;
}

const initialData = (storeConfig as { initialData?: Record<string, unknown> }).initialData ?? {};

export const useSduiStore = create<SduiState>()((set) => ({
  data: { ...initialData },
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
