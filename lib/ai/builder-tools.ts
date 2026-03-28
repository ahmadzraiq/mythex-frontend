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

export interface BuilderTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

import { ALL_PRIMITIVES } from '@/lib/builder/primitive-components';

// ─── Component Labels (what the AI knows as palette labels) ───────────────────

// Auto-derived from ALL_PRIMITIVES — stays in sync with the builder palette automatically
export const COMPONENT_LABELS: string[] = ALL_PRIMITIVES.map(c => c.label);

// ─── Read / Context Tools ─────────────────────────────────────────────────────

const readTools: BuilderTool[] = [
  {
    name: 'get_page_tree',
    description: 'Read the current page structure — section names, IDs, and types. Call this first when you need to know what already exists on the page before making changes.',
    input_schema: {
      type: 'object',
      properties: {
        depth: { type: 'number', description: 'How many levels deep to include. Default 2 (sections + their direct children). Max 4.' },
      },
    },
  },
  {
    name: 'get_node_details',
    description: 'Get full details of one or more nodes — props, text, children, and other fields as stored in the builder. Use when you need the current state of a specific node before editing it.',
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
    description: 'List all pages in the project with their IDs, names, and routes.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_theme',
    description: 'Get the current theme variable values (colors and fonts).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_variables',
    description: 'List all custom variables defined in the project.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_formula_context',
    description: 'Returns all formula paths available for a given node — exactly what the builder\'s formula picker shows. Includes: custom variables (label → variables[\'UUID\'] path), data sources (label → collections[\'UUID\'].data path), repeat context if the node is inside a repeated container (context.item.data.*), and standard paths (route.*, auth.*, _workflow.*). Call this BEFORE writing any condition, set_repeat mapPath, or text binding so you use the correct paths.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Optional — pass the node you are about to write a formula for, so repeat context is detected from its ancestors.',
        },
      },
    },
  },
  {
    name: 'get_workflows',
    description: 'List all named workflows available in this project (both page-scoped and global). Call this before bind_action to see what workflow names exist and what trigger they use.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_data_sources',
    description: 'List all configured data sources (API collections) in this project. Returns each source\'s id, label, and the path to use in formulas (e.g. "collections[\'UUID\'].data"). Use this before set_repeat or writing any formula that references collection data.',
    input_schema: { type: 'object', properties: {} },
  },
];

// ─── Section Generation (streaming, shows live building on canvas) ─────────────

const generationTools: BuilderTool[] = [
  {
    name: 'generate_section',
    description: 'Generate and stream a new section onto the current page using AI. The section builds live on the canvas — user sees it appearing piece by piece. Use this for any new content section (hero, features, pricing, testimonials, contact, footer, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Section name, e.g. "Hero", "Pricing Plans", "Customer Testimonials", "Contact Form", "Footer".',
        },
        description: {
          type: 'string',
          description: 'What the section should contain and how it should look. Be specific about layout, content, and tone.',
        },
        components: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: suggest which builder components to use. E.g. ["Box", "Image", "Heading", "Text", "Btn Solid"]. If omitted, AI chooses.',
        },
        tone: {
          type: 'string',
          description: 'Optional: 2-4 word visual tone for this specific section. E.g. "bold, impactful", "warm, inviting".',
        },
        layout: {
          type: 'string',
          description: 'Optional: brief layout hint. E.g. "full-width image background with centered overlay text", "3-column card grid".',
        },
        position: {
          type: 'string',
          enum: ['append', 'prepend'],
          description: 'Where to place the section. "append" adds at the bottom (default), "prepend" at the top.',
        },
      },
      required: ['name', 'description'],
    },
  },
  {
    name: 'generate_app',
    description: 'Generate a complete multi-page app from scratch. Creates all pages with sections, applies a theme, and builds content for each page. Use when the user asks to build a full app or website.',
    input_schema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Name for the app.' },
        description: { type: 'string', description: 'Full business description.' },
        mood: { type: 'string', description: 'Design mood: modern, minimal, organic, bold, playful, elegant.' },
        category: { type: 'string', description: 'Business category: restaurant, saas, portfolio, ecommerce, etc.' },
      },
      required: ['description'],
    },
  },
];

// ─── Component Addition (like dragging from the left panel) ───────────────────

const addTools: BuilderTool[] = [
  {
    name: 'add_component',
    description: 'Add a component to the page by its palette label — exactly like dragging it from the builder\'s left panel. The builder inserts the component template with proper defaults. AI never writes JSON. Do NOT use this tool for Image or Video — use add_image / add_video instead; those tools set src (and poster for video) correctly.\n\nBATCH TIP: Pass a short descriptive nodeId (e.g. "section-wrap"). Use that same string as parentId for children in the same batch. After the batch, use the real UUID from the tool result for all subsequent rounds.',
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
          description: 'Optional: short descriptive id for this node (e.g. "section-wrap", "hero-title"). Use this same string as parentId for children in the same batch. After the batch, use the real UUID returned in the result for all future tool calls.',
        },
        parentId: {
          type: 'string',
          description: 'ID of the container to add into. Use either the short alias from the same batch, or the real UUID from a previous round\'s result. Omit to add at the top-level of the current page.',
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
    description: 'Add an icon to the page or inside a container. Use search_icons first to find the right icon name.',
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
    description: 'Add an image to the page. Use search_images first to find a URL, or provide a URL directly.',
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
    description: 'Add a video to the page. Provide a direct video URL.',
    input_schema: {
      type: 'object',
      properties: {
        src: { type: 'string', description: 'Video URL (mp4, webm, etc.).' },
        poster: { type: 'string', description: 'Poster image URL shown before the video plays.' },
        autoPlay: { type: 'boolean', description: 'Auto-play on load. Default false.' },
        loop: { type: 'boolean', description: 'Loop the video. Default false.' },
        muted: { type: 'boolean', description: 'Mute audio. Default true (required for autoPlay in browsers).' },
        controls: { type: 'boolean', description: 'Show playback controls. Default true.' },
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
    description: 'Delete a node (and all its children) by ID.',
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
    description: 'Duplicate a node — creates an identical copy placed after the original.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'move_node_up',
    description: 'Move a node one position up among its siblings (reorder within same parent).',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'move_node_down',
    description: 'Move a node one position down among its siblings (reorder within same parent).',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'move_node',
    description: 'Move a node to a different parent container, optionally at a specific index. Use this for cross-container moves; use move_node_up/move_node_down for same-parent reordering.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node to move.' },
        targetParentId: { type: 'string', description: 'ID of the destination container. Pass the page root container ID to move to top-level.' },
        atIndex: { type: 'number', description: 'Position within the target parent. Omit to append at end.' },
      },
      required: ['nodeId', 'targetParentId'],
    },
  },
  {
    name: 'wrap_in_container',
    description: 'Wrap one or more nodes in a new Box container.',
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
    description: 'Set the text content of a Text, Heading, Button, or any node with a text field.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        text: { type: 'string', description: 'New text. Can include {{variable}} template syntax.' },
      },
      required: ['nodeId', 'text'],
    },
  },
  {
    name: 'set_placeholder',
    description: 'Set the placeholder text on an InputField, Textarea, or Select.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        placeholder: { type: 'string' },
      },
      required: ['nodeId', 'placeholder'],
    },
  },
  {
    name: 'set_href',
    description: 'Set the href/link destination on a Link node.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        href: { type: 'string', description: 'URL or route path, e.g. "/about" or "https://example.com".' },
      },
      required: ['nodeId', 'href'],
    },
  },
  {
    name: 'set_src',
    description: 'Set the source URL on an Image or Video node only (Box ignores src — use add_image / add_component Image for photo layers). Also objectFit, alt (Image), poster (Video). To change objectFit or poster on a Video without changing the URL, use set_video_props instead.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
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
    description: 'Set playback and display properties on a Video node without changing the source URL. IMPORTANT: Video defaults are already correct for ambient/embedded use (autoPlay=true, loop=true, muted=true, controls=false). Only call this tool when the user explicitly asks to change playback behavior — do NOT call it just to add controls or disable autoPlay.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
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
    description: 'Change the icon on an Icon node.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        icon: { type: 'string', description: 'New Iconify icon name, e.g. "lucide:home", "heroicons:star".' },
        size: { type: 'number', description: 'Optional new size in px.' },
        color: { type: 'string', description: 'Optional new color.' },
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
    description: 'Set the background color of a node (solid / theme colors only). Use theme names ("primary", "card", "muted"), named palette shades the panel accepts (e.g. "blue-600"), or hex (e.g. "#1a1a1a"). For photos or full-bleed imagery use add_image or add_component Image + set_src, not this tool.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        bg: {
          type: 'string',
          description: 'Background color. Theme names: "primary", "card", "background", "muted", "secondary", "accent", "destructive", "foreground". Or: "transparent", "#hex", "blue-600", "var(--theme-*)".',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_text_color',
    description: 'Set the text color of a node. Use theme names ("foreground", "primary", "muted-foreground"), named palette shades (e.g. "gray-900"), or hex.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        color: {
          type: 'string',
          description: 'Text color. Theme names: "foreground", "primary", "primary-foreground", "muted-foreground", "card-foreground", "secondary-foreground", "accent-foreground", "destructive". Or: "white", "gray-900", "#hex".',
        },
      },
      required: ['nodeId', 'color'],
    },
  },
  {
    name: 'set_typography',
    description: 'Set text styling — font size, weight, alignment, line height, letter spacing, decoration, and transform. Only pass the properties you want to change; others remain unchanged.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        size: {
          type: 'string',
          enum: ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'],
          description: 'Font size.',
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
    description: 'Set border width, style, color, and/or radius on a node. Only pass the properties you want to change.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        width: {
          type: 'string',
          enum: ['0', '1', '2', '4', '8'],
          description: 'Border width in px. "0" removes border.',
        },
        style: {
          type: 'string',
          enum: ['solid', 'dashed', 'dotted', 'double', 'none'],
          description: 'Border style.',
        },
        color: {
          type: 'string',
          description: 'Border color. Theme names: "border", "primary", "muted". Or: "gray-200", "#hex".',
        },
        radius: {
          type: 'string',
          enum: ['none', 'sm', 'default', 'md', 'lg', 'xl', '2xl', '3xl', 'full'],
          description: 'Border radius applied to all four corners. "default" = small standard radius (matches Design panel).',
        },
        radiusTL: { type: 'string', enum: ['none', 'sm', 'default', 'md', 'lg', 'xl', '2xl', '3xl', 'full'], description: 'Top-left corner radius.' },
        radiusTR: { type: 'string', enum: ['none', 'sm', 'default', 'md', 'lg', 'xl', '2xl', '3xl', 'full'], description: 'Top-right corner radius.' },
        radiusBR: { type: 'string', enum: ['none', 'sm', 'default', 'md', 'lg', 'xl', '2xl', '3xl', 'full'], description: 'Bottom-right corner radius.' },
        radiusBL: { type: 'string', enum: ['none', 'sm', 'default', 'md', 'lg', 'xl', '2xl', '3xl', 'full'], description: 'Bottom-left corner radius.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_shadow',
    description: 'Set the drop shadow on a node.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        shadow: {
          type: 'string',
          enum: ['none', 'sm', 'default', 'md', 'lg', 'xl', '2xl', 'inner'],
          description: '"none" removes the shadow. "default" = medium standard shadow (matches Design panel).',
        },
      },
      required: ['nodeId', 'shadow'],
    },
  },
  {
    name: 'set_opacity',
    description: 'Set the opacity of a node (0–100). Matches the builder panel Opacity slider.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        opacity: { type: 'number', description: 'Opacity 0–100. E.g. 50 = half transparent, 100 = fully visible.' },
      },
      required: ['nodeId', 'opacity'],
    },
  },
  {
    name: 'set_spacing',
    description: 'Set padding, margin, and/or gap on a node in pixels. Matches the builder panel Padding/Margin/Gap number inputs.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
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
    description: 'Set width, height, or size constraints on a node. Mirrors the builder right panel Hug/Fill/Fixed controls and Min/Max W/H fields.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        width: { type: 'string', description: 'Width mode: "fill" grows to take remaining space in the parent container (use for expanding columns in row/horizontal layouts), "full" is 100% of parent width, "fit" shrinks to content size, "screen" is full viewport width, "px:N" sets an exact pixel width (e.g. "px:320"). In multi-column row layouts, at least one column should use "fill" — not "fit" on every column.' },
        height: { type: 'string', description: 'Height mode: "fill" grows to fill remaining space in the parent flex container (use for sidebars, cards — does NOT work on position:absolute nodes), "screen" is full viewport height (use for full-page sections and ALL position:absolute background/overlay layers), "fit" shrinks to content, "px:N" for exact pixels (e.g. "px:400"), "vh:N" for viewport-relative height (e.g. "vh:90"). Use "min-screen" for sections that need at least full viewport height.' },
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
    description: 'Set position type, z-index, and inset (top/right/bottom/left) on a node.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        position: {
          type: 'string',
          enum: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
          description: 'Position type.',
        },
        zIndex: {
          type: 'string',
          enum: ['0', '10', '20', '30', '40', '50', 'auto'],
          description: 'Z-index.',
        },
        top:    { type: 'number', description: 'Top inset in pixels.' },
        right:  { type: 'number', description: 'Right inset in pixels.' },
        bottom: { type: 'number', description: 'Bottom inset in pixels.' },
        left:   { type: 'number', description: 'Left inset in pixels.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_transform',
    description: 'Set rotation, flip (mirror), cursor, overflow, or self-alignment on a node.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        rotate: { type: 'number', description: 'Rotation in degrees (-180 to 180). Any degree value is supported.' },
        flipX: { type: 'boolean', description: 'Flip horizontally (mirror on X axis).' },
        flipY: { type: 'boolean', description: 'Flip vertically (mirror on Y axis).' },
        cursor: {
          type: 'string',
          enum: ['auto', 'default', 'pointer', 'not-allowed', 'grab', 'move', 'text', 'crosshair'],
          description: 'Cursor style on hover.',
        },
        overflow: {
          type: 'string',
          enum: ['auto', 'hidden', 'visible', 'scroll'],
          description: 'Overflow for both axes.',
        },
        overflowX: {
          type: 'string',
          enum: ['auto', 'hidden', 'visible', 'scroll'],
          description: 'Horizontal overflow only.',
        },
        overflowY: {
          type: 'string',
          enum: ['auto', 'hidden', 'visible', 'scroll'],
          description: 'Vertical overflow only.',
        },
        self: {
          type: 'string',
          enum: ['auto', 'start', 'center', 'end', 'stretch', 'baseline'],
          description: 'Self-alignment of this node within its parent flex container.',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_overflow',
    description: 'Clip (or unclip) a node\'s content — mirrors the "Clip content" toggle in the design panel. Use clip:true to add overflow-hidden so child content is clipped to the box boundary; clip:false to remove it. Use this instead of set_transform when you only need to control clipping.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node ID' },
        clip: { type: 'boolean', description: 'true = add overflow-hidden, false = remove overflow-hidden' },
      },
      required: ['nodeId', 'clip'],
    },
  },
  {
    name: 'set_display',
    description: 'Set display mode (flex, grid, block, hidden) and grid-specific properties on a node.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        display: {
          type: 'string',
          enum: ['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'hidden'],
          description: '"hidden" hides the element completely.',
        },
        gridCols: { type: 'number', description: 'Number of grid columns (1–12). Only applies when display is "grid".' },
        gridRows: { type: 'number', description: 'Number of grid rows (1–6). Only applies when display is "grid".' },
        colSpan:  { type: 'number', description: 'How many columns this item spans (1–12). Pass 13 for "col-span-full".' },
        flexWrap: {
          type: 'string',
          enum: ['wrap', 'nowrap', 'wrap-reverse'],
          description: 'Flex wrap behavior.',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_submit',
    description: 'Toggle the form-submit behavior of a Button. Matches the builder Settings panel "Submit" toggle — when enabled the button triggers FormContainer validation and submission.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        submit: { type: 'boolean', description: 'true = button acts as a form submit trigger. false = regular button.' },
      },
      required: ['nodeId', 'submit'],
    },
  },
  {
    name: 'set_input_props',
    description: 'Configure input-specific properties on an Input or InputField node (type, multiline, min/max, maxLength).',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
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
      },
      required: ['nodeId'],
    },
  },
];

// ─── Layout / Spacing ─────────────────────────────────────────────────────────

const layoutTools: BuilderTool[] = [
  {
    name: 'set_layout',
    description: 'Update the flex layout of a container node — direction, alignment, gap, padding. Convenient for layout-only changes without touching other style properties.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        direction: { type: 'string', enum: ['row', 'column'], description: '"row" lays children side by side; "column" stacks them top to bottom.' },
        align: { type: 'string', enum: ['start', 'center', 'end', 'stretch', 'baseline'], description: 'Cross-axis alignment of children (e.g. center = vertically centered in a row).' },
        justify: { type: 'string', enum: ['start', 'center', 'end', 'between', 'around', 'evenly'], description: 'Main-axis distribution of children (e.g. between = space evenly between, center = grouped in center).' },
        gap: { type: 'number', description: 'Gap between children in pixels.' },
      },
      required: ['nodeId'],
    },
  },
];

// ─── Logic / Behavior ─────────────────────────────────────────────────────────

const logicTools: BuilderTool[] = [
  {
    name: 'set_condition',
    description: 'Set or remove a visibility condition on a node. The node is shown when the condition is truthy.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        condition: {
          type: 'string',
          description: 'JS formula string, e.g. "variables[\'UUID\'] === \'active\'" or "!variables[\'UUID\']". Pass empty string "" to remove.',
        },
      },
      required: ['nodeId', 'condition'],
    },
  },
  {
    name: 'set_repeat',
    description: 'Make a node repeat over a list of items (like a for-loop in the builder). The node renders once per item.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        mapPath: { type: 'string', description: 'State path to the array, e.g. "collections.UUID.data.items". Pass "" to remove.' },
        keyField: { type: 'string', description: 'Field to use as React key, e.g. "id".' },
      },
      required: ['nodeId', 'mapPath'],
    },
  },
  {
    name: 'bind_action',
    description: 'Bind a named workflow to a node event (appends to existing bindings — does not replace them). Use get_workflows() first to see what workflow names exist.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        workflowName: { type: 'string', description: 'Name of the workflow to bind, e.g. "onSubmitContactForm".' },
      },
      required: ['nodeId', 'workflowName'],
    },
  },
  {
    name: 'unbind_action',
    description: 'Remove a specific workflow binding from a node without affecting other bindings on that node.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        workflowName: { type: 'string', description: 'Name of the workflow binding to remove.' },
      },
      required: ['nodeId', 'workflowName'],
    },
  },
  {
    name: 'create_workflow',
    description: `Create a new named workflow and optionally bind it to a node. Use for ALL interactive behaviour: incrementing/decrementing counters, toggling state, navigating, showing/hiding elements, submitting forms.

STEP TYPES (use exactly these type strings — same as the builder's Type dropdown):
  changeVariableValue, navigateTo, navigatePrev, branch, multiOptionBranch, forEach, whileLoop,
  breakLoop, continueLoop, setFormState, resetForm, fetchCollection, fetchCollectionsParallel,
  updateCollection, resetVariableValue, timeDelay, graphql, fetchData, copyToClipboard,
  openPopup, closeAllPopups, stopPropagation, customJavaScript, returnValue

Each step must have a unique "id" plus "type" and "config". Examples:
- changeVariableValue: { "id": "s1", "type": "changeVariableValue", "config": { "variableName": "UUID", "value": { "formula": "expr" } } }
  formula examples: "variables['UUID'] + 1"  /  "!variables['UUID']"  /  "'active'"  /  "max(0, variables['UUID'] - 1)"
  Use formula functions (max, min, floor, ceil, clamp, abs, etc.) — the tool validates syntax automatically.
- navigateTo:  { "id": "s1", "type": "navigateTo", "config": { "path": "/route" } }
- timeDelay:   { "id": "s1", "type": "timeDelay", "config": { "ms": 500 } }
- branch:      { "id": "s1", "type": "branch", "config": { "condition": "variables['UUID'] > 0" }, "trueBranch": [...], "falseBranch": [...] }`,
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
    description: 'Delete a named workflow from the project. Use get_workflows() to see existing workflow names.',
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
    description: 'Add or update animation on a node. Only pass the animation types you want to set; others remain unchanged. Pass "none" to clear a specific animation type.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        enter: {
          type: 'string',
          enum: ['none', 'fadeIn', 'slideInUp', 'slideInDown', 'slideInLeft', 'slideInLeftSubtle', 'slideInRight', 'riseFade', 'dropIn', 'zoomIn', 'expandIn', 'bounceIn', 'flipInX', 'flipInY', 'flipIn3D', 'tiltIn', 'skewIn', 'skewInY', 'blurIn', 'glowIn', 'rollIn'],
          description: 'Enter animation (plays on mount). "none" removes it.',
        },
        enterDuration: { type: 'number', description: 'Enter animation duration in ms. Default 300.' },
        exit: {
          type: 'string',
          enum: ['none', 'fadeOut', 'slideOutUp', 'slideOutDown', 'slideOutLeft', 'slideOutRight', 'zoomOut', 'shrinkOut', 'bounceOut', 'flipOutX', 'flipOutY', 'flipOut3D', 'blurOut', 'skewOut', 'rollOut'],
          description: 'Exit animation. "none" removes it.',
        },
        exitDuration: { type: 'number', description: 'Exit animation duration in ms. Default 300.' },
        loop: {
          type: 'string',
          enum: ['none', 'pulse', 'breathe', 'float', 'shake', 'wiggle', 'wobble', 'swing', 'spin', 'ticker', 'bounce', 'heartbeat', 'flash', 'ripple', 'glowPulse', 'gradientDrift'],
          description: 'Continuous loop animation. "none" removes it.',
        },
        hover: {
          type: 'string',
          enum: ['scale', 'lift', 'none'],
          description: 'Hover animation. "scale" = grows slightly, "lift" = moves up.',
        },
        press: {
          type: 'string',
          enum: ['scale', 'bounce', 'none'],
          description: 'Press/active animation that plays when clicked.',
        },
        scroll: {
          type: 'string',
          enum: ['none', 'fadeIn', 'slideInUp', 'slideInDown', 'slideInLeft', 'slideInRight', 'riseFade', 'dropIn', 'zoomIn', 'expandIn', 'bounceIn', 'blurIn'],
          description: 'Scroll-triggered enter animation — fires when the element enters the viewport.',
        },
        imperativeTrigger: {
          type: 'object',
          description: 'Trigger the animation imperatively when a variable changes. E.g. to shake on error: { "type": "shake", "watchVar": "variables[\'UUID\']", "duration": 500 }',
          properties: {
            type: { type: 'string', enum: ['none', 'pulse', 'breathe', 'float', 'shake', 'wiggle', 'wobble', 'swing', 'spin', 'bounce', 'heartbeat', 'flash', 'ripple', 'glowPulse', 'gradientDrift'], description: 'Animation type.' },
            watchVar: { type: 'string', description: 'Formula expression to watch for changes, e.g. "variables[\'UUID\']".' },
            duration: { type: 'number', description: 'Animation duration in ms. Default 500.' },
          },
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_validation',
    description: 'Add form validation rules to an InputField inside a FormContainer.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'InputField node ID.' },
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
    description: 'Set the display name of a node — visible in the Layers panel on the left. Always call this after creating a section container (Box) so it has a meaningful label like "Hero Section" or "Pricing Grid".',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        name: { type: 'string', description: 'Display name, e.g. "Hero Section", "Pricing Card", "Nav Bar".' },
      },
      required: ['nodeId', 'name'],
    },
  },
  {
    name: 'set_disabled',
    description: 'Set the disabled state on a node (e.g. a Button or Input). Pass a boolean or a JS formula string for conditional disabling.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        disabled: {
          description: 'true, false, or a JS formula string e.g. "variables[\'uuid\'] === \'loading\'".',
        },
      },
      required: ['nodeId', 'disabled'],
    },
  },
  {
    name: 'set_loading_state',
    description: 'Set the visibility state tag on a node. Used to show different content based on loading/empty/default states.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
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
    description: 'Create a new project variable. Variables are referenced as variables[\'UUID\'] in conditions and {{variables[\'UUID\']}} in text.\n\nBATCH TIP: Provide a short variableId (e.g. "show-menu") so you can immediately use variables[\'show-menu\'] in set_text, set_condition, and create_workflow calls in the same batch — no round-trip needed.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name, e.g. "Show Modal", "Cart Count".' },
        type: { type: 'string', enum: ['string', 'number', 'boolean', 'object', 'array'] },
        initialValue: { description: 'Initial value.' },
        variableId: {
          type: 'string',
          description: 'Optional: pre-assign a short descriptive ID like "show-modal", "active-tab". Use this same string in variables[\'your-id\'] bindings in the same batch.',
        },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'update_variable',
    description: 'Update an existing variable\'s display name, type, or initial value. Use get_variables() to find the variable ID first.',
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
    description: 'Delete a variable from the project. Make sure no workflows or conditions reference it first.',
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
    description: 'Add a new REST or GraphQL data source to the project. After adding, use the returned id in formulas as collections[\'id\'].data. When trigger is "mount", data auto-fetches on page load.',
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
    description: 'Remove a data source from the project. Use get_data_sources() to find the source ID.',
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
    description: 'Update a theme CSS variable. All components using that variable update automatically.',
    input_schema: {
      type: 'object',
      properties: {
        variable: {
          type: 'string',
          description: 'CSS var name without --. E.g. "theme-primary", "theme-background", "theme-card", "font-heading".',
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
    description: 'Add a new page to the project. The result contains the pageId — use it immediately in switch_page.',
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
    description: 'Switch the builder canvas to a different page.',
    input_schema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'Page ID to switch to.' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'rename_page',
    description: 'Rename a page.',
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
    description: 'Delete a page.',
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
    description: 'Set SEO metadata (title, description, OG image) and/or on-mount workflow for the currently active page.',
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
    description: 'Select a node on the canvas to show the user what was just changed or created.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'undo',
    description: 'Undo the last action.',
    input_schema: { type: 'object', properties: {} },
  },
];

// ─── Asset Search ─────────────────────────────────────────────────────────────

const assetTools: BuilderTool[] = [
  {
    name: 'search_images',
    description: 'Search for stock photos from Unsplash. Returns a list of image URLs. Use the URL with add_image or set_src.',
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
    description: 'Search for stock videos from the project asset library. Returns direct video file URLs. Always use this before add_video — never hardcode a video URL.',
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
    description: 'Search for icons from Iconify. Returns icon names like "lucide:coffee". Use with add_icon or set_icon.',
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

// ─── All Tools (in priority order) ───────────────────────────────────────────

/** Tools for the builder chat AI — excludes generationTools (raw JSON pipeline removed) */
export const ALL_BUILDER_TOOLS: BuilderTool[] = [
  // Context first — AI reads before acting
  ...readTools,
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

export const TOOL_NAMES = ALL_BUILDER_TOOLS.map(t => t.name);

export function getBuilderTool(name: string): BuilderTool | undefined {
  return ALL_BUILDER_TOOLS.find(t => t.name === name);
}
