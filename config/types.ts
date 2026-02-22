/**
 * App config types - used by page and config
 */

export type PageUI = {
  redirecting?: { text?: string; wrapperClassName?: string; textClassName?: string };
  pageNotFound?: { text?: string; wrapperClassName?: string; textClassName?: string };
  layoutClasses?: Record<string, string>;
};

export type AppConfig = {
  defaultRedirect: string;
  ui?: PageUI;
  routes: Array<{
    path: string;
    config?: string;
    redirect?: string;
    auth?: boolean;
    layout?: string;
    dynamic?: boolean;
    paramChangeAction?: string;
    keyBy?: string[];
  }>;
  screens: Record<string, { meta?: object; state?: object; ui: object; initActions?: object[]; dataSources?: object[] }>;
  actions: Record<string, object>;
};
