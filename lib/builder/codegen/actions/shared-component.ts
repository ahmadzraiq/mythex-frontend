/**
 * Shared component management actions.
 * At codegen time, shared components are flattened — addSharedComponent /
 * deleteSharedComponent / deleteAllSharedComponents lower to state-driven
 * condition toggling. The runtime list of shared component models is not
 * emitted; visibility is controlled via a boolean in the app state.
 */

import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

interface SCStep {
  type: 'addSharedComponent' | 'deleteSharedComponent' | 'deleteAllSharedComponents';
  modelId?: string;
  id?: string;
  payload?: Record<string, unknown>;
}

export function emitSharedComponent(step: SCStep, symbols: SymbolMap): string {
  switch (step.type) {
    case 'addSharedComponent': {
      const id = step.modelId ?? step.id ?? step.payload?.modelId as string ?? '';
      return `useStore.setState(s => ({ ...s, sharedComponents: { ...s.sharedComponents, ${JSON.stringify(id)}: true } }));`;
    }
    case 'deleteSharedComponent': {
      const id = step.modelId ?? step.id ?? step.payload?.modelId as string ?? '';
      return `useStore.setState(s => { const { ${JSON.stringify(id)}: _, ...rest } = s.sharedComponents ?? {}; return { ...s, sharedComponents: rest }; });`;
    }
    case 'deleteAllSharedComponents': {
      return `useStore.setState(s => ({ ...s, sharedComponents: {} }));`;
    }
    default:
      return `/* unknown sharedComponent action */`;
  }
}
