import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

interface RemoveAtStep { type: 'removeAt'; path?: string; index?: unknown; payload?: { path?: string; index?: unknown } }

export function emitRemoveAt(step: RemoveAtStep, symbols: SymbolMap): string {
  const path = step.path ?? step.payload?.path ?? '';
  const rawIndex = step.index !== undefined ? step.index : step.payload?.index;
  const indexExpr = rewritePropValue(rawIndex, symbols);
  const parts = path.split('.').map(p => JSON.stringify(p));
  return `useStore.setState(s => removeAtPath(s, [${parts.join(', ')}], ${indexExpr}));`;
}
