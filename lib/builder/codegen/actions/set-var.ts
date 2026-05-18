import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

interface SetVarStep { type: 'setVar'; name?: string; value?: unknown; payload?: { name?: string; value?: unknown } }

export function emitSetVar(step: SetVarStep, symbols: SymbolMap): string {
  const name = step.name ?? step.payload?.name ?? '';
  const rawValue = step.value !== undefined ? step.value : step.payload?.value;
  const valueExpr = rewritePropValue(rawValue, symbols);
  if (!name) return `/* setVar: skipped — no variable name configured */`;
  const ident = symbols.vars.get(name);
  const keyExpr = ident ?? JSON.stringify(name);
  return `useStore.setState(s => ({ ...s, variables: { ...s.variables, ${keyExpr}: ${valueExpr} } }));`;
}
