/**
 * Shared component type definitions.
 * Used by config/root.ts and lib/sdui/components/SharedComponentNode.tsx.
 */

export type SharedComponentPropertyType = 'text' | 'number' | 'boolean' | 'color' | 'any';

export interface SharedComponentProperty {
  id: string;
  name: string;
  type: SharedComponentPropertyType;
  defaultValue?: unknown;
}

/** A variable scoped to a shared component model instance. */
export interface ScopedVarDef {
  /** Display label shown in the builder */
  label: string;
  /** Optional machine-friendly name (used for formula references) */
  name?: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  initialValue: unknown;
  folder?: string;
  description?: string;
  saveInLocalStorage?: boolean;
}

/** A formula scoped to a shared component model. */
export interface ScopedFormulaDef {
  id: string;
  name: string;
  params: Array<{ id: string; name: string; type: string }>;
  formula: string;
  folder?: string;
  description?: string;
}

/** A workflow step (minimal — actual step shape is defined in the builder store types). */
export type ScopedWorkflowStep = Record<string, unknown>;

/** A workflow scoped to a shared component model. */
export interface ScopedWorkflow {
  id: string;
  name: string;
  /** Component-specific trigger. 'execution' = only via executeComponentAction. */
  trigger: 'execution' | 'created' | 'mounted' | 'beforeUnmount' | 'propertyChange';
  /** Declared input parameters — always present (empty array when none). */
  params: Array<{
    id: string;
    name: string;
    type: 'Text' | 'Number' | 'Boolean' | 'Object' | 'Array';
    testValue?: unknown;
  }>;
  steps: ScopedWorkflowStep[];
  folder?: string;
  description?: string;
}

export interface SharedComponentModel {
  id: string;
  name: string;
  /** Folder/group for organising components in the builder panel. */
  folder?: string;
  /** Human-readable description shown in the builder panel. */
  description?: string;
  properties: SharedComponentProperty[];
  /** Variables scoped to this component (keyed by a stable UUID). */
  variables?: Record<string, ScopedVarDef>;
  /** Formulas scoped to this component (keyed by a stable UUID). */
  formulas?: Record<string, ScopedFormulaDef>;
  /** Workflows scoped to this component (keyed by a stable UUID). */
  workflows?: Record<string, ScopedWorkflow>;
  content: Record<string, unknown>;
}
