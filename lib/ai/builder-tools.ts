/**
 * Builder Tool Definitions — Anthropic tool_use format.
 *
 * Core design principle: The AI works exactly like a builder user.
 * - It adds components by their palette label ("Card", "Btn Solid", etc.)
 * - It edits text, styles, and props through semantic design tools
 * - It NEVER writes raw JSON — that's the builder's job
 *
 * Grouped by category to match the builder's left-panel organization.
 */

interface BuilderTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

import { ALL_PRIMITIVES } from '@/lib/builder/primitive-components';
import { TOOL_DESCRIPTIONS } from '@/lib/ai/builder-knowledge-v2';

// ─── Component Labels (what the AI knows as palette labels) ───────────────────

// Auto-derived from ALL_PRIMITIVES — stays in sync with the builder palette automatically
export const COMPONENT_LABELS: string[] = ALL_PRIMITIVES.map(c => c.label);

// ─── Read / Context Tools ─────────────────────────────────────────────────────

const readTools: BuilderTool[] = [
  {
    name: 'get_page_tree',
    description: TOOL_DESCRIPTIONS['get_page_tree'],
    input_schema: {
      type: 'object',
      properties: {
        depth: { type: 'number', description: 'How many levels deep to include. Default 2 (sections + their direct children). Max 4.' },
      },
    },
  },
  {
    name: 'get_node_details',
    description: TOOL_DESCRIPTIONS['get_node_details'],
    input_schema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node IDs to inspect.' },
      },
      required: ['nodeIds'],
    },
  },
  {
    name: 'get_pages',
    description: TOOL_DESCRIPTIONS['get_pages'],
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_theme',
    description: TOOL_DESCRIPTIONS['get_theme'],
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_variables',
    description: TOOL_DESCRIPTIONS['get_variables'],
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_formula_context',
    description: TOOL_DESCRIPTIONS['get_formula_context'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Single node ID to check repeat nesting for.',
        },
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Batch: array of node IDs to check in one call. Returns scope info for each.',
        },
      },
    },
  },
  {
    name: 'get_workflows',
    description: TOOL_DESCRIPTIONS['get_workflows'],
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_data_sources',
    description: TOOL_DESCRIPTIONS['get_data_sources'],
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_nodes',
    description: TOOL_DESCRIPTIONS['search_nodes'],
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Substring to search for in node name, type, text content, or id (case-insensitive).',
        },
        nodeType: {
          type: 'string',
          description: 'Optional: filter results to a specific component type, e.g. "Button", "Text", "Box".',
        },
      },
      required: ['query'],
    },
  },
];

// ─── Component Addition (like dragging from the left panel) ───────────────────

const addTools: BuilderTool[] = [
  {
    name: 'add_component',
    description: TOOL_DESCRIPTIONS['add_component'],
    input_schema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          enum: COMPONENT_LABELS as unknown as string[],
          description: 'Component palette label. E.g. "Card", "Btn Solid", "Heading", "HStack". Do NOT use for Image or Video — use add_image / add_video instead; those tools set src correctly.',
        },
        nodeId: {
          type: 'string',
          description: 'UUID for this node — generate a UUID yourself (e.g. "a1b2c3d4-e5f6-7890-abcd-ef1234567890"). Use this exact UUID as parentId for children in the same batch and for all subsequent tool calls.',
        },
        name: {
          type: 'string',
          description: 'Display name shown in the Layers panel (e.g. "Hero Section", "Pricing Card", "Nav Bar"). Always set this on container/section nodes. Replaces the need for a separate rename_node call on initial creation.',
        },
        parentId: {
          type: 'string',
          description: 'UUID of the container to add into. Use the UUID you set as nodeId on the parent in this batch, or the real UUID from a previous round\'s result. Omit to add at the top-level of the current page.',
        },
        atIndex: {
          type: 'number',
          description: 'Position within parent children. Omit to append at end.',
        },
      },
      required: ['label'],
    },
  },
  {
    name: 'add_icon',
    description: TOOL_DESCRIPTIONS['add_icon'],
    input_schema: {
      type: 'object',
      properties: {
        icon: { type: 'string', description: 'Iconify icon name, e.g. "lucide:coffee", "heroicons:star", "mdi:home".' },
        parentId: { type: 'string', description: 'Container to add into.' },
        size: { type: 'number', description: 'Icon size in px. Default 24.' },
        color: { type: 'string', description: 'Color. Default "currentColor". Can use CSS vars like "var(--theme-primary)".' },
      },
      required: ['icon'],
    },
  },
  {
    name: 'add_image',
    description: TOOL_DESCRIPTIONS['add_image'],
    input_schema: {
      type: 'object',
      properties: {
        src: { type: 'string', description: 'Image URL.' },
        alt: { type: 'string', description: 'Alt text.' },
        objectFit: { type: 'string', description: 'Object fit: cover | contain | fill | none | scale-down. Default "cover".' },
        parentId: { type: 'string', description: 'Container to add into.' },
        className: { type: 'string', description: 'Optional layout override. Omit to use the default Image preset; prefer set_size / set_border after adding when possible.' },
      },
      required: ['src'],
    },
  },
  {
    name: 'add_video',
    description: TOOL_DESCRIPTIONS['add_video'],
    input_schema: {
      type: 'object',
      properties: {
        src: { type: 'string', description: 'Video URL (mp4, webm, etc.).' },
        poster: { type: 'string', description: 'Poster image URL shown before the video plays.' },
        autoPlay: { type: 'boolean', description: 'Auto-play on load. Default true.' },
        loop: { type: 'boolean', description: 'Loop the video. Default true.' },
        muted: { type: 'boolean', description: 'Mute audio. Default true (required for autoPlay in browsers).' },
        controls: { type: 'boolean', description: 'Show playback controls. Default false (background videos are usually silent and control-free).' },
        objectFit: { type: 'string', description: 'Object fit: cover | contain | fill. Default "cover".' },
        parentId: { type: 'string', description: 'Container to add into.' },
        className: { type: 'string', description: 'Optional layout override. Omit to use the default Video preset; prefer set_size after adding when possible.' },
      },
      required: ['src'],
    },
  },
];

// ─── Node Deletion / Duplication / Movement ───────────────────────────────────

const structureTools: BuilderTool[] = [
  {
    name: 'delete_node',
    description: TOOL_DESCRIPTIONS['delete_node'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'ID of the node to delete.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'duplicate_node',
    description: TOOL_DESCRIPTIONS['duplicate_node'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the node to duplicate.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'move_node_up',
    description: TOOL_DESCRIPTIONS['move_node_up'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the node to move.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'move_node_down',
    description: TOOL_DESCRIPTIONS['move_node_down'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the node to move.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'move_node',
    description: TOOL_DESCRIPTIONS['move_node'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node to move.' },
        targetParentId: { type: 'string', description: 'ID of the destination container node. Omit entirely to move to the page root level. NEVER pass a page ID (e.g. "page-1234567890") — that is not a node ID, is not in the tree, and silently deletes the node causing all subsequent operations to fail.' },
        atIndex: { type: 'number', description: 'Position within the target parent. Omit to append at end.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'wrap_in_container',
    description: TOOL_DESCRIPTIONS['wrap_in_container'],
    input_schema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node IDs to wrap.' },
        direction: { type: 'string', enum: ['row', 'column'], description: 'Flex direction for the new wrapper. Default "column".' },
      },
      required: ['nodeIds'],
    },
  },
];

// ─── Text Editing ─────────────────────────────────────────────────────────────

const textTools: BuilderTool[] = [
  {
    name: 'set_text',
    description: TOOL_DESCRIPTIONS['set_text'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        text: { type: 'string', description: 'Literal text ("Get Started") or a plain formula expression ("variables[\'UUID\']", "context.item.data.title", "\'$\' + context.item.data.price"). CRITICAL: String literals inside formula expressions MUST use single quotes (\'$\', \'/month\', \'active\'). NEVER use double quotes inside formula strings — they cause Invalid formula errors.' },
      },
      required: ['nodeId', 'text'],
    },
  },
  {
    name: 'set_placeholder',
    description: TOOL_DESCRIPTIONS['set_placeholder'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        placeholder: { type: 'string' },
      },
      required: ['nodeId', 'placeholder'],
    },
  },
  {
    name: 'set_href',
    description: TOOL_DESCRIPTIONS['set_href'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        href: { type: 'string', description: 'URL or route path, e.g. "/about" or "https://example.com".' },
      },
      required: ['nodeId', 'href'],
    },
  },
  {
    name: 'set_src',
    description: TOOL_DESCRIPTIONS['set_src'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        src: { type: 'string', description: 'New image/video URL. Required — always include the URL when calling this tool.' },
        alt: { type: 'string', description: 'Alt text (Image only).' },
        objectFit: { type: 'string', description: 'Object fit: cover | contain | fill | none | scale-down.' },
        poster: { type: 'string', description: 'Poster image URL (Video only).' },
      },
      required: ['nodeId', 'src'],
    },
  },
  {
    name: 'set_video_props',
    description: TOOL_DESCRIPTIONS['set_video_props'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        poster: { type: 'string', description: 'Poster image URL shown before playback.' },
        autoPlay: { type: 'boolean', description: 'Auto-play on load.' },
        loop: { type: 'boolean', description: 'Loop the video.' },
        muted: { type: 'boolean', description: 'Mute audio.' },
        controls: { type: 'boolean', description: 'Show playback controls.' },
        objectFit: { type: 'string', description: 'Object fit: cover | contain | fill.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_icon',
    description: TOOL_DESCRIPTIONS['set_icon'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        icon: {
          type: 'string',
          description: 'Iconify icon name (static) or a formula expression string (conditional). Static: "lucide:home", "heroicons:star", "tabler:check", "ph:arrow-right", etc. Conditional: pass result.expression with a ternary, e.g. "context?.item?.data?.[\'featured\'] ? \'lucide:check-circle\' : \'lucide:check\'". Omit to keep the current icon and only update size/color.',
        },
        size: { type: 'number', description: 'Optional new size in px.' },
        color: {
          type: 'string',
          description: 'Icon color (static) or formula expression (conditional). Static: "#hex", "currentColor", or theme token name (e.g. "primary", "muted-foreground"). Conditional: ternary using \'theme:tokenName\' for colors. Omit to keep the current color.',
        },
      },
      required: ['nodeId'],
    },
  },
];

// ─── Semantic Design Tools ────────────────────────────────────────────────────
// Every design property is controlled via a dedicated semantic tool — mirroring
// each section of the builder's right-panel Design controls.
// The AI uses semantic design tools only — not raw layout utility strings.

const semanticDesignTools: BuilderTool[] = [
  {
    name: 'set_background',
    description: TOOL_DESCRIPTIONS['set_background'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        bg: {
          type: 'string',
          description: 'Background color (static) or formula expression (conditional). Static: theme name ("primary", "card", "background", "muted", "secondary", "accent", "destructive", "foreground"), or "#hex", "transparent", or Tailwind opacity notation like "black/40". Conditional: ternary using \'theme:tokenName\' for colors (e.g. "variables[\'uuid\'] ? \'theme:primary\' : \'theme:card\'").',
        },
        fillOpacity: {
          type: 'number',
          description: 'Background fill opacity 0–100. Affects ONLY the background color, not child content (unlike set_opacity which affects the whole element). E.g. 50 = semi-transparent background. Only works with named/hex backgrounds, not with "black/40" opacity notation.',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_text_color',
    description: TOOL_DESCRIPTIONS['set_text_color'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        color: {
          type: 'string',
          description: 'Text color (static) or formula expression (conditional). Static: theme name ("foreground", "primary", "primary-foreground", "muted-foreground", "card-foreground", "secondary-foreground", "accent-foreground", "destructive"), or "white", "gray-900", "#hex". Conditional: ternary using \'theme:tokenName\' for colors.',
        },
      },
      required: ['nodeId', 'color'],
    },
  },
  {
    name: 'set_typography',
    description: TOOL_DESCRIPTIONS['set_typography'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        size: {
          type: 'number',
          description: 'Font size in pixels. E.g. 12, 14, 16, 18, 20, 24, 30, 36, 48.',
        },
        weight: {
          type: 'string',
          enum: ['thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black'],
          description: 'Font weight.',
        },
        align: {
          type: 'string',
          enum: ['left', 'center', 'right', 'justify'],
          description: 'CSS text-align for text content rendered inside this node (left/center/right/justify). This does NOT center child nodes in a flex container — use set_layout({align:"center"}) for that.',
        },
        leading: {
          type: 'string',
          enum: ['none', 'tight', 'snug', 'normal', 'relaxed', 'loose', '3', '4', '5', '6', '7', '8', '9', '10'],
          description: 'Line height. Named scale or numeric (3–10).',
        },
        tracking: {
          type: 'string',
          enum: ['tighter', 'tight', 'normal', 'wide', 'wider', 'widest'],
          description: 'Letter spacing.',
        },
        italic: { type: 'boolean', description: 'true = italic, false = not-italic.' },
        decoration: {
          type: 'string',
          enum: ['none', 'underline', 'line-through', 'overline'],
          description: 'Text decoration. "none" removes decoration.',
        },
        transform: {
          type: 'string',
          enum: ['none', 'uppercase', 'lowercase', 'capitalize'],
          description: 'Text transform. "none" resets to normal-case.',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_border',
    description: TOOL_DESCRIPTIONS['set_border'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        width: {
          type: 'number',
          description: 'Border width in pixels. E.g. 1, 2, 4. Pass 0 to remove border.',
        },
        style: {
          type: 'string',
          enum: ['solid', 'dashed', 'dotted', 'double', 'none'],
          description: 'Border style.',
        },
        color: {
          type: 'string',
          description: 'Border color (static) or formula expression (conditional). Static: theme name ("border", "primary", "muted"), or "gray-200", "#hex". Conditional: ternary using \'theme:tokenName\' for colors.',
        },
        radius: {
          type: 'number',
          description: 'Border radius in pixels applied to all four corners. E.g. 4, 6, 8, 12, 9999 (full/pill).',
        },
        radiusTL: { type: 'number', description: 'Top-left corner radius in pixels.' },
        radiusTR: { type: 'number', description: 'Top-right corner radius in pixels.' },
        radiusBR: { type: 'number', description: 'Bottom-right corner radius in pixels.' },
        radiusBL: { type: 'number', description: 'Bottom-left corner radius in pixels.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_shadow',
    description: TOOL_DESCRIPTIONS['set_shadow'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId:     { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        boxShadow:  { type: 'string', description: 'Full CSS box-shadow value OR a formula/ternary expression. Static: "0px 4px 20px 0px #000000". Formula for per-item shadow: "context?.item?.data?.featured ? \'0px 12px 25px -5px #7c3aed\' : \'0px 4px 8px 0px #00000026\'".' },
        color:      { type: 'string', description: 'Shadow color as a hex string, e.g. "#000000", "#a855f7". Used with blur/spread/x/y params.' },
        blur:       { type: 'number', description: 'Shadow blur radius in px. Default 20. Larger = softer/wider shadow.' },
        spread:     { type: 'number', description: 'Shadow spread in px. Default 0. Positive = larger, negative = tighter (inner glow).' },
        x:          { type: 'number', description: 'Horizontal offset in px. Default 0.' },
        y:          { type: 'number', description: 'Vertical offset in px. Default 4.' },
        remove:     { type: 'boolean', description: 'Pass true to remove the shadow entirely.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_opacity',
    description: TOOL_DESCRIPTIONS['set_opacity'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        opacity: { type: 'number', description: 'Opacity 0–100. E.g. 50 = half transparent, 100 = fully visible.' },
      },
      required: ['nodeId', 'opacity'],
    },
  },
  {
    name: 'set_spacing',
    description: TOOL_DESCRIPTIONS['set_spacing'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        p:  { type: 'number', description: 'Padding all sides in px.' },
        px: { type: 'number', description: 'Horizontal padding (left + right) in px.' },
        py: { type: 'number', description: 'Vertical padding (top + bottom) in px.' },
        pt: { type: 'number', description: 'Padding top in px.' },
        pr: { type: 'number', description: 'Padding right in px.' },
        pb: { type: 'number', description: 'Padding bottom in px.' },
        pl: { type: 'number', description: 'Padding left in px.' },
        m:  { type: 'number', description: 'Margin all sides in px.' },
        mx: { type: 'number', description: 'Horizontal margin (left + right) in px.' },
        my: { type: 'number', description: 'Vertical margin (top + bottom) in px.' },
        mt: { type: 'number', description: 'Margin top in px.' },
        mr: { type: 'number', description: 'Margin right in px.' },
        mb: { type: 'number', description: 'Margin bottom in px.' },
        ml: { type: 'number', description: 'Margin left in px.' },
        gap:  { type: 'number', description: 'Gap between flex/grid children in px.' },
        gapX: { type: 'number', description: 'Horizontal gap between children in px.' },
        gapY: { type: 'number', description: 'Vertical gap between children in px.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_size',
    description: TOOL_DESCRIPTIONS['set_size'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        width: {
          type: 'string',
          description: 'Width (static) or formula expression (conditional). Static: "fill" (expand to fill remaining space in parent), "full" (100% of parent — for absolutely-positioned covers), "fit" (shrink to content), "screen" (100vw — for top-level page sections), "px:N" (exact pixels, e.g. "px:320"). Conditional: pass a ternary expression string.',
        },
        height: {
          type: 'string',
          description: 'Height (static) or formula expression (conditional). Static: "fill" (flex grow), "full" (100% of parent — for absolutely-positioned covers), "screen" (100vh — for full-viewport sections), "fit" (shrink to content), "px:N" (exact pixels), "vh:N" (viewport-relative, e.g. "vh:80"). Conditional: pass a ternary expression string.',
        },
        maxWidth:  { type: 'number', description: 'Max-width constraint in pixels (e.g. 800). Matches the builder panel Max W field.' },
        minWidth:  { type: 'number', description: 'Min-width constraint in pixels. Matches the builder panel Min W field.' },
        maxHeight: { type: 'number', description: 'Max-height constraint in pixels. Matches the builder panel Max H field.' },
        minHeight: { type: 'number', description: 'Min-height constraint in pixels. Matches the builder panel Min H field.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_position',
    description: TOOL_DESCRIPTIONS['set_position'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        position: {
          type: 'string',
          enum: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
          description: 'Position type.',
        },
        zIndex: {
          type: 'number',
          description: 'Z-index as an integer. E.g. 0, 10, 20, 50, 100.',
        },
        top:    { description: 'Top inset — plain integer (px) or formula expression string for conditional positioning.' },
        right:  { description: 'Right inset — plain integer (px) or formula expression string.' },
        bottom: { description: 'Bottom inset — plain integer (px) or formula expression string.' },
        left:   { description: 'Left inset — plain integer (px) or formula expression string.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_transform',
    description: TOOL_DESCRIPTIONS['set_transform'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        rotate: { type: 'number', description: 'Rotation in degrees (-180 to 180). Any degree value is supported.' },
        flipX: { type: 'boolean', description: 'Flip horizontally (mirror on X axis).' },
        flipY: { type: 'boolean', description: 'Flip vertically (mirror on Y axis).' },
        translateX: {
          description: 'Horizontal offset in pixels (positive = right, negative = left). Pass a number for a static offset, or a formula expression string for dynamic positioning.',
        },
        translateY: {
          description: 'Vertical offset in pixels (positive = down, negative = up). Pass a number for a static offset, or a formula expression string for dynamic positioning.',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_overflow',
    description: TOOL_DESCRIPTIONS['set_overflow'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        clip: { type: 'boolean', description: 'true = clip content to box boundary (overflow-hidden), false = allow overflow.' },
        pointerEvents: { type: 'string', enum: ['none', 'auto'], description: '"none" makes the element pass all pointer events through to elements beneath it (overlay pass-through). "auto" restores default behavior.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_submit',
    description: TOOL_DESCRIPTIONS['set_submit'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        submit: { type: 'boolean', description: 'true = button acts as a form submit trigger. false = regular button.' },
      },
      required: ['nodeId', 'submit'],
    },
  },
  {
    name: 'set_input_props',
    description: TOOL_DESCRIPTIONS['set_input_props'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        type: {
          type: 'string',
          enum: ['text', 'email', 'password', 'number', 'decimal', 'tel'],
          description: 'Input type. "decimal" = number input that allows decimal values. Matches the builder Settings panel input type options.',
        },
        multiline: { type: 'boolean', description: 'Switch to a multiline textarea.' },
        rows: { type: 'number', description: 'Visible rows for multiline textarea.' },
        min: { type: 'number', description: 'Minimum value for number inputs.' },
        max: { type: 'number', description: 'Maximum value for number inputs.' },
        maxLength: { type: 'number', description: 'Maximum character length.' },
        fieldName: { type: 'string', description: 'Form field tracking name — used to read the value at submit time via local.data.form.formData[fieldName]. Must be unique within the form.' },
        validationTrigger: {
          type: 'string',
          enum: ['submit', 'change'],
          description: 'When validation runs: "submit" = only on form submit (default), "change" = on every keystroke.',
        },
        initialValue: { description: 'Default value pre-filled in the field when the form first loads.' },
        debounce: { type: 'number', description: 'Debounce delay in ms for the change event. E.g. 300 delays the action by 300ms after the user stops typing.' },
        debounceEnabled: { type: 'boolean', description: 'Enable or disable debounce on the change event.' },
        autocomplete: { type: 'boolean', description: 'Enable browser autocomplete/autofill on this field.' },
      },
      required: ['nodeId'],
    },
  },
];

// ─── Layout / Spacing ─────────────────────────────────────────────────────────

const layoutTools: BuilderTool[] = [
  {
    name: 'set_layout',
    description: TOOL_DESCRIPTIONS['set_layout'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        direction: { type: 'string', enum: ['row', 'column'], description: '"row" lays children side by side; "column" stacks them top to bottom.' },
        align: { type: 'string', enum: ['start', 'center', 'end', 'stretch', 'baseline'], description: 'Cross-axis alignment of children (items-*). In a row: aligns children vertically. In a column: aligns children horizontally — use align:"center" on a column container to horizontally center its children.' },
        justify: { type: 'string', enum: ['start', 'center', 'end', 'between', 'around', 'evenly'], description: 'Main-axis distribution of children (justify-*). In a row: horizontal distribution. In a column: vertical distribution. Accepts a ternary expression string for per-item variation inside repeat templates.' },
        gap: { type: 'number', description: 'Gap between children in pixels.' },
        self: {
          type: 'string',
          enum: ['auto', 'start', 'center', 'end', 'stretch', 'baseline'],
          description: 'Self-alignment of THIS node within its parent flex container (alignSelf). Only has effect when the node is NOT full-width. Accepts a ternary expression string for per-item variation inside repeat templates.',
        },
        cursor: {
          type: 'string',
          enum: ['auto', 'default', 'pointer', 'not-allowed', 'grab', 'move', 'text', 'crosshair'],
          description: 'Cursor style on hover.',
        },
        gridCols: { type: 'number', description: 'Number of grid columns (1-12). Switches display to grid automatically.' },
        gridRows: { type: 'number', description: 'Number of grid rows (1-6).' },
        colSpan:  { type: 'number', description: 'How many columns this item spans (1-12). 13 = col-span-full.' },
        flexWrap: { type: 'string', enum: ['wrap', 'nowrap', 'wrap-reverse'], description: 'Flex wrap behavior.' },
      },
      required: ['nodeId'],
    },
  },
];

// ─── Logic / Behavior ─────────────────────────────────────────────────────────

const logicTools: BuilderTool[] = [
  {
    name: 'set_condition',
    description: TOOL_DESCRIPTIONS['set_condition'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        condition: {
          type: 'string',
          description: 'JS formula string, e.g. "variables[\'UUID\'] === \'active\'" or "context?.item?.data?.inStock". Pass "" to remove. NEVER pass "true" — that is a no-op; just omit set_condition if the node should always be visible.',
        },
      },
      required: ['nodeId', 'condition'],
    },
  },
  {
    name: 'set_repeat',
    description: TOOL_DESCRIPTIONS['set_repeat'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        mapPath: { type: 'string', description: 'State path to the array, e.g. "variables[\'varId\']" or "collections.UUID.data.items". For nested repeat (sub-list inside an outer repeated item), use "context.item.data.fieldName". Pass "" to remove.' },
        keyField: { type: 'string', description: 'Field to use as React key, e.g. "id".' },
      },
      required: ['nodeId', 'mapPath'],
    },
  },
  {
    name: 'bind_action',
    description: TOOL_DESCRIPTIONS['bind_action'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        workflowName: { type: 'string', description: 'Name of the workflow to bind, e.g. "onSubmitContactForm".' },
      },
      required: ['nodeId', 'workflowName'],
    },
  },
  {
    name: 'unbind_action',
    description: TOOL_DESCRIPTIONS['unbind_action'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        workflowName: { type: 'string', description: 'Name of the workflow binding to remove.' },
      },
      required: ['nodeId', 'workflowName'],
    },
  },
  {
    name: 'create_workflow',
    description: TOOL_DESCRIPTIONS['create_workflow'],
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Unique workflow name. E.g. "onToggleMenu", "onSubmitForm", "onLoadData".',
        },
        trigger: {
          type: 'string',
          enum: ['click', 'change', 'submit', 'created', 'valueChange', 'enterKey'],
          description: 'When this workflow fires. Default "click".',
        },
        steps: {
          type: 'array',
          description: 'Array of step objects. Each step needs a unique "id" string plus "type" and "config".',
          items: { type: 'object' },
        },
        bindToNodeId: {
          type: 'string',
          description: 'Optional — immediately binds this workflow to that node after creation.',
        },
      },
      required: ['name', 'steps'],
    },
  },
  {
    name: 'delete_workflow',
    description: TOOL_DESCRIPTIONS['delete_workflow'],
    input_schema: {
      type: 'object',
      properties: {
        workflowName: { type: 'string', description: 'Exact name of the workflow to delete.' },
      },
      required: ['workflowName'],
    },
  },
  {
    name: 'set_animation',
    description: TOOL_DESCRIPTIONS['set_animation'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        enter: {
          type: 'string',
          enum: ['none', 'fadeIn', 'slideInUp', 'slideInDown', 'slideInLeft', 'slideInLeftSubtle', 'slideInRight', 'riseFade', 'dropIn', 'zoomIn', 'expandIn', 'bounceIn', 'flipInX', 'flipInY', 'flipIn3D', 'tiltIn', 'skewIn', 'skewInY', 'blurIn', 'glowIn', 'rollIn', 'revealUp', 'charFall', 'charBounce'],
          description: 'Enter animation (plays on mount). "none" removes it.',
        },
        enterDuration: { type: 'number', description: 'Enter animation duration in ms. Default 300.' },
        enterDelay: { type: 'number', description: 'Delay before the enter animation starts (ms).' },
        enterStagger: { type: 'number', description: 'Per-child stagger offset (ms). Set this on the mapped LIST CONTAINER, not on individual child nodes — the engine distributes the delay automatically.' },
        enterEasing: {
          type: 'string',
          enum: ['easeOut', 'easeIn', 'easeInOut', 'linear', 'circIn', 'circOut', 'circInOut', 'backIn', 'backOut', 'backInOut'],
          description: 'Easing curve for the enter animation. Default "easeOut".',
        },
        enterSpring: { type: 'boolean', description: 'Use spring physics for the enter animation instead of duration-based easing.' },
        enterStiffness: { type: 'number', description: 'Spring stiffness (10–1000). Only used when enterSpring is true. Default 200.' },
        enterDamping: { type: 'number', description: 'Spring damping (1–100). Only used when enterSpring is true. Default 20.' },
        enterMass: { type: 'number', description: 'Spring mass (0.1–10). Only used when enterSpring is true. Default 1.' },
        exit: {
          type: 'string',
          // bounceOut, flipOutX, flipOutY, flipOut3D, rollOut are NOT in REANIMATED_EXIT_MAP — removed
          enum: ['none', 'fadeOut', 'slideOutUp', 'slideOutDown', 'slideOutLeft', 'slideOutRight', 'zoomOut', 'shrinkOut', 'blurOut', 'skewOut'],
          description: 'Exit animation (plays on unmount). "none" removes it.',
        },
        exitDuration: { type: 'number', description: 'Exit animation duration in ms. Default 300.' },
        exitDelay: { type: 'number', description: 'Delay before the exit animation starts (ms).' },
        exitEasing: {
          type: 'string',
          enum: ['easeIn', 'easeOut', 'easeInOut', 'linear', 'circIn', 'circOut', 'circInOut', 'backIn', 'backOut', 'backInOut'],
          description: 'Easing curve for the exit animation. Default "easeIn".',
        },
        loop: {
          type: 'string',
          enum: ['none', 'pulse', 'breathe', 'float', 'shake', 'wiggle', 'wobble', 'swing', 'spin', 'ticker', 'bounce', 'heartbeat', 'flash', 'ripple', 'glowPulse', 'gradientDrift'],
          description: 'Continuous loop animation. "none" removes it. "gradientDrift" requires gradientColors to be set first.',
        },
        loopDuration: { type: 'number', description: 'Loop animation duration per cycle in ms. Default 1500.' },
        loopDelay: { type: 'number', description: 'Delay before the loop animation starts (ms).' },
        loopRepeatCount: { type: 'number', description: 'Number of loop repetitions. -1 = infinite (default). E.g. 3 = play 3 times then stop.' },
        loopDirection: {
          type: 'string',
          enum: ['normal', 'alternate'],
          description: 'Loop playback direction. "normal" = always forward. "alternate" = forward then backward (default for most types).',
        },
        loopColor: { type: 'string', description: 'Glow/shadow color for glowPulse and ripple loop types (hex, e.g. "#a855f7"). Required for glowPulse to be visible on light backgrounds.' },
        hover: {
          type: 'string',
          enum: ['scale', 'lift', 'none'],
          description: 'Hover animation preset. "scale" = grows slightly, "lift" = moves up. For fine control use hoverScale/hoverY/hoverOpacity/hoverDuration/hoverEasing.',
        },
        hoverScale: { type: 'number', description: 'Hover scale multiplier (e.g. 1.05 = 5% larger, 0.95 = slightly smaller). Overrides the preset scale.' },
        hoverOpacity: { type: 'number', description: 'Hover opacity 0–100. Overrides preset opacity.' },
        hoverY: { type: 'number', description: 'Hover vertical offset in px (negative = up, e.g. -4).' },
        hoverDuration: { type: 'number', description: 'Hover animation duration in ms. Default 200.' },
        hoverEasing: {
          type: 'string',
          enum: ['easeOut', 'easeIn', 'easeInOut', 'linear', 'circIn', 'circOut', 'circInOut', 'backIn', 'backOut', 'backInOut'],
          description: 'Easing for the hover animation. Default "easeOut".',
        },
        press: {
          type: 'string',
          enum: ['scale', 'bounce', 'none'],
          description: 'Press/tap animation preset. "scale" = shrinks on tap (scale: 0.95), "bounce" = deeper shrink (scale: 0.9). For fine control use pressScale/pressX/pressY/pressOpacity/pressDuration/pressEasing.',
        },
        pressScale: { type: 'number', description: 'Press scale multiplier (e.g. 0.95). Overrides the preset scale.' },
        pressOpacity: { type: 'number', description: 'Press opacity 0–100. Overrides preset opacity.' },
        pressX: { type: 'number', description: 'Press horizontal offset in px.' },
        pressY: { type: 'number', description: 'Press vertical offset in px.' },
        pressDuration: { type: 'number', description: 'Press animation duration in ms. Default 100.' },
        pressEasing: {
          type: 'string',
          enum: ['easeOut', 'easeIn', 'easeInOut', 'linear', 'circIn', 'circOut', 'circInOut', 'backIn', 'backOut', 'backInOut'],
          description: 'Easing for the press animation. Default "easeOut".',
        },
        scroll: {
          type: 'string',
          enum: ['none', 'fadeIn', 'slideInUp', 'slideInDown', 'slideInLeft', 'slideInRight', 'riseFade', 'dropIn', 'zoomIn', 'expandIn', 'bounceIn', 'blurIn'],
          description: 'Scroll-triggered enter animation — fires when the element scrolls into the viewport.',
        },
        scrollDuration: { type: 'number', description: 'Scroll animation duration in ms. Default 500.' },
        scrollDelay: { type: 'number', description: 'Delay before the scroll animation starts (ms).' },
        scrollThreshold: { type: 'number', description: 'Fraction of element visible (0–1) before animation triggers. Default 0.2 (20% visible). Use 0 to trigger as soon as the top edge enters viewport.' },
        scrollOnce: { type: 'boolean', description: 'Play the scroll animation only once (default true). Set false to replay every time the element re-enters the viewport.' },
        scrollEasing: {
          type: 'string',
          enum: ['easeOut', 'easeIn', 'easeInOut', 'linear', 'circIn', 'circOut', 'circInOut', 'backIn', 'backOut', 'backInOut'],
          description: 'Easing for the scroll-triggered animation. Default "easeOut".',
        },
        shimmer: {
          type: 'boolean',
          description: 'Add a shimmer/skeleton-loading highlight sweep effect. Use on placeholder cards or loading states.',
        },
        filterBlur: {
          type: 'number',
          description: 'Apply a blur filter to the element itself (px). E.g. 8 = soft blur. Works cross-platform (CSS filter on web, RN 0.76+ filter array on native). 0 removes it.',
        },
        filterBrightness: {
          type: 'number',
          description: 'Brightness filter multiplier. 1 = normal, 0 = black, 2 = double brightness, 0.5 = half brightness. Range 0–5.',
        },
        filterContrast: {
          type: 'number',
          description: 'Contrast filter multiplier. 1 = normal, 0 = flat grey, 2 = high contrast. Range 0–5.',
        },
        filterSaturate: {
          type: 'number',
          description: 'Saturation filter multiplier. 1 = normal, 0 = grayscale, 2 = vivid. Range 0–5.',
        },
        filterGrayscale: {
          type: 'number',
          description: 'Grayscale amount. 0 = full color, 1 = fully gray. Range 0–1.',
        },
        filterHueRotate: {
          type: 'number',
          description: 'Hue rotation in degrees (-360 to 360). Shifts all colors around the color wheel.',
        },
        backdropBlur: {
          type: 'number',
          description: 'Apply a backdrop blur (glassmorphism) behind the element (px). E.g. 12. Web only — no-op on native. Pair with a semi-transparent background (e.g. set_background {bg:"white/10"}). 0 removes it.',
        },
        gradientColors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of ≥2 hex colors for an animated flowing gradient background. Automatically sets loop to "gradientDrift". E.g. ["#667eea","#764ba2","#f64f59"]. Web only.',
        },
        imperativeTrigger: {
          type: 'object',
          description: 'Re-play a one-shot animation whenever a variable changes (e.g. shake on validation error). watchVar must be a formula expression like "variables[\'UUID\']". Use Date.now() as the variable value to guarantee a change on every trigger.',
          properties: {
            type: { type: 'string', enum: ['pulse', 'breathe', 'float', 'shake', 'wiggle', 'wobble', 'swing', 'spin', 'bounce', 'heartbeat', 'flash', 'ripple', 'glowPulse'], description: 'Animation type to replay.' },
            watchVar: { type: 'string', description: 'Formula expression to watch, e.g. "variables[\'UUID\']".' },
            duration: { type: 'number', description: 'Animation duration in ms. Default 500.' },
          },
          required: ['type', 'watchVar'],
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_validation',
    description: TOOL_DESCRIPTIONS['set_validation'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the InputField node — from generate_structure or add_component result. Never a display name.' },
        rules: {
          type: 'array',
          description: 'Validation rules. E.g. [{"type":"required","message":"Required"},{"type":"email","message":"Invalid email"}].',
          items: { type: 'object' },
        },
      },
      required: ['nodeId', 'rules'],
    },
  },
  {
    name: 'rename_node',
    description: TOOL_DESCRIPTIONS['rename_node'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        name: { type: 'string', description: 'Display name, e.g. "Hero Section", "Pricing Card", "Nav Bar".' },
      },
      required: ['nodeId', 'name'],
    },
  },
  {
    name: 'set_disabled',
    description: TOOL_DESCRIPTIONS['set_disabled'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        disabled: {
          type: ['boolean', 'string'],
          description: 'true/false to statically disable, or a JS formula string e.g. "variables[\'uuid\'] === \'loading\'" for conditional disabling.',
        },
      },
      required: ['nodeId', 'disabled'],
    },
  },
  {
    name: 'set_loading_state',
    description: TOOL_DESCRIPTIONS['set_loading_state'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the target node — from generate_structure or add_component result. Never a display name.' },
        state: {
          type: 'string',
          enum: ['Loading', 'Empty', 'Default', 'Custom', 'None'],
          description: '"Loading" = shown during data fetch; "Empty" = shown when list is empty; "Default" = always shown; "None" removes the tag.',
        },
      },
      required: ['nodeId', 'state'],
    },
  },
];

// ─── Variables ────────────────────────────────────────────────────────────────

const variableTools: BuilderTool[] = [
  {
    name: 'add_variable',
    description: TOOL_DESCRIPTIONS['add_variable'],
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name, e.g. "Show Modal", "Cart Count".' },
        type: { type: 'string', enum: ['string', 'number', 'boolean', 'object', 'array'] },
        initialValue: { description: 'Initial value.' },
        variableId: {
          type: 'string',
          description: 'Pre-assign a hex UUID (8-4-4-4-12 format, hex characters only). Use this SAME UUID as variableName in create_workflow changeVariableValue steps and in variables[\'UUID\'] bindings in the same batch.',
        },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'update_variable',
    description: TOOL_DESCRIPTIONS['update_variable'],
    input_schema: {
      type: 'object',
      properties: {
        variableId: { type: 'string', description: 'Variable ID (as returned by add_variable or get_variables).' },
        name: { type: 'string', description: 'New display name.' },
        type: { type: 'string', enum: ['string', 'number', 'boolean', 'object', 'array'], description: 'New type.' },
        initialValue: { description: 'New initial value.' },
      },
      required: ['variableId'],
    },
  },
  {
    name: 'delete_variable',
    description: TOOL_DESCRIPTIONS['delete_variable'],
    input_schema: {
      type: 'object',
      properties: {
        variableId: { type: 'string', description: 'Variable ID to delete.' },
      },
      required: ['variableId'],
    },
  },
];

// ─── Data Sources ─────────────────────────────────────────────────────────────

const dataTools: BuilderTool[] = [
  {
    name: 'add_data_source',
    description: TOOL_DESCRIPTIONS['add_data_source'],
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable name, e.g. "Products API", "User Profile".' },
        type: { type: 'string', enum: ['rest', 'graphql'], description: 'Data source type.' },
        url: { type: 'string', description: 'REST endpoint URL (required when type is "rest").' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'HTTP method. Default "GET".' },
        endpoint: { type: 'string', description: 'GraphQL endpoint URL (required when type is "graphql").' },
        query: { type: 'string', description: 'GraphQL query string (required when type is "graphql").' },
        storeIn: { type: 'string', description: 'Dot-path key inside the response to expose. E.g. "products" to access as collections[\'id\'].data.products.' },
        trigger: { type: 'string', enum: ['mount', 'action'], description: '"mount" = auto-fetch on page load. "action" = only fetch when a workflow step calls fetchCollection. Default "mount".' },
        dataSourceId: { type: 'string', description: 'Optional: pre-assign a short ID like "products-api". Becomes the collections[\'id\'] key in formulas.' },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'delete_data_source',
    description: TOOL_DESCRIPTIONS['delete_data_source'],
    input_schema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'Data source ID to delete.' },
      },
      required: ['sourceId'],
    },
  },
];

// ─── Theme ────────────────────────────────────────────────────────────────────

const themeTools: BuilderTool[] = [
  {
    name: 'set_theme_color',
    description: TOOL_DESCRIPTIONS['set_theme_color'],
    input_schema: {
      type: 'object',
      properties: {
        variable: {
          type: 'string',
          description: 'Theme token name. Color tokens: "primary", "primary-foreground", "background", "foreground", "card", "card-foreground", "muted", "muted-foreground", "secondary", "secondary-foreground", "accent", "accent-foreground", "destructive", "destructive-foreground", "border", "input", "ring", "popover", "popover-foreground". Font tokens: "font-heading", "font-body". Passed as-is to the theme store — do NOT prefix with "theme-".',
        },
        value: { type: 'string', description: 'New value, e.g. "#6366f1" or "Inter".' },
        mode: { type: 'string', enum: ['light', 'dark'], description: 'Which color mode. Default "light".' },
      },
      required: ['variable', 'value'],
    },
  },
];

// ─── Page Management ──────────────────────────────────────────────────────────

const pageTools: BuilderTool[] = [
  {
    name: 'add_page',
    description: TOOL_DESCRIPTIONS['add_page'],
    input_schema: {
      type: 'object',
      properties: {
        route: { type: 'string', description: 'URL path, e.g. "/about".' },
        name: { type: 'string', description: 'Page display name, e.g. "About Us".' },
      },
      required: ['route', 'name'],
    },
  },
  {
    name: 'switch_page',
    description: TOOL_DESCRIPTIONS['switch_page'],
    input_schema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'Page ID from the pages list (e.g. "440c9f08-8a0c-4a98-b4e1-75251aa14167" or "page-ec5c6347"). NEVER pass a node UUID — node UUIDs from generate_structure are NOT page IDs.' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'rename_page',
    description: TOOL_DESCRIPTIONS['rename_page'],
    input_schema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['pageId', 'name'],
    },
  },
  {
    name: 'remove_page',
    description: TOOL_DESCRIPTIONS['remove_page'],
    input_schema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'set_page_config',
    description: TOOL_DESCRIPTIONS['set_page_config'],
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Page SEO title shown in browser tab and search results.' },
        description: { type: 'string', description: 'Page SEO meta description for search engines.' },
        ogImage: { type: 'string', description: 'Open Graph image URL for social sharing.' },
        onMountWorkflow: { type: 'string', description: 'Name of a workflow to run automatically when the page loads. Must exist in the project — use get_workflows() to check.' },
      },
    },
  },
];

// ─── Canvas Utilities ─────────────────────────────────────────────────────────

const canvasTools: BuilderTool[] = [
  {
    name: 'select_node',
    description: TOOL_DESCRIPTIONS['select_node'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'UUID of the node to select.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'undo',
    description: TOOL_DESCRIPTIONS['undo'],
    input_schema: { type: 'object', properties: {} },
  },
];

// ─── Asset Search ─────────────────────────────────────────────────────────────

const assetTools: BuilderTool[] = [
  {
    name: 'search_images',
    description: TOOL_DESCRIPTIONS['search_images'],
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "coffee shop interior", "modern office".' },
        count: { type: 'number', description: 'Number of results (1-8). Default 4.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_videos',
    description: TOOL_DESCRIPTIONS['search_videos'],
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "workflow automation", "city aerial", "team meeting".' },
        count: { type: 'number', description: 'Number of results (1-8). Default 4.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_icons',
    description: TOOL_DESCRIPTIONS['search_icons'],
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "coffee", "arrow-right", "heart".' },
        prefix: { type: 'string', description: 'Optional icon set prefix: "lucide", "heroicons", "mdi", "tabler", "phosphor".' },
        count: { type: 'number', description: 'Number of results (1-20). Default 10.' },
      },
      required: ['query'],
    },
  },
];

// ─── Batch Structure (build entire tree in one call) ─────────────────────────

const batchTools: BuilderTool[] = [
  {
    name: 'generate_structure',
    description: TOOL_DESCRIPTIONS['generate_structure'],
    input_schema: {
      type: 'object',
      properties: {
        tree: {
          type: 'object',
          description: 'Root node of the section tree. Each node: { label, name?, text?, direction?: "row"|"column", icon?, searchQuery?, repeat?, keyField?, condition?, children? }. direction:"row" = horizontal layout. icon = Iconify name for Icon nodes (e.g. "lucide:check") or formula. searchQuery = Image/Video search. repeat = state path to array (e.g. "variables[\'UUID\']") — node is cloned per item. keyField = React key field (default "id"). condition = visibility formula (e.g. "context?.item?.data?.featured"). Switch/Switch On sibling pairs are auto-wired with boolean variable conditions.',
        },
        variables: {
          type: 'array',
          description: 'Variables this section needs. Pre-assign uuid as valid hex UUID (8-4-4-4-12). Include complete initialValue with realistic demo data.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Display name, e.g. "Pricing Plans", "Is Featured".' },
              type: { type: 'string', enum: ['string', 'number', 'boolean', 'object', 'array'], description: 'Variable type.' },
              initialValue: { description: 'Initial value with realistic demo data. Arrays: 3-6 items with ALL display fields. Booleans: false. Strings: first option value.' },
              uuid: { type: 'string', description: 'Pre-assigned hex UUID (8-4-4-4-12 format, hex chars only). Use this SAME UUID in repeat fields as variables[\'UUID\'].' },
            },
            required: ['name', 'type', 'uuid'],
          },
        },
        parentId: {
          type: 'string',
          description: 'UUID of existing node to insert under. Omit to add at the page root.',
        },
        atIndex: {
          type: 'number',
          description: 'Position within the parent children. Omit to append at end.',
        },
      },
      required: ['tree'],
    },
  },
];

// ─── Bulk Operations (apply same op to multiple nodes) ───────────────────────

const bulkTools: BuilderTool[] = [
  {
    name: 'bulk_apply',
    description: TOOL_DESCRIPTIONS['bulk_apply'],
    input_schema: {
      type: 'object',
      properties: {
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of node IDs returned by search_nodes.',
        },
        tool: {
          type: 'string',
          enum: ['set_spacing', 'set_border', 'set_background', 'set_typography', 'set_opacity', 'set_size', 'set_position', 'set_layout', 'set_icon', 'set_text_color', 'set_animation'],
          description: 'Name of the style tool to apply to every node.',
        },
        params: {
          type: 'object',
          description: 'Params to pass to the tool — same as calling it directly (nodeId is injected automatically).',
        },
      },
      required: ['nodeIds', 'tool', 'params'],
    },
  },
];

// ─── All Tools (in priority order) ───────────────────────────────────────────

/** Tools for the builder chat AI */
export const ALL_BUILDER_TOOLS: BuilderTool[] = [
  // Context first — AI reads before acting
  ...readTools,
  // Batch structure — build full tree in one call
  ...batchTools,
  // Bulk ops — apply same style to multiple nodes
  ...bulkTools,
  // Structure — add / remove / reorder / reparent
  ...addTools,
  ...structureTools,
  // Content — text, images, icons
  ...textTools,
  // Style — semantic design controls (mirror right-panel sections)
  ...semanticDesignTools,
  ...layoutTools,
  // Behavior — logic, animations, forms
  ...logicTools,
  // State — variables and data sources
  ...variableTools,
  ...dataTools,
  // Theme
  ...themeTools,
  // Pages
  ...pageTools,
  // Canvas
  ...canvasTools,
  // Assets
  ...assetTools,
];

/** Phase 3 styling-only tools.
 *  Excluded (run in parallel phases or handled server-side):
 *  - create_workflow / bind_action → Phase W (parallel)
 *  - set_repeat → Phase 2b (wiring already done)
 *  - search_icons / search_images / search_videos / set_src → media phase (server-side)
 *  - set_submit → behavior/form wiring (not styling)
 *  - set_input_props → input config/structure (not styling)
 *  - set_icon icon param → icon name set by tree manifest; Phase 3 only adjusts size/color. */
export const PHASE3_BUILDER_TOOLS: BuilderTool[] = [
  ...pageTools.filter(t => t.name === 'switch_page'),
  // Exclude set_submit (form behavior) and set_input_props (input structure) from styling phase
  ...semanticDesignTools
    .filter(t => !['set_submit', 'set_input_props'].includes(t.name)),
  ...layoutTools,
  ...logicTools.filter(t => ['set_condition', 'set_animation'].includes(t.name)),
  // set_icon for Phase 3: size and color only (icon name stripped — set by tree manifest)
  ...textTools.filter(t => t.name === 'set_icon').map(t => {
    const { icon: _icon, ...propsWithoutIcon } =
      (t.input_schema as { properties: Record<string, unknown> }).properties;
    void _icon;
    return {
      ...t,
      description: 'Adjust icon size and color. Icon name is already set by the tree manifest — do NOT pass the icon param.',
      input_schema: { ...t.input_schema, properties: propsWithoutIcon },
    };
  }),
  ...textTools.filter(t => ['set_text', 'set_placeholder'].includes(t.name)),
  ...bulkTools,
];

/** Phase W (workflow) tools — runs in parallel with Phase 3 after structure is built. */
export const PHASE_W_TOOLS: BuilderTool[] = [
  ...pageTools.filter(t => t.name === 'switch_page'),
  ...readTools.filter(t => ['get_variables', 'get_workflows'].includes(t.name)),
  ...logicTools.filter(t => ['create_workflow', 'bind_action'].includes(t.name)),
  // add_variable needed when Phase W creates boolean/string state variables for toggles, tabs, etc.
  ...variableTools.filter(t => t.name === 'add_variable'),
];

// ─── Parallel Agent Tool Collections ─────────────────────────────────────────

const stripIconName = (t: BuilderTool): BuilderTool => {
  const { icon: _icon, ...propsWithoutIcon } =
    (t.input_schema as { properties: Record<string, unknown> }).properties;
  void _icon;
  return {
    ...t,
    description: 'Adjust icon size and color. Icon name is set by the media agent — do NOT pass the icon param.',
    input_schema: { ...t.input_schema, properties: propsWithoutIcon },
  };
};

const stripIconColorSize = (t: BuilderTool): BuilderTool => {
  const { color: _color, size: _size, ...propsWithoutColorSize } =
    (t.input_schema as { properties: Record<string, unknown> }).properties;
  void _color; void _size;
  return {
    ...t,
    description: 'Set icon name (static or formula). Color/size are set by the Colors agent.',
    input_schema: { ...t.input_schema, properties: propsWithoutColorSize },
  };
};

/** Structure Agent — builds tree shape + declares variables in one call. */
export const STRUCTURE_AGENT_TOOLS: BuilderTool[] = [
  ...batchTools, // generate_structure (includes variables array)
];

/** Binding Agent — connects data to UI nodes (text, repeat, condition, disabled, icon name). */
export const BINDING_AGENT_TOOLS: BuilderTool[] = [
  ...textTools.filter(t => ['set_text'].includes(t.name)),
  ...logicTools.filter(t => ['set_condition', 'set_repeat', 'set_disabled'].includes(t.name)),
  ...textTools.filter(t => t.name === 'set_icon').map(stripIconColorSize),
];

// ─── Styling Sub-Agent Tool Collections (3-way parallel split) ───────────────

/** Layout Sub-Agent — spacing, sizing, layout, position, overflow. */
export const LAYOUT_AGENT_TOOLS: BuilderTool[] = [
  ...semanticDesignTools.filter(t => ['set_spacing', 'set_size', 'set_position', 'set_overflow'].includes(t.name)),
  ...layoutTools, // set_layout
];

/** Colors Sub-Agent — backgrounds, text color, borders, shadows, opacity, icon color/size. */
export const COLORS_AGENT_TOOLS: BuilderTool[] = [
  ...semanticDesignTools.filter(t => ['set_background', 'set_text_color', 'set_border', 'set_shadow', 'set_opacity'].includes(t.name)),
  ...textTools.filter(t => t.name === 'set_icon').map(stripIconName),
];

/** Typography + Animation Sub-Agent — typography, animation, transform, bulk_apply. */
export const TYPO_ANIM_AGENT_TOOLS: BuilderTool[] = [
  ...semanticDesignTools.filter(t => ['set_typography', 'set_transform'].includes(t.name)),
  ...logicTools.filter(t => t.name === 'set_animation'),
  ...bulkTools,
];

