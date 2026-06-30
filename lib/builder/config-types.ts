/**
 * App config types - used by page and config
 */

export interface WorkflowParamValidation {
  /** Text: minimum character length */
  minLength?: number;
  /** Text: maximum character length */
  maxLength?: number;
  /** Text: regex pattern the value must match */
  pattern?: string;
  /** Number: minimum value */
  min?: number;
  /** Number: maximum value */
  max?: number;
  /** Array: minimum number of items */
  minItems?: number;
  /** Array: maximum number of items */
  maxItems?: number;
  /** Text | Number: value must be one of these */
  enum?: string[];
}

export interface WorkflowParam {
  id: string;
  name: string;
  type: 'Text' | 'Number' | 'Boolean' | 'Object' | 'Array' | 'File';
  /** Where this param comes from in the HTTP request */
  in?: 'path' | 'query' | 'body' | 'header';
  /** Whether the param is required (path params are always required) */
  required?: boolean;
  /** Human-readable description shown in docs */
  description?: string;
  /** Test value used in the formula editor dry-runs */
  testValue?: unknown;
  /** Runtime validation rules */
  validation?: WorkflowParamValidation;
}

export interface WorkflowDef {
  id: string;
  name?: string;
  /** Event trigger (click, change, valueChange, created, appLoad, etc.) */
  trigger?: string;
  params?: WorkflowParam[];
  steps: object[];
  folder?: string;
  isTrigger?: boolean;
  isAppTrigger?: boolean;
  pageScope?: string;
  /** Extra trigger configuration (e.g. threshold + scrollTarget for reachEnd) */
  config?: Record<string, unknown>;
}

export type PageUI = {
  redirecting?: { text?: string; wrapperClassName?: string; textClassName?: string };
  pageNotFound?: { text?: string; wrapperClassName?: string; textClassName?: string };
};

export type AppConfig = {
  defaultRedirect?: string;
  ui?: PageUI;
  routes: Array<{
    path: string;
    config?: string;
    redirect?: string;
    dynamic?: boolean;
    paramChangeAction?: string;
    keyBy?: string[];
  }>;
  screens: Record<string, { meta?: object; state?: object; ui: object; dataSources?: object[] }>;
  actions: Record<string, object>;
  /** Named/reusable workflows. Replaces the old split pageWorkflows/globalWorkflows dicts. */
  workflows?: Record<string, WorkflowDef>;
};
