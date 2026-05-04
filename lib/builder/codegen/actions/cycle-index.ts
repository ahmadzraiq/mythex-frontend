import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

interface CycleStep { type: 'cycleIndex'; path?: string; length?: unknown; payload?: { path?: string; length?: unknown } }

export function emitCycleIndex(step: CycleStep, symbols: SymbolMap): string {
  const path = step.path ?? step.payload?.path ?? '';
  const rawLen = step.length ?? step.payload?.length;
  const lenExpr = rewritePropValue(rawLen, symbols);
  const parts = path.split('.').map(p => JSON.stringify(p));
  return `useStore.setState(s => cycleAtPath(s, [${parts.join(', ')}], ${lenExpr}));`;
}
