/**
 * component-capabilities.ts
 *
 * Single source of truth for which tool groups each component type supports.
 *
 * Design philosophy (matching the project rule):
 *   "Constraints are enforced by tool errors, not prompt instructions."
 *
 * Usage:
 *   - tool-executor.ts calls checkCapability(nodeId, group, store) before executing
 *     any capability-gated tool — returns { success: false, error } when unsupported.
 *   - Prompts no longer need "NEVER call X on Y" rules; the executor rejects
 *     the call and tells the model which groups the component does support.
 *
 * Universal tools (never capability-gated — always allowed on any component):
 *   set_opacity, set_position, set_animation, set_condition, set_repeat,
 *   bind_action, unbind_action, rename_node, set_transform, set_loading_state,
 *   set_href
 *
 * Unknown component types (not listed here) → no capability restriction applied.
 */

// ─── Tool groups ─────────────────────────────────────────────────────────────

export type ToolGroup =
  | 'text'        // set_text, set_placeholder
  | 'typography'  // set_typography, set_text_color
  | 'background'  // set_background
  | 'src'         // set_src, set_video_props
  | 'icon'        // set_icon_src
  | 'layout'      // set_layout
  | 'size'        // set_size
  | 'spacing'     // set_spacing
  | 'border'      // set_border
  | 'shadow'      // set_shadow
  | 'overflow'    // set_overflow
  | 'input-props' // set_input_props, set_validation
  | 'submit'      // set_submit
  | 'disabled';   // set_disabled

/** Maps each tool name to its capability group (undefined = universal or custom check in executor). */
export const TOOL_CAPABILITY_GROUP: Partial<Record<string, ToolGroup>> = {
  set_text:        'text',
  set_placeholder: 'text',
  set_text_color:  'typography',
  set_background:  'background',
  set_src:         'src',
  set_video_props: 'src',
  set_icon_src:    'icon',
  // set_layout: omitted — executor handles per-param capability checks (layout, spacing, size, typography groups)
  // set_spacing: omitted — backward-compat alias, delegates to set_layout which does its own checks
  // set_size: omitted — backward-compat alias, delegates to set_layout which does its own checks
  // set_typography: omitted — backward-compat alias, delegates to set_layout which does its own checks
  set_border:      'border',
  set_shadow:      'shadow',
  set_overflow:    'overflow',
  set_input_props: 'input-props',
  set_validation:  'input-props',
  set_submit:      'submit',
  set_disabled:    'disabled',
};

// ─── Component capability registry ───────────────────────────────────────────
//
// Each entry is a whitelist of groups the component supports.
// Missing groups = blocked (returns a helpful error with the allowed list).
// null = component not in registry = no restriction (passthrough).
//
// "Universal" tools (set_opacity, set_position, set_animation, set_condition,
// set_repeat, bind_action, unbind_action, rename_node, set_transform,
// set_loading_state, set_href) are never checked against this registry.

export const COMPONENT_CAPABILITIES: Record<string, ToolGroup[]> = {
  // ── Layout containers ─────────────────────────────────────────────────────
  // Box covers all palette entries that use type:"Box" (Row, Grid, Card, Link,
  // Divider, Button variants, Chip, Table, etc.)
  Box: [
    'background', 'layout', 'size', 'spacing', 'border',
    'shadow', 'overflow', 'submit', 'disabled',
  ],

  // ── Typography ────────────────────────────────────────────────────────────
  // Text covers all palette entries that use type:"Text" (Heading, Label, Caption).
  // Not a container: no layout, no background. Size (maxWidth/minWidth/width) is valid
  // for controlling line-wrapping width and works alongside typography in set_layout.
  Text: ['text', 'typography', 'size', 'spacing', 'border'],

  // ── Media ─────────────────────────────────────────────────────────────────
  // Image/Video render their own content — no background, no overflow, no layout.
  Image: ['src', 'size', 'border', 'shadow'],
  Video: ['src', 'size', 'border'],

  // Icon name is set via set_icon_src; color/size are set via set_style (Icon-specific branch).
  // No layout (not a container), no background, no typography.
  Icon: ['icon'],

  // ── Form container ────────────────────────────────────────────────────────
  FormContainer: [
    'background', 'layout', 'size', 'spacing', 'border', 'shadow', 'overflow',
  ],

  // ── Form inputs ───────────────────────────────────────────────────────────
  Input: ['size', 'border', 'spacing', 'input-props', 'disabled'],
  Textarea: ['size', 'border', 'spacing', 'input-props', 'disabled'],

  // Select is a composite — style the trigger/content children directly.
  Select: ['size', 'border', 'spacing', 'disabled'],

  // ── Toggle / check controls ───────────────────────────────────────────────
  Checkbox:      ['disabled'],
  CheckboxGroup: ['layout', 'size', 'spacing', 'disabled'],

  Switch: ['disabled'],

  RadioGroup: ['layout', 'size', 'spacing', 'disabled'],

  Slider:   ['size', 'disabled'],
  Progress: ['size', 'border'],

  // ── Overlays ──────────────────────────────────────────────────────────────
  Tooltip: ['layout'],

  // ── Skeleton ──────────────────────────────────────────────────────────────
  Skeleton: ['size', 'border'],

  // ── Data & Media widgets ──────────────────────────────────────────────────
  // These are mostly opaque components — only size makes sense externally.
  DatePicker:      ['size', 'border', 'disabled'],
  TimePicker:      ['size', 'border', 'disabled'],
  DateTimePicker:  ['size', 'border', 'disabled'],
  ColorPicker:     ['size', 'disabled'],
  FileUpload:      ['size', 'border', 'disabled'],
  Iframe:          ['size'],
  SvgViewer:       ['size'],
  JsonViewer:      ['size'],
  Chart:           ['size'],
  QRCodeWidget:    ['size'],
  MarkdownViewer:  ['size'],
  GoogleMap:       ['size'],
  GoogleMapPlaces: ['size', 'border', 'disabled'],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the supported tool groups for the given component type,
 * or null if the type is not in the registry (no restriction applied).
 */
export function getCapabilities(componentType: string): ToolGroup[] | null {
  return COMPONENT_CAPABILITIES[componentType] ?? null;
}

/**
 * Builds a concise capability table scoped to the tools an agent actually has.
 * Only lists component types where some of the agent's tools are blocked.
 * Types that support all of the agent's groups are omitted (no restriction).
 *
 * Example output for layout agent (groups: layout, size, spacing, overflow):
 *   ## Component restrictions for your tools
 *   - Text → spacing only  (skip: layout, size, overflow)
 *   - Image → size only  (skip: layout, spacing, overflow)
 *   - Icon → skip — none of your tools apply
 *   - Input → size, spacing only  (skip: layout, overflow)
 *   Unlisted types (Box, FormContainer, etc.) → all your tools work.
 */
export function buildAgentCapabilityTable(agentGroups: ToolGroup[]): string {
  const lines: string[] = [];
  for (const [type, caps] of Object.entries(COMPONENT_CAPABILITIES)) {
    const allowed = agentGroups.filter(g => caps.includes(g));
    if (allowed.length === agentGroups.length) continue; // fully supported — omit
    const blocked = agentGroups.filter(g => !caps.includes(g));
    if (allowed.length === 0) {
      lines.push(`  - ${type} → skip — none of your tools apply`);
    } else {
      lines.push(`  - ${type} → ${allowed.join(', ')} only  (skip: ${blocked.join(', ')})`);
    }
  }
  if (lines.length === 0) return '';
  return `## Component restrictions for your tools\n${lines.join('\n')}\n  Unlisted types → all your tools work.`;
}

/**
 * Returns a human-readable string describing what this component supports.
 * Used to populate error messages so the AI knows what to use instead.
 *
 * Example: "Box supports: background, layout, size, spacing, border, shadow, overflow, submit, disabled"
 */
export function buildCapabilityNote(componentType: string): string {
  const caps = getCapabilities(componentType);
  if (!caps) return `${componentType}: no restrictions (all tool groups allowed)`;
  if (caps.length === 0) return `${componentType}: no styling groups supported (use universal tools only: set_opacity, set_position, set_animation, set_condition, etc.)`;
  return `${componentType} supports: ${caps.join(', ')}`;
}

/**
 * Returns a suggestion message for when a tool group is blocked.
 * Maps disallowed groups to actionable alternatives.
 */
export function buildBlockedGroupSuggestion(group: ToolGroup, componentType: string): string {
  const SUGGESTIONS: Partial<Record<ToolGroup, string>> = {
    text:        'Use set_text on a Text child node instead.',
    typography:  'Use set_typography / set_text_color on a Text child node instead.',
    background:  'Wrap the element in a Box and call set_background on the Box instead.',
    src:         'Use set_src — it only works on Image or Video nodes.',
    icon:        'Use set_icon_src on an Icon node to set the icon name; use set_style for color/size.',
    layout:      `${componentType} is not a flex/grid container. Use set_layout on a Box wrapper.`,
    size:        `Use set_style with "width" param for Icon nodes, or use set_layout / set_spacing for Text.`,
    overflow:    `${componentType} manages overflow internally. Use a Box wrapper for overflow control.`,
    'input-props': 'Use set_input_props / set_validation on an Input or Textarea node.',
    submit:      'set_submit only applies to Box-based button nodes inside a FormContainer.',
    disabled:    `${componentType} does not support the disabled state.`,
  };
  return SUGGESTIONS[group] ?? `"${group}" is not supported on ${componentType}.`;
}
