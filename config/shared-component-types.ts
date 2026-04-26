/**
 * Shared component type definitions.
 * Used by config/root.ts and lib/sdui/components/SharedComponentNode.tsx.
 */

export type SharedComponentPropertyType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'color'
  | 'any'
  | 'size'
  | 'select'
  | 'icon'
  | 'list';

export interface SharedComponentProperty {
  id: string;
  name: string;
  type: SharedComponentPropertyType;
  defaultValue?: unknown;
  /** Option list for properties whose type is 'select'. */
  options?: Array<{ label: string; value: string }>;
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

/**
 * A custom trigger declared on a component model (WeWeb-parity "component
 * event"). Listener workflows on an instance set `workflow.trigger = trigger.id`
 * and receive the emitted payload as `context.event` in their scope.
 */
export interface ComponentTrigger {
  /** Stable id — referenced as `workflow.trigger` on listener workflows. */
  id: string;
  /** Display label ("On login success"). */
  name: string;
  /**
   * Payload template evaluated at emit time. Stored as a `FormulaValue` —
   * either a literal JSON string authored in a code editor, or a bound
   * formula (`{ formula: "..." }`) that reads the emit-site scope (e.g.
   * `context?.item?.data?.dateStr`). The engine evaluates this once per emit
   * and delivers the result to every matching listener as `context.event`.
   * Declaring the shape here (instead of on the emit step) keeps the payload
   * in one place — emit sites just reference the trigger id.
   */
  payload?: string | { formula: string };
}

/** A workflow scoped to a shared component model. */
export interface ScopedWorkflow {
  id: string;
  name: string;
  /**
   * Workflow trigger. Three categories:
   *  - Component lifecycle (surfaces under the SC's Component/Actions tab):
   *    'execution' (= only via executeComponentAction), 'created', 'mounted',
   *    'beforeUnmount', 'propertyChange'.
   *  - DOM events (surfaces under an element's right-panel Workflow tab when
   *    the workflow is bound to an inner element via `actions: [{action}]`):
   *    'click', 'doubleClick', 'rightClick', 'mouseDown', 'mouseUp',
   *    'mouseMove', 'mouseEnter', 'mouseLeave', 'touchStart', 'touchMove',
   *    'touchEnd', 'touchCancel', 'scroll', 'escapeKey', 'resize', 'keydown',
   *    'keyup'.
   *  - Custom component triggers (WeWeb-style component events): any string id
   *    that matches a `ComponentTrigger.id` declared on the ambient SC model.
   *    Listener workflows live on an instance node, invoked by
   *    `emitComponentTrigger` from inside the component.
   */
  trigger:
    | 'execution' | 'created' | 'mounted' | 'beforeUnmount' | 'propertyChange'
    | 'click' | 'doubleClick' | 'rightClick'
    | 'mouseDown' | 'mouseUp' | 'mouseMove' | 'mouseEnter' | 'mouseLeave'
    | 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel'
    | 'scroll' | 'escapeKey' | 'resize' | 'keydown' | 'keyup'
    | (string & {});
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
  /**
   * Custom triggers (component events) declared on this component. Fired from
   * inside the component by the `emitComponentTrigger` workflow step and
   * listened to by parent-page workflows bound on an instance.
   */
  triggers?: ComponentTrigger[];
  content: Record<string, unknown>;
}
