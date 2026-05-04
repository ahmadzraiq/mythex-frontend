import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

interface AppendStep { type: 'appendToPath'; path?: string; value?: unknown; payload?: { path?: string; value?: unknown } }

export function emitAppendToPath(step: AppendStep, symbols: SymbolMap): string {
  const path = step.path ?? step.payload?.path ?? '';
  const rawValue = step.value !== undefined ? step.value : step.payload?.value;
  const valueExpr = rewritePropValue(rawValue, symbols);
  const parts = path.split('.').map(p => JSON.stringify(p));
  return `useStore.setState(s => appendToPath(s, [${parts.join(', ')}], ${valueExpr}));`;
}
