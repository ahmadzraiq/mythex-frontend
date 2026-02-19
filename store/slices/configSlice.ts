/**
 * Config slice - stores fetched data from JSON-configured thunks.
 * Initial state from config/store.json.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import storeConfig from '@/config/store.json';

export interface ConfigState {
  data: Record<string, unknown>;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;
}

const initialData = (storeConfig as { initialData?: Record<string, unknown> }).initialData ?? {};

const initialState: ConfigState = {
  data: { ...initialData },
  loading: {},
  error: {},
};

const configSlice = createSlice({
  name: 'config',
  initialState,
  reducers: {
    setLoading: (state, action: PayloadAction<{ path: string; loading: boolean }>) => {
      state.loading[action.payload.path] = action.payload.loading;
      if (action.payload.loading) state.error[action.payload.path] = null;
    },
    setData: (state, action: PayloadAction<{ path: string; value: unknown }>) => {
      state.data[action.payload.path] = action.payload.value;
      state.loading[action.payload.path] = false;
      state.error[action.payload.path] = null;
    },
    setError: (state, action: PayloadAction<{ path: string; error: string | null }>) => {
      state.error[action.payload.path] = action.payload.error;
      state.loading[action.payload.path] = false;
    },
    append: (state, action: PayloadAction<{ path: string; value: unknown }>) => {
      const { path, value } = action.payload;
      const current = state.data[path];
      const arr = Array.isArray(current) ? [...current, value] : [value];
      state.data[path] = arr;
    },
  },
});

export const { setLoading, setData, setError, append } = configSlice.actions;
export default configSlice.reducer;
