/**
 * SDUI config and context types
 */

import type { SDUINode, SDUIAction, SDUIDataSource } from './node';

/** Full screen/page configuration */
export interface SDUIConfig {
  state?: Record<string, unknown>;
  /** Data sources - fetched when config loads */
  dataSources?: SDUIDataSource[];
  /** Actions to run on mount (e.g. redux_fetchProducts) */
  initActions?: SDUIAction[];
  ui: SDUINode;
  meta?: { title?: string; description?: string };
}

/** Runtime context passed through render tree */
export interface SDUIContext {
  state: Record<string, unknown>;
  setState: (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  get: (path: string, scope?: Record<string, unknown>) => unknown;
  runAction: (action: SDUIAction | SDUIAction[], event?: unknown, scope?: Record<string, unknown>) => void | Promise<void>;
  fetchData: (ds: SDUIDataSource) => Promise<void>;
}
