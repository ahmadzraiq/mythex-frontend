/**
 * Builder Tool Definitions — Anthropic tool_use format.
 *
 * Core design principle: The AI works exactly like a builder user.
 * - It adds components by their palette label
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
          description: 'Search term (name/type/text/id, case-insensitive).',
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
          description: 'Component palette label from enum. Do NOT use for Image or Video — use add_image / add_video instead.',
        },
        nodeId: {
          type: 'string',
          description: 'UUID for this node — generate a UUID yourself (e.g. "a1b2c3d4-e5f6-7890-abcd-ef1234567890"). Use this exact UUID as parentId for children in the same batch and for all subsequent tool calls.',
        },
        name: {
          type: 'string',
          description: 'Display name shown in the Layers panel (e.g. "Hero Section", "Pricing Card", "Nav Bar").',
        },
        parentId: {
          type: 'string',
          description: 'Parent node ID. Omit for page root.',
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
        muted: { type: 'boolean', description: 'Mute audio. Default true.' },
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
        // Current builder store only groups root-level nodes.
        // Nested nodes should be moved to root first.
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
        nodeId: { type: 'string', description: 'Node ID.' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
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
    name: 'set_icon_src',
    description: TOOL_DESCRIPTIONS['set_icon_src'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node ID.' },
        icon: {
          type: 'string',
          description: 'Iconify icon name (static) or a formula expression string (conditional). Static: "lucide:home", "heroicons:star", "tabler:check", "ph:arrow-right", etc. Conditional: ternary, e.g. "context?.item?.data?.[\'featured\'] ? \'lucide:check-circle\' : \'lucide:check\'". Color and size are set via set_style.',
        },
      },
      required: ['nodeId', 'icon'],
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
        nodeId: { type: 'string', description: 'Node ID.' },
        bg: {
          type: 'string',
          description: 'Solid color only — theme token, hex, rgb/rgba, or formula expression. For gradients use the gradient param or bgImage.',
        },
        fillOpacity: {
          type: 'number',
          description: 'Background fill opacity 0-100. Affects background only (not children).',
        },
        bgImage: {
          type: 'string',
          description: 'Background image URL.',
        },
        bgSize: {
          type: 'string',
          description: 'Background-size. Default "auto".',
        },
        bgPosition: {
          type: 'string',
          description: 'Background-position.',
        },
        bgRepeat: {
          type: 'string',
          enum: ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'],
          description: 'Background-repeat.',
        },
        gradient: {
          type: 'object',
          description: 'Static linear or radial gradient background.',
          properties: {
            colors: { type: 'array', items: { type: 'string' }, description: 'Array of ≥2 CSS color values (hex, rgb, etc.), e.g. ["#667eea","#764ba2"].' },
            direction: { type: 'string', description: 'Gradient direction, e.g. "to bottom", "to right", "to bottom right", "135deg". Default "to bottom".' },
            radial: { type: 'boolean', description: 'true = radial gradient (ignores direction). Default false = linear.' },
          },
          required: ['colors'],
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
        nodeId: { type: 'string', description: 'Node ID.' },
        color: {
          type: 'string',
          description: 'Text color (theme token, hex, named color) or formula expression.',
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
        nodeId: { type: 'string', description: 'Node ID.' },
        size: {
          type: 'number',
          description: 'Font size in px.',
        },
        weight: {
          type: 'string',
          enum: ['thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black'],
          description: 'Font weight.',
        },
        align: {
          type: 'string',
          enum: ['left', 'center', 'right', 'justify'],
          description: 'Text alignment.',
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
        italic: { type: 'boolean' },
        decoration: {
          type: 'string',
          enum: ['none', 'underline', 'line-through', 'overline'],
        },
        transform: {
          type: 'string',
          enum: ['none', 'uppercase', 'lowercase', 'capitalize'],
        },
        overflow: {
          type: 'string',
          enum: ['truncate', 'clip'],
          description: '"truncate" = ellipsis, "clip" = hard clip.',
        },
        whitespace: {
          type: 'string',
          enum: ['normal', 'nowrap', 'pre', 'pre-line', 'pre-wrap', 'break-spaces'],
        },
        wordBreak: {
          type: 'string',
          enum: ['normal', 'all', 'words', 'keep'],
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
        nodeId: { type: 'string', description: 'Node ID.' },
        width: {
          type: 'number',
          description: 'Border width in pixels. 0 removes border.',
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
          description: 'Border radius in pixels. 9999 = pill/full.',
        },
        radiusTL: { type: 'number', description: 'Top-left corner radius in pixels.' },
        radiusTR: { type: 'number', description: 'Top-right corner radius in pixels.' },
        radiusBR: { type: 'number', description: 'Bottom-right corner radius in pixels.' },
        radiusBL: { type: 'number', description: 'Bottom-left corner radius in pixels.' },
        topWidth:    { type: 'number', description: 'Top border width in pixels.' },
        rightWidth:  { type: 'number', description: 'Right border width in pixels.' },
        bottomWidth: { type: 'number', description: 'Bottom border width in pixels.' },
        leftWidth:   { type: 'number', description: 'Left border width in pixels.' },
        topColor:    { type: 'string', description: 'Top border color (hex, theme name, or formula).' },
        rightColor:  { type: 'string', description: 'Right border color (hex, theme name, or formula).' },
        bottomColor: { type: 'string', description: 'Bottom border color (hex, theme name, or formula).' },
        leftColor:   { type: 'string', description: 'Left border color (hex, theme name, or formula).' },
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
        nodeId:     { type: 'string', description: 'Node ID.' },
        boxShadow:  { type: 'string', description: 'Full CSS box-shadow value OR a formula/ternary expression. Static: "0px 4px 20px 0px #000000". Formula for per-item shadow: "context?.item?.data?.featured ? \'0px 12px 25px -5px #7c3aed\' : \'0px 4px 8px 0px #00000026\'".' },
        color:      { type: 'string', description: 'Shadow color (hex or rgba).' },
        blur:       { type: 'number', description: 'Shadow blur radius in px.' },
        spread:     { type: 'number', description: 'Shadow spread in px.' },
        x:          { type: 'number', description: 'Horizontal offset in px.' },
        y:          { type: 'number', description: 'Vertical offset in px.' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
        opacity: { type: 'number', description: 'Opacity 0–100.' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
        p:  { type: 'number', description: 'Padding all sides in px.' },
        px: { type: 'number', description: 'Horizontal padding (left + right) in px.' },
        py: { type: 'number', description: 'Vertical padding (top + bottom) in px.' },
        pt: { type: 'number', description: 'Padding top in px.' },
        pr: { type: 'number', description: 'Padding right in px.' },
        pb: { type: 'number', description: 'Padding bottom in px.' },
        pl: { type: 'number', description: 'Padding left in px.' },
        m:  { type: 'number', description: 'Margin all sides in px.' },
        mx: { description: 'Horizontal margin in px, or "auto".' },
        my: { description: 'Vertical margin in px, or "auto".' },
        mt: { type: 'number', description: 'Margin top in px.' },
        mr: { type: 'number', description: 'Margin right in px.' },
        mb: { type: 'number', description: 'Margin bottom in px.' },
        ml: { type: 'number', description: 'Margin left in px.' },
        gap:  { type: 'number', minimum: 0, description: 'Gap between flex/grid children in px.' },
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
        nodeId:    { type: 'string', description: 'Node ID.' },
        width:     { description: 'CSS width value — e.g. "100%", "320px", "50vw". Number treated as px. Formula string for dynamic values.' },
        height:    { description: 'CSS height value — e.g. "100%", "550px", "80vh", "100svh". Number treated as px. Formula string for dynamic values.' },
        flex:      { type: 'number', enum: [1], description: 'Flex-grow. Only 1 is accepted.' },
        maxWidth:  { description: 'CSS max-width — e.g. "800px", "100%", "90vw". Number treated as px.' },
        minWidth:  { description: 'CSS min-width — e.g. "320px", "50%". Number treated as px.' },
        maxHeight: { description: 'CSS max-height — e.g. "100vh", "600px". Number treated as px.' },
        minHeight: { description: 'CSS min-height — e.g. "100vh", "200px". Number treated as px.' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
        position: {
          type: 'string',
          enum: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
          description: 'Position type.',
        },
        zIndex: {
          type: 'number',
          description: 'Z-index.',
        },
        top:    { description: 'Top inset — integer pixels (e.g. 50), percentage string (e.g. "10%"), or formula expression string.' },
        right:  { description: 'Right inset — integer pixels (e.g. 50), percentage string (e.g. "20%"), or formula expression string.' },
        bottom: { description: 'Bottom inset — integer pixels (e.g. 80), percentage string (e.g. "10%"), or formula expression string.' },
        left:   { description: 'Left inset — integer pixels (e.g. 40), percentage string (e.g. "25%"), or formula expression string.' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
        rotate: { type: 'number', description: 'Degrees.' },
        flipX: { type: 'boolean' },
        flipY: { type: 'boolean' },
        translateX: {
          description: 'Pixels or formula string.',
        },
        translateY: {
          description: 'Pixels or formula string.',
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
        nodeId: { type: 'string', description: 'Node ID.' },
        mode: {
          type: 'string',
          enum: ['none', 'visible', 'clip', 'auto', 'scroll', 'x-auto', 'y-auto'],
          description: 'Overflow mode.',
        },
        clip: { type: 'boolean', description: 'Deprecated. Use mode:"clip".' },
        pointerEvents: { type: 'string', enum: ['none', 'auto'], description: 'Pointer events mode.' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
        submit: { type: 'boolean' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
        type: {
          type: 'string',
          enum: ['text', 'email', 'password', 'number', 'decimal', 'tel'],
          description: 'Input type. "decimal" = number with decimals.',
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
        debounce: { type: 'number', description: 'Debounce delay in ms for the change event.' },
        debounceEnabled: { type: 'boolean', description: 'Enable or disable debounce on the change event.' },
        autocomplete: { type: 'boolean', description: 'Enable browser autocomplete/autofill on this field.' },
      },
      required: ['nodeId'],
    },
  },
];

// ─── Layout / Spacing / Size / Typography ─────────────────────────────────────

const layoutTools: BuilderTool[] = [
  {
    name: 'set_layout',
    description: TOOL_DESCRIPTIONS['set_layout'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node ID.' },
        // ── Flex/Grid layout ──────────────────────────────────────────────────
        direction: { type: 'string', enum: ['row', 'column'], description: 'Flex direction.' },
        align: { type: 'string', enum: ['start', 'center', 'end', 'stretch', 'baseline'], description: 'Cross-axis alignment (items-*). Accepts formula string.' },
        justify: { description: 'justify-content value or Tailwind shorthand (between, around, evenly). Accepts formula string.' },
        self: {
          type: 'string',
          enum: ['auto', 'start', 'center', 'end', 'stretch', 'baseline'],
          description: 'Align-self. Accepts formula string.',
        },
        cursor: {
          type: 'string',
          enum: ['auto', 'default', 'pointer', 'not-allowed', 'grab', 'move', 'text', 'crosshair'],
          description: 'Cursor style on hover.',
        },
        gridCols: { description: 'Number of columns (integer, 1-12) or fr-unit template string (e.g. \'3fr 2fr\'). Fr strings are written as inline gridTemplateColumns. Switches display to grid automatically.' },
        gridRows: { type: 'number', description: 'Number of grid rows (1-6).' },
        gridFlow: {
          type: 'string',
          enum: ['row', 'col', 'dense', 'row-dense', 'col-dense'],
          description: 'Grid auto-flow.',
        },
        colSpan:  { type: 'number', description: 'How many columns this item spans (1-12). 13 = col-span-full.' },
        flexWrap: { type: 'string', enum: ['wrap', 'nowrap', 'wrap-reverse'], description: 'Flex wrap behavior.' },
        flex:     { type: 'number', enum: [1], description: 'Flex-grow. Only 1 is accepted.' },
        // ── Spacing (padding, margin, gap) ────────────────────────────────────
        gap: { type: 'number', minimum: 0, description: 'Gap between flex/grid children in px.' },
        p:   { type: 'number', description: 'Padding all sides in px.' },
        px:  { type: 'number', description: 'Horizontal padding in px.' },
        py:  { type: 'number', description: 'Vertical padding in px.' },
        pt:  { type: 'number', description: 'Padding top in px.' },
        pr:  { type: 'number', description: 'Padding right in px.' },
        pb:  { type: 'number', description: 'Padding bottom in px.' },
        pl:  { type: 'number', description: 'Padding left in px.' },
        m:   { type: 'number', description: 'Margin all sides in px.' },
        mx:  { description: 'Horizontal margin in px, or "auto".' },
        my:  { description: 'Vertical margin in px, or "auto".' },
        mt:  { type: 'number', description: 'Margin top in px.' },
        mr:  { type: 'number', description: 'Margin right in px.' },
        mb:  { type: 'number', description: 'Margin bottom in px.' },
        ml:  { type: 'number', description: 'Margin left in px.' },
        // ── Size ─────────────────────────────────────────────────────────────
        width:     { description: 'CSS width — e.g. "100%", "320px", "50vw", "fit-content". Number treated as px. Formula string for dynamic values.' },
        height:    { description: 'CSS height — e.g. "100%", "550px", "80vh", "100svh". Number treated as px. Formula string for dynamic values.' },
        minWidth:  { description: 'CSS min-width — e.g. "320px", "50%". Number treated as px.' },
        maxWidth:  { description: 'CSS max-width — e.g. "800px", "100%", "90vw". Number treated as px.' },
        minHeight: { description: 'CSS min-height — e.g. "100vh", "200px". Number treated as px.' },
        maxHeight: { description: 'CSS max-height — e.g. "100vh", "600px". Number treated as px.' },
        // ── Typography ────────────────────────────────────────────────────────
        fontSize: {
          type: 'number',
          description: 'Font size in px.',
        },
        weight: {
          type: 'string',
          enum: ['thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black'],
          description: 'Font weight.',
        },
        textAlign: {
          type: 'string',
          enum: ['left', 'center', 'right', 'justify'],
          description: 'Text alignment.',
        },
        leading: {
          type: 'string',
          enum: ['none', 'tight', 'snug', 'normal', 'relaxed', 'loose', '3', '4', '5', '6', '7', '8', '9', '10'],
          description: 'Line height.',
        },
        tracking: {
          type: 'string',
          enum: ['tighter', 'tight', 'normal', 'wide', 'wider', 'widest'],
          description: 'Letter spacing.',
        },
        italic: { type: 'boolean' },
        decoration: {
          type: 'string',
          enum: ['none', 'underline', 'line-through', 'overline'],
        },
        textTransform: {
          type: 'string',
          enum: ['none', 'uppercase', 'lowercase', 'capitalize'],
        },
        textOverflow: {
          type: 'string',
          enum: ['truncate', 'clip'],
          description: '"truncate" = ellipsis, "clip" = hard clip.',
        },
        whitespace: {
          type: 'string',
          enum: ['normal', 'nowrap', 'pre', 'pre-line', 'pre-wrap', 'break-spaces'],
        },
        wordBreak: {
          type: 'string',
          enum: ['normal', 'all', 'words', 'keep'],
        },
        // ── Position & insets ─────────────────────────────────────────────────
        position: {
          type: 'string',
          enum: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
          description: 'CSS position.',
        },
        zIndex: {
          type: 'number',
          description: 'Z-index. Writes z-[N] to className.',
        },
        top:    { description: 'Top inset — pixels (e.g. 8), percentage string (e.g. "50%"), or formula expression.' },
        right:  { description: 'Right inset — pixels (e.g. 0), percentage string, or formula expression.' },
        bottom: { description: 'Bottom inset — pixels (e.g. 0), percentage string, or formula expression.' },
        left:   { description: 'Left inset — pixels (e.g. 0), percentage string, or formula expression.' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
        mapPath: { type: 'string', description: 'State path to the array, e.g. "variables[\'varId\']" or "collections.UUID.data.items". For nested repeat (sub-list field on each outer item), use "context.item.data.fieldName". For nested repeat over a separate array-of-arrays variable, use "getByIndex(variables[\'FEATURES_UUID\'], context?.item?.data?.index)". Omit mapPath or pass empty string to remove repeat.' },
        keyField: { type: 'string', description: 'Field to use as React key. Use "id" when items are objects with an id field. Use "index" when items are plain strings or numbers (primitive arrays).' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'bind_action',
    description: TOOL_DESCRIPTIONS['bind_action'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node ID.' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
        enter: {
          type: 'string',
          enum: ['none', 'fadeIn', 'slideInUp', 'slideInDown', 'slideInLeft', 'slideInLeftSubtle', 'slideInRight', 'riseFade', 'dropIn', 'zoomIn', 'expandIn', 'bounceIn', 'flipInX', 'flipInY', 'flipIn3D', 'tiltIn', 'skewIn', 'skewInY', 'blurIn', 'glowIn', 'rollIn', 'revealUp', 'charFall', 'charBounce'],
          description: 'Enter animation (plays on mount). "none" removes it.',
        },
        enterDuration: { type: 'number', description: 'Enter animation duration in ms. Default 300.' },
        enterDelay: { type: 'number', description: 'Delay before the enter animation starts (ms).' },
        enterStagger: { type: 'number', description: 'Per-child stagger offset (ms). MUST be used together with an `enter` type in the same call — enterStagger alone removes all animations. Set on the LIST CONTAINER, not individual child nodes.' },
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
        loopColor: { type: 'string', description: 'Glow/shadow color for glowPulse and ripple loop types (hex or rgba, e.g. "#a855f7"). Required for glowPulse to be visible on light backgrounds.' },
        loopIntensity: { type: 'number', description: 'Glow intensity for glowPulse (0–1). Scales max shadow radius and opacity. 0.3–0.5 for subtle badges, 0.8–1 for prominent hero elements. Default 1.' },
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
          description: 'Blur filter in px. 0 removes it.',
        },
        filterBrightness: {
          type: 'number',
          description: 'Brightness filter multiplier. 1 = normal.',
        },
        filterContrast: {
          type: 'number',
          description: 'Contrast filter multiplier. 1 = normal.',
        },
        filterSaturate: {
          type: 'number',
          description: 'Saturation filter multiplier. 1 = normal, 0 = grayscale.',
        },
        filterGrayscale: {
          type: 'number',
          description: 'Grayscale amount. 0 = color, 1 = gray.',
        },
        filterHueRotate: {
          type: 'number',
          description: 'Hue rotation in degrees.',
        },
        backdropBlur: {
          type: 'number',
          description: 'Backdrop blur in px (glassmorphism). Web only. Pair with semi-transparent background. 0 removes it.',
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
        nodeId: { type: 'string', description: 'Node ID.' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
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
        nodeId: { type: 'string', description: 'Node ID.' },
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
          description: 'Root node of the section tree. Node fields are defined in the system prompt. Required per media type: Icon needs icon (Iconify name, e.g. "lucide:check"), Image needs searchQuery (photo description), Video needs searchQuery (video description).',
          properties: {
            label: { type: 'string', description: 'Component type (Box, Text, Image, Icon, etc.).' },
            name: { type: 'string', description: 'Semantic name for this node.' },
            text: { type: 'string', description: 'Static text content — Text nodes only.' },
            icon: { type: 'string', description: 'Iconify icon name (Icon nodes only, e.g. "lucide:check").' },
            searchQuery: { type: 'string', description: 'Visual search query for Image/Video nodes.' },
            bgImage: { type: 'string', description: 'Background image search query for Box nodes.' },
            children: { type: 'array', description: 'Child nodes — same structure as this node.' },
          },
          required: ['label'],
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
              description: { type: 'string', description: 'Brief usage hint for downstream agents — what this variable stores and when it should be updated (e.g. "Left operand — updated after every intermediate calculation result").' },
              folder: { type: 'string', description: 'Folder/group name for organizing variables in the builder panel (e.g. "Calculator", "Cart"). Use the feature name.' },
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

// ─── Unified Styling Tool (set_style) ────────────────────────────────────────
// Single tool that covers ALL visual properties: layout, spacing, size,
// typography, position, overflow, background, text color, border, shadow,
// opacity, and transform. Used exclusively by the merged styling agent.
// Old individual tools (set_layout, set_background, etc.) remain available
// for the builder design panel and backward-compat single-agent edit mode.

const setStyleTool: BuilderTool[] = [
  {
    name: 'set_style',
    description: 'Apply any visual style to a node in one call. Covers layout, spacing, size, typography, position, overflow, background, text color, border, shadow, opacity, and transform. Use this for ALL styling — no need to call set_layout + set_background + set_border separately.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node ID.' },

        // ── Layout (flex/grid direction, alignment) ───────────────────────────
        direction: { type: 'string', enum: ['row', 'column'], description: 'Flex direction.' },
        align: { type: 'string', enum: ['start', 'center', 'end', 'stretch', 'baseline'], description: 'Cross-axis alignment (align-items). Accepts formula string.' },
        justify: { description: 'justify-content value (start, center, end, between, around, evenly). Accepts formula string.' },
        self: { type: 'string', enum: ['auto', 'start', 'center', 'end', 'stretch', 'baseline'], description: 'Self cross-axis alignment (align-self).' },
        cursor: { type: 'string', enum: ['pointer', 'default', 'not-allowed', 'grab', 'crosshair', 'text'], description: 'CSS cursor.' },
        gridCols: { description: 'Number of columns (integer) or fr-unit template string (e.g. \'3fr 2fr\'). Fr strings are written as inline gridTemplateColumns.' },
        gridRows: { description: 'Number of grid rows.' },
        gridFlow: { type: 'string', enum: ['row', 'col', 'row-dense', 'col-dense'], description: 'grid-auto-flow direction.' },
        colSpan: { description: 'Number of grid columns this item spans.' },
        flexWrap: { type: 'string', enum: ['wrap', 'nowrap', 'wrap-reverse'], description: 'Flex wrap behaviour.' },
        flex: { type: 'number', enum: [1], description: 'Flex-grow. Only 1 is accepted.' },

        // ── Spacing ───────────────────────────────────────────────────────────
        gap: { type: 'number', minimum: 0, description: 'Gap between flex/grid children in px (number, e.g. 20). Never pass strings like "20px".' },
        p:   { type: 'number', description: 'Padding all sides in px (number, e.g. 16). Never pass strings like "16px".' },
        px:  { type: 'number', description: 'Horizontal padding (left + right) in px (number, e.g. 32).' },
        py:  { type: 'number', description: 'Vertical padding (top + bottom) in px (number, e.g. 14).' },
        pt:  { type: 'number', description: 'Padding top in px (number).' },
        pr:  { type: 'number', description: 'Padding right in px (number).' },
        pb:  { type: 'number', description: 'Padding bottom in px (number).' },
        pl:  { type: 'number', description: 'Padding left in px (number).' },
        m:   { type: 'number', description: 'Margin all sides in px (number). Use 0 to clear.' },
        mx:  { description: 'Horizontal margin in px, or "auto".' },
        my:  { description: 'Vertical margin in px, or "auto".' },
        mt:  { type: 'number', description: 'Margin top in px (number).' },
        mr:  { type: 'number', description: 'Margin right in px (number).' },
        mb:  { type: 'number', description: 'Margin bottom in px (number).' },
        ml:  { type: 'number', description: 'Margin left in px (number).' },

        // ── Size ─────────────────────────────────────────────────────────────
        width:     { description: 'Width (number = px, "100%" = fill, "fit-content", "auto", CSS string).' },
        height:    { description: 'Height (number = px, "100%", "100vh", "fit-content", CSS string).' },
        minWidth:  { description: 'min-width value.' },
        maxWidth:  { description: 'max-width value (e.g. "600px", "100%").' },
        minHeight: { description: 'min-height value.' },
        maxHeight: { description: 'max-height value.' },

        // ── Typography (Text nodes only) ───────────────────────────────────
        fontSize:      { type: 'number', description: 'Font size in px as a number (e.g. 56 for 56px). Never pass strings like "56px" or Tailwind tokens like "lg" — the builder exclusively uses the text-[Npx] format.' },
        weight:        { type: 'string', enum: ['thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black'], description: 'Font weight.' },
        textAlign:     { type: 'string', enum: ['left', 'center', 'right', 'justify'], description: 'Text alignment.' },
        leading:       { type: 'string', description: 'Line height (tight, snug, normal, relaxed, loose or number).' },
        tracking:      { type: 'string', description: 'Letter spacing (tighter, tight, normal, wide, wider, widest).' },
        italic:        { type: 'boolean', description: 'Italic text.' },
        decoration:    { type: 'string', enum: ['underline', 'line-through', 'overline', 'no-underline'], description: 'Text decoration.' },
        textTransform: { type: 'string', enum: ['uppercase', 'lowercase', 'capitalize', 'normal-case'], description: 'Text transform.' },
        textOverflow:  { type: 'string', enum: ['truncate', 'ellipsis', 'clip'], description: 'Text overflow handling.' },
        whitespace:    { type: 'string', enum: ['normal', 'nowrap', 'pre', 'pre-line', 'pre-wrap'], description: 'White-space mode.' },
        wordBreak:     { type: 'string', enum: ['normal', 'words', 'all', 'keep'], description: 'Word break mode.' },

        // ── Position / Insets ─────────────────────────────────────────────────
        position: { type: 'string', enum: ['relative', 'absolute', 'fixed', 'sticky', 'static'], description: 'CSS position.' },
        zIndex:   { description: 'z-index (number or CSS string).' },
        top:      { description: 'Top inset (number = px or CSS string like "50%", "-20px").' },
        right:    { description: 'Right inset.' },
        bottom:   { description: 'Bottom inset.' },
        left:     { description: 'Left inset.' },

        // ── Overflow ──────────────────────────────────────────────────────────
        overflow:      { type: 'string', enum: ['clip', 'visible', 'auto', 'scroll', 'x-auto', 'y-auto'], description: 'Overflow behaviour.' },
        pointerEvents: { type: 'string', enum: ['none', 'auto'], description: 'Pointer events.' },

        // ── Background ────────────────────────────────────────────────────────
        bg:          { type: 'string', description: 'Solid color only — theme token, hex, rgb/rgba, or formula. For gradients use the gradient param or bgImage.' },
        fillOpacity: { type: 'number', description: 'Background fill opacity 0-100.' },
        bgImage:     { type: 'string', description: 'Background-image URL or CSS gradient string (e.g. linear-gradient(...)). Do NOT wrap in url() — the executor handles that for URLs automatically.' },
        bgSize:      { type: 'string', description: 'background-size (cover, contain, auto, CSS value).' },
        bgPosition:  { type: 'string', description: 'background-position value.' },
        bgRepeat:    { type: 'string', description: 'background-repeat value.' },
        gradient: {
          type: 'object',
          description: 'Linear gradient. direction: CSS angle/keyword. colors: 2-5 color stops.',
          properties: {
            direction: { type: 'string' },
            colors: { type: 'array', items: { type: 'string' } },
          },
        },

        // ── Text Color ────────────────────────────────────────────────────────
        color: { type: 'string', description: 'Text/icon color (theme token, hex, formula). Theme tokens: foreground, primary, muted-foreground, etc.' },

        // ── Border ────────────────────────────────────────────────────────────
        borderWidth: { description: 'Border width in px (number) or 0 to remove.' },
        borderStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted', 'none'], description: 'Border style.' },
        borderColor: { type: 'string', description: 'Border color (theme token, hex, formula).' },
        radius:    { description: 'Border radius in px (number, e.g. 8 = rounded-[8px]). IMPORTANT: pair with overflow:"clip" to clip child content.' },
        radiusTL:  { description: 'Top-left radius px.' },
        radiusTR:  { description: 'Top-right radius px.' },
        radiusBR:  { description: 'Bottom-right radius px.' },
        radiusBL:  { description: 'Bottom-left radius px.' },
        // Per-side border width/color
        topWidth:    { description: 'Top border width px.' },
        rightWidth:  { description: 'Right border width px.' },
        bottomWidth: { description: 'Bottom border width px.' },
        leftWidth:   { description: 'Left border width px.' },
        topColor:    { type: 'string', description: 'Top border color.' },
        rightColor:  { type: 'string', description: 'Right border color.' },
        bottomColor: { type: 'string', description: 'Bottom border color.' },
        leftColor:   { type: 'string', description: 'Left border color.' },

        // ── Shadow ────────────────────────────────────────────────────────────
        shadow: {
          type: 'object',
          description: 'Box shadow. Use boxShadow for a full CSS string, or set x/y/blur/spread/color individually.',
          properties: {
            boxShadow: { type: 'string', description: 'Full CSS box-shadow string, e.g. "0px 4px 12px 0px rgba(0,0,0,0.1)".' },
            color:  { type: 'string', description: 'Shadow color (hex or rgba).' },
            blur:   { type: 'number', description: 'Blur radius px.' },
            spread: { type: 'number', description: 'Spread px.' },
            x:      { type: 'number', description: 'X offset px.' },
            y:      { type: 'number', description: 'Y offset px.' },
            remove: { type: 'boolean', description: 'Remove all shadows.' },
          },
        },

        // ── Opacity ───────────────────────────────────────────────────────────
        opacity: { type: 'number', description: 'Opacity 0–100 (100 = fully opaque, 0 = invisible).' },

        // ── Transform ────────────────────────────────────────────────────────
        transform:  { type: 'string', description: 'CSS transform string — parsed automatically. e.g. "translate(-50%, -50%)" sets both translateX and translateY; "rotate(45deg)" sets rotation. Use this instead of separate translateX/translateY.' },
        rotate:     { description: 'Rotation in degrees (number) or CSS string.' },
        flipX:      { type: 'boolean', description: 'Flip horizontally (scaleX(-1)).' },
        flipY:      { type: 'boolean', description: 'Flip vertically (scaleY(-1)).' },
        translateX: { description: 'Horizontal translate (number = px or CSS string).' },
        translateY: { description: 'Vertical translate (number = px or CSS string).' },
      },
      required: ['nodeId'],
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
 *  - search_icons / search_images / search_videos / set_src → media phase (AI agent)
 *  - set_submit → behavior/form wiring (not styling)
 *  - set_input_props → input config/structure (not styling)
 *  - set_icon_src → icon name set by tree manifest or media agent; color/size via set_style. */
export const PHASE3_BUILDER_TOOLS: BuilderTool[] = [
  ...pageTools.filter(t => t.name === 'switch_page'),
  // Exclude set_submit (form behavior), set_input_props (input structure), set_spacing (merged into set_layout) from styling phase
  // Note: set_typography and set_size are kept as backward-compat aliases in Phase 3 (single-agent edit mode)
  ...semanticDesignTools
    .filter(t => !['set_submit', 'set_input_props', 'set_spacing'].includes(t.name)),
  ...layoutTools,
  ...logicTools.filter(t => ['set_condition', 'set_animation'].includes(t.name)),
  // set_icon_src for Phase 3: icon name only (color/size handled via set_style)
  ...textTools.filter(t => t.name === 'set_icon_src'),
  ...textTools.filter(t => ['set_text', 'set_placeholder'].includes(t.name)),
];

/** Phase W (workflow) tools — runs in parallel with Phase 3 after structure is built. */
export const PHASE_W_TOOLS: BuilderTool[] = [
  ...pageTools.filter(t => t.name === 'switch_page'),
  ...readTools.filter(t => ['get_variables', 'get_workflows'].includes(t.name)),
  ...logicTools.filter(t => ['create_workflow', 'bind_action'].includes(t.name)),
];

// ─── Parallel Agent Tool Collections ─────────────────────────────────────────

/** Structure Agent — builds tree shape + declares variables in one call. */
export const STRUCTURE_AGENT_TOOLS: BuilderTool[] = [
  ...batchTools, // generate_structure (includes variables array)
];

/** Binding Agent — connects data to UI nodes (text, repeat, condition, disabled, icon name). */
export const BINDING_AGENT_TOOLS: BuilderTool[] = [
  ...textTools.filter(t => ['set_text', 'set_src'].includes(t.name)),
  ...logicTools.filter(t => ['set_condition', 'set_repeat', 'set_disabled'].includes(t.name)),
  ...textTools.filter(t => t.name === 'set_icon_src'),
];

// ─── Styling Sub-Agent Tool Collections (3-way parallel split) ───────────────

/** Layout Sub-Agent — layout, spacing, sizing, typography, position, overflow, transform. */
export const LAYOUT_AGENT_TOOLS: BuilderTool[] = [
  ...layoutTools, // set_layout (includes layout, spacing, size, typography params)
  ...semanticDesignTools.filter(t => ['set_overflow'].includes(t.name)),
  ...semanticDesignTools.filter(t => t.name === 'set_transform'),
];

/** Colors Sub-Agent — backgrounds, text color, borders, shadows, opacity, animation. */
export const COLORS_AGENT_TOOLS: BuilderTool[] = [
  ...semanticDesignTools.filter(t => ['set_background', 'set_text_color', 'set_border', 'set_shadow', 'set_opacity'].includes(t.name)),
  ...logicTools.filter(t => t.name === 'set_animation'),
];

/** Typography + Animation Sub-Agent — removed (merged into layout + colors agents). */
export const TYPO_ANIM_AGENT_TOOLS: BuilderTool[] = [];

// ─── Merged Styling Agent Tool Collections ────────────────────────────────────

/** Styling Agent — unified set_style covers ALL visual properties (layout, colors, border, shadow…).
 *  Icon color/size are set via set_style (Icon-specific branch handles props.color + props.size).
 *  Icon name is set by the media/binding agents via set_icon_src — not available here. */
export const STYLING_AGENT_TOOLS: BuilderTool[] = [
  ...setStyleTool,
];

/** Animation Agent — set_animation for loop/enter/exit/hover/press. */
export const ANIMATION_AGENT_TOOLS: BuilderTool[] = [
  ...logicTools.filter(t => t.name === 'set_animation'),
];

/** Media Agent — searches for and assigns images, videos, and icons to nodes.
 *  search_images / search_videos / search_icons are read-tools (return data to AI).
 *  set_src / set_background / set_icon_src are write-tools (emit tool_executed to client).
 *  Icon color/size are NOT set here — handled by the styling agent via set_style. */
export const MEDIA_AGENT_TOOLS: BuilderTool[] = [
  ...assetTools, // search_images, search_videos, search_icons
  ...textTools.filter(t => ['set_src', 'set_icon_src'].includes(t.name)),
  ...semanticDesignTools.filter(t => t.name === 'set_background'),
];

