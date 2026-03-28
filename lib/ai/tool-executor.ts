/**
 * Tool Executor — maps AI tool calls to builder Zustand store actions.
 *
 * Design: The AI uses semantic builder actions, never raw JSON.
 * - add_component("Card") → looks up COMPONENT_SCHEMA["Card"] → inserts template
 * - set_text(id, "Hello") → patchProp(id, "text", "Hello")
 * - set_background(id, {bg:"primary"}) → resolves to bg-[var(--theme-primary)], patches className
 * - generate_section(...) → signals the streaming generator (handled at API level)
 *
 * All node mutations auto-push to history via the store actions.
 */

import type { SDUINode } from '@/lib/sdui/types/node';
import type { BuilderStore, CustomVar, DataSourceConfig } from '@/app/dev/builder/_store-types';
import { COMPONENT_SCHEMA } from './sdui-component-schema';
import { ALL_PRIMITIVES } from '@/lib/builder/primitive-components';
import { FORMULA_FNS } from '@/lib/sdui/formula-functions';
import { replaceTwToken, removeTwToken } from '@/app/dev/builder/_tw-utils';

export type ToolInput = Record<string, unknown>;

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type StoreGetter = () => BuilderStore;

// ─── Formula validator ────────────────────────────────────────────────────────
// Returns an error message string if the formula is invalid, or null if valid.
// Used by create_workflow so the AI receives an error and self-corrects rather
// than relying on fragile "NEVER" prompt instructions.

const KNOWN_FN_NAMES = new Set(Object.keys(FORMULA_FNS));

function validateFormula(expr: string): string | null {
  // Detect Math.* usage (Math.max, Math.floor, etc.)
  if (/\bMath\s*\./.test(expr)) {
    const matches = expr.match(/\bMath\s*\.\s*(\w+)/g) ?? [];
    const names = matches.map(m => m.replace(/\bMath\s*\.\s*/, ''));
    const suggestions = names.map(n => {
      const lower = n.toLowerCase();
      const found = [...KNOWN_FN_NAMES].find(k => k.toLowerCase() === lower);
      return found ? `Math.${n}() → ${found}()` : `Math.${n}() (not available as a formula function)`;
    });
    return `Formula uses JavaScript globals (${matches.join(', ')}). Use the formula functions directly instead: ${suggestions.join('; ')}. Available math functions: ${[...KNOWN_FN_NAMES].filter(k => ['abs','ceil','floor','round','max','min','clamp','pow','sqrt','mod','sum'].includes(k)).join(', ')}.`;
  }
  return null;
}

// Validates all changeVariableValue formula steps in a workflow.
// Returns an error string if any step has an invalid formula, or null if all pass.
function validateWorkflowFormulas(steps: Array<Record<string, unknown>>): string | null {
  for (const step of steps) {
    if (step.type !== 'changeVariableValue') continue;
    const cfg = step.config as Record<string, unknown> | undefined;
    const value = cfg?.value as Record<string, unknown> | undefined;
    if (typeof value?.formula === 'string') {
      const err = validateFormula(value.formula);
      if (err) return `Step "${step.id ?? '?'}": ${err}`;
    }
  }
  return null;
}

// ─── UUID ────────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

function isUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// ─── Assign UUIDs to all nodes in a tree ─────────────────────────────────────

function assignIds(node: Record<string, unknown>): Record<string, unknown> {
  if (!node.id) node.id = uuid();
  if (Array.isArray(node.children)) {
    node.children = (node.children as Record<string, unknown>[]).map(c => assignIds(c));
  }
  return node;
}

// ─── Get template from COMPONENT_SCHEMA ──────────────────────────────────────

function getTemplate(label: string): SDUINode | null {
  const schema = COMPONENT_SCHEMA[label];
  if (!schema) return null;
  try {
    const node = JSON.parse(schema) as Record<string, unknown>;
    const templateNode = assignIds(node) as unknown as SDUINode;

    // Strip behaviour is declared on the component itself via `aiStrip` — no hardcoded lists here.
    const primitive = ALL_PRIMITIVES.find(c => c.label === label);
    if (primitive?.aiStrip && templateNode.children?.length) {
      const stripped =
        primitive.aiStrip === 'all'
          ? []
          : (templateNode.children as SDUINode[]).filter(
              (c: SDUINode) => c.type !== 'Heading' && c.type !== 'Text'
            );
      (templateNode as unknown as Record<string, unknown>).children = stripped;
    }

    return templateNode;
  } catch {
    return null;
  }
}

// ─── Find node in tree ───────────────────────────────────────────────────────

function findNode(nodes: SDUINode[], id: string): SDUINode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const found = findNode(n.children as SDUINode[], id);
      if (found) return found;
    }
  }
  return null;
}

// ─── Check if a node has an ancestor with a map field (repeat context) ───────

function checkAncestorHasMap(nodes: SDUINode[], targetId: string, ancestors: SDUINode[] = []): boolean {
  for (const n of nodes) {
    const path = [...ancestors, n];
    if (n.id === targetId) {
      return path.some(a => !!a.map);
    }
    if (n.children?.length) {
      if (checkAncestorHasMap(n.children as SDUINode[], targetId, path)) return true;
    }
  }
  return false;
}

// ─── Summarize node for context reads ────────────────────────────────────────

function summarizeNode(n: SDUINode, depth: number): unknown {
  const node = n as unknown as Record<string, unknown>;
  const base: Record<string, unknown> = {
    id: n.id,
    type: n.type,
    name: node.name,
    text: typeof node.text === 'string' ? (node.text as string).slice(0, 80) : undefined,
    className: (n.props as { className?: string })?.className?.slice(0, 100),
  };
  if (depth > 0 && n.children?.length) {
    base.children = (n.children as SDUINode[]).map(c => summarizeNode(c, depth - 1));
  } else if (n.children?.length) {
    base.childCount = n.children.length;
  }
  return base;
}

// ─── Apply set_layout helper ─────────────────────────────────────────────────

function buildLayoutClass(input: ToolInput, current = ''): string {
  let cls = current;

  if (input.direction === 'row') {
    cls = cls.replace(/\bflex-col\b/g, '').trim();
    if (!cls.includes('flex-row')) cls += ' flex-row';
  } else if (input.direction === 'column') {
    cls = cls.replace(/\bflex-row\b/g, '').trim();
    if (!cls.includes('flex-col')) cls += ' flex-col';
  }

  if (input.align)   cls = replaceTwToken(cls, 'items-', `items-${input.align}`);
  if (input.justify) cls = replaceTwToken(cls, 'justify-', `justify-${input.justify}`);
  // gap is handled via inline style (written after buildLayoutClass via patchNodeStyle in set_layout executor)

  // Process padding and width in a single pass (no early returns — both can be set together)
  if (input.padding) {
    cls = cls.split(' ').filter(t => !/^p[xyblrt]?-/.test(t)).join(' ');
    cls += ` ${input.padding}`;
  }
  if (input.width) {
    const widthVal = input.width as string;
    cls = cls.split(' ').filter(t => !/^(w-|max-w-|mx-)/.test(t)).join(' ');
    cls += ` ${widthVal}`;
    // max-w-* always needs mx-auto to actually center — add it automatically
    if (/^max-w-/.test(widthVal) && !widthVal.includes('mx-auto')) {
      cls += ' mx-auto';
    }
  }

  return cls.replace(/\s+/g, ' ').trim();
}

// ─── Semantic design helpers ──────────────────────────────────────────────────

function getNodeClassName(store: BuilderStore, nodeId: string): string {
  const node = findNode(store.pageNodes as SDUINode[], nodeId);
  return (node?.props as { className?: string })?.className ?? '';
}

function setNodeClassName(store: BuilderStore, nodeId: string, cls: string): void {
  store.patchProp(nodeId, 'props.className', cls.replace(/\s+/g, ' ').trim());
}

// Helper: read the node's current inline style object.
function getNodeStyle(store: BuilderStore, nodeId: string): Record<string, unknown> {
  const node = findNode(store.pageNodes as SDUINode[], nodeId);
  return { ...((node?.props as { style?: Record<string, unknown> })?.style ?? {}) };
}

// Helper: write back inline style, dropping any keys that are now empty strings.
// This mirrors the builder right panel's behaviour: setting a property to '' removes it.
function patchNodeStyle(store: BuilderStore, nodeId: string, patch: Record<string, string>): void {
  const existing = getNodeStyle(store, nodeId);
  const merged = { ...existing, ...patch };
  const clean = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== '' && v != null));
  store.patchProp(nodeId, 'props.style', clean);
}

// Helper: remove specific keys from props.style entirely (no empty-string residue).
function removeNodeStyleKeys(store: BuilderStore, nodeId: string, keys: string[]): void {
  const existing = getNodeStyle(store, nodeId);
  const keySet = new Set(keys);
  const clean = Object.fromEntries(Object.entries(existing).filter(([k]) => !keySet.has(k)));
  store.patchProp(nodeId, 'props.style', clean);
}

// Map friendly color names to CSS-variable Tailwind classes.
// prefix: 'bg' | 'text' | 'border'
function resolveColorClass(value: string, prefix: 'bg' | 'text' | 'border'): string {
  const THEME_NAMES: Record<string, string> = {
    primary:              `${prefix}-[var(--theme-primary)]`,
    'primary-foreground': `${prefix}-[var(--theme-primary-foreground)]`,
    secondary:            `${prefix}-[var(--theme-secondary)]`,
    'secondary-foreground': `${prefix}-[var(--theme-secondary-foreground)]`,
    card:                 `${prefix}-[var(--theme-card)]`,
    'card-foreground':    `${prefix}-[var(--theme-card-foreground)]`,
    background:           `${prefix}-[var(--theme-background)]`,
    foreground:           `${prefix}-[var(--theme-foreground)]`,
    muted:                `${prefix}-[var(--theme-muted)]`,
    'muted-foreground':   `${prefix}-[var(--theme-muted-foreground)]`,
    accent:               `${prefix}-[var(--theme-accent)]`,
    'accent-foreground':  `${prefix}-[var(--theme-accent-foreground)]`,
    destructive:          `${prefix}-[var(--theme-destructive)]`,
    border:               `${prefix}-[var(--theme-border)]`,
    transparent:          `${prefix}-transparent`,
  };
  if (THEME_NAMES[value]) return THEME_NAMES[value];
  // Already a full class with this prefix
  if (value.startsWith(`${prefix}-`)) return value;
  // CSS variable or rgb() — wrap in arbitrary
  if (value.startsWith('var(') || value.startsWith('rgb(') || value.startsWith('hsl(')) {
    return `${prefix}-[${value}]`;
  }
  // Hex value — wrap in arbitrary
  if (value.startsWith('#')) return `${prefix}-[${value}]`;
  // Tailwind color token like "blue-600", "gray-900"
  return `${prefix}-${value}`;
}

// Remove text color tokens while preserving size, alignment, and decoration tokens.
function stripTextColorTokens(cls: string): string {
  const TEXT_NON_COLOR = /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl|left|center|right|justify|start|end|inherit|current|transparent|wrap|nowrap|balance|pretty|ellipsis|clip|truncate)$/;
  return cls
    .split(/\s+/)
    .filter(t => {
      const bare = t.startsWith('!') ? t.slice(1) : t;
      if (!bare.startsWith('text-')) return true;
      return TEXT_NON_COLOR.test(bare);
    })
    .join(' ');
}

// Strip border color tokens while preserving width/style tokens.
function stripBorderColorTokens(cls: string): string {
  const BORDER_NON_COLOR = /^border(-[0-9]+|-solid|-dashed|-dotted|-double|-none|-[xytrblse](-[0-9]+)?|(-[xytrblse])?-opacity-[0-9]+)?$/;
  return cls
    .split(/\s+/)
    .filter(t => {
      const bare = t.startsWith('!') ? t.slice(1) : t;
      if (!bare.startsWith('border-')) return true;
      return BORDER_NON_COLOR.test(bare);
    })
    .join(' ');
}

// Replace or add a specific token group (e.g. all text-size tokens).
// Strips each pattern from `patterns` and appends `newToken` (if not empty).
/**
 * Remove an exact class token — unlike removeTwToken which uses prefix matching
 * (e.g. "flex" prefix removes "flex-col"), this removes only the exact class.
 * Uses space/start/end anchors so "flex" never matches "flex-col" or "flex-row".
 */
function removeExactToken(cls: string, token: string): string {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cls
    .replace(new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function replaceTokenGroup(cls: string, patterns: string[], newToken: string): string {
  let result = cls;
  for (const p of patterns) {
    result = removeExactToken(result, p);
  }
  return newToken ? `${result} ${newToken}`.replace(/\s+/g, ' ').trim() : result.replace(/\s+/g, ' ').trim();
}

const TEXT_SIZE_PREFIXES = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl', 'text-4xl', 'text-5xl', 'text-6xl', 'text-7xl', 'text-8xl', 'text-9xl'];
const TEXT_ALIGN_PREFIXES = ['text-left', 'text-center', 'text-right', 'text-justify'];
const FONT_WEIGHT_PREFIXES = ['font-thin', 'font-extralight', 'font-light', 'font-normal', 'font-medium', 'font-semibold', 'font-bold', 'font-extrabold', 'font-black'];
const LEADING_PREFIXES = ['leading-none', 'leading-tight', 'leading-snug', 'leading-normal', 'leading-relaxed', 'leading-loose'];
const TRACKING_PREFIXES = ['tracking-tighter', 'tracking-tight', 'tracking-normal', 'tracking-wide', 'tracking-wider', 'tracking-widest'];
const DECORATION_TOKENS = ['underline', 'no-underline', 'line-through', 'overline'];
const TRANSFORM_TOKENS = ['uppercase', 'lowercase', 'capitalize', 'normal-case'];
const ITALIC_TOKENS = ['italic', 'not-italic'];
const SHADOW_PREFIXES = ['shadow-none', 'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl', 'shadow-2xl', 'shadow-inner', 'shadow'];
const OPACITY_PREFIXES = ['opacity-0', 'opacity-5', 'opacity-10', 'opacity-20', 'opacity-25', 'opacity-30', 'opacity-40', 'opacity-50', 'opacity-60', 'opacity-70', 'opacity-75', 'opacity-80', 'opacity-90', 'opacity-95', 'opacity-100'];
const POSITION_TOKENS = ['static', 'relative', 'absolute', 'fixed', 'sticky'];
const Z_PREFIXES = ['z-0', 'z-10', 'z-20', 'z-30', 'z-40', 'z-50', 'z-auto'];
const OVERFLOW_PREFIXES = ['overflow-auto', 'overflow-hidden', 'overflow-visible', 'overflow-scroll'];
const OVERFLOW_X_PREFIXES = ['overflow-x-auto', 'overflow-x-hidden', 'overflow-x-visible', 'overflow-x-scroll'];
const OVERFLOW_Y_PREFIXES = ['overflow-y-auto', 'overflow-y-hidden', 'overflow-y-visible', 'overflow-y-scroll'];
const CURSOR_PREFIXES = ['cursor-auto', 'cursor-default', 'cursor-pointer', 'cursor-not-allowed', 'cursor-grab', 'cursor-move', 'cursor-text', 'cursor-crosshair'];
const SELF_PREFIXES = ['self-auto', 'self-start', 'self-center', 'self-end', 'self-stretch', 'self-baseline'];
const DISPLAY_TOKENS = ['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'hidden'];
const ROUNDED_PREFIXES = ['rounded-none', 'rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl', 'rounded-2xl', 'rounded-3xl', 'rounded-full', 'rounded'];
const BORDER_WIDTH_PREFIXES = ['border-0', 'border-2', 'border-4', 'border-8', 'border'];
const BORDER_STYLE_PREFIXES = ['border-solid', 'border-dashed', 'border-dotted', 'border-double', 'border-none'];

// Spacing token for a scale value. Returns "auto" for -1, else the scale value.
function spacingToken(prefix: string, value: number): string {
  if (value === -1) return `${prefix}-auto`;
  return `${prefix}-${value}`;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

type Handler = (input: ToolInput, getStore: StoreGetter) => Promise<ToolResult> | ToolResult;

const handlers: Record<string, Handler> = {

  // ── Context reads ──────────────────────────────────────────────────────────

  get_page_tree(input, getStore) {
    const store = getStore();
    const depth = Math.min(Number(input.depth ?? 2), 4);
    const summary = store.pageNodes.map(n => summarizeNode(n, depth));
    return { success: true, data: {
      pageId: store.currentPageId,
      pageName: store.pages.find(p => p.id === store.currentPageId)?.name,
      sections: summary,
    }};
  },

  get_node_details(input, getStore) {
    const store = getStore();
    const ids = input.nodeIds as string[];
    const nodes = ids.map(id => findNode(store.pageNodes, id)).filter(Boolean);
    return { success: true, data: nodes.map(n => summarizeNode(n!, 3)) };
  },

  get_pages(_, getStore) {
    const store = getStore();
    return { success: true, data: store.pages.map(p => ({ id: p.id, name: p.name, route: p.route })) };
  },

  get_theme(_, getStore) {
    const store = getStore();
    return { success: true, data: { light: store.themeOverrides, dark: store.themeDarkOverrides } };
  },

  get_variables(_, getStore) {
    const store = getStore();
    return { success: true, data: store.customVars };
  },

  get_formula_context(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string | undefined;

    const variables = (store.customVars ?? []).map((cv: CustomVar) => ({
      label: cv.label ?? cv.name,
      path: `variables['${cv.id ?? cv.name}']`,
      type: cv.type ?? 'string',
      initialValue: cv.initialValue,
    }));

    const dataSources = (store.pageDataSources ?? []).map((ds: DataSourceConfig) => ({
      label: ds._label ?? ds.name ?? ds.id,
      path: `collections['${ds.id}'].data`,
      id: ds.id,
    }));

    let repeatContext = null;
    if (nodeId) {
      const hasRepeat = checkAncestorHasMap(store.pageNodes, nodeId);
      if (hasRepeat) {
        repeatContext = {
          path: 'context.item.data',
          note: 'This node is inside a repeated container. Use context.item.data.fieldName to access each item\'s fields in text templates ({{context.item.data.name}}) or formulas (context?.item?.data?.name).',
        };
      }
    }

    const standard = [
      { label: 'Route params', examples: ['route.slug', 'route.q', 'route.page'] },
      { label: 'Auth state', examples: ['auth.user', 'auth.token', 'auth.isLoggedIn'] },
      { label: 'Workflow result', examples: ['_workflow.lastError', '_workflow.lastAction'] },
    ];

    return { success: true, data: { variables, dataSources, repeatContext, standard } };
  },

  get_workflows(_, getStore) {
    const store = getStore();
    // Include both page-scoped and global workflows
    const pageWfs = Object.entries(store.pageWorkflows ?? {}).map(([name]) => ({
      name,
      trigger: store.pageWorkflowMeta?.[name]?.trigger ?? 'click',
      scope: 'page',
    }));
    const globalWfs = Object.entries(store.globalWorkflows ?? {}).map(([name]) => ({
      name,
      trigger: store.globalWorkflowMeta?.[name]?.trigger ?? 'click',
      scope: 'global',
    }));
    return { success: true, data: [...pageWfs, ...globalWfs] };
  },

  get_data_sources(_, getStore) {
    const store = getStore();
    return {
      success: true,
      data: (store.pageDataSources ?? []).map((ds: DataSourceConfig) => ({
        id: ds.id,
        label: ds._label ?? ds.name ?? ds.id,
        path: `collections['${ds.id}'].data`,
      })),
    };
  },

  // ── Generation (signal to API layer — not executed client-side) ────────────

  generate_section(input) {
    return { success: true, data: { _generationRequest: 'generate_section', ...input } };
  },

  generate_app(input) {
    return { success: true, data: { _generationRequest: 'generate_app', ...input } };
  },

  // ── Add component (palette-based, no JSON) ─────────────────────────────────

  add_component(input, getStore) {
    const store = getStore();
    const label = input.label as string;
    const template = getTemplate(label);

    if (!template) {
      return { success: false, error: `Unknown component label: "${label}". Available: ${Object.keys(COMPONENT_SCHEMA).join(', ')}` };
    }

    const requestedId = (input.nodeId as string | undefined)
      ?? (input._assignedNodeId as string | undefined);
    // Use the requested id only when it is a valid UUID (canonical path). Non-UUID strings
    // fall back to assignIds; executeTools may map alias → real id for same-batch parentId
    // resolution, but prompts should use real UUIDs for nodeId/parentId.
    if (requestedId && isUUID(requestedId)) {
      (template as unknown as Record<string, unknown>).id = requestedId;
    }

    // Defensive: models often pass src with add_component("Image"); apply it so the URL is not dropped.
    if (label === 'Image' && input.src) {
      (template as unknown as Record<string, unknown>).src = input.src;
    }

    const parentId = (input.parentId as string | null) ?? null;
    const atIdx = input.atIndex as number | undefined;

    // Guard: if parentId is given but doesn't exist in the current page, the node would be
    // silently dropped (insertNode returns the unchanged tree). Return an error so the AI
    // can call get_page_tree to get valid IDs and retry.
    if (parentId && !findNode(store.pageNodes as SDUINode[], parentId)) {
      return { success: false, error: `Parent node "${parentId}" not found in the current page. Call get_page_tree first to get valid node IDs, or omit parentId to add at the page root.` };
    }

    store.addNode(template, parentId, atIdx);

    return { success: true, data: { nodeId: template.id, type: (template as { type?: string }).type, message: `Added ${label} with nodeId ${template.id}` } };
  },

  add_icon(input, getStore) {
    const store = getStore();
    const nodeId = (input._assignedNodeId as string | undefined) ?? uuid();
    const parentId = (input.parentId as string | null) ?? null;
    if (parentId && !findNode(store.pageNodes as SDUINode[], parentId)) {
      return { success: false, error: `Parent node "${parentId}" not found in the current page. Call get_page_tree first to get valid node IDs, or omit parentId to add at the page root.` };
    }
    const node = {
      id: nodeId,
      type: 'Icon',
      props: {
        icon: input.icon as string,
        width: (input.size as number) || 24,
        height: (input.size as number) || 24,
        color: (input.color as string) || 'currentColor',
      },
    } as unknown as SDUINode;
    store.addNode(node, parentId);
    return { success: true, data: { nodeId, message: `Added icon "${input.icon}"` } };
  },

  add_image(input, getStore) {
    const store = getStore();
    const nodeId = (input._assignedNodeId as string | undefined) ?? uuid();
    const parentId = (input.parentId as string | null) ?? null;
    if (parentId && !findNode(store.pageNodes as SDUINode[], parentId)) {
      return { success: false, error: `Parent node "${parentId}" not found in the current page. Call get_page_tree first to get valid node IDs, or omit parentId to add at the page root.` };
    }
    const node = {
      id: nodeId,
      type: 'Image',
      src: input.src as string,
      props: {
        alt: (input.alt as string) || '',
        className: (input.className as string) || 'w-full rounded-xl',
      },
    } as unknown as SDUINode;
    store.addNode(node, parentId);
    return { success: true, data: { nodeId, message: 'Added image' } };
  },

  add_video(input, getStore) {
    const store = getStore();
    const nodeId = (input._assignedNodeId as string | undefined) ?? uuid();
    const parentId = (input.parentId as string | null) ?? null;
    if (parentId && !findNode(store.pageNodes as SDUINode[], parentId)) {
      return { success: false, error: `Parent node "${parentId}" not found in the current page. Call get_page_tree first to get valid node IDs, or omit parentId to add at the page root.` };
    }
    const node = {
      id: nodeId,
      type: 'Video',
      props: {
        src: input.src as string,
        ...(input.poster ? { poster: input.poster as string } : {}),
        autoPlay: (input.autoPlay as boolean) ?? true,
        loop:     (input.loop as boolean) ?? true,
        muted:    (input.muted as boolean) ?? true,
        controls: (input.controls as boolean) ?? false,
        objectFit: (input.objectFit as string) || 'cover',
        className: (input.className as string) || 'w-full h-64 rounded-xl',
      },
    } as unknown as SDUINode;
    store.addNode(node, parentId);
    return { success: true, data: { nodeId, message: 'Added video' } };
  },

  // ── Structure ──────────────────────────────────────────────────────────────

  delete_node(input, getStore) {
    const store = getStore();
    store.deleteNodes([input.nodeId as string]);
    return { success: true, data: { message: `Deleted node "${input.nodeId}"` } };
  },

  duplicate_node(input, getStore) {
    const store = getStore();
    store.duplicateNodes([input.nodeId as string]);
    return { success: true, data: { message: 'Duplicated node' } };
  },

  move_node_up(input, getStore) {
    const store = getStore();
    store.moveNodeUp(input.nodeId as string);
    return { success: true, data: { message: 'Moved up' } };
  },

  move_node_down(input, getStore) {
    const store = getStore();
    store.moveNodeDown(input.nodeId as string);
    return { success: true, data: { message: 'Moved down' } };
  },

  move_node(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const targetParentId = input.targetParentId as string;
    const atIndex = (input.atIndex as number | undefined) ?? 0;
    store.moveNode(nodeId, targetParentId, atIndex);
    return { success: true, data: { message: `Moved node to "${targetParentId}" at index ${atIndex}` } };
  },

  wrap_in_container(input, getStore) {
    const store = getStore();
    const ids = input.nodeIds as string[];
    const direction = (input.direction as string) || 'column';
    const cls = direction === 'row'
      ? 'flex flex-row items-center gap-4 w-full'
      : 'flex flex-col gap-4 w-full';
    store.groupNodes(ids);
    const wrapperId = store.selectedIds[0];
    if (wrapperId) {
      store.patchProp(wrapperId, 'props.className', cls);
    }
    return { success: true, data: { wrapperId, message: `Wrapped ${ids.length} node(s) in a ${direction} container` } };
  },

  // ── Text / Content ─────────────────────────────────────────────────────────

  set_text(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const text = input.text as string;

    const TEXT_CHILD_TYPES = new Set(['Text', 'RadioLabel', 'CheckboxLabel']);
    const node = findNode(store.pageNodes as SDUINode[], nodeId);
    // Redirect to a single text-type child when the node itself has no `text` property
    // (handles button-like Box wrappers, etc.)
    if (node && !('text' in node) && Array.isArray(node.children)) {
      const textChildren = (node.children as SDUINode[]).filter(c => TEXT_CHILD_TYPES.has(c.type));
      if (textChildren.length === 1 && textChildren[0].id) {
        store.patchProp(textChildren[0].id, 'text', text);
        return { success: true, data: { message: `Set text to "${text.slice(0, 50)}" (via child ${textChildren[0].type})` } };
      }
    }

    store.patchProp(nodeId, 'text', text);
    return { success: true, data: { message: `Set text to "${text.slice(0, 50)}"` } };
  },

  set_placeholder(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const placeholder = input.placeholder as string;
    // Input is now a flat node (InputWithField) — set placeholder directly on it
    store.patchProp(nodeId, 'props.placeholder', placeholder);
    return { success: true, data: { message: `Set placeholder` } };
  },

  set_href(input, getStore) {
    const store = getStore();
    store.patchProp(input.nodeId as string, 'props.href', input.href);
    return { success: true, data: { message: `Set href to "${input.href}"` } };
  },

  set_src(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const node = findNode(store.pageNodes as SDUINode[], nodeId);
    // Box/HStack/etc. ignore props.src — only Image/Video render a URL. Without this guard,
    // set_src "succeeds" but nothing appears on canvas (common AI hero pattern: Box + set_src).
    const nodeType = node?.type as string | undefined;
    if (!node || (nodeType !== 'Image' && nodeType !== 'Video')) {
      return {
        success: false,
        error:
          'set_src only works on Image or Video nodes. Add an Image (add_component label "Image" or add_image), then call set_src. For a full-bleed photo behind content, use an Image layer with absolute positioning and object-cover — do not use set_background for image URLs.',
      };
    }
    // Image nodes store URL at top-level src; Video uses props.src
    if (nodeType === 'Image') {
      if (input.src !== undefined) store.patchProp(nodeId, 'src', input.src);
    } else {
      if (input.src !== undefined) store.patchProp(nodeId, 'props.src', input.src);
    }
    if (input.alt        !== undefined) store.patchProp(nodeId, 'props.alt',       input.alt);
    if (input.objectFit  !== undefined) store.patchProp(nodeId, 'props.objectFit', input.objectFit);
    if (input.poster     !== undefined) store.patchProp(nodeId, 'props.poster',    input.poster);
    return { success: true, data: { message: 'Updated source' } };
  },

  set_icon(input, getStore) {
    const store = getStore();
    store.patchProp(input.nodeId as string, 'props.icon', input.icon);
    if (input.size) {
      store.patchProp(input.nodeId as string, 'props.width', input.size);
      store.patchProp(input.nodeId as string, 'props.height', input.size);
    }
    if (input.color) store.patchProp(input.nodeId as string, 'props.color', input.color);
    return { success: true, data: { message: `Changed icon to "${input.icon}"` } };
  },

  set_video_props(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    if (input.poster    !== undefined) store.patchProp(nodeId, 'props.poster',    input.poster);
    if (input.autoPlay  !== undefined) store.patchProp(nodeId, 'props.autoPlay',  input.autoPlay);
    if (input.loop      !== undefined) store.patchProp(nodeId, 'props.loop',      input.loop);
    if (input.muted     !== undefined) store.patchProp(nodeId, 'props.muted',     input.muted);
    if (input.controls  !== undefined) store.patchProp(nodeId, 'props.controls',  input.controls);
    if (input.objectFit !== undefined) store.patchProp(nodeId, 'props.objectFit', input.objectFit);
    return { success: true, data: { message: 'Updated video properties' } };
  },

  // ── Semantic Design Tools ──────────────────────────────────────────────────

  set_background(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    let cls = getNodeClassName(store, nodeId);

    if (input.bg != null) {
      const bgVal = input.bg as string;
      const bgClass = resolveColorClass(bgVal, 'bg');
      cls = replaceTwToken(cls, 'bg-', bgClass);
      // Remove any residual inline backgroundColor — class is the single source of truth
      removeNodeStyleKeys(store, nodeId, ['backgroundColor']);
    }

    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: 'Updated background' } };
  },

  set_text_color(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const colorClass = resolveColorClass(input.color as string, 'text');

    // Apply color to the text child when the node itself has no `text` property
    // (handles button-like Box wrappers, etc.)
    const WRAPPER_TEXT_CHILD_TYPES = new Set(['Text', 'RadioLabel', 'CheckboxLabel']);
    const node = findNode(store.pageNodes as SDUINode[], nodeId);
    if (node && !('text' in node) && Array.isArray(node.children)) {
      const textChildren = (node.children as SDUINode[]).filter(c => WRAPPER_TEXT_CHILD_TYPES.has(c.type));
      if (textChildren.length === 1 && textChildren[0].id) {
        const textChild = textChildren[0];
        let childCls = getNodeClassName(store, textChild.id);
        childCls = stripTextColorTokens(childCls);
        childCls = `${childCls} ${colorClass}`.replace(/\s+/g, ' ').trim();
        patchNodeStyle(store, textChild.id, { color: '' });
        setNodeClassName(store, textChild.id, childCls);
        return { success: true, data: { message: `Set text color to "${input.color}" (via child ${textChild.type})` } };
      }
    }

    let cls = getNodeClassName(store, nodeId);
    cls = stripTextColorTokens(cls);
    cls = `${cls} ${colorClass}`.replace(/\s+/g, ' ').trim();
    // Clear inline color so the Tailwind class wins
    patchNodeStyle(store, nodeId, { color: '' });
    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: `Set text color to "${input.color}"` } };
  },

  set_typography(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    let cls = getNodeClassName(store, nodeId);

    if (input.size)     cls = replaceTokenGroup(cls, TEXT_SIZE_PREFIXES, `text-${input.size}`);
    if (input.weight)   cls = replaceTokenGroup(cls, FONT_WEIGHT_PREFIXES, `font-${input.weight}`);
    if (input.align)    cls = replaceTokenGroup(cls, TEXT_ALIGN_PREFIXES, `text-${input.align}`);
    if (input.leading)  cls = replaceTokenGroup(cls, LEADING_PREFIXES, `leading-${input.leading}`);
    if (input.tracking) cls = replaceTokenGroup(cls, TRACKING_PREFIXES, `tracking-${input.tracking}`);

    if (input.italic !== undefined) {
      cls = replaceTokenGroup(cls, ITALIC_TOKENS, input.italic ? 'italic' : 'not-italic');
    }
    if (input.decoration) {
      const newDec = input.decoration === 'none' ? 'no-underline' : input.decoration as string;
      cls = replaceTokenGroup(cls, DECORATION_TOKENS, input.decoration === 'none' ? '' : newDec);
      if (input.decoration === 'none') cls = `${cls} no-underline`.trim();
    }
    if (input.transform) {
      cls = replaceTokenGroup(cls, TRANSFORM_TOKENS, input.transform === 'none' ? 'normal-case' : input.transform as string);
    }

    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: 'Updated typography' } };
  },

  set_border(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    let cls = getNodeClassName(store, nodeId);

    if (input.width != null) {
      const w = String(input.width);
      const token = w === '0' ? 'border-0' : w === '1' ? 'border' : `border-${w}`;
      cls = replaceTokenGroup(cls, BORDER_WIDTH_PREFIXES, token);
    }
    if (input.style) {
      cls = replaceTokenGroup(cls, BORDER_STYLE_PREFIXES, `border-${input.style}`);
    }
    if (input.color) {
      const borderColorClass = resolveColorClass(input.color as string, 'border');
      cls = stripBorderColorTokens(cls);
      cls = `${cls} ${borderColorClass}`.replace(/\s+/g, ' ').trim();
    }
    if (input.radius) {
      const r = input.radius as string;
      const token = r === 'none' ? 'rounded-none' : r === 'default' ? 'rounded' : `rounded-${r}`;
      cls = replaceTokenGroup(cls, ROUNDED_PREFIXES, token);
    }
    // Per-corner radii
    const corners = [
      ['radiusTL', 'rounded-tl'],
      ['radiusTR', 'rounded-tr'],
      ['radiusBR', 'rounded-br'],
      ['radiusBL', 'rounded-bl'],
    ] as const;
    for (const [key, prefix] of corners) {
      if (input[key]) {
        const val = input[key] as string;
        const token = val === 'none' ? `${prefix}-none` : val === 'default' ? prefix : `${prefix}-${val}`;
        cls = replaceTwToken(cls, `${prefix}-`, token);
      }
    }

    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: 'Updated border' } };
  },

  set_shadow(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    let cls = getNodeClassName(store, nodeId);
    const shadow = input.shadow as string;
    const token = shadow === 'none' ? '' : shadow === 'default' ? 'shadow' : `shadow-${shadow}`;
    cls = replaceTokenGroup(cls, SHADOW_PREFIXES, token);
    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: shadow === 'none' ? 'Removed shadow' : `Set shadow to "${shadow}"` } };
  },

  set_opacity(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    let cls = getNodeClassName(store, nodeId);
    const value = Math.min(100, Math.max(0, Number(input.opacity)));
    // Write to style.opacity (0–1 float) — matches the builder panel's patchStyle behaviour
    const opacityFloat = value >= 100 ? '' : String(value / 100);
    // Clear any Tailwind opacity-* class that would conflict
    cls = cls.split(' ').filter(t => !/^opacity-/.test(t)).join(' ').replace(/\s+/g, ' ').trim();
    patchNodeStyle(store, nodeId, { opacity: opacityFloat });
    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: `Set opacity to ${value}%` } };
  },

  set_spacing(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    let cls = getNodeClassName(store, nodeId);

    const toPx = (n: number) => `${n}px`;

    // Helper: strip the bare p-* or m-* shorthand (e.g. p-4, m-8) when individual
    // sides are being set. The shorthand sets all four sides and would conflict with
    // per-side arbitrary values (e.g. p-4 alongside pt-[96px] is confusing noise).
    const stripPShorthand = (c: string) => c.split(' ').filter(t => !/^p-/.test(t)).join(' ').trim();
    const stripMShorthand = (c: string) => c.split(' ').filter(t => !/^-?m-/.test(t)).join(' ').trim();
    // Helper: write an arbitrary Tailwind token only when value > 0; for 0 just strip.
    const setTok = (c: string, stripRe: RegExp, token: string, val: number) => {
      c = c.split(' ').filter(t => !stripRe.test(t)).join(' ').trim();
      return val !== 0 ? `${c} ${token}`.trim() : c;
    };

    // Padding — write as arbitrary Tailwind classes, never inline style.
    // When value is 0 we only strip (zero padding = no class needed).
    if (input.p != null) {
      const n = input.p as number;
      cls = cls.split(' ').filter(t => !/^p[xyblrt]?-/.test(t)).join(' ').trim();
      if (n !== 0) {
        const v = toPx(n);
        cls = `${cls} pt-[${v}] pr-[${v}] pb-[${v}] pl-[${v}]`.trim();
      }
    }
    if (input.px != null) {
      const n = input.px as number;
      cls = stripPShorthand(cls.split(' ').filter(t => !/^p[xlr]-/.test(t)).join(' ').trim());
      if (n !== 0) cls = `${cls} pl-[${toPx(n)}] pr-[${toPx(n)}]`.trim();
    }
    if (input.py != null) {
      const n = input.py as number;
      cls = stripPShorthand(cls.split(' ').filter(t => !/^p[ybt]-/.test(t)).join(' ').trim());
      if (n !== 0) cls = `${cls} pt-[${toPx(n)}] pb-[${toPx(n)}]`.trim();
    }
    if (input.pt != null) { cls = setTok(stripPShorthand(cls), /^pt-/, `pt-[${toPx(input.pt as number)}]`, input.pt as number); }
    if (input.pr != null) { cls = setTok(stripPShorthand(cls), /^pr-/, `pr-[${toPx(input.pr as number)}]`, input.pr as number); }
    if (input.pb != null) { cls = setTok(stripPShorthand(cls), /^pb-/, `pb-[${toPx(input.pb as number)}]`, input.pb as number); }
    if (input.pl != null) { cls = setTok(stripPShorthand(cls), /^pl-/, `pl-[${toPx(input.pl as number)}]`, input.pl as number); }

    // Margin — same pattern
    if (input.m != null) {
      const n = input.m as number;
      cls = cls.split(' ').filter(t => !/^-?m[xyblrt]?-/.test(t)).join(' ').trim();
      if (n !== 0) {
        const v = toPx(n);
        cls = `${cls} mt-[${v}] mr-[${v}] mb-[${v}] ml-[${v}]`.trim();
      }
    }
    if (input.mx != null) {
      const n = input.mx as number;
      cls = stripMShorthand(cls.split(' ').filter(t => !/^-?m[xlr]-/.test(t)).join(' ').trim());
      if (n !== 0) cls = `${cls} ml-[${toPx(n)}] mr-[${toPx(n)}]`.trim();
    }
    if (input.my != null) {
      const n = input.my as number;
      cls = stripMShorthand(cls.split(' ').filter(t => !/^-?m[ybt]-/.test(t)).join(' ').trim());
      if (n !== 0) cls = `${cls} mt-[${toPx(n)}] mb-[${toPx(n)}]`.trim();
    }
    if (input.mt != null) { cls = setTok(stripMShorthand(cls), /^-?mt-/, `mt-[${toPx(input.mt as number)}]`, input.mt as number); }
    if (input.mr != null) { cls = setTok(stripMShorthand(cls), /^-?mr-/, `mr-[${toPx(input.mr as number)}]`, input.mr as number); }
    if (input.mb != null) { cls = setTok(stripMShorthand(cls), /^-?mb-/, `mb-[${toPx(input.mb as number)}]`, input.mb as number); }
    if (input.ml != null) { cls = setTok(stripMShorthand(cls), /^-?ml-/, `ml-[${toPx(input.ml as number)}]`, input.ml as number); }

    // Gap — arbitrary classes; value 0 = just strip (no gap-[0px] noise)
    if (input.gap  != null) { cls = setTok(cls.split(' ').filter(t => !/^gap-/.test(t)).join(' ').trim(),   /^gap-/,   `gap-[${toPx(input.gap  as number)}]`, input.gap  as number); }
    if (input.gapX != null) { cls = setTok(cls.split(' ').filter(t => !/^gap-x-/.test(t)).join(' ').trim(), /^gap-x-/, `gap-x-[${toPx(input.gapX as number)}]`, input.gapX as number); }
    if (input.gapY != null) { cls = setTok(cls.split(' ').filter(t => !/^gap-y-/.test(t)).join(' ').trim(), /^gap-y-/, `gap-y-[${toPx(input.gapY as number)}]`, input.gapY as number); }

    // Strip any residual inline spacing styles that used to be written by the old path
    removeNodeStyleKeys(store, nodeId, [
      'paddingTop','paddingRight','paddingBottom','paddingLeft','paddingBlock','paddingInline',
      'marginTop','marginRight','marginBottom','marginLeft',
      'gap','columnGap','rowGap',
    ]);
    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: 'Updated spacing' } };
  },

  set_size(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    let cls = getNodeClassName(store, nodeId);

    if (input.width != null) {
      const w = input.width as string;
      if (w === 'fill') {
        // w-full: matches exactly what the panel's Width "Fill" button writes.
        cls = cls.split(' ').filter(t => !/^w-/.test(t) && !/^grow$/.test(t) && !/^min-w-/.test(t)).join(' ').trim();
        cls = `${cls} w-full`.trim();
      } else if (w.startsWith('px:')) {
        const px = w.slice(3);
        cls = cls.split(' ').filter(t => !/^flex-1/.test(t)).join(' ').trim();
        cls = replaceTwToken(cls, 'w-', `w-[${px}px]`);
        // Ensure min-width:0 class so the element doesn't overflow flex parents
        cls = cls.split(' ').filter(t => !/^min-w-/.test(t)).join(' ').trim();
        cls = `${cls} min-w-[0px]`.trim();
      } else {
        cls = cls.split(' ').filter(t => !/^flex-1/.test(t)).join(' ').trim();
        cls = replaceTwToken(cls, 'w-', `w-${w}`);
        // Remove any stale min-w arbitrary value when switching to named mode
        cls = cls.split(' ').filter(t => !/^min-w-\[0/.test(t)).join(' ').trim();
      }
    }
    if (input.height != null) {
      const h = input.height as string;
      if (h === 'min-screen') {
        cls = replaceTwToken(cls, 'min-h-', 'min-h-screen');
      } else if (h === 'fill' || h === 'full') {
        // Fill = flex-1 (grows in flex parent, like Figma Fill)
        cls = removeTwToken(removeTwToken(removeTwToken(cls, 'h-'), 'flex-1'), 'min-h-');
        cls = `${cls} flex-1`.trim();
      } else if (h === 'screen') {
        cls = removeTwToken(removeTwToken(removeTwToken(cls, 'h-'), 'flex-1'), 'min-h-');
        cls = `${cls} h-screen`.trim();
      } else if (h.startsWith('vh:')) {
        // vh unit: Tailwind arbitrary class h-[Nvh]
        const vhVal = h.slice(3);
        cls = removeTwToken(removeTwToken(removeTwToken(cls, 'h-fit'), 'h-screen'), 'flex-1');
        cls = `${cls} h-[${vhVal}vh]`.trim();
      } else if (h.startsWith('px:')) {
        // Exact pixel height — class only
        const px = h.slice(3);
        cls = removeTwToken(removeTwToken(removeTwToken(cls, 'h-'), 'flex-1'), 'min-h-');
        cls = `${cls} h-[${px}px]`.trim();
      } else {
        const token = `h-${h}`;
        cls = removeTwToken(removeTwToken(removeTwToken(cls, 'h-'), 'flex-1'), 'min-h-');
        cls = replaceTwToken(cls, 'h-', token);
      }
    }
    if (input.maxWidth != null) {
      const px = Number(input.maxWidth);
      cls = cls.split(' ').filter(t => !/^max-w-/.test(t)).join(' ').trim();
      if (px > 0) cls = `${cls} max-w-[${px}px]`.trim();
    }
    if (input.minWidth != null) {
      const px = Number(input.minWidth);
      cls = cls.split(' ').filter(t => !/^min-w-/.test(t)).join(' ').trim();
      if (px > 0) cls = `${cls} min-w-[${px}px]`.trim();
    }
    if (input.maxHeight != null) {
      const px = Number(input.maxHeight);
      cls = cls.split(' ').filter(t => !/^max-h-/.test(t)).join(' ').trim();
      if (px > 0) cls = `${cls} max-h-[${px}px]`.trim();
    }
    if (input.minHeight != null) {
      const px = Number(input.minHeight);
      cls = cls.split(' ').filter(t => !/^min-h-/.test(t)).join(' ').trim();
      if (px > 0) cls = `${cls} min-h-[${px}px]`.trim();
    }

    // Strip any residual inline size styles that used to be written by the old path
    removeNodeStyleKeys(store, nodeId, ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight']);
    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: 'Updated size' } };
  },

  set_position(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    let cls = getNodeClassName(store, nodeId);

    if (input.position) cls = replaceTokenGroup(cls, POSITION_TOKENS, input.position as string);
    if (input.zIndex) {
      const zVal = String(input.zIndex);
      const twZScale = new Set(['0', '10', '20', '30', '40', '50', 'auto']);
      const zCls = twZScale.has(zVal) ? `z-${zVal}` : `z-[${zVal}]`;
      cls = replaceTokenGroup(cls, Z_PREFIXES, zCls);
    }

    // Inset: write as arbitrary Tailwind classes, not inline style
    if (input.top    != null) { cls = cls.split(' ').filter(t => !/^top-/.test(t)).join(' ').trim();    cls = `${cls} top-[${input.top}px]`.trim(); }
    if (input.right  != null) { cls = cls.split(' ').filter(t => !/^right-/.test(t)).join(' ').trim();  cls = `${cls} right-[${input.right}px]`.trim(); }
    if (input.bottom != null) { cls = cls.split(' ').filter(t => !/^bottom-/.test(t)).join(' ').trim(); cls = `${cls} bottom-[${input.bottom}px]`.trim(); }
    if (input.left   != null) { cls = cls.split(' ').filter(t => !/^left-/.test(t)).join(' ').trim();   cls = `${cls} left-[${input.left}px]`.trim(); }

    // Strip any residual inline inset styles
    removeNodeStyleKeys(store, nodeId, ['top', 'right', 'bottom', 'left']);
    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: 'Updated position' } };
  },

  set_transform(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    let cls = getNodeClassName(store, nodeId);
    const stylePatch: Record<string, string> = {};

    if (input.rotate != null) {
      const deg = Number(input.rotate);
      // Write to style.transform (matches the panel's patchStyle behaviour — any degree value supported)
      stylePatch.transform = deg === 0 ? '' : `rotate(${deg}deg)`;
      // Clear any Tailwind rotate-* class that would conflict
      cls = cls.split(' ').filter(t => !/^-?rotate-/.test(t)).join(' ').replace(/\s+/g, ' ').trim();
    }
    if (input.flipX !== undefined) {
      cls = removeTwToken(cls, 'scale-x-');
      cls = removeTwToken(cls, '-scale-x-');
      cls = `${cls} ${input.flipX ? '-scale-x-100' : 'scale-x-100'}`.trim();
      stylePatch.transform = '';
    }
    if (input.flipY !== undefined) {
      cls = removeTwToken(cls, 'scale-y-');
      cls = removeTwToken(cls, '-scale-y-');
      cls = `${cls} ${input.flipY ? '-scale-y-100' : 'scale-y-100'}`.trim();
      stylePatch.transform = '';
    }
    if (input.cursor)    cls = replaceTokenGroup(cls, CURSOR_PREFIXES, `cursor-${input.cursor}`);
    if (input.overflow)  cls = replaceTokenGroup(cls, OVERFLOW_PREFIXES, `overflow-${input.overflow}`);
    if (input.overflowX) cls = replaceTokenGroup(cls, OVERFLOW_X_PREFIXES, `overflow-x-${input.overflowX}`);
    if (input.overflowY) cls = replaceTokenGroup(cls, OVERFLOW_Y_PREFIXES, `overflow-y-${input.overflowY}`);
    if (input.self)      cls = replaceTokenGroup(cls, SELF_PREFIXES, `self-${input.self}`);

    if (Object.keys(stylePatch).length > 0) patchNodeStyle(store, nodeId, stylePatch);
    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: 'Updated transform/display properties' } };
  },

  set_overflow(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    let cls = getNodeClassName(store, nodeId);
    if (input.clip) {
      if (!cls.includes('overflow-hidden')) cls = `${cls} overflow-hidden`.trim();
    } else {
      cls = cls.split(' ').filter(t => t !== 'overflow-hidden').join(' ').trim();
    }
    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: (input.clip as boolean) ? 'Clipping enabled (overflow-hidden)' : 'Clipping removed' } };
  },

  set_display(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    let cls = getNodeClassName(store, nodeId);

    if (input.display)  cls = replaceTokenGroup(cls, DISPLAY_TOKENS, input.display as string);
    if (input.gridCols) cls = replaceTwToken(cls, 'grid-cols-', `grid-cols-${input.gridCols}`);
    if (input.gridRows) cls = replaceTwToken(cls, 'grid-rows-', `grid-rows-${input.gridRows}`);
    if (input.colSpan) {
      const span = input.colSpan as number;
      cls = replaceTwToken(cls, 'col-span-', span > 12 ? 'col-span-full' : `col-span-${span}`);
    }
    if (input.flexWrap) cls = replaceTokenGroup(cls, ['flex-wrap', 'flex-nowrap', 'flex-wrap-reverse'], `flex-${input.flexWrap}`);

    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: 'Updated display' } };
  },

  set_submit(input, getStore) {
    const store = getStore();
    // Toggle props.type='submit' — mirrors the builder Settings panel "Submit" toggle
    store.patchProp(input.nodeId as string, 'props.type', input.submit ? 'submit' : null);
    return { success: true, data: { message: input.submit ? 'Set button as form submit' : 'Cleared button submit type' } };
  },

  set_input_props(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    // Input is now a flat node (InputWithField) — set props directly on it
    const targetId = nodeId;

    if (input.type) {
      if (input.type === 'decimal') {
        // "decimal" maps to type=number with step=0.01 — matches the builder panel behaviour
        store.patchProp(targetId, 'props.type', 'number');
        store.patchProp(targetId, 'props.step', '0.01');
      } else {
        store.patchProp(targetId, 'props.type', input.type);
      }
    }
    if (input.multiline !== undefined) store.patchProp(targetId, 'props.multiline', input.multiline);
    if (input.rows)      store.patchProp(targetId, 'props.rows', input.rows);
    if (input.min != null) store.patchProp(targetId, 'props.min', input.min);
    if (input.max != null) store.patchProp(targetId, 'props.max', input.max);
    if (input.maxLength) store.patchProp(targetId, 'props.maxLength', input.maxLength);
    return { success: true, data: { message: 'Updated input properties' } };
  },

  // ── Layout ─────────────────────────────────────────────────────────────────

  set_layout(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const node = findNode(store.pageNodes, nodeId);
    const current = (node?.props as { className?: string })?.className ?? '';
    let updated = buildLayoutClass(input, current);
    // gap is a pixel number — write as arbitrary Tailwind class, not inline style
    if (input.gap != null) {
      updated = updated.split(' ').filter(t => !/^gap(-[xy])?-/.test(t)).join(' ').replace(/\s+/g, ' ').trim();
      updated = `${updated} gap-[${input.gap}px]`.trim();
      removeNodeStyleKeys(store, nodeId, ['gap', 'columnGap', 'rowGap']);
    }
    store.patchProp(nodeId, 'props.className', updated);
    return { success: true, data: { message: 'Updated layout' } };
  },

  // ── Logic ──────────────────────────────────────────────────────────────────

  set_condition(input, getStore) {
    const store = getStore();
    const condition = input.condition as string | undefined;
    const condValue = condition ? (condition as unknown as object) : null;
    store.patchCondition(input.nodeId as string, condValue);
    return { success: true, data: { message: condition ? `Set condition` : 'Removed condition' } };
  },

  set_repeat(input, getStore) {
    const store = getStore();
    const mapPath = input.mapPath as string;
    store.patchMap(input.nodeId as string, mapPath || null, input.keyField as string | undefined);
    return { success: true, data: { message: mapPath ? `Set repeat over "${mapPath}"` : 'Removed repeat' } };
  },

  bind_action(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const workflowName = input.workflowName as string;
    const node = findNode(store.pageNodes as SDUINode[], nodeId);
    const existing = Array.isArray(node?.actions) ? [...(node.actions as Array<{ action: string }>)] : [];
    // Append only if not already bound
    if (!existing.some(a => a.action === workflowName)) {
      const updated = [...existing, { action: workflowName }];
      store.patchActions(nodeId, updated as unknown as Record<string, unknown>);
    }
    return { success: true, data: { message: `Bound workflow "${workflowName}" to node` } };
  },

  unbind_action(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const workflowName = input.workflowName as string;
    const node = findNode(store.pageNodes as SDUINode[], nodeId);
    const existing = Array.isArray(node?.actions) ? [...(node.actions as Array<{ action: string }>)] : [];
    const updated = existing.filter(a => a.action !== workflowName);
    store.patchActions(nodeId, updated as unknown as Record<string, unknown>);
    return { success: true, data: { message: `Unbound workflow "${workflowName}" from node` } };
  },

  create_workflow(input, getStore) {
    const store = getStore();
    const name = input.name as string;
    const trigger = (input.trigger as string) ?? 'click';
    const rawSteps = input.steps as Array<Record<string, unknown>>;

    const steps = rawSteps.map((s, i) => ({
      id: s.id ?? `step-${i + 1}`,
      ...s,
    }));

    const formulaError = validateWorkflowFormulas(steps);
    if (formulaError) {
      return { success: false, error: formulaError };
    }

    store.setPageWorkflow(name, steps);
    store.setPageWorkflowMeta(name, { id: name, name, trigger });

    if (input.bindToNodeId) {
      const nodeId = input.bindToNodeId as string;
      const findNodeLocal = (nodes: SDUINode[], id: string): SDUINode | null => {
        for (const n of nodes) {
          if (n.id === id) return n;
          if (Array.isArray(n.children)) {
            const found = findNodeLocal(n.children as SDUINode[], id);
            if (found) return found;
          }
        }
        return null;
      };
      const node = findNodeLocal(store.pageNodes as SDUINode[], nodeId);
      const existing = Array.isArray(node?.actions) ? [...(node.actions as unknown[])] : [];
      const newActions = [...existing, { action: name }];
      store.patchActions(nodeId, newActions as unknown as Record<string, unknown>);
    }

    return {
      success: true,
      data: {
        name,
        trigger,
        stepCount: steps.length,
        message: `Created workflow "${name}" (trigger: ${trigger}, ${steps.length} step${steps.length !== 1 ? 's' : ''})${input.bindToNodeId ? ` and bound to node` : ''}`,
      },
    };
  },

  delete_workflow(input, getStore) {
    const store = getStore();
    const workflowName = input.workflowName as string;
    store.removePageWorkflow(workflowName);
    return { success: true, data: { message: `Deleted workflow "${workflowName}"` } };
  },

  set_animation(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;

    // Read existing animation to merge (preserve unspecified fields)
    const node = findNode(store.pageNodes as SDUINode[], nodeId);
    const existing = ((node as unknown as Record<string, unknown>)?.animation ?? {}) as Record<string, unknown>;
    const animation: Record<string, unknown> = { ...existing };

    if (input.enter !== undefined) {
      if (input.enter === 'none') {
        delete animation.enter;
      } else {
        animation.enter = { type: input.enter, duration: Number(input.enterDuration ?? 300) };
      }
    }

    if (input.exit !== undefined) {
      if (input.exit === 'none') {
        delete animation.exit;
      } else {
        animation.exit = { type: input.exit, duration: Number(input.exitDuration ?? 300) };
      }
    }

    if (input.loop !== undefined) {
      if (input.loop === 'none') {
        delete animation.loop;
      } else {
        animation.loop = { type: input.loop, duration: 1500, repeatCount: -1, direction: 'alternate' };
      }
    }

    if (input.hover !== undefined) {
      if (input.hover === 'none') {
        delete animation.hover;
      } else {
        const hoverType = input.hover as string;
        if (hoverType === 'scale') animation.hover = { type: 'scale', value: 1.05, duration: 200 };
        else if (hoverType === 'lift') animation.hover = { type: 'translateY', value: -4, duration: 200 };
      }
    }

    if (input.press !== undefined) {
      if (input.press === 'none') {
        delete animation.press;
      } else {
        const pressType = input.press as string;
        if (pressType === 'scale') animation.press = { type: 'scale', value: 0.95, duration: 100 };
        else if (pressType === 'bounce') animation.press = { type: 'scale', value: 0.9, duration: 100 };
      }
    }

    if (input.scroll !== undefined) {
      if (input.scroll === 'none') {
        delete animation.scroll;
      } else {
        animation.scroll = { type: input.scroll, duration: 400 };
      }
    }

    if (input.imperativeTrigger !== undefined) {
      const it = input.imperativeTrigger as Record<string, unknown>;
      animation.imperativeTrigger = {
        type: it.type ?? 'shake',
        watchVar: it.watchVar,
        duration: Number(it.duration ?? 500),
      };
    }

    if (Object.keys(animation).length === 0) {
      store.patchNodeField(nodeId, 'animation', null);
      return { success: true, data: { message: 'Removed all animations' } };
    }

    store.patchNodeField(nodeId, 'animation', animation);
    return { success: true, data: { message: `Updated animation` } };
  },

  set_validation(input, getStore) {
    const store = getStore();
    store.patchNodeField(input.nodeId as string, '_validation', {
      trigger: 'submit',
      rules: input.rules,
    });
    return { success: true, data: { message: `Set ${(input.rules as unknown[]).length} validation rule(s)` } };
  },

  rename_node(input, getStore) {
    const store = getStore();
    store.patchNodeField(input.nodeId as string, 'name', input.name as string);
    return { success: true, data: { message: `Renamed node to "${input.name}"` } };
  },

  set_disabled(input, getStore) {
    const store = getStore();
    store.patchProp(input.nodeId as string, 'disabled', input.disabled);
    return { success: true, data: { message: `Set disabled to ${JSON.stringify(input.disabled)}` } };
  },

  set_loading_state(input, getStore) {
    const store = getStore();
    const state = input.state as string;
    store.patchNodeField(input.nodeId as string, '_stateTag', state === 'None' ? null : state);
    return { success: true, data: { message: state === 'None' ? 'Removed state tag' : `Set state tag to "${state}"` } };
  },

  // ── Variables ──────────────────────────────────────────────────────────────

  add_variable(input, getStore) {
    const store = getStore();
    const id = (input.variableId as string | undefined)
      ?? (input._assignedVarId as string | undefined)
      ?? uuid();
    const v: CustomVar = {
      id,
      name: input.name as string,
      type: input.type as CustomVar['type'],
      initialValue: input.initialValue,
    };
    store.addCustomVar(v);
    return { success: true, data: { id, name: v.name, message: `Created variable "${v.name}" (${id})` } };
  },

  update_variable(input, getStore) {
    const store = getStore();
    const variableId = input.variableId as string;
    const patch: Partial<CustomVar> = {};
    if (input.name !== undefined)         patch.name = input.name as string;
    if (input.type !== undefined)         patch.type = input.type as CustomVar['type'];
    if (input.initialValue !== undefined) patch.initialValue = input.initialValue;
    store.updateCustomVar(variableId, patch);
    return { success: true, data: { message: `Updated variable "${variableId}"` } };
  },

  delete_variable(input, getStore) {
    const store = getStore();
    store.removeCustomVar(input.variableId as string);
    return { success: true, data: { message: `Deleted variable "${input.variableId}"` } };
  },

  // ── Data Sources ───────────────────────────────────────────────────────────

  add_data_source(input, getStore) {
    const store = getStore();
    const id = (input.dataSourceId as string | undefined) ?? uuid();
    const cfg: DataSourceConfig = {
      id,
      name: input.name as string,
      type: input.type as 'rest' | 'graphql',
      url: input.url as string | undefined,
      method: (input.method as DataSourceConfig['method']) ?? 'GET',
      endpoint: input.endpoint as string | undefined,
      query: input.query as string | undefined,
      storeIn: input.storeIn as string | undefined,
      trigger: (input.trigger as 'mount' | 'action') ?? 'mount',
    };
    store.addPageDataSource(cfg);
    return { success: true, data: { id, message: `Added data source "${cfg.name}" (${id}). Use collections['${id}'].data in formulas.` } };
  },

  delete_data_source(input, getStore) {
    const store = getStore();
    store.removePageDataSource(input.sourceId as string);
    return { success: true, data: { message: `Deleted data source "${input.sourceId}"` } };
  },

  // ── Theme ──────────────────────────────────────────────────────────────────

  set_theme_color(input, getStore) {
    const store = getStore();
    const mode = (input.mode as 'light' | 'dark') || 'light';
    store.patchTheme(input.variable as string, input.value as string, mode);
    return { success: true, data: { message: `Set ${mode} --${input.variable} = ${input.value}` } };
  },

  // ── Pages ──────────────────────────────────────────────────────────────────

  add_page(input, getStore) {
    const store = getStore();
    const pageId = input._assignedPageId as string | undefined;
    store.addPage(input.route as string, input.name as string, pageId);
    return { success: true, data: { message: `Added page "${input.name}" at "${input.route}"` } };
  },

  switch_page(input, getStore) {
    const store = getStore();
    store.navigatePage(input.pageId as string);
    return { success: true, data: { message: `Switched to page` } };
  },

  rename_page(input, getStore) {
    const store = getStore();
    store.renamePage(input.pageId as string, input.name as string);
    return { success: true, data: { message: `Renamed page to "${input.name}"` } };
  },

  remove_page(input, getStore) {
    const store = getStore();
    store.removePage(input.pageId as string);
    return { success: true, data: { message: `Removed page` } };
  },

  set_page_config(input, getStore) {
    const store = getStore();
    const meta: Record<string, unknown> = {};
    if (input.title)       meta.title = input.title;
    if (input.description) meta.description = input.description;
    if (input.ogImage)     meta.ogImage = input.ogImage;
    if (Object.keys(meta).length > 0) {
      store.setCurrentPageMeta(meta as Parameters<typeof store.setCurrentPageMeta>[0]);
    }
    if (input.onMountWorkflow) {
      store.setCurrentPageInteractions({ mount: { workflow: input.onMountWorkflow as string } });
    }
    return { success: true, data: { message: `Updated page config` } };
  },

  // ── Canvas ─────────────────────────────────────────────────────────────────

  select_node(input, getStore) {
    const store = getStore();
    store.select(input.nodeId as string, false);
    return { success: true, data: { message: `Selected node` } };
  },

  undo(_, getStore) {
    getStore().undo();
    return { success: true, data: { message: 'Undone' } };
  },

  // ── Asset search (server-side in API route) ────────────────────────────────

  search_images() {
    return { success: true, data: { pending: 'server_side' } };
  },

  search_videos() {
    return { success: true, data: { pending: 'server_side' } };
  },

  search_icons() {
    return { success: true, data: { pending: 'server_side' } };
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Execute a single tool call from the AI.
 * Returns the result (success + data or error).
 */
export async function executeTool(
  toolName: string,
  input: ToolInput,
  getStore: StoreGetter,
): Promise<ToolResult> {
  const handler = handlers[toolName];
  if (!handler) {
    return { success: false, error: `Unknown tool: "${toolName}"` };
  }
  try {
    return await handler(input, getStore);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Tool "${toolName}" failed: ${msg}` };
  }
}

/** Execute multiple tool calls in sequence.
 *
 * When add_component receives a non-UUID nodeId, the tree stores a generated UUID; aliasMap
 * maps that provisional string to the real id so same-batch parentId still resolves.
 * Preferred: pass UUID nodeIds everywhere (see builder knowledge) — then aliasMap is unused.
 */
export async function executeTools(
  toolCalls: Array<{ name: string; input: ToolInput; id: string }>,
  getStore: StoreGetter,
): Promise<Array<{ id: string; result: ToolResult }>> {
  // Maps AI-provided short aliases → actual UUID stored in the tree
  const aliasMap = new Map<string, string>();

  const results: Array<{ id: string; result: ToolResult }> = [];
  for (const call of toolCalls) {
    // Resolve any aliased string values in this call's input before executing
    const resolvedInput = resolveAliases(call.input, aliasMap);
    const result = await executeTool(call.name, resolvedInput, getStore);

    // After add_component / add_icon / add_image / add_video — if the AI passed
    // a short non-UUID nodeId, record the alias → actual UUID mapping so later
    // calls in this batch can use it as parentId.
    if (result.success && resolvedInput.nodeId && typeof resolvedInput.nodeId === 'string') {
      const originalId = call.input.nodeId as string | undefined;
      const actualId = (result.data as { nodeId?: string } | undefined)?.nodeId;
      if (originalId && actualId && originalId !== actualId && !isUUID(originalId)) {
        aliasMap.set(originalId, actualId);
      }
    }

    results.push({ id: call.id, result });
  }
  return results;
}

/** Replace any aliased string values in a tool input with their resolved UUIDs. */
function resolveAliases(input: ToolInput, aliasMap: Map<string, string>): ToolInput {
  if (!aliasMap.size) return input;
  const out: ToolInput = {};
  for (const [key, val] of Object.entries(input)) {
    out[key] = (typeof val === 'string' && aliasMap.has(val)) ? aliasMap.get(val)! : val;
  }
  return out;
}

/** Format tool results as Anthropic tool_result content blocks. */
export function formatToolResults(
  results: Array<{ id: string; result: ToolResult }>,
): Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> {
  return results.map(({ id, result }) => ({
    type: 'tool_result' as const,
    tool_use_id: id,
    content: result.success
      ? JSON.stringify(result.data ?? { ok: true })
      : `ERROR: ${result.error}`,
    is_error: !result.success || undefined,
  }));
}

// ─── Mutation tool set (executed client-side) ─────────────────────────────────

export const CLIENT_SIDE_TOOLS = new Set([
  'add_component', 'add_icon', 'add_image', 'add_video',
  'delete_node', 'duplicate_node', 'move_node_up', 'move_node_down', 'move_node', 'wrap_in_container',
  'set_text', 'set_placeholder', 'set_href', 'set_src', 'set_icon', 'set_video_props',
  'set_background', 'set_text_color', 'set_typography', 'set_border', 'set_shadow',
  'set_opacity', 'set_spacing', 'set_size', 'set_position', 'set_transform', 'set_overflow', 'set_display',
  'set_submit', 'set_input_props',
  'set_layout',
  'set_condition', 'set_repeat', 'bind_action', 'unbind_action', 'create_workflow',
  'delete_workflow', 'set_animation', 'set_validation',
  'rename_node', 'set_disabled', 'set_loading_state',
  'get_formula_context', 'get_workflows', 'get_data_sources',
  'add_variable', 'update_variable', 'delete_variable',
  'add_data_source', 'delete_data_source',
  'set_theme_color',
  'add_page', 'switch_page', 'rename_page', 'remove_page', 'set_page_config',
  'select_node', 'undo',
]);
