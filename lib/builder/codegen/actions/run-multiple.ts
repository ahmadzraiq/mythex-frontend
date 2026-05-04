import type { SymbolMap } from '../types';
import { emitStep } from './index';

interface RunMultipleStep { type: 'runMultiple'; actions?: unknown[]; steps?: unknown[]; payload?: { actions?: unknown[]; steps?: unknown[] } }

export function emitRunMultiple(step: RunMultipleStep, symbols: SymbolMap): string {
  const steps = step.actions ?? step.steps ?? step.payload?.actions ?? step.payload?.steps ?? [];
  const lines = (steps as Record<string, unknown>[]).map(s => emitStep(s, symbols));
  return lines.join('\n');
}
