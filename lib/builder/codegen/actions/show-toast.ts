import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

interface ToastStep { type: 'showToast'; message?: unknown; title?: unknown; level?: string; variant?: string; description?: unknown; payload?: Record<string, unknown> }

export function emitShowToast(step: ToastStep, symbols: SymbolMap): string {
  const msg = step.message ?? step.title ?? step.payload?.message ?? step.payload?.title ?? '';
  const desc = step.description ?? step.payload?.description;
  const level = step.level ?? step.variant ?? (step.payload?.level as string) ?? (step.payload?.variant as string) ?? 'default';
  const msgExpr = rewritePropValue(msg, symbols);
  const method = level === 'error' ? 'error' : level === 'success' ? 'success' : level === 'warning' ? 'warning' : 'message';
  if (desc) {
    const descExpr = rewritePropValue(desc, symbols);
    return `toast.${method}(${msgExpr}, { description: ${descExpr} });`;
  }
  return `toast.${method}(${msgExpr});`;
}
