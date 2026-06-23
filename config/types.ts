/**
 * App config types - used by page and config
 */

export interface WorkflowParam {
  id: string;
  name: string;
  type: 'Text' | 'Number' | 'Boolean' | 'Object' | 'Array';
  allowMultiple?: boolean;
  testValue?: unknown;
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
}

export type PageUI = {
  redirecting?: { text?: string; wrapperClassName?: string; textClassName?: string };
  pageNotFound?: { text?: string; wrapperClassName?: string; textClassName?: string };
  layoutClasses?: Record<string, string>;
};

export type AppConfig = {
  defaultRedirect?: string;
  ui?: PageUI;
  routes: Array<{
    path: string;
    config?: string;
    redirect?: string;
    /** JS formula evaluated at render time. Falsy → redirect to protectionRedirect. Leave empty for public access. */
    protectionCondition?: string;
    /** Path to redirect to when protectionCondition is falsy. Defaults to '/'. */
    protectionRedirect?: string;
    layout?: string;
    dynamic?: boolean;
    paramChangeAction?: string;
    keyBy?: string[];
  }>;
  screens: Record<string, { meta?: object; state?: object; ui: object; dataSources?: object[] }>;
  actions: Record<string, object>;
  /** Named/reusable workflows. Replaces the old split pageWorkflows/globalWorkflows dicts. */
  workflows?: Record<string, WorkflowDef>;
};
