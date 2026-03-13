/**
 * Engine conventions - hardcoded defaults (no store.json dependency).
 * Per-variable flags (persist, resetOnNavigate, role, sortInputMap) are read
 * at runtime from variables.json via the variable-config helpers.
 */

export const CONVENTIONS = {
  loadingSuffix: 'loading' as const,
  errorSuffix: 'error' as const,
  workflowPath: '_workflow' as const,
};
