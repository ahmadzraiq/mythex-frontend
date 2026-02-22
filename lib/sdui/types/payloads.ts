/**
 * SDUI action payload types
 */

/** Action payload for setState */
export interface SetStatePayload {
  path: string;
  value?: unknown;
  merge?: boolean;
}

/** Action payload for fetch */
export interface FetchPayload {
  url: string;
  method?: string;
  key: string;
  body?: Record<string, unknown>;
}

/** Action payload for navigate (switch view) */
export interface NavigatePayload {
  view: string;
  state?: Record<string, unknown>;
}

/** Action payload for setStateTemporary (e.g. toast - clears after delay) */
export interface SetStateTemporaryPayload {
  path: string;
  value: unknown;
  clearAfter?: number;
}
