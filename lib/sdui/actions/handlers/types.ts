/**
 * Context passed to action handlers. Handlers receive the action definition and
 * this context to perform side effects (setData, setLoading, runOne, etc.).
 */

import type { SDUIAction } from '../../types';

export type ActionDef = Record<string, unknown> & {
  type?: string;
  path?: string;
  value?: unknown;
  url?: string;
  storeIn?: string;
  onSuccess?: { action: string; payload?: Record<string, unknown> } | Array<{ action: string; payload?: Record<string, unknown> }>;
  [key: string]: unknown;
};

export interface ActionHandlerContext {
  get: (path: string, scope?: Record<string, unknown>) => unknown;
  getFullMergedState: () => Record<string, unknown>;
  setData: (path: string, value: unknown) => void;
  setLoading: (storeIn: string, loading: boolean) => void;
  setError: (storeIn: string, error: string | null) => void;
  append: (path: string, value: unknown) => void;
  runOne: (a: SDUIAction) => Promise<void>;
  store: { getState: () => { setState: (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void } };
  configName: string;
  actionName: string;
  payload?: Record<string, unknown>;
  scope?: Record<string, unknown>;
  event?: unknown;
  CONVENTIONS: Record<string, unknown>;
  router?: { push: (url: string) => void };
  pathname?: string;
  searchParams?: URLSearchParams | null;
  routes?: Array<{ path?: string; config?: string; dynamic?: boolean }>;
  setColorScheme?: (mode: 'light' | 'dark' | 'system') => void;
  useSduiStore?: { getState: () => { setData: (path: string, value: unknown) => void } };
}

export type ActionHandler = (
  actionDef: ActionDef,
  ctx: ActionHandlerContext
) => Promise<void>;
