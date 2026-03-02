/**
 * Engine types - ValidationRule, ActionsConfig, EngineConfig, RouteConfig, SDUIEngineProps
 */

import type { SDUIConfig } from './types';

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
    storeIn?: string;
    storeFullResponseIn?: string;
    responsePath?: string;
    errorMessagePath?: string;
    path?: string;
    value?: unknown;
    map?: Record<string, string>;
    rules?: Record<string, ValidationRule>;
    storeErrorsIn?: string;
    payload?: Record<string, unknown>;
    actions?: Array<{ action: string; payload?: Record<string, unknown> }>;
    onSuccess?: { action: string; payload?: Record<string, unknown> } | { action: string; payload?: Record<string, unknown> }[];
    formPath?: string;
    targetPath?: string;
    resetFormPath?: string;
    resetFormValue?: Record<string, unknown>;
  };
}

export interface EngineConfig {
  sync?: readonly string[];
}

export interface RouteConfig {
  path: string;
  config?: string;
  dynamic?: boolean;
}

export interface SDUIEngineProps {
  config: SDUIConfig;
  configName?: string;
  actionsConfig?: ActionsConfig;
  engineConfig?: EngineConfig;
  routes?: RouteConfig[];
  paramChangeAction?: string;
  /** When true, annotates every rendered node with data-builder-* attributes.
   *  Used by /dev/builder. */
  builderMode?: boolean;
  /** Active preview state name (e.g. 'hover', 'loading', 'error', 'empty').
   *  When set in builder mode, applies _stateOverrides and state patches. */
  previewState?: string;
  /** Multiple active preview states — applied in order. Supercedes previewState when provided. */
  previewStates?: string[];
  /** Flat key-value data to overlay on top of merged state in builder mode.
   *  Used by the "Data" preview state to inject per-page dummy data. */
  previewData?: Record<string, unknown>;
}
