/**
 * Shared types for AI output validators.
 */

export type ValidationResult = {
  pass: boolean;
  errors?: string[];
};

export type UiNode = {
  type?: string;
  id?: string;
  map?: string;
  key?: string;
  props?: Record<string, unknown>;
  text?: string | Record<string, unknown>;
  actions?: Record<string, unknown>;
  condition?: unknown;
  children?: UiNode[];
  $ref?: string;
  $slot?: string;
  [key: string]: unknown;
};
