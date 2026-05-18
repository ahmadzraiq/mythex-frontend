/**
 * component-capabilities.ts — Phase 10: capabilities matrix removed.
 *
 * Any tool now runs on any node. The engine ignores mismatched props (same as
 * standard React/CSS semantics). This file is kept as a stub so existing imports
 * in tool-executor.ts continue to compile without changes.
 *
 * All functions return permissive values (no restrictions).
 */

// ─── Tool groups ─────────────────────────────────────────────────────────────

export type ToolGroup =
  | 'text'
  | 'typography'
  | 'background'
  | 'src'
  | 'icon'
  | 'layout'
  | 'size'
  | 'spacing'
  | 'border'
  | 'shadow'
  | 'overflow'
  | 'input-props'
  | 'submit'
  | 'disabled';

/** @deprecated Phase 10 — capabilities matrix removed. All groups accepted on all nodes. */
export const TOOL_CAPABILITY_GROUP: Partial<Record<string, ToolGroup>> = {};

/** @deprecated Phase 10 — capabilities matrix removed. */
export const COMPONENT_CAPABILITIES: Record<string, ToolGroup[]> = {};

/**
 * Phase 10: always returns null (no restriction) so checkCapability never blocks.
 * @deprecated
 */
export function getCapabilities(_componentType: string): ToolGroup[] | null {
  return null; // null = no restriction in executor
}

/**
 * Phase 10: always returns empty string (no capability table injected into prompts).
 * @deprecated
 */
export function buildAgentCapabilityTable(_agentGroups: ToolGroup[]): string {
  return '';
}

/**
 * Phase 10: always returns empty string.
 * @deprecated
 */
export function buildCapabilityNote(_componentType: string): string {
  return '';
}

/**
 * Phase 10: always returns empty string.
 * @deprecated
 */
export function buildBlockedGroupSuggestion(_group: ToolGroup, _componentType: string): string {
  return '';
}
