/**
 * Engine types - ValidationRule, ActionsConfig, EngineConfig, RouteConfig, SDUIEngineProps
 */

import type { SDUIConfig } from './types';

/** Named data source definition (from config/datasources.json). The record key is the storeIn path. */
export type NamedDataSourceDef = RestNamedDataSourceDef | GraphQLNamedDataSourceDef;

export interface RestNamedDataSourceDef {
  type: 'rest';
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Array<{ key: string; value: string; enabled?: boolean }> | Record<string, string | { formula: string }>;
  queryParams?: Array<{ key: string; value: string; enabled?: boolean }>;
  body?: string;
  responsePath?: string;
  proxy?: boolean;
  sendCredentials?: boolean;
  skipStoreWhenNull?: boolean;
  cacheTag?: string;
  cacheTTL?: number;
  cacheKeyVars?: string[];
}

export interface GraphQLNamedDataSourceDef {
  type: 'graphql';
  endpoint: string;
  query: string;
  variables?: Record<string, unknown>;
  headers?: Record<string, string>;
  responsePath?: string;
  skipStoreWhenNull?: boolean;
  cacheTag?: string;
  cacheTTL?: number;
  cacheKeyVars?: string[];
  /** Route this datasource through /api/proxy (server-side) to bypass CORS. */
  proxy?: boolean;
  /** Send credentials (cookies) with the request. */
  sendCredentials?: boolean;
}

export interface ValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  equals?: string;
  equalsField?: string;
  message?: string;
}

/** Supported validation rule keys. Used by AI generators. */
export const VALIDATION_RULE_KEYS = [
  'required',
  'minLength',
  'maxLength',
  'pattern',
  'equals',
  'equalsField',
  'message',
] as const;

export interface ActionsConfig {
  [actionName: string]: {
    type: string;
    url?: string;
    method?: string;
    body?: Record<string, unknown>;
    storeFullResponseIn?: string;
    path?: string;
    value?: unknown;
    map?: Record<string, string>;
    rules?: Record<string, ValidationRule>;
    storeErrorsIn?: string;
    payload?: Record<string, unknown>;
    actions?: Array<{ action: string; payload?: Record<string, unknown> }>;
    formPath?: string;
    targetPath?: string;
    resetFormPath?: string;
    resetFormValue?: Record<string, unknown>;
  };
}

export interface EngineConfig {
  sync?: readonly string[];
}

/** Global authentication configuration — used by authenticate/clearSession/restoreSession steps. */
export interface AuthConfig {
  /** Token type prefix for Authorization header (default: 'bearer'). */
  tokenType?: 'bearer' | 'basic' | 'custom';
  /**
   * How to send the stored token in outgoing requests.
   * Defaults to { header: 'Authorization', prefix: 'Bearer ' }.
   */
  tokenSend?: {
    /** Request header name (default: 'Authorization'). */
    header?: string;
    /** Prefix before the token value (default: 'Bearer '). */
    prefix?: string;
  };
  /** GraphQL query to fetch the current user (used by restoreSession step). */
  userQuery?: string;
  /** Endpoint for the userQuery (falls back to global GraphQL endpoint). */
  userQueryEndpoint?: string;
  /** Extra headers for the userQuery request. */
  userQueryHeaders?: Record<string, string>;
  /** REST endpoint to fetch the current user. Used when userQuery is not set. */
  userEndpoint?: string;
  /** Refresh token endpoint (optional). */
  refreshEndpoint?: string;
  /** Redirect path for unauthenticated users hitting a protected route (default: '/sign-in'). */
  unauthenticatedRedirect?: string;
  /** Redirect path when accessCondition fails for an authenticated user (default: '/'). */
  unauthorizedRedirect?: string;
  /** Redirect path when an authenticated user hits a guestOnly page (default: '/'). */
  authenticatedRedirect?: string;
}

export interface RouteConfig {
  path: string;
  config?: string;
  dynamic?: boolean;
  /** If true, only authenticated users can access this route. */
  auth?: boolean;
  /** Formula evaluated after auth check; falsy → redirect to authConfig.unauthorizedRedirect. */
  accessCondition?: string;
  /** If true, authenticated users are redirected away (e.g. /sign-in, /register). */
  guestOnly?: boolean;
}

export interface SDUIEngineProps {
  config: SDUIConfig;
  configName?: string;
  actionsConfig?: ActionsConfig;
  engineConfig?: EngineConfig;
  routes?: RouteConfig[];
  paramChangeAction?: string;
  /** Global authentication configuration (token storage, user endpoint, redirect paths). */
  authConfig?: AuthConfig;
  /** Named data sources from config/datasources.json — fetched on mount, stored at their name path. */
  dataSources?: Record<string, NamedDataSourceDef>;
  /** When true, annotates every rendered node with data-builder-* attributes.
   *  Used by /dev/builder. */
  builderMode?: boolean;
  /** In builder mode, caps the overlay height to the canvas viewport
   *  (e.g. 900) so it doesn't cover the full scrollable page height. */
  builderViewportHeight?: number;
  /** Node IDs with their popover/tooltip shown on the builder canvas (e.g. "popover:abc123") */
  shownPopovers?: Set<string>;
  /** Active preview state name (e.g. 'hover', 'loading', 'error', 'empty').
   *  When set in builder mode, applies _stateOverrides and state patches. */
  previewState?: string;
  /** Multiple active preview states — applied in order. Supercedes previewState when provided. */
  previewStates?: string[];
  /** Flat key-value data to overlay on top of merged state in builder mode.
   *  Used by the "Data" preview state to inject per-page dummy data. */
  previewData?: Record<string, unknown>;
  /** In builder mode, the active viewport preset (e.g. 'mobile', 'tablet').
   *  Used to derive the responsive breakpoint for the simulated canvas width
   *  instead of reading window.innerWidth. */
  builderViewport?: 'mobile' | 'tablet' | 'laptop' | 'desktop';
  /** In builder mode, per-page query parameter definitions injected into
   *  globalContext.browser.query so formulas can reference them. */
  builderQueryParams?: Array<{ name: string; value: string }>;
}
