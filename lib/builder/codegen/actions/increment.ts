import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

interface BumpStep { type: 'increment' | 'decrement'; path?: string; amount?: unknown; step?: unknown; payload?: { path?: string; amount?: unknown; step?: unknown } }

export function emitIncrement(step: BumpStep, symbols: SymbolMap): string {
  const path = step.path ?? step.payload?.path ?? '';
  const rawAmount = step.amount ?? step.step ?? step.payload?.amount ?? step.payload?.step ?? 1;
  const amountExpr = rewritePropValue(rawAmount, symbols);
  const dir = step.type === 'decrement' ? '-1' : '1';
  const parts = path.split('.').map(p => JSON.stringify(p));
  return `useStore.setState(s => bumpAtPath(s, [${parts.join(', ')}], ${dir} * ${amountExpr}));`;
}
