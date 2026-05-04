import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

interface SetThemeStep { type: 'setTheme'; theme?: string; mode?: unknown; payload?: Record<string, unknown> }

export function emitSetTheme(step: SetThemeStep, symbols: SymbolMap): string {
  const mode = step.mode ?? step.theme ?? step.payload?.mode ?? step.payload?.theme ?? 'system';
  const modeExpr = rewritePropValue(mode, symbols);
  return `setTheme(${modeExpr});`;
}
