/**
 * Shared agent taxonomy — single source of truth for agent names and descriptions.
 * Imported by context-agent.ts (operationTypes) and planner/prompt.ts (full agent list).
 */

/**
 * Descriptions for the operation-type specialists the Context Agent can dispatch.
 * (Does not include structure/media/sharedComponents — those require a full build op.)
 */
export const OPERATION_TYPE_LINES = [
  '"styling" — any visual change: color, size, spacing, layout, typography, background, border, shadow, opacity',
  '"animation" — transitions, hover effects, keyframe animations',
  '"binding" — connecting a node to a variable or data source',
  '"workflows" — adding/editing click handlers, navigation, form submission',
  '"data" — adding or configuring a data source',
].map(l => `- ${l}`).join('\n');

/**
 * Full agent list for the Planner prompt.
 */
export const PLANNER_AGENT_LINES = `- structure — builds or rewrites the node tree (new sections, pages, delete, reorder)
- styling — visual design: colors, spacing, typography, shadows, layout, border
- media — places images, videos, icons (any visual asset)
- binding — connects nodes to variables or data sources
- workflows — the only agent that writes to variables; required whenever a user action must update any variable value
- animation — transitions, hover effects, keyframe animations
- data — configures remote API datasources only (REST endpoints, GraphQL). Never include it when all data is local UI state — variables declared by the structure agent are NOT datasources.
- sharedComponents — creates reusable component definitions`;
