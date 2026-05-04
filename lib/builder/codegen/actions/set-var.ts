import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

interface SetVarStep { type: 'setVar'; name?: string; value?: unknown; payload?: { name?: string; value?: unknown } }

export function emitSetVar(step: SetVarStep, symbols: SymbolMap): string {
  const name = step.name ?? step.payload?.name ?? '';
  const rawValue = step.value !== undefined ? step.value : step.payload?.value;
  const valueExpr = rewritePropValue(rawValue, symbols);
  const ident = symbols.vars.get(name) ?? name;
  if (!ident) return `/* setVar: skipped — no variable name configured */`;
  return `useStore.setState(s => ({ ...s, variables: { ...s.variables, ${ident}: ${valueExpr} } }));`;
}
