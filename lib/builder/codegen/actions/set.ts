import type { SymbolMap } from '../types';
import { pathToExpr, rewritePropValue } from '../formula-rewrite';

interface SetStep { type: 'set' | 'setState'; path?: string; value?: unknown; payload?: { path?: string; value?: unknown } }

export function emitSet(step: SetStep, symbols: SymbolMap): string {
  const path = step.path ?? step.payload?.path ?? '';
  const rawValue = step.value !== undefined ? step.value : step.payload?.value;
  const valueExpr = rewritePropValue(rawValue, symbols);

  if (!path) return `useStore.setState(s => ({ ...s, ...${valueExpr} }));`;

  // Build path for setNestedValue
  const parts = path.split('.').map(p => JSON.stringify(p));
  return `useStore.setState(s => setNestedValue(s, [${parts.join(', ')}], ${valueExpr}));`;
}
