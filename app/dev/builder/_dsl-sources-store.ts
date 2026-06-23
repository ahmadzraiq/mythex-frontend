import { create } from 'zustand';

interface DslSourcesState {
  /** Map of file path → source content, representing the current DSL file tree. */
  sources: Record<string, string>;
  /** Replace the entire sources map. */
  setSources: (sources: Record<string, string>) => void;
  /** Set (or overwrite) a single file entry. */
  setSource: (path: string, content: string) => void;
}

export const useDslSourcesStore = create<DslSourcesState>((set) => ({
  sources: {},
  setSources: (sources) => set({ sources }),
  setSource: (path, content) =>
    set((state) => ({ sources: { ...state.sources, [path]: content } })),
}));
