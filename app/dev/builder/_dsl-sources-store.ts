'use client';

/**
 * Lightweight Zustand store that holds the AI-generated DSL source files.
 * Shared between useWebContainerDsl (writer) and FilesPanel (reader).
 */

import { create } from 'zustand';

interface DslSourcesState {
  sources: Record<string, string>;
  setSources: (sources: Record<string, string>) => void;
  setSource: (path: string, content: string) => void;
}

export const useDslSourcesStore = create<DslSourcesState>((set) => ({
  sources: {},
  setSources: (sources) => set({ sources }),
  setSource: (path, content) =>
    set((state) => ({ sources: { ...state.sources, [path]: content } })),
}));
