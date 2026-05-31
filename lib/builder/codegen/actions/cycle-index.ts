import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

interface CycleStep {
  type: 'cycleIndex';
  path?: string;
  length?: unknown;
  direction?: string;
  arrayPath?: string;
  payload?: { path?: string; length?: unknown; direction?: string; arrayPath?: string };
}

export function emitCycleIndex(step: CycleStep, symbols: SymbolMap): string {
  const path = step.path ?? step.payload?.path ?? '';
  const direction = step.direction ?? step.payload?.direction ?? 'next';
  const rawLen = step.length ?? step.payload?.length;
  const arrayPath = step.arrayPath ?? step.payload?.arrayPath;

  // Resolve variable UUID → ['variables', ident]; otherwise dot-split
  const varIdent = symbols.vars.get(path);
  const parts = varIdent
    ? ['"variables"', JSON.stringify(varIdent)]
    : path.split('.').map(p => JSON.stringify(p));

  // Determine length expression: explicit `length`, or derive from `arrayPath`
  let lenExpr: string;
  if (rawLen !== undefined && rawLen !== null) {
    lenExpr = rewritePropValue(rawLen, symbols);
  } else if (arrayPath) {
    // arrayPath like "product.assets" → resolve against known collections
    // Heuristic: "product.X" → productDetail collection's product.X
    const ap = String(arrayPath);
    if (ap.startsWith('product.')) {
      const subPath = ap.slice('product.'.length);
      const collIdent = symbols.collections.get('productDetail') ?? 'productDetail';
      lenExpr = `(state.collections?.${collIdent}?.data?.product?.${subPath} as unknown[])?.length ?? 0`;
    } else {
      // Try direct collection path
      const apParts = ap.split('.');
      const collIdent = symbols.collections.get(apParts[0]!);
      if (collIdent) {
        const rest = apParts.slice(1).join('?.');
        lenExpr = `(state.collections?.${collIdent}?.data?.${rest} as unknown[])?.length ?? 0`;
      } else {
        lenExpr = `0 /* unresolved arrayPath: ${arrayPath} */`;
      }
    }
  } else {
    lenExpr = '0';
  }

  if (direction === 'prev') {
    // Use setNestedValue with manual decrement + wrap
    return `useStore.setState(s => { const _len = ${lenExpr}; const _cur = Number((s as any)${parts.map(p => `?.[${p}]`).join('')} ?? 0); return setNestedValue(s, [${parts.join(', ')}], (_cur - 1 + (_len || 1)) % (_len || 1)); });`;
  }

  return `useStore.setState(s => cycleAtPath(s, [${parts.join(', ')}], ${lenExpr}));`;
}
