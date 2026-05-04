import type { SymbolMap } from '../types';

interface ClearPersistedStep { type: 'clearPersistedPaths'; paths?: string[]; payload?: { paths?: string[] } }

export function emitClearPersisted(step: ClearPersistedStep, _symbols: SymbolMap): string {
  const paths = step.paths ?? step.payload?.paths ?? [];
  if (paths.length === 0) {
    return `localStorage.removeItem('app-store');`;
  }
  const removes = paths.map(p => `localStorage.removeItem(persistKey(${JSON.stringify(p)}));`).join('\n');
  return removes;
}
