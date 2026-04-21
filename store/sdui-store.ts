/**
 * SDUI Store - Zustand-based state for JSON-driven UI
 * Initial state seeded from screen config on first render.
 */

import { create } from 'zustand';

// Restore auth state from localStorage on page load so auth.user / auth.accessToken
// survive refreshes without a re-login. Origin-level isolation (each project runs on
// its own subdomain) means the fixed key never collides between projects.
const _authSnapshot = (() => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('sdui_auth_snapshot');
    return raw ? (JSON.parse(raw) as { user: unknown; accessToken: unknown; refreshToken: unknown }) : null;
  } catch { return null; }
})();

const _initialData: Record<string, unknown> = _authSnapshot
  ? {
      'auth.user':         _authSnapshot.user ?? null,
      'auth.accessToken':  _authSnapshot.accessToken ?? null,
      'auth.token':        _authSnapshot.accessToken ?? null,
      'auth.refreshToken': _authSnapshot.refreshToken ?? null,
    }
  : {};

export interface SduiState {
  data: Record<string, unknown>;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;
  /** True once the initial session restore attempt has completed (or no token was found).
   *  The auth guard in page.tsx waits for this before redirecting. */
  sessionRestored: boolean;
  setLoading: (path: string, loading: boolean) => void;
  setData: (path: string, value: unknown) => void;
  setError: (path: string, error: string | null) => void;
  append: (path: string, value: unknown) => void;
  setSessionRestored: (value: boolean) => void;
}

export const useSduiStore = create<SduiState>()((set) => ({
  data: _initialData,
  loading: {},
  error: {},
  sessionRestored: false,

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
      // Keep the dedicated sessionRestored flag in sync with the data key
      ...(path === 'sessionRestored' ? { sessionRestored: Boolean(value) } : {}),
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

  setSessionRestored: (value) => set({ sessionRestored: value }),
}));

