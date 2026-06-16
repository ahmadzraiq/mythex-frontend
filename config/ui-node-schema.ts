/**
 * UI node schema - single source of truth for SDUI JSON tree structure.
 * Used by AI generators and docs. Update here when schema changes.
 */

export const UI_NODE_FIELDS: Record<string, string> = {
  type: 'Component type (Box, Text, Pressable, etc.). Required for most nodes.',
  props: 'Component props: className, size, variant, etc.',
  id: 'Optional id for override targeting (e.g. navbar-cart-button).',
  name: 'Composition label — the "component name" for this piece. Put a descriptive name on every meaningful composition (chip, card, avatar, button, nav, etc.) so it is findable by grep and semantic search. Builder-only; renderer ignores it.',
  children: 'Array of child nodes.',
  text: 'Text content. Use {{path}} interpolation or { expr, suffix?, prefix? } for computed.',
  condition: 'JSON Logic. Render only when truthy.',
  map: 'State path to array; renders node per item. Use with key.',
  key: 'Key for map items (e.g. "product", "$item").',
  actions: 'Event handlers: click, change, keyDown, valueChange, etc.',
  $slot: 'Layout placeholder: "content".',
  _group: 'Named section marker (builder-only, ignored by renderer). Value is a display name e.g. "Hero", "Pricing". Makes this node a virtual file at pages/<page>/groups/<name>. Use for top-level sections that should be independently editable.',
};

/** Recommended key order for predictable AI scanning. */
export const UI_NODE_KEY_ORDER = [
  'type',
  'props',
  'id',
  'condition',
  'map',
  'key',
  'children',
  'actions',
  'text',
  '$slot',
] as const;
