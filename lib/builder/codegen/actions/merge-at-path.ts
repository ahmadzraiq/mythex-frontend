import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

interface MergeStep { type: 'mergeAtPath'; path?: string; value?: unknown; payload?: { path?: string; value?: unknown } }

export function emitMergeAtPath(step: MergeStep, symbols: SymbolMap): string {
  const path = step.path ?? step.payload?.path ?? '';
  const rawValue = step.value !== undefined ? step.value : step.payload?.value;
  const valueExpr = rewritePropValue(rawValue, symbols);
  const parts = path.split('.').map(p => JSON.stringify(p));
  return `useStore.setState(s => mergeAtPath(s, [${parts.join(', ')}], ${valueExpr}));`;
}
