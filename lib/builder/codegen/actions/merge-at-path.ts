import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

interface MergeStep {
  type: 'mergeAtPath';
  path?: string;
  key?: unknown;
  value?: unknown;
  payload?: { path?: string; key?: unknown; value?: unknown };
}

export function emitMergeAtPath(step: MergeStep, symbols: SymbolMap, inMapScope = false): string {
  const path = step.path ?? step.payload?.path ?? '';
  const rawKey = step.key !== undefined ? step.key : step.payload?.key;
  const rawValue = step.value !== undefined ? step.value : step.payload?.value;
  const valueExpr = rewritePropValue(rawValue, symbols, inMapScope);

  // Resolve variable UUID or dot-path to store path segments.
  // If the path is a variable UUID, prefix with ['variables', ident].
  const varIdent = symbols.vars.get(path);
  let parts: string[];
  if (varIdent) {
    parts = ['"variables"', JSON.stringify(varIdent)];
  } else {
    parts = path.split('.').map(p => JSON.stringify(p));
  }

  // When a `key` is provided, merge { [key]: value } into the map at path
  // (e.g. selectedOptions[groupId] = optionId)
  if (rawKey != null) {
    const keyExpr = rewritePropValue(rawKey, symbols, inMapScope);
    return `useStore.setState(s => mergeAtPath(s, [${parts.join(', ')}], { [${keyExpr}]: ${valueExpr} }));`;
  }

  return `useStore.setState(s => mergeAtPath(s, [${parts.join(', ')}], ${valueExpr}));`;
}
