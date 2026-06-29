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
import { TOOL_DESCRIPTIONS } from '@/lib/ai/tool-descriptions';

// ─── Component Labels (what the AI knows as palette labels) ───────────────────

// Auto-derived from ALL_PRIMITIVES — stays in sync with the builder palette automatically
export const COMPONENT_LABELS: string[] = ALL_PRIMITIVES.map(c => c.label);

// ─── Read / Context Tools v2 — two generic tools replacing the 10 individual get_* ───

const KIND_ENUM = ['node', 'variable', 'workflow', 'formula', 'dataSource', 'sharedComponent', 'page', 'theme'] as const;

const searchToolV2: BuilderTool = {
  name: 'search',
  description: 'Regex search across all artifacts. Use when the user refers to something by a specific name, label, or exact text (e.g. "header", "submit button", "Hero CTA"). Plain words do substring match. Use | for alternatives, .* to connect signals, ^ for starts-with, $ for ends-with.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Case-insensitive regex. Plain words do substring match. Use | for OR, .* to connect two signals, ^ and $ for anchors. Covers names, types, text content, IDs, and all stored fields.',
      },
      kinds: {
        type: 'array',
        items: { type: 'string', enum: KIND_ENUM as unknown as string[] },
        description: 'Limit to these artifact kinds. Omit to search everything.',
      },
      scope: {
        type: 'string',
        enum: ['currentPage', 'allPages'],
        description: 'currentPage = only nodes on current page (faster). allPages = also search other pages (default).',
      },
      limit: {
        type: 'number',
        description: 'Max results (default 30, max 100).',
      },
    },
    required: ['query'],
  },
};

const readToolV2: BuilderTool = {
  name: 'read',
  description: 'Get full details for a specific artifact by ID. Like Cursor\'s read_file. Supports dot-path slicing for nested data (e.g. "response.data[0].user") and depth control for node trees. For theme use id="*".',
  input_schema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: KIND_ENUM as unknown as string[],
        description: 'Type of artifact to read.',
      },
      id: {
        type: 'string',
        description: 'UUID, name, route, or "*" for singletons (theme, pages list).',
      },
      path: {
        type: 'string',
        description: 'Optional dot-notation path to slice into nested data: "response.data[0].customer.email". Only the matching subtree is returned.',
      },
      depth: {
        type: 'number',
        description: 'For node/page kinds: how many levels of children to include (default 1, max 3). Deeper levels replace children with stubs showing hasMoreChildren count.',
      },
    },
    required: ['kind', 'id'],
  },
};

const semanticSearchTool: BuilderTool = {
  name: 'semantic_search',
  description: 'Semantic search — finds nodes by meaning, not exact text. Use when the user describes a visual property or concept whose literal value may not appear in the markup: colors by name ("the red button", "dark card"), visual roles ("hero section", "navigation menu"), or interaction patterns. Returns all relevant matches ranked by similarity — no fixed cap.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language description of what to find. Be specific and descriptive: "red primary action button", "large purple gradient hero banner".',
      },
    },
    required: ['query'],
  },
};

/** v2 read tools — used by Context Agent only */
export const READ_TOOLS_V2: BuilderTool[] = [searchToolV2, semanticSearchTool, readToolV2];

// ─── Read / Context Tools (legacy — deprecated, kept for one release) ─────────

const readTools: BuilderTool[] = [
  searchToolV2,
  readToolV2,
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
    name: 'get_formulas',
    description: TOOL_DESCRIPTIONS['get_formulas'],
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_shared_components',
    description: TOOL_DESCRIPTIONS['get_shared_components'],
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
  {
    name: 'add_shared_component_instance',
    description: TOOL_DESCRIPTIONS['add_shared_component_instance'],
    input_schema: {
      type: 'object',
      properties: {
        modelId: { type: 'string', description: 'SharedComponentModel id (returned by get_shared_components).' },
        nodeId: { type: 'string', description: 'Pre-minted UUID for the new instance node — required so subsequent calls can target it.' },
        parentId: { type: 'string', description: 'Parent node id. Omit for page root.' },
        atIndex: { type: 'number', description: 'Position within parent children. Omit to append.' },
        name: { type: 'string', description: 'Optional display name for the Layers panel (defaults to the model name).' },
        props: {
          type: 'object',
          description: 'Optional initial instance props (only keys declared in model.properties[]). Use set_component_props later to update.',
        },
      },
      required: ['modelId', 'nodeId'],
    },
  },
  {
    name: 'set_component_props',
    description: TOOL_DESCRIPTIONS['set_component_props'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Shared-component instance node id (must have node._shared.id set).' },
        props: {
          type: 'object',
          description: 'Object whose keys match model.properties[].name. Pass JS expressions ({"formula":"..."}) for dynamic values, plain literals for static.',
        },
      },
      required: ['nodeId', 'props'],
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
        text: { type: 'string', description: 'Text value. CRITICAL: string literals inside expressions MUST use single quotes (\'$\', \'/month\', \'active\'). Double quotes inside expressions cause parse errors.' },
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
          description: 'Iconify icon name, e.g. "lucide:home", "heroicons:star", "tabler:check", "ph:arrow-right". Color and size are set via set_style.',
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
          description: 'Solid color only — theme token, hex, rgb/rgba. For gradients use the gradient param or bgImage.',
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
          description: 'Text color — theme token, hex, named color.',
        },
      },
      required: ['nodeId', 'color'],
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
          description: 'Border color — theme name ("border", "primary", "muted"), hex, or \'theme:tokenName\'.',
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
        topColor:    { type: 'string', description: 'Top border color (hex, theme name).' },
        rightColor:  { type: 'string', description: 'Right border color (hex, theme name).' },
        bottomColor: { type: 'string', description: 'Bottom border color (hex, theme name).' },
        leftColor:   { type: 'string', description: 'Left border color (hex, theme name).' },
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
        boxShadow:  { type: 'string', description: 'Full CSS box-shadow value OR a JS ternary expression. Static: "0px 4px 20px 0px #000000". Per-item: "context?.item?.data?.isActive ? \'0px 12px 25px -5px #000000\' : \'0px 4px 8px 0px #00000026\'".' },
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
          description: 'Pixels (e.g. -50) or percentage string (e.g. "-50%").',
        },
        translateY: {
          description: 'Pixels (e.g. -50) or percentage string (e.g. "-50%").',
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
        breakpoint: { type: 'string', enum: ['desktop', 'laptop', 'tablet', 'mobile'], description: 'Target responsive breakpoint. Omit or "desktop" for base styles.' },
        // ── Flex/Grid layout ──────────────────────────────────────────────────
        direction: { type: 'string', enum: ['row', 'column'], description: 'Flex direction.' },
        align: { type: 'string', enum: ['items-start', 'items-center', 'items-end', 'items-stretch', 'items-baseline'], description: 'Cross-axis alignment (align-items).' },
        justify: { type: 'string', enum: ['justify-start', 'justify-center', 'justify-end', 'justify-between', 'justify-around', 'justify-evenly'], description: 'Main-axis alignment (justify-content).' },
        self: {
          type: 'string',
          enum: ['auto', 'start', 'center', 'end', 'stretch', 'baseline'],
          description: 'Align-self.',
        },
        cursor: {
          type: 'string',
          enum: ['auto', 'default', 'pointer', 'not-allowed', 'grab', 'move', 'text', 'crosshair'],
          description: 'Cursor style on hover.',
        },
        gridCols: { description: 'Number of columns (integer, 1-12) or fr-unit template string (e.g. \'3fr 2fr\'). Switches display to grid automatically. For repeat containers, set gridCols on the CONTAINER — the repeat template inherits each cell. Using direction:\'column\' on a repeat container only stacks items vertically; gridCols is required for multi-column grids.' },
        gridRows: { type: 'number', description: 'Number of grid rows (1-6).' },
        gridFlow: {
          type: 'string',
          enum: ['row', 'col', 'dense', 'row-dense', 'col-dense'],
          description: 'Grid auto-flow.',
        },
        colSpan:  { description: 'How many columns this item spans (1-12). 13 = col-span-full. Also accepts a JS formula string that evaluates to a number for per-item dynamic span inside a REPEAT.' },
        flexWrap: { type: 'string', enum: ['wrap', 'nowrap', 'wrap-reverse'], description: 'Flex wrap behavior.' },
        flex:     { type: 'number', enum: [1], description: 'Flex-grow. Only 1 is accepted.' },
        // ── Spacing (padding, margin, gap) ────────────────────────────────────
        gap: { type: 'number', minimum: 0, description: 'Gap between flex/grid children in px (uniform).' },
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
          description: 'Text alignment — valid ONLY on Text nodes. Setting this on a Box has NO effect (text-align does not cascade to children).',
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
        top:    { description: 'Top inset — pixels (e.g. 8) or percentage string (e.g. "50%").' },
        right:  { description: 'Right inset — pixels or percentage string.' },
        bottom: { description: 'Bottom inset — pixels or percentage string.' },
        left:   { description: 'Left inset — pixels or percentage string.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_responsive_override',
    description: TOOL_DESCRIPTIONS['set_responsive_override'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node id.' },
        breakpoint: {
          type: 'string',
          enum: ['laptop', 'tablet', 'mobile'],
          description: 'Breakpoint to override at. Desktop is the base — never use it here.',
        },
        field: {
          type: 'string',
          description: 'Dot-path under node.responsive[bp]. Examples: "text" (override text), "condition", "props.className", "props.icon", "actions", "animation.enter", "animation.gesture", "map.path".',
        },
        value: {
          description: 'Value to write. Pass a string for text/icon/className, a boolean/object for props, an array for actions, an object for animation/map.',
        },
      },
      required: ['nodeId', 'breakpoint', 'field', 'value'],
    },
  },
  {
    name: 'clear_responsive_override',
    description: TOOL_DESCRIPTIONS['clear_responsive_override'],
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node id.' },
        breakpoint: {
          type: 'string',
          enum: ['laptop', 'tablet', 'mobile'],
          description: 'Breakpoint to clear at.',
        },
        field: {
          type: 'string',
          description: 'Optional dot-path to clear. Omit to delete the entire breakpoint slice.',
        },
      },
      required: ['nodeId', 'breakpoint'],
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
          description: 'JS expression. Pass "" to remove. NEVER pass "true" — that is a no-op; omit set_condition if the node should always be visible.',
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
        mapPath: { type: 'string', description: 'State path to the array. Use plain dot notation (no optional chaining): "variables[\'varId\']" or "context.item.data.fieldName" for nested repeats. Optional chaining (context?.item) in mapPath breaks scope resolution — use it everywhere else but NOT here. For a separate array-of-arrays variable: "getByIndex(variables[\'UUID\'], context?.item?.data?.index)". Pass empty string to remove repeat.' },
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
        trigger: {
          type: 'string',
          description: 'Optional — explicitly set the trigger event for this binding (overrides the workflow default). Common values: click, change, submit, valueChange, enterKey, mouseEnter, mouseLeave, swipeLeft, swipeRight, swipeUp, swipeDown, dragStart, dragUpdate, dragEnd, focus, blur, scroll. Or a SC custom-trigger id when binding inside a shared component.',
        },
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
          description: 'When this workflow fires. DOM events: click, change, submit, valueChange, enterKey, dragStart, dragUpdate, dragEnd, mouseEnter, mouseLeave, swipeLeft, swipeRight, swipeUp, swipeDown. Trigger-workflow events: appLoadBefore, appLoad, pageLoadBefore, pageLoad, pageUnload, scroll, resize, keydown, keyup, collectionFetchError. Shared-component lifecycle: execution, created, mounted, beforeUnmount, propertyChange. Or any declared SC custom-trigger id. Default "click".',
        },
        isTrigger: {
          type: 'boolean',
          description: 'Mark this workflow as a trigger workflow (runs on app/page lifecycle events instead of user interaction).',
        },
        isAppTrigger: {
          type: 'boolean',
          description: 'When true, this trigger workflow runs in the app shell (e.g. appLoadBefore, appLoad). Implies isTrigger: true.',
        },
        pageScope: {
          type: 'string',
          description: 'When set, this trigger workflow only runs on the page with this id (e.g. pageLoad on a specific page). Implies isTrigger: true.',
        },
        scope: {
          type: 'string',
          enum: ['page', 'global', 'component'],
          description: 'Workflow storage scope. Default "page" (page-scoped, stored in store.workflows with pageScope). "global" writes to project-level workflows. "component" writes to model.workflows[uuid] — requires componentModelId.',
        },
        componentModelId: {
          type: 'string',
          description: 'Required when scope is "component" — the SharedComponentModel id whose workflow you are creating.',
        },
        folder: {
          type: 'string',
          description: 'Optional folder name for organising workflows.',
        },
        bindToNodeId: {
          type: 'string',
          description: 'Optional — immediately binds this workflow to that node after creation.',
        },
      },
      required: ['name'],
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
    name: 'update_workflow_steps',
    description: TOOL_DESCRIPTIONS['update_workflow_steps'],
    input_schema: {
      type: 'object',
      properties: {
        workflowName: { type: 'string', description: 'Existing page-scoped workflow name.' },
        steps: {
          type: 'array',
          description: 'Full replacement steps array (same shape as create_workflow.steps).',
          items: { type: 'object' },
        },
      },
      required: ['workflowName', 'steps'],
    },
  },
  {
    name: 'add_workflow_step',
    description: TOOL_DESCRIPTIONS['add_workflow_step'],
    input_schema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow UUID from the WORKFLOW ROSTER in your message.' },
        stepId:       { type: 'string', description: 'Unique step ID string, e.g. "s1", "s-digit-1". Must be unique within the entire workflow.' },
        type:         { type: 'string', enum: ['changeVariableValue', 'resetVariableValue', 'branch', 'multiOptionBranch', 'passThroughCondition', 'forEach', 'whileLoop', 'breakLoop', 'continueLoop', 'navigateTo', 'navigatePrev', 'fetchData', 'graphql', 'fetchCollection', 'updateCollection', 'runJavaScript', 'timeDelay', 'copyToClipboard', 'runProjectWorkflow', 'setFormState', 'resetForm', 'returnValue', 'executeComponentAction', 'pickFile', 'printPdf', 'downloadFileFromUrl', 'createUrlFromBase64', 'encodeFileAsBase64', 'stopPropagation'], description: 'Step type. See per-field descriptions for which params each type uses.' },
        parentStepId: { type: 'string', description: 'ID of the parent container step. Omit this field entirely for root-level steps — do NOT pass the string "null". Only branch, multiOptionBranch, forEach, and whileLoop are valid parents. To add multiple sequential steps at the same level, repeat the same parentStepId + branchKey for each — they are appended in order.' },
        branchKey:    { type: 'string', description: 'Where inside the parent to insert. Values: "trueBranch" or "falseBranch" (inside a branch); "branches.{matchValue}" (inside a multiOptionBranch — creates the entry if missing); "defaultBranch" (multiOptionBranch fallback — REQUIRED for every multiOptionBranch, add it even with an empty step to make the no-match case explicit); "loopBody" (inside forEach/whileLoop). There is no "null" branchKey.' },
        // changeVariableValue / resetVariableValue
        variableName: { type: 'string', description: 'changeVariableValue / resetVariableValue: UUID of the target variable. Use dot-notation "UUID.fieldName" to update one field of an object variable without touching siblings.' },
        value:        { type: 'string', description: 'changeVariableValue: a JS expression that evaluates to the new value. String literals need quotes: \'hello\' not hello. Booleans: true/false. Numbers: 42. Variable access: variables[\'UUID\']. Compound: variables[\'UUID\'] + 1.' },
        defaultValue: { type: 'string', description: 'resetVariableValue: optional override default value.' },
        // branch / multiOptionBranch / whileLoop / passThroughCondition
        condition:    { type: 'string', description: 'branch / multiOptionBranch / whileLoop / passThroughCondition: JS expression that evaluates to true/false or the match value.' },
        // forEach
        listPath:     { type: 'string', description: 'forEach: variable UUID or state path whose value is the array to iterate.' },
        // navigateTo
        navPath:      { type: 'string', description: 'navigateTo: internal route path (e.g. "/products") or use navExternalUrl for external.' },
        navExternalUrl: { type: 'string', description: 'navigateTo: external URL.' },
        navLinkType:  { type: 'string', description: 'navigateTo: "internal" (default) or "external".' },
        navNewTab:    { type: 'boolean', description: 'navigateTo: open in new tab.' },
        navQueryParamsJson: { type: 'string', description: 'navigateTo: JSON string of [{name, value}] query params, e.g. \'[{"name":"slug","value":"my-product"}]\'.' },
        navReplace:   { type: 'boolean', description: 'navigateTo: replace history entry.' },
        navDefaultPath: { type: 'string', description: 'navigatePrev: fallback path if no history.' },
        // runJavaScript
        code:         { type: 'string', description: 'runJavaScript: the JS function body. Available globals: fns (formula functions — fns.toText, fns.toNumber, fns.formatCurrency, fns.clamp, fns.round, etc.), wwLib (wwLib.variables.get/set, wwLib.navigate.to/prev, wwLib.scroll.to(nodeId) [nodeId = UUID of target page node — use this to scroll to a section], wwLib.collections.refetch, wwLib.clipboard.copy, wwLib.timing.delay, wwLib.workflows.run, wwLib.event.stopPropagation). Return value is stored in context.workflow[stepId].result. Forbidden: fetch, document, window, eval, localStorage, require, import.' },
        isAsync:      { type: 'boolean', description: 'runJavaScript: defaults true.' },
        // timeDelay
        delayMs:      { type: 'number', description: 'timeDelay: delay in milliseconds.' },
        // copyToClipboard / returnValue
        copyValue:    { type: 'string', description: 'copyToClipboard: text to copy.' },
        // fetchData
        fetchUrl:     { type: 'string', description: 'fetchData: request URL.' },
        fetchMethod:  { type: 'string', description: 'fetchData: HTTP method (GET/POST/PUT/DELETE/PATCH). Default GET.' },
        fetchBody:    { type: 'string', description: 'fetchData: raw request body string.' },
        fetchContentType: { type: 'string', description: 'fetchData: Content-Type header.' },
        // graphql
        gqlEndpoint:  { type: 'string', description: 'graphql: endpoint URL.' },
        gqlQuery:     { type: 'string', description: 'graphql: the GraphQL query or mutation string.' },
        // fetchCollection / fetchCollectionsParallel / updateCollection
        collectionId: { type: 'string', description: 'fetchCollection / updateCollection: datasource UUID. For fetching multiple collections in parallel, pass collectionIds instead.' },
        collectionIds: { type: 'string', description: 'fetchCollection: comma-separated list of datasource UUIDs to refetch in parallel. Replaces fetchCollectionsParallel.' },
        updateType:   { type: 'string', description: 'updateCollection: "insert", "update", "delete", or "replaceAll".' },
        collectionData: { type: 'string', description: 'updateCollection: JSON string of the item to insert/update/replace.' },
        idKey:        { type: 'string', description: 'updateCollection: field name to match for update/delete (e.g. "id").' },
        idValue:      { type: 'string', description: 'updateCollection: value of idKey to find the target item.' },
        // runProjectWorkflow
        projectWorkflowId: { type: 'string', description: 'runProjectWorkflow: name of the workflow to call.' },
        // setFormState
        formIsSubmitting: { type: 'boolean', description: 'setFormState: isSubmitting value.' },
        formIsSubmitted:  { type: 'boolean', description: 'setFormState: isSubmitted value.' },
        // pickFile
        pickAccept:   { type: 'string', description: 'pickFile: accepted file types (e.g. "image/*").' },
        pickMultiple: { type: 'boolean', description: 'pickFile: allow multiple files.' },
        pickStoreIn:  { type: 'string', description: 'pickFile: variable ID to store picked files array.' },
        // createUrlFromBase64 / encodeFileAsBase64
        base64:        { type: 'string', description: 'createUrlFromBase64: base64 string.' },
        mimeType:      { type: 'string', description: 'createUrlFromBase64: MIME type (e.g. "image/png").' },
        storeIn:       { type: 'string', description: 'createUrlFromBase64 / encodeFileAsBase64 / pickFile: variable ID to store result.' },
        dataUrl:       { type: 'string', description: 'encodeFileAsBase64: data URL string.' },
        // downloadFileFromUrl
        downloadUrl:   { type: 'string', description: 'downloadFileFromUrl: file URL to download.' },
      },
      required: ['workflowName', 'stepId', 'type'],
    },
  },
  {
    name: 'set_workflow_params',
    description: TOOL_DESCRIPTIONS['set_workflow_params'],
    input_schema: {
      type: 'object',
      properties: {
        workflowName: { type: 'string', description: 'Exact name of the workflow to declare params on.' },
        params: {
          type: 'array',
          description: 'Ordered list of typed input parameters. Each: { name: string, type: "string"|"number"|"boolean"|"object"|"array", description?: string, defaultValue?: any }.',
          items: { type: 'object' },
        },
      },
      required: ['workflowName', 'params'],
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
          enum: ['none', 'fadeIn', 'slideInUp', 'slideInDown', 'slideInLeft', 'slideInLeftSubtle', 'slideInRight', 'riseFade', 'dropIn', 'zoomIn', 'expandIn', 'bounceIn', 'flipInX', 'flipInY', 'flipIn3D', 'tiltIn', 'skewIn', 'skewInY', 'blurIn', 'glowIn', 'rollIn', 'revealUp', 'charFall', 'charBounce'],
          description: 'Scroll-triggered enter animation — fires when the element scrolls into the viewport. Same enum as enter.',
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
          description: 'Array of ≥2 CSS color values (hex, rgba, or theme token) for an animated flowing gradient background. Automatically sets loop to "gradientDrift". E.g. ["#000000","#ffffff"]. Web only.',
        },
        imperativeTrigger: {
          type: 'object',
          description: 'Re-play a one-shot animation whenever a variable changes (e.g. shake on validation error). watchVar must be a JS expression like "variables[\'UUID\']". Use Date.now() as the variable value to guarantee a change on every trigger.',
          properties: {
            type: {
              type: 'string',
              description: 'Animation type to replay. Loop types: pulse | breathe | float | shake | wiggle | wobble | swing | spin | ticker | bounce | heartbeat | flash | ripple | glowPulse | gradientDrift. Or any enter type: fadeIn | slideInUp | slideInDown | slideInLeft | slideInLeftSubtle | slideInRight | riseFade | dropIn | zoomIn | expandIn | bounceIn | flipInX | flipInY | flipIn3D | tiltIn | skewIn | skewInY | blurIn | glowIn | rollIn | revealUp | charFall | charBounce.',
            },
            watchVar: { type: 'string', description: 'JS expression to watch, e.g. "variables[\'UUID\']".' },
            duration: { type: 'number', description: 'Animation duration in ms. Default 500.' },
            easing: { type: 'string', description: 'Optional easing curve.' },
          },
          required: ['type', 'watchVar'],
        },

        // ── Advanced surfaces (nested objects, mirror panel sections) ────────
        tilt: {
          type: 'object',
          description: 'Mouse-follow 3D tilt. Properties: { enabled, maxX, maxY, perspective, scale, duration, reset }.',
        },
        mouseParallax: {
          type: 'object',
          description: 'Cursor-driven parallax shift. Properties: { enabled, strength, axis: "both"|"x"|"y" }.',
        },
        focus: {
          type: 'object',
          description: 'Animated focus ring (form inputs). Properties: { enabled, color, blur, spread, duration }.',
        },
        flip: {
          type: 'object',
          description: 'Card flip. Properties: { trigger: "hover"|"click", duration, perspective }.',
        },
        parallax: {
          type: 'object',
          description: 'Scroll-driven parallax. Properties: { enabled, speed, direction: "vertical"|"horizontal", clamp }.',
        },
        scrollProgress: {
          type: 'object',
          description: 'Scroll-progress driven property animation. Properties: { enabled, property, from, to, unit, start, end, pin, useWindowScroll, rgb }.',
        },
        color: {
          type: 'object',
          description: 'Animated color transition. Properties: { enabled, property, from, to, trigger: "enter"|"loop", duration, easing, loop }.',
        },
        layout: {
          type: 'object',
          description: 'Reanimated layout animation when children reorder. Properties: { enabled, type: "linear"|"spring"|"sequenced"|"fading", duration }.',
        },
        morphShape: {
          type: 'object',
          description: 'Border-radius morph. Properties: { enabled, from, to, steps[], duration, easing, loop }.',
        },
        drag: {
          type: 'object',
          description: 'Drag-and-drop. Properties: { enabled, axis: "both"|"x"|"y", bounds: {top,bottom,left,right}, snapBack, springBack, slotHeight, slotWidth, onDragStart, onDragUpdate, onDragEnd, noVisualMove }. Pair with workflows that read event.translationX/Y/percentX/percentY.',
        },
        splitText: {
          type: 'object',
          description: 'Split text into chars/words/lines and animate each unit. Properties: { text, split: "char"|"word"|"line", type, duration, stagger, delay, easing, className, unitClass }.',
        },
        states: {
          type: 'object',
          description: 'State-machine animation: snapshots interpolated when watchVar changes. Properties: { watchVar (JS expression), duration, easing, defaultState, states: { stateName: { property: value } } }.',
        },
        gesture: {
          type: 'object',
          description: 'Swipe gesture (animation-driven swiper / Tinder card stack). Properties: { enabled, swipe, swipeThreshold, velocityThreshold, onSwipeLeft/Right/Up/Down (workflow ids), animationDuration, dragFeedback, loop }. Pair with cycleIndex action steps to advance an index variable.',
        },
        particles: {
          type: 'object',
          description: 'Particle background effect. Properties: { count, color, background, speed, maxRadius, connectDistance, interactive }.',
        },
        noise: {
          type: 'object',
          description: 'SVG noise filter. Properties: { baseFrequency, numOctaves, opacity, color, animate, animateDuration, type: "fractalNoise"|"turbulence" }.',
        },
        svgStroke: {
          type: 'object',
          description: 'SVG stroke draw-on animation. Properties: { enabled, length, duration, delay, easing, loop }.',
        },
        gradientAnimation: {
          type: 'object',
          description: 'Animated gradient background. Properties: { enabled, type: "linear"|"radial"|"conic", colors[], angle, duration, animateAngle, animateColors, loop }.',
        },
        clipPath: {
          type: 'object',
          description: 'CSS clip-path morph. Properties: { enabled, from, to, trigger: "enter"|"hover"|"always", duration, easing }.',
        },
        mask: {
          type: 'object',
          description: 'CSS mask animation. Properties: { enabled, image, size, position, animateSize, duration, easing }.',
        },
        pseudoElement: {
          type: 'object',
          description: '::before / ::after styling + hover transitions (e.g. animated underlines). Properties: { enabled, target, content, background, width, height, position, top/right/bottom/left, transition, trigger, hoverWidth, hoverOpacity, hoverBackground }.',
        },
        timeline: {
          type: 'array',
          description: 'Multi-step CSS timeline. Array of { property, from, to, startMs, endMs, easing, loop }.',
          items: { type: 'object' },
        },
        customBezier: {
          type: 'array',
          description: 'Cubic-bezier easing override applied to enter/loop. Array of 4 numbers [x1, y1, x2, y2] (each between 0–1).',
          items: { type: 'number' },
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
        trigger: {
          type: 'string',
          enum: ['submit', 'change'],
          description: 'When the rules run. "submit" (default) — only on form submit. "change" — live as the user types.',
        },
        rules: {
          type: 'array',
          description: 'Ordered list of rules. Each rule has type+message; some types require value or formula.',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['required', 'email', 'phone', 'url', 'minLength', 'maxLength', 'pattern', 'formula', 'equalsField'],
                description: 'Rule type. minLength/maxLength → value:number. pattern → value:string regex. formula → formula:"...". equalsField → value:"<otherFieldName>".',
              },
              message: { type: 'string', description: 'Error message shown when this rule fails.' },
              value: { description: 'Rule operand: number for minLength/maxLength, string regex for pattern, string field name for equalsField.' },
              formula: { type: 'string', description: 'Formula expression evaluated for type:"formula". Truthy = valid, falsy = invalid.' },
            },
            required: ['type', 'message'],
          },
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
          description: 'true/false to disable, or a JS expression for conditional disabling.',
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
          enum: ['loading', 'empty', 'default', 'custom', 'none'],
          description: '"loading" = shown during data fetch; "empty" = shown when list is empty; "default" = always shown; "custom" = use customStateName; "none" removes the tag.',
        },
        customStateName: {
          type: 'string',
          description: 'When state="custom", the custom state tag name (free-form string).',
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
        type: {
          type: 'string',
          enum: ['string', 'number', 'boolean', 'object', 'array', 'form'],
          description: 'string, number, boolean, object, array, or form (a structured form-state variable with declared fields[]).',
        },
        initialValue: { description: 'Initial value (ignored for type="form" — use fields[] instead).' },
        variableId: {
          type: 'string',
          description: 'Pre-assign a hex UUID (8-4-4-4-12 format, hex characters only). Use this SAME UUID as variableName in create_workflow changeVariableValue steps and in variables[\'UUID\'] bindings in the same batch.',
        },
        label: { type: 'string', description: 'Optional human-readable label shown in the right panel.' },
        description: { type: 'string', description: 'Optional description for documentation.' },
        saveInLocalStorage: { type: 'boolean', description: 'When true, the variable is persisted to localStorage and rehydrated on page load.' },
        folder: { type: 'string', description: 'Optional folder name. The executor auto-creates the folder if it does not exist.' },
        folderId: { type: 'string', description: 'Optional folder id (use when the folder already exists).' },
        scope: {
          type: 'string',
          enum: ['app', 'page', 'component'],
          description: 'Variable scope. "app" — global app state. "page" (default) — per-page. "component" — local to a shared component (requires componentModelId).',
        },
        componentModelId: { type: 'string', description: 'Required when scope="component" — the SharedComponentModel id this variable belongs to.' },
        fields: {
          type: 'array',
          description: 'For type="form": declared fields [{ name, type: "string"|"number"|"boolean", defaultValue? }].',
          items: { type: 'object' },
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
        type: { type: 'string', enum: ['string', 'number', 'boolean', 'object', 'array', 'form'], description: 'New type.' },
        initialValue: { description: 'New initial value.' },
        label: { type: 'string' },
        description: { type: 'string' },
        saveInLocalStorage: { type: 'boolean' },
        folderId: { type: 'string' },
        fields: { type: 'array', items: { type: 'object' }, description: 'For type="form" — replace the field list.' },
        scope: { type: 'string', enum: ['app', 'page', 'component'] },
        componentModelId: { type: 'string', description: 'Required when scope="component".' },
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
        scope: { type: 'string', enum: ['app', 'page', 'component'], description: 'Optional — required for component-scope vars.' },
        componentModelId: { type: 'string', description: 'Required when scope="component".' },
      },
      required: ['variableId'],
    },
  },
  {
    name: 'update_variable_initial_value',
    description: TOOL_DESCRIPTIONS['update_variable_initial_value'],
    input_schema: {
      type: 'object',
      properties: {
        variableId: { type: 'string' },
        initialValue: { description: 'New initial value.' },
        scope: { type: 'string', enum: ['app', 'page', 'component'] },
        componentModelId: { type: 'string' },
      },
      required: ['variableId'],
    },
  },
  {
    name: 'patch_variable_item',
    description: TOOL_DESCRIPTIONS['patch_variable_item'],
    input_schema: {
      type: 'object',
      properties: {
        variableId: { type: 'string', description: 'Variable ID or name (must be an array variable).' },
        index: { type: 'number', description: 'Zero-based index of the array item to update.' },
        fields: { type: 'object', description: 'Partial object — only these keys are merged into array[index]. All other keys in the item are preserved.' },
      },
      required: ['variableId', 'index', 'fields'],
    },
  },
  {
    name: 'patch_variable_items',
    description: TOOL_DESCRIPTIONS['patch_variable_items'],
    input_schema: {
      type: 'object',
      properties: {
        variableId: { type: 'string', description: 'Variable ID or name (must be an array variable).' },
        updates: {
          type: 'array',
          description: 'List of {index, fields} patches to apply in order.',
          items: {
            type: 'object',
            properties: {
              index: { type: 'number', description: 'Zero-based index of the item.' },
              fields: { type: 'object', description: 'Partial object to merge into that item.' },
            },
            required: ['index', 'fields'],
          },
        },
      },
      required: ['variableId', 'updates'],
    },
  },
  {
    name: 'patch_variable_fields',
    description: TOOL_DESCRIPTIONS['patch_variable_fields'],
    input_schema: {
      type: 'object',
      properties: {
        variableId: { type: 'string', description: 'Variable ID or name (object variable).' },
        fields: { type: 'object', description: 'Top-level keys to merge into the variable\'s initialValue object. Only listed keys change.' },
      },
      required: ['variableId', 'fields'],
    },
  },
  {
    name: 'append_variable_item',
    description: TOOL_DESCRIPTIONS['append_variable_item'],
    input_schema: {
      type: 'object',
      properties: {
        variableId: { type: 'string', description: 'Variable ID or name (must be an array variable).' },
        item: { description: 'New item to push onto the end of the array.' },
      },
      required: ['variableId', 'item'],
    },
  },
  {
    name: 'remove_variable_item',
    description: TOOL_DESCRIPTIONS['remove_variable_item'],
    input_schema: {
      type: 'object',
      properties: {
        variableId: { type: 'string', description: 'Variable ID or name (must be an array variable).' },
        index: { type: 'number', description: 'Zero-based index of the item to remove.' },
      },
      required: ['variableId', 'index'],
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
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method. Default "GET".' },
        endpoint: { type: 'string', description: 'GraphQL endpoint URL (required when type is "graphql").' },
        query: { type: 'string', description: 'GraphQL query string (required when type is "graphql").' },
        variables: {
          type: 'object',
          description: 'GraphQL variables. Pass JSON object.',
        },
        headers: {
          type: 'object',
          description: 'Request headers as a key→value map.',
        },
        body: {
          description: 'Request body (object/string). For REST POST/PUT/PATCH, prefer a JSON object; the executor stringifies it.',
        },
        queryParams: {
          type: 'object',
          description: 'URL query params as key→value map.',
        },
        auth: {
          type: 'object',
          description: 'Auth: { type: "bearer"|"basic"|"apiKey", token?, username?, password?, header? }.',
        },
        responsePath: { type: 'string', description: 'Dot-path inside the response to extract before storing. E.g. "data.products".' },
        storeIn: { type: 'string', description: 'Dot-path key inside the response to expose. E.g. "products" to access as collections[\'id\'].data.products.' },
        trigger: { type: 'string', enum: ['mount', 'action'], description: '"mount" = auto-fetch on page load. "action" = only fetch when a workflow step calls fetchCollection. Default "mount".' },
        triggerActionName: { type: 'string', description: 'Optional named action to bind for trigger="action".' },
        proxy: { type: 'boolean', description: 'When true, route the request through the project proxy (CORS/server-side fetch).' },
        sendCredentials: { type: 'boolean', description: 'When true, include cookies (credentials: "include").' },
        cacheTag: { type: 'string', description: 'GraphQL only — cache invalidation tag.' },
        cacheTTL: { type: 'number', description: 'GraphQL only — cache time-to-live in milliseconds.' },
        cacheKeyVars: {
          type: 'array',
          items: { type: 'string' },
          description: 'GraphQL only — variable names that participate in the cache key.',
        },
        folder: { type: 'string', description: 'Optional folder name. Auto-created if missing.' },
        folderId: { type: 'string', description: 'Optional folder id when the folder already exists.' },
        dataSourceId: { type: 'string', description: 'Optional: pre-assign a short ID like "products-api". Becomes the collections[\'id\'] key in formulas.' },
        schema: {
          type: 'string',
          description: 'TypeScript-like type string describing the response shape at the path exposed via `storeIn`.',
        },
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
  {
    name: 'update_data_source_schema',
    description: TOOL_DESCRIPTIONS['update_data_source_schema'],
    input_schema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'Data source id.' },
        name: { type: 'string' },
        type: { type: 'string', enum: ['rest', 'graphql'] },
        url: { type: 'string' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        endpoint: { type: 'string' },
        query: { type: 'string' },
        variables: { type: 'object' },
        headers: { type: 'object' },
        body: {},
        queryParams: { type: 'object' },
        auth: { type: 'object' },
        responsePath: { type: 'string' },
        storeIn: { type: 'string' },
        trigger: { type: 'string', enum: ['mount', 'action'] },
      },
      required: ['sourceId'],
    },
  },
];

// ─── Global formulas ──────────────────────────────────────────────────────────

const formulaTools: BuilderTool[] = [
  {
    name: 'add_formula',
    description: TOOL_DESCRIPTIONS['add_formula'],
    input_schema: {
      type: 'object',
      properties: {
        formulaId: { type: 'string', description: 'Optional pre-minted id — key in globalFormulas map.' },
        name: { type: 'string', description: 'Display/function name (no spaces).' },
        params: {
          type: 'array',
          description: 'Positional parameters { name, type: Text|Number|Boolean|Object|Array, testValue? }',
          items: { type: 'object' },
        },
        formula: { type: 'string', description: 'Body expression referencing parameters.' },
        folder: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['name', 'formula'],
    },
  },
  {
    name: 'update_formula',
    description: TOOL_DESCRIPTIONS['update_formula'],
    input_schema: {
      type: 'object',
      properties: {
        formulaId: { type: 'string', description: 'Key in globalFormulas.' },
        name: { type: 'string' },
        params: { type: 'array', items: { type: 'object' } },
        formula: { type: 'string' },
        folder: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['formulaId'],
    },
  },
  {
    name: 'update_formula_body',
    description: TOOL_DESCRIPTIONS['update_formula_body'],
    input_schema: {
      type: 'object',
      properties: {
        formulaId: { type: 'string' },
        formula: { type: 'string', description: 'New body only.' },
      },
      required: ['formulaId', 'formula'],
    },
  },
  {
    name: 'delete_formula',
    description: TOOL_DESCRIPTIONS['delete_formula'],
    input_schema: {
      type: 'object',
      properties: { formulaId: { type: 'string' } },
      required: ['formulaId'],
    },
  },
];

const appConfigTools: BuilderTool[] = [
  {
    name: 'set_app_config',
    description: TOOL_DESCRIPTIONS['set_app_config'],
    input_schema: {
      type: 'object',
      properties: {
        projectAppName: { type: 'string' },
        appPreviewData: { type: 'object', description: 'Replace global preview data object when set.' },
        graphqlEndpoint: { type: 'string' },
        graphqlHeaders: { type: 'object' },
        graphqlCredentials: { type: 'string' },
      },
    },
  },
  {
    name: 'create_folder',
    description: TOOL_DESCRIPTIONS['create_folder'],
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['variables', 'workflows', 'data-sources', 'colors'] },
        name: { type: 'string' },
        folderId: { type: 'string', description: 'Optional pre-minted folder id (UUID).' },
        parentId: { type: 'string', description: 'Optional parent folder id.' },
      },
      required: ['kind', 'name'],
    },
  },
  {
    name: 'rename_folder',
    description: TOOL_DESCRIPTIONS['rename_folder'],
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['variables', 'workflows', 'data-sources', 'colors'] },
        folderId: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['kind', 'folderId', 'name'],
    },
  },
  {
    name: 'delete_folder',
    description: TOOL_DESCRIPTIONS['delete_folder'],
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['variables', 'workflows', 'data-sources', 'colors'] },
        folderId: { type: 'string' },
      },
      required: ['kind', 'folderId'],
    },
  },
];

const sharedComponentAuthoringTools: BuilderTool[] = [
  {
    name: 'create_shared_component',
    description: TOOL_DESCRIPTIONS['create_shared_component'],
    input_schema: {
      type: 'object',
      properties: {
        modelId: { type: 'string', description: 'Optional pre-minted model id.' },
        name: { type: 'string' },
        folder: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_shared_component_metadata',
    description: TOOL_DESCRIPTIONS['update_shared_component_metadata'],
    input_schema: {
      type: 'object',
      properties: {
        modelId: { type: 'string' },
        name: { type: 'string' },
        folder: { type: 'string' },
        description: { type: 'string' },
        valueVariable: { type: 'string', description: 'Variable UUID key or empty to clear.' },
      },
      required: ['modelId'],
    },
  },
  {
    name: 'delete_shared_component',
    description: TOOL_DESCRIPTIONS['delete_shared_component'],
    input_schema: {
      type: 'object',
      properties: { modelId: { type: 'string' } },
      required: ['modelId'],
    },
  },
  {
    name: 'update_shared_component_properties',
    description: TOOL_DESCRIPTIONS['update_shared_component_properties'],
    input_schema: {
      type: 'object',
      properties: {
        modelId: { type: 'string' },
        ops: { type: 'array', items: { type: 'object' }, description: '{ op: add|update|remove, property?, propertyId? }' },
      },
      required: ['modelId', 'ops'],
    },
  },
  {
    name: 'update_shared_component_variables',
    description: TOOL_DESCRIPTIONS['update_shared_component_variables'],
    input_schema: {
      type: 'object',
      properties: {
        modelId: { type: 'string' },
        ops: { type: 'array', items: { type: 'object' } },
      },
      required: ['modelId', 'ops'],
    },
  },
  {
    name: 'update_shared_component_formulas',
    description: TOOL_DESCRIPTIONS['update_shared_component_formulas'],
    input_schema: {
      type: 'object',
      properties: {
        modelId: { type: 'string' },
        ops: { type: 'array', items: { type: 'object' } },
      },
      required: ['modelId', 'ops'],
    },
  },
  {
    name: 'update_shared_component_triggers',
    description: TOOL_DESCRIPTIONS['update_shared_component_triggers'],
    input_schema: {
      type: 'object',
      properties: {
        modelId: { type: 'string' },
        ops: { type: 'array', items: { type: 'object' } },
      },
      required: ['modelId', 'ops'],
    },
  },
  {
    name: 'enter_shared_component_edit',
    description: TOOL_DESCRIPTIONS['enter_shared_component_edit'],
    input_schema: {
      type: 'object',
      properties: { modelId: { type: 'string' } },
      required: ['modelId'],
    },
  },
  {
    name: 'exit_shared_component_edit',
    description: TOOL_DESCRIPTIONS['exit_shared_component_edit'],
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_instance_controlled',
    description: TOOL_DESCRIPTIONS['set_instance_controlled'],
    input_schema: {
      type: 'object',
      properties: {
        instanceId: { type: 'string' },
        controlled: { type: 'boolean' },
        varKey: { type: 'string' },
      },
      required: ['instanceId', 'controlled'],
    },
  },
];

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
  {
    name: 'set_theme_mode',
    description: TOOL_DESCRIPTIONS['set_theme_mode'],
    input_schema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['light', 'dark', 'system'],
          description: 'Runtime color mode. "system" follows OS preference.',
        },
      },
      required: ['mode'],
    },
  },
  {
    name: 'apply_theme_preset',
    description: TOOL_DESCRIPTIONS['apply_theme_preset'],
    input_schema: {
      type: 'object',
      properties: {
        presetName: {
          type: 'string',
          description: 'Name of a built-in theme preset (e.g. "Default", "Dark", "Sunset"). Lists are project-defined.',
        },
      },
      required: ['presetName'],
    },
  },
  {
    name: 'add_custom_color',
    description: TOOL_DESCRIPTIONS['add_custom_color'],
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the custom color, e.g. "Brand Coral", "Accent Indigo".' },
        light: { type: 'string', description: 'Light-mode value (hex/rgba).' },
        dark: { type: 'string', description: 'Dark-mode value (hex/rgba).' },
        label: { type: 'string', description: 'Optional UI label (defaults to name).' },
        description: { type: 'string', description: 'Optional documentation note.' },
        folderId: { type: 'string', description: 'Optional color folder id.' },
        colorId: { type: 'string', description: 'Optional pre-minted id for the color (slug or UUID).' },
      },
      required: ['name', 'light', 'dark'],
    },
  },
  {
    name: 'delete_custom_color',
    description: TOOL_DESCRIPTIONS['delete_custom_color'],
    input_schema: {
      type: 'object',
      properties: {
        colorId: { type: 'string', description: 'Custom color id to remove.' },
      },
      required: ['colorId'],
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
        access: {
          type: 'string',
          enum: ['public', 'authenticated', 'guest'],
          description: 'Page access policy. "public" (default) — anyone may view. "authenticated" — only logged-in users (auth.user must be truthy). "guest" — only signed-out users (e.g. login/signup pages). Pair with accessCondition / guestOnly redirects for fine-grained control.',
        },
        accessCondition: {
          type: 'string',
          description: 'Optional JS expression evaluated when access="authenticated". Must return truthy to allow the user. E.g. "auth?.user?.role === \'admin\'".',
        },
        guestOnly: {
          type: 'boolean',
          description: 'When true, this page only renders for guests; logged-in users are redirected to the post-login page. Use for /login or /signup screens.',
        },
        redirectTo: {
          type: 'string',
          description: 'Page id to redirect to when access policy fails (e.g. "/login" for authenticated pages, "/dashboard" for guestOnly pages).',
        },
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
            searchQuery: { type: 'string', description: 'Visual search query for Image/Video nodes OUTSIDE a repeat template.' },
            bgImage: { type: 'string', description: 'Background image search query for Box nodes.' },
            loop: { type: 'boolean', description: 'Set to true on the loop template node (the child that repeats). Image/Video children of a loop template must NOT have searchQuery — declare image needs in the parent variable\'s mediaHints instead.' },
            placeholder: { type: 'string', description: 'Placeholder text for Input/Textarea nodes.' },
            actions: {
              type: 'array',
              description: 'Workflow triggers for this node. One entry per trigger. Mint a UUID per workflowId the same way you mint variable uuids. Only declare actions on truly interactive nodes (buttons, cards that tap, links, inputs). Display-only nodes (output panels, info text, badges) declare none.',
              items: {
                type: 'object',
                properties: {
                  workflowId: { type: 'string', description: 'Pre-assigned hex UUID (8-4-4-4-12) for the workflow stub.' },
                  trigger: { type: 'string', enum: ['click', 'change', 'submit', 'enterKey', 'valueChange', 'mouseEnter', 'mouseLeave'], description: 'For Input/Textarea: use "change" (not "valueChange" — it maps to onValueChange which InputWithField never calls). For send/submit patterns, no change stub is needed at all — the tracker slot variables["{nodeId}-value"] is auto-written every keystroke.' },
                },
                required: ['workflowId', 'trigger'],
              },
            },
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
              mediaHints: {
                type: 'array',
                description: 'For array variables: declare fields that need stock photo search. One entry per image-URL field. The media agent will call patch_variable_items to fill in real URLs.',
                items: {
                  type: 'object',
                  properties: {
                    field:       { type: 'string', description: 'Field name in each array item that holds the image URL, e.g. "avatarUrl", "photoSrc".' },
                    searchQuery: { type: 'string', description: 'Visual description for the stock photo search, e.g. "professional headshot portrait".' },
                  },
                  required: ['field', 'searchQuery'],
                },
              },
            },
            required: ['name', 'type', 'uuid'],
          },
        },
        pageActions: {
          type: 'array',
          description: 'Page-lifecycle workflows. Mint a UUID per workflowId. Only include when the page needs logic at this lifecycle event (e.g. fetch on load). Purely presentational pages omit this.',
          items: {
            type: 'object',
            properties: {
              workflowId: { type: 'string', description: 'Pre-assigned hex UUID (8-4-4-4-12) for the workflow stub.' },
              trigger: { type: 'string', enum: ['pageLoadBefore', 'pageLoad', 'pageUnload', 'scroll', 'resize', 'keydown', 'keyup', 'collectionFetchError'] },
            },
            required: ['workflowId', 'trigger'],
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
        breakpoint: { type: 'string', enum: ['desktop', 'laptop', 'tablet', 'mobile'], description: 'Target responsive breakpoint. Omit or "desktop" for base styles. Set to "tablet" or "mobile" to make styles apply only at that breakpoint and smaller (desktop-first cascade).' },

        // ── Layout (flex/grid direction, alignment) ───────────────────────────
        direction: { type: 'string', enum: ['row', 'column'], description: 'flex-direction — only applies to flex containers. Do NOT combine with gridCols: grid containers ignore flex-direction entirely.' },
        align: { type: 'string', enum: ['items-start', 'items-center', 'items-end', 'items-stretch', 'items-baseline'], description: 'Cross-axis alignment (align-items).' },
        justify: { type: 'string', enum: ['justify-start', 'justify-center', 'justify-end', 'justify-between', 'justify-around', 'justify-evenly'], description: 'Main-axis alignment (justify-content).' },
        self: { type: 'string', enum: ['auto', 'start', 'center', 'end', 'stretch', 'baseline'], description: 'Self cross-axis alignment (align-self).' },
        cursor: { type: 'string', enum: ['pointer', 'default', 'not-allowed', 'grab', 'crosshair', 'text'], description: 'CSS cursor.' },
        gridCols: { description: 'grid-template-columns. Switches container to CSS grid. Integer or fr-unit string (e.g. \'3fr 2fr\').' },
        gridRows: { description: 'Number of grid rows.' },
        gridFlow: { type: 'string', enum: ['row', 'col', 'row-dense', 'col-dense'], description: 'grid-auto-flow direction.' },
        colSpan: { description: 'Number of grid columns this item spans (1-12). Also accepts a JS formula string that evaluates to a number for per-item dynamic span inside a REPEAT.' },
        flexWrap: { type: 'string', enum: ['wrap', 'nowrap', 'wrap-reverse'], description: 'Flex wrap behaviour.' },
        flex: { type: 'number', enum: [1], description: 'Flex-grow. Only 1 is accepted.' },

        // ── Spacing ───────────────────────────────────────────────────────────
        gap: { type: 'number', minimum: 0, description: 'Gap between flex/grid children in px (uniform, e.g. 20). Never pass strings like "20px".' },
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
        textAlign:     { type: 'string', enum: ['left', 'center', 'right', 'justify'], description: 'Text alignment — valid ONLY on Text nodes. Setting this on a Box has NO effect (text-align does not cascade to children).' },
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
        bg:          { type: 'string', description: 'Solid color only — theme token, hex, rgb/rgba. For gradients use the gradient param or bgImage.' },
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
        color: { type: 'string', description: 'Text/icon color — ONLY valid on Text and Heading nodes. NEVER on a Box container — set it on the child Text node directly. Theme token, hex.' },

        // ── Border ────────────────────────────────────────────────────────────
        borderWidth: { description: 'Border width in px (number) or 0 to remove.' },
        borderStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted', 'none'], description: 'Border style.' },
        borderColor: { type: 'string', description: 'Border color — theme token or hex.' },
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
        rotate:     { description: 'Rotation. Pass a plain number for literal degrees (e.g. -8 → rotate(-8deg)). Pass a CSS angle string ("5deg") or a formula/js object (e.g. { formula: "variables[\'UUID\'] + \'deg\'" }) for dynamic values. Any non-number is stored as-is in style.rotate and evaluated at render time.' },
        flipX:      { type: 'boolean', description: 'Flip horizontally (scaleX(-1)).' },
        flipY:      { type: 'boolean', description: 'Flip vertically (scaleY(-1)).' },
        translateX: { description: 'Horizontal translate (number = px or CSS string).' },
        translateY: { description: 'Vertical translate (number = px or CSS string).' },

        // ── Batched responsive overrides ──────────────────────────────────────
        // Use this instead of making 3-4 separate set_style calls per node.
        // Each key is a breakpoint; the value is a style object with the same
        // properties as the base call (excluding nodeId and breakpoints itself).
        breakpoints: {
          type: 'object',
          description: 'Apply responsive overrides for multiple breakpoints in one call. Valid keys: laptop, tablet, mobile ONLY — do NOT include a \'desktop\' key (base/desktop styles go directly on the root call parameters). laptop (≥1024px), tablet (≥768px), mobile (<768px). Base styles (no breakpoint key) apply at desktop — ≥1280px with no upper limit, so they must work at any width. ALWAYS use this instead of making separate set_style calls per breakpoint.',
          properties: {
            laptop: { type: 'object', additionalProperties: true, description: 'Styles applied at laptop breakpoint and smaller.' },
            tablet: { type: 'object', additionalProperties: true, description: 'Styles applied at tablet breakpoint and smaller.' },
            mobile: { type: 'object', additionalProperties: true, description: 'Styles applied at mobile breakpoint and smaller.' },
          },
        },
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
  // Compound styling — single-call multi-property setter
  ...setStyleTool,
  // Behavior — logic, animations, forms
  ...logicTools,
  // State — variables and data sources
  ...variableTools,
  ...dataTools,
  ...formulaTools,
  ...appConfigTools,
  ...sharedComponentAuthoringTools,
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
  // Exclude set_submit (form behavior), set_input_props (input structure) from styling phase
  ...semanticDesignTools
    .filter(t => !['set_submit', 'set_input_props'].includes(t.name)),
  ...layoutTools,
  // Compound styling — preferred for >=3 visual properties at once
  ...setStyleTool,
  ...logicTools.filter(t => ['set_condition', 'set_animation'].includes(t.name)),
  // set_icon_src for Phase 3: icon name only (color/size handled via set_style)
  ...textTools.filter(t => t.name === 'set_icon_src'),
  ...textTools.filter(t => ['set_text', 'set_placeholder'].includes(t.name)),
];

/** Phase W (workflow) tools — runs in parallel with Phase 3 after structure is built. */
export const PHASE_W_TOOLS: BuilderTool[] = [
  ...pageTools.filter(t => t.name === 'switch_page'),
  ...logicTools.filter(t => ['add_workflow_step', 'update_workflow_steps', 'set_workflow_params', 'delete_workflow'].includes(t.name)),
];

// ─── Parallel Agent Tool Collections ─────────────────────────────────────────

/** Structure Agent — builds tree shape + declares variables in one call. */
export const STRUCTURE_AGENT_TOOLS: BuilderTool[] = [
  ...batchTools, // generate_structure (includes variables array)
];

/** Binding Agent — connects data to UI nodes (text, repeat, condition, disabled, icon name).
 *  get_shared_components: needed to read internal node IDs for SC instance overrides.
 *  set_component_props: sets declared property overrides on SC instances (Path 1). */
export const BINDING_AGENT_TOOLS: BuilderTool[] = [
  ...readTools.filter(t => t.name === 'get_shared_components'),
  ...addTools.filter(t => t.name === 'set_component_props'),
  ...textTools.filter(t => ['set_text', 'set_src'].includes(t.name)),
  ...logicTools.filter(t => ['set_condition', 'set_repeat', 'set_disabled'].includes(t.name)),
  ...textTools.filter(t => t.name === 'set_icon_src'),
];

/** Data Agent — owns project-level datasource creation (REST + GraphQL).
 *  Runs in parallel with the per-page UI agents. Predicted dataSourceIds are
 *  passed through from the planner / structure step so binders can reference
 *  collections['…'] in formulas before this agent finishes. */
export const DATA_AGENT_TOOLS: BuilderTool[] = [
  ...readTools.filter(t => ['get_variables', 'get_data_sources'].includes(t.name)),
  ...dataTools, // add_data_source, delete_data_source, update_data_source_schema
];

// ─── Merged Styling Agent Tool Collections ────────────────────────────────────

/** Styling Agent — unified set_style covers ALL visual properties (layout, colors, border, shadow…).
 *  Icon color/size are set via set_style (Icon-specific branch handles props.color + props.size).
 *  Icon name is set by the media/binding agents via set_icon_src — not available here. */
export const STYLING_AGENT_TOOLS: BuilderTool[] = [
  ...setStyleTool,
];

/** Animation Agent — set_animation only.
 *  No read tools: the full page tree chunk is already in the user message. */
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
  // patch_variable_items — used for loop Image/Video nodes to inject real URLs into array variable items
  ...variableTools.filter(t => t.name === 'patch_variable_items'),
];

/** Combined Agent — merges styling + animation + workflows + binding into one agent.
 *  Used when planner picks dispatchMode "combined_per_page" or "global_combined".
 *  Tool surface = union of all four families. Families actually used are controlled
 *  by the system prompt (buildCombinedPageAgentPrompt) and the planner's agents keys. */
export const COMBINED_AGENT_TOOLS: BuilderTool[] = [
  // Read (get_workflows intentionally excluded — combined agents know their workflow names from create_workflow results)
  ...readTools.filter(t => ['get_variables', 'get_formulas'].includes(t.name)),
  // Styling
  ...setStyleTool,
  // Animation
  ...logicTools.filter(t => t.name === 'set_animation'),
  // Workflows
  ...pageTools.filter(t => t.name === 'switch_page'),
  ...logicTools.filter(t => ['create_workflow', 'add_workflow_step', 'bind_action', 'update_workflow_steps', 'set_workflow_params'].includes(t.name)),
  // Binding — set_src included so the agent can bind per-item image sources inside repeat templates
  ...textTools.filter(t => ['set_text', 'set_src', 'set_icon_src'].includes(t.name)),
  ...logicTools.filter(t => ['set_condition', 'set_repeat', 'set_disabled'].includes(t.name)),
];

/** Shared Components Agent — edits EXISTING SC models only (enter/exit scope + primitives).
 *  SC shells are pre-minted by the structure step; this agent is NOT involved in creation.
 *  create_shared_component excluded — this agent never creates SC models.
 *  set_icon_src excluded — icon names are managed by the media/binding agents.
 *  add_shared_component_instance excluded — placement done by structure. */
export const SC_AGENT_TOOLS: BuilderTool[] = [
  ...readTools.filter(t => ['get_shared_components', 'get_variables'].includes(t.name)),
  ...sharedComponentAuthoringTools.filter(t => t.name !== 'create_shared_component'),
  // Primitives allowed inside the enter/exit scope:
  ...addTools.filter(t => t.name === 'add_component'),
  ...setStyleTool,
  ...textTools.filter(t => ['set_text', 'set_src'].includes(t.name)),
  ...logicTools.filter(t => ['set_repeat', 'set_condition', 'set_animation', 'create_workflow', 'add_workflow_step', 'bind_action', 'update_workflow_steps'].includes(t.name)),
];

