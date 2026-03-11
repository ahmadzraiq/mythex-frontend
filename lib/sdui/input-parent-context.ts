import { createContext, useContext } from 'react';

/**
 * Provides the nearest parent `Input` SDUI node's ID to descendant nodes.
 * Used by `trackFormFieldProps` so `InputField` children can write to
 * `variables['{parentInputId}-value']` on change — keeping the formula
 * `variables['input-uuid-value']` live without modifying the renderer pipeline.
 */
export const InputParentContext = createContext<string | null>(null);

export function useParentInputId(): string | null {
  return useContext(InputParentContext);
}
