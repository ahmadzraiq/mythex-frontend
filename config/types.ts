/**
 * App config types - used by page and config
 */

export type PageUI = {
  redirecting?: { text?: string; wrapperClassName?: string; textClassName?: string };
  pageNotFound?: { text?: string; wrapperClassName?: string; textClassName?: string };
  layoutClasses?: Record<string, string>;
};

export type AuthConfig = {
  tokenStorageKey?: string;
  tokenType?: 'bearer' | 'basic' | 'custom';
  userQuery?: string;
  userQueryEndpoint?: string;
  userQueryHeaders?: Record<string, string>;
  userEndpoint?: string;
  refreshEndpoint?: string;
  unauthenticatedRedirect?: string;
  unauthorizedRedirect?: string;
  authenticatedRedirect?: string;
};

export type AppConfig = {
  defaultRedirect: string;
  ui?: PageUI;
  /** Action to run once on first app mount — used for session restore. */
  startupAction?: string;
  /** Global authentication configuration. */
  authConfig?: AuthConfig;
  routes: Array<{
    path: string;
    config?: string;
    redirect?: string;
    auth?: boolean;
    authRedirect?: string;
    accessCondition?: string;
    guestOnly?: boolean;
    layout?: string;
    dynamic?: boolean;
    paramChangeAction?: string;
    keyBy?: string[];
  }>;
  screens: Record<string, { meta?: object; state?: object; ui: object; dataSources?: object[] }>;
  actions: Record<string, object>;
};
