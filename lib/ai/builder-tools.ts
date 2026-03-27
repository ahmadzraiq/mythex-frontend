/**
 * Builder Tool Definitions — Anthropic tool_use format.
 *
 * Core design principle: The AI works exactly like a builder user.
 * - It adds components by their palette label ("Card", "Btn Solid", etc.)
 * - It edits text, styles, and props through semantic design tools
 * - It NEVER writes raw JSON — that's the builder's job
 * - For rich AI-generated sections, it calls generate_section() which triggers
 *   the streaming generator that builds the section live on canvas
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
    description: 'Get full details of one or more nodes — all props, className, text, children. Use when you need to see the current state of a specific node before editing it.',
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
    description: 'Add a component to the page by its palette label — exactly like dragging it from the builder\'s left panel. The builder inserts the component template with proper defaults. AI never writes JSON.\n\nBATCH TIP: Provide a short nodeId (e.g. "section-wrap") so you can use it as parentId for child components in the SAME batch of tool calls — no need to wait for the result.',
    input_schema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          enum: COMPONENT_LABELS as unknown as string[],
          description: 'Component palette label. E.g. "Card", "Btn Solid", "Heading", "Image", "HStack".',
        },
        nodeId: {
          type: 'string',
          description: 'Optional: pre-assign a short descriptive ID like "hero-wrap", "features-grid", "cta-btn". Use this same string as parentId for children in the same batch.',
        },
        parentId: {
          type: 'string',
          description: 'ID of the container to add into. Omit to add at the top-level of the current page.',
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
        className: { type: 'string', description: 'Tailwind classes. Default "w-full h-64 object-cover rounded-xl".' },
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
        className: { type: 'string', description: 'Tailwind classes. Default "w-full h-64 rounded-xl".' },
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
    description: 'Set the href/link destination on a Link or Pressable node.',
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
    description: 'Set the source URL on an Image or Video node. Also accepts objectFit, alt (Image), and poster (Video).',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        src: { type: 'string', description: 'New image/video URL.' },
        alt: { type: 'string', description: 'Alt text (Image only).' },
        objectFit: { type: 'string', description: 'Object fit: cover | contain | fill | none | scale-down.' },
        poster: { type: 'string', description: 'Poster image URL (Video only).' },
      },
      required: ['nodeId', 'src'],
    },
  },
  {
    name: 'set_video_props',
    description: 'Set playback and display properties on a Video node without changing the source URL.',
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
// The AI never writes raw Tailwind class strings directly.

const semanticDesignTools: BuilderTool[] = [
  {
    name: 'set_background',
    description: 'Set the background color or image of a node. Use theme variable names ("primary", "card", "muted") or Tailwind color tokens ("blue-600") or hex values ("#1a1a1a").',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        bg: {
          type: 'string',
          description: 'Background color. Theme names: "primary", "card", "background", "muted", "secondary", "accent", "destructive", "foreground". Or: "transparent", "#hex", "blue-600", "var(--theme-*)".',
        },
        bgImage: {
          type: 'string',
          description: 'CSS background-image value, e.g. "url(https://...)" or "linear-gradient(to right, #000, #fff)". Sets backgroundSize:cover and backgroundPosition:center automatically.',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_text_color',
    description: 'Set the text color of a node. Use theme variable names ("foreground", "primary", "muted-foreground") or Tailwind tokens ("gray-900") or hex values.',
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
          enum: ['none', 'tight', 'snug', 'normal', 'relaxed', 'loose'],
          description: 'Line height.',
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
          enum: ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full'],
          description: 'Border radius applied to all four corners.',
        },
        radiusTL: { type: 'string', enum: ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full'], description: 'Top-left corner radius.' },
        radiusTR: { type: 'string', enum: ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full'], description: 'Top-right corner radius.' },
        radiusBR: { type: 'string', enum: ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full'], description: 'Bottom-right corner radius.' },
        radiusBL: { type: 'string', enum: ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full'], description: 'Bottom-left corner radius.' },
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
          enum: ['none', 'sm', 'md', 'lg', 'xl', '2xl', 'inner'],
          description: '"none" removes the shadow.',
        },
      },
      required: ['nodeId', 'shadow'],
    },
  },
  {
    name: 'set_opacity',
    description: 'Set the opacity of a node (0–100).',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        opacity: { type: 'number', description: 'Opacity 0–100. E.g. 50 = 50% transparent, 100 = fully visible.' },
      },
      required: ['nodeId', 'opacity'],
    },
  },
  {
    name: 'set_spacing',
    description: 'Set padding, margin, and/or gap on a node using Tailwind spacing scale values (0–96). Use -1 for "auto" margins.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        p:  { type: 'number', description: 'Padding all sides.' },
        px: { type: 'number', description: 'Horizontal padding (left + right).' },
        py: { type: 'number', description: 'Vertical padding (top + bottom).' },
        pt: { type: 'number', description: 'Padding top.' },
        pr: { type: 'number', description: 'Padding right.' },
        pb: { type: 'number', description: 'Padding bottom.' },
        pl: { type: 'number', description: 'Padding left.' },
        m:  { type: 'number', description: 'Margin all sides. Use -1 for "auto".' },
        mx: { type: 'number', description: 'Horizontal margin. Use -1 for "auto".' },
        my: { type: 'number', description: 'Vertical margin. Use -1 for "auto".' },
        mt: { type: 'number', description: 'Margin top.' },
        mr: { type: 'number', description: 'Margin right.' },
        mb: { type: 'number', description: 'Margin bottom.' },
        ml: { type: 'number', description: 'Margin left.' },
        gap:  { type: 'number', description: 'Gap between flex/grid children.' },
        gapX: { type: 'number', description: 'Horizontal gap between children.' },
        gapY: { type: 'number', description: 'Vertical gap between children.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'set_size',
    description: 'Set width, height, or max-width on a node. Mirrors the builder right panel Hug/Fill/Fixed controls.',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        width: { type: 'string', description: 'Width mode: "full" fills parent (w-full, builder Fill), "fit" wraps content (w-fit, builder Hug), "px:N" for fixed pixels (e.g. "px:320"), or Tailwind token "1/2", "64", etc.' },
        height: { type: 'string', description: 'Height mode: "fill" grows to fill available space in flex parent (flex-1, builder Fill — matches Figma Fill, works in any flex-col container), "screen" full viewport height (h-screen / 100vh — for full-page sections, modals, overlays), "fit" wraps content (h-fit, builder Hug), "px:N" for exact pixels (e.g. "px:400"), "vh:N" for viewport-relative height (e.g. "vh:90" = 90vh). Legacy "full" also maps to flex-1. Use "min-screen" for sections that need AT LEAST full viewport height (min-h-screen).' },
        maxWidth: { type: 'string', enum: ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', 'full', 'screen-sm', 'screen-md', 'screen-lg', 'screen-xl'], description: 'Max-width constraint.' },
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
        top:    { type: 'number', description: 'Top inset in Tailwind spacing scale (0, 1, 2, 4, 8, 16…). Use 0 for "top-0".' },
        right:  { type: 'number', description: 'Right inset.' },
        bottom: { type: 'number', description: 'Bottom inset.' },
        left:   { type: 'number', description: 'Left inset.' },
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
        rotate: { type: 'number', description: 'Rotation degrees. Supported: 0, 1, 2, 3, 6, 12, 45, 90, 180. Negative = counter-clockwise.' },
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
    description: 'Configure a Button\'s action variant (controls Gluestack Button style: primary, secondary, destructive, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        action: {
          type: 'string',
          enum: ['primary', 'secondary', 'destructive', 'positive', 'custom'],
          description: 'Button action variant. "primary" = filled accent style, "secondary" = softer, "destructive" = red/danger, "positive" = green/success, "custom" = no variant injection (use with className).',
        },
      },
      required: ['nodeId', 'action'],
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
          enum: ['text', 'email', 'password', 'number', 'tel', 'url', 'search', 'date'],
          description: 'HTML input type.',
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
        direction: { type: 'string', enum: ['row', 'column'], description: 'flex-row or flex-col.' },
        align: { type: 'string', enum: ['start', 'center', 'end', 'stretch', 'baseline'], description: 'align-items.' },
        justify: { type: 'string', enum: ['start', 'center', 'end', 'between', 'around', 'evenly'], description: 'justify-content.' },
        gap: { type: 'string', description: 'Gap class, e.g. "gap-4", "gap-8".' },
        padding: { type: 'string', description: 'Padding class, e.g. "p-6", "px-8 py-12".' },
        width: { type: 'string', description: 'Width class, e.g. "w-full", "max-w-4xl mx-auto".' },
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
          enum: ['fadeIn', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'scaleIn', 'bounceIn', 'none'],
          description: 'Enter animation (plays on mount). "none" removes it.',
        },
        enterDuration: { type: 'number', description: 'Enter animation duration in ms. Default 300.' },
        exit: {
          type: 'string',
          enum: ['fadeOut', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'scaleOut', 'none'],
          description: 'Exit animation. "none" removes it.',
        },
        exitDuration: { type: 'number', description: 'Exit animation duration in ms. Default 300.' },
        loop: {
          type: 'string',
          enum: ['pulse', 'spin', 'bounce', 'ping', 'glowPulse', 'gradientDrift', 'none'],
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
          enum: ['fadeIn', 'slideUp', 'zoomIn', 'none'],
          description: 'Scroll-triggered enter animation — fires when the element enters the viewport.',
        },
        imperativeTrigger: {
          type: 'object',
          description: 'Trigger the animation imperatively when a variable changes. E.g. to shake on error: { "type": "shake", "watchVar": "variables[\'UUID\']", "duration": 500 }',
          properties: {
            type: { type: 'string', enum: ['shake', 'pulse', 'bounce', 'flash'], description: 'Animation type.' },
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
          description: 'CSS var name without --. E.g. "theme-primary", "theme-background", "theme-shop-button", "font-heading".',
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

export const ALL_BUILDER_TOOLS: BuilderTool[] = [
  // Context first — AI reads before acting
  ...readTools,
  // Generation — rich AI content
  ...generationTools,
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
