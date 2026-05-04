import type { SymbolMap } from '../types';
import { emitStep } from './index';

interface WorkflowStepsStep { type: 'workflowSteps'; steps?: unknown[]; payload?: { steps?: unknown[] } }

export function emitWorkflowSteps(step: WorkflowStepsStep, symbols: SymbolMap): string {
  const steps = step.steps ?? step.payload?.steps ?? [];
  const lines = (steps as Record<string, unknown>[]).map(s => emitStep(s, symbols));
  return lines.join('\n');
}
