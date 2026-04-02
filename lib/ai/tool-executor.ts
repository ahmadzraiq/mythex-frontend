/**
 * Tool Executor — maps AI tool calls to builder Zustand store actions.
 *
 * Design: The AI uses semantic builder actions, never raw JSON.
 * - add_component("Card") → looks up COMPONENT_SCHEMA["Card"] → inserts template
 * - set_text(id, "Hello") → patchProp(id, "text", "Hello")
 * - set_background(id, {bg:"primary"}) → resolves to bg-[var(--theme-primary)], patches className
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

// Recursively checks all steps (including nested branches/loops) for prohibited types.
function findProhibitedStep(steps: Array<Record<string, unknown>>, prohibited: Set<string>): string | null {
  for (const step of steps) {
    const t = step.type as string | undefined;
    if (t && prohibited.has(t)) {
      return `Step "${step.id ?? '?'}": type "${t}" is not supported. Use changeVariableValue, navigateTo, or other supported types instead.`;
    }
    for (const branch of ['trueBranch', 'falseBranch', 'loopBody', 'defaultBranch'] as const) {
      if (Array.isArray(step[branch])) {
        const err = findProhibitedStep(step[branch] as Array<Record<string, unknown>>, prohibited);
        if (err) return err;
      }
    }
    if (Array.isArray(step.branches)) {
      for (const b of step.branches as Array<Record<string, unknown>>) {
        if (Array.isArray(b.steps)) {
          const err = findProhibitedStep(b.steps as Array<Record<string, unknown>>, prohibited);
          if (err) return err;
        }
      }
    }
  }
  return null;
}

// ─── UUID ────────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

// Strict hex-only UUID format check — matches the server-side validator in route.ts.
// The server rejects non-hex UUIDs before they reach the client, so this is a second
// safety net for any edge cases where a node ID is set without going through the server.
function isUUIDFormat(id: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
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

// ─── Require a node to exist — used by all setter tools ──────────────────────

function requireNode(
  store: BuilderStore,
  nodeId: string | undefined,
): { success: false; error: string } | null {
  if (!nodeId) return { success: false, error: 'nodeId is required.' };
  if (!findNode(store.pageNodes as SDUINode[], nodeId)) {
    return {
      success: false,
      error: `Node "${nodeId}" not found on the current page. Call get_page_tree first to get valid node IDs, or check whether a prior add_component step failed.`,
    };
  }
  return null;
}

// ─── Return all map-bearing ancestors of a node (repeat context chain) ───────

function getRepeatAncestors(nodes: SDUINode[], targetId: string, ancestors: SDUINode[] = []): SDUINode[] | null {
  for (const n of nodes) {
    const path = [...ancestors, n];
    if (n.id === targetId) {
      return path.filter(a => !!(a as unknown as Record<string, unknown>).map);
    }
    if (n.children?.length) {
      const found = getRepeatAncestors(n.children as SDUINode[], targetId, path);
      if (found !== null) return found;
    }
  }
  return null;
}

function buildRepeatContext(ancestors: SDUINode[]): Array<{ level: number; path: string; note?: string }> | null {
  if (ancestors.length === 0) return null;
  return ancestors.map((_, i) => {
    const level = ancestors.length - i;
    if (level === 1) {
      return { level: 1, path: 'context?.item?.data?.*' };
    }
    return { level, path: 'context?.item?.parent?.data?.*', note: `access outer repeat item (${level - 1} levels up)` };
  });
}

// ─── Check if a node is inside a repeat scope ───────────────────────────────

function isInsideRepeatScope(nodes: SDUINode[], targetId: string): boolean {
  const ancestors = getRepeatAncestors(nodes, targetId);
  return ancestors !== null && ancestors.length > 0;
}

function nodeHasRepeat(nodes: SDUINode[], nodeId: string): boolean {
  const node = findNode(nodes, nodeId);
  if (!node) return false;
  return !!(node as unknown as Record<string, unknown>).map;
}

/**
 * Returns an error if a formula uses context?.item?.data but the target node
 * is NOT inside a repeat scope (neither has map itself nor has an ancestor with map).
 * This prevents the AI from applying per-item ternaries to parent containers.
 */
function validateRepeatScopeFormula(
  store: BuilderStore,
  nodeId: string,
  formula: string,
): { success: false; error: string } | null {
  if (!formula.includes('context?.item?.data') && !formula.includes("context?.item?.parent?.data")) return null;
  if (nodeHasRepeat(store.pageNodes as SDUINode[], nodeId)) return null;
  if (isInsideRepeatScope(store.pageNodes as SDUINode[], nodeId)) return null;
  return {
    success: false,
    error: `Formula uses context?.item?.data but node "${nodeId}" is NOT inside a repeat scope — it has no repeat/map and no ancestor with repeat. context?.item?.data resolves to undefined on this node. You likely confused the CONTAINER (this node) with the TEMPLATE (the child node that has repeat). Call get_page_tree to identify which node has repeat, then apply the formula to THAT node instead.`,
  };
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
function patchNodeStyle(store: BuilderStore, nodeId: string, patch: Record<string, unknown>): void {
  const existing = getNodeStyle(store, nodeId);
  const merged = { ...existing, ...patch };
  const clean = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== '' && v != null && v !== undefined));
  store.patchProp(nodeId, 'props.style', clean);
}

// Helper: remove specific keys from props.style entirely (no empty-string residue).
function removeNodeStyleKeys(store: BuilderStore, nodeId: string, keys: string[]): void {
  const existing = getNodeStyle(store, nodeId);
  const keySet = new Set(keys);
  const clean = Object.fromEntries(Object.entries(existing).filter(([k]) => !keySet.has(k)));
  store.patchProp(nodeId, 'props.style', clean);
}

/**
 * Returns true when `val` is a formula expression rather than a static color.
 * Static colors: hex (#...), rgb/hsl/var() functions, plain Tailwind token names (no special chars).
 * Formulas: contain optional-chaining (?.), comparison operators, if(), or known scope prefixes.
 */
function isFormulaExpression(val: string): boolean {
  if (val.startsWith('#') || val.startsWith('rgb') || val.startsWith('hsl') || val.startsWith('var(')) return false;
  return (
    val.includes('?.') ||
    val.includes('===') ||
    val.includes('!==') ||
    val.includes('if(') ||
    val.includes("variables['") ||
    val.startsWith('theme?.') ||
    val.startsWith('context') ||
    val.startsWith('theme[')
  );
}

// Map friendly color names to CSS-variable Tailwind classes.
// prefix: 'bg' | 'text' | 'border'
function resolveColorClass(value: string, prefix: 'bg' | 'text' | 'border'): string {
  // Strip 'theme:' prefix so AI can use 'theme:primary' interchangeably with 'primary' in static params
  if (value.startsWith('theme:')) value = value.slice(6);
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
  // CSS variable, rgb(), rgba(), hsl(), hsla() — wrap in arbitrary
  if (value.startsWith('var(') || value.startsWith('rgb(') || value.startsWith('rgba(') || value.startsWith('hsl(') || value.startsWith('hsla(')) {
    return `${prefix}-[${value}]`;
  }
  // Hex value — possibly with Tailwind opacity modifier (#000000/40 → bg-[#000000]/40)
  if (value.startsWith('#')) {
    const slashIdx = value.indexOf('/');
    if (slashIdx !== -1) {
      const hex = value.slice(0, slashIdx);
      const opacity = value.slice(slashIdx); // includes the "/"
      return `${prefix}-[${hex}]${opacity}`;
    }
    return `${prefix}-[${value}]`;
  }
  // Tailwind color token like "blue-600", "gray-900"
  return `${prefix}-${value}`;
}

// Remove text color tokens while preserving size, alignment, and decoration tokens.
function stripTextColorTokens(cls: string): string {
  const TEXT_NON_COLOR = /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl|left|center|right|justify|start|end|inherit|current|transparent|wrap|nowrap|balance|pretty|ellipsis|clip|truncate)$/;
  // Preserve arbitrary size tokens like text-[72px], text-[1.5rem], text-[18px]
  const TEXT_SIZE_ARBITRARY = /^text-\[[\d.]+(?:px|rem|em|vw|vh|%|ch|ex|lh|dvh|svh)\]$/;
  return cls
    .split(/\s+/)
    .filter(t => {
      const bare = t.startsWith('!') ? t.slice(1) : t;
      if (!bare.startsWith('text-')) return true;
      return TEXT_NON_COLOR.test(bare) || TEXT_SIZE_ARBITRARY.test(bare);
    })
    .join(' ');
}

// Strip border color tokens while preserving width/style tokens.
function stripBorderColorTokens(cls: string): string {
  // Preserve width tokens (scale AND arbitrary e.g. border-[1px] border-[2px])
  const BORDER_NON_COLOR = /^border(-[0-9]+|-\[[0-9]+px\]|-solid|-dashed|-dotted|-double|-none|-[xytrblse](-[0-9]+)?|(-[xytrblse])?-opacity-[0-9]+)?$/;
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

/**
 * Sanitize tool-parameter tokens embedded in a formula string.
 * Each tool passes its own token map so the AI can use the same vocabulary
 * inside formulas as it uses for static values, and the tool transparently
 * converts them to valid CSS before storing in style.
 *
 * Built-in pattern replacements (always applied before the static map):
 *   'px:N'  → 'Npx'   (e.g. 'px:360' → '360px')
 *   'vh:N'  → 'Nvh'   (e.g. 'vh:80'  → '80vh')
 *   'theme:token' → theme?.['colors']?.['token']  (evaluator returns hex from THEME_OBJ)
 *
 * Then static map keys are replaced: e.g. { fill: '100%', fit: 'fit-content' }
 */
const THEME_TOKEN_NAMES = new Set([
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
  'card', 'card-foreground', 'background', 'foreground',
  'muted', 'muted-foreground', 'accent', 'accent-foreground',
  'destructive', 'destructive-foreground', 'border', 'transparent',
  'input', 'ring',
]);

function resolveFormulaTokens(formula: string, staticMap: Record<string, string> = {}): string {
  return formula
    .replace(/'px:(\d+(?:\.\d+)?)'/g, "'$1px'")
    .replace(/'vh:(\d+(?:\.\d+)?)'/g, "'$1vh'")
    .replace(/'theme:([a-z][a-z0-9-]*)'/g, "theme?.['colors']?.['$1']")
    .replace(/(?<!\?\.\[)'([a-z][a-z0-9-]*)'/g, (match, token) => {
      if (THEME_TOKEN_NAMES.has(token)) return `theme?.['colors']?.['${token}']`;
      return Object.prototype.hasOwnProperty.call(staticMap, token) ? `'${staticMap[token]}'` : match;
    });
}

const SIZE_WIDTH_TOKEN_MAP: Record<string, string> = {
  fill:   '100%',
  full:   '100%',
  fit:    'fit-content',
  screen: '100vw',
};
const SIZE_HEIGHT_TOKEN_MAP: Record<string, string> = {
  fill:   '100%',
  fit:    'fit-content',
  screen: '100vh',
};

function replaceTokenGroup(cls: string, patterns: string[], newToken: string): string {
  let result = cls;
  for (const p of patterns) {
    result = removeExactToken(result, p);
  }
  return newToken ? `${result} ${newToken}`.replace(/\s+/g, ' ').trim() : result.replace(/\s+/g, ' ').trim();
}

// Remove ALL tokens sharing a prefix — both scale tokens (z-10) and arbitrary (z-[10]).
// Used when replacing a property that is now stored as an arbitrary-value class.
function removeAllWithPrefix(cls: string, prefix: string): string {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cls
    .replace(new RegExp(`(^|\\s)${escaped}\\S+`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TEXT_SIZE_PREFIXES = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl', 'text-4xl', 'text-5xl', 'text-6xl', 'text-7xl', 'text-8xl', 'text-9xl'];
const TEXT_ALIGN_PREFIXES = ['text-left', 'text-center', 'text-right', 'text-justify'];
const FONT_WEIGHT_PREFIXES = ['font-thin', 'font-extralight', 'font-light', 'font-normal', 'font-medium', 'font-semibold', 'font-bold', 'font-extrabold', 'font-black'];
const LEADING_PREFIXES = ['leading-none', 'leading-tight', 'leading-snug', 'leading-normal', 'leading-relaxed', 'leading-loose'];
const TRACKING_PREFIXES = ['tracking-tighter', 'tracking-tight', 'tracking-normal', 'tracking-wide', 'tracking-wider', 'tracking-widest'];
const DECORATION_TOKENS = ['underline', 'no-underline', 'line-through', 'overline'];
const TRANSFORM_TOKENS = ['uppercase', 'lowercase', 'capitalize', 'normal-case'];
const ITALIC_TOKENS = ['italic', 'not-italic'];
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
    // Support single nodeId or batch nodeIds array
    const nodeId = input.nodeId as string | undefined;
    const nodeIds = input.nodeIds as string[] | undefined;
    const ids = nodeIds ?? (nodeId ? [nodeId] : []);

    if (ids.length === 0) {
      return {
        success: true,
        data: {
          note: 'Pass nodeId or nodeIds to get scope info. Variables and data sources are already in your context.',
          nodes: [],
        },
      };
    }

    const results: Record<string, { repeatDepth: number; scopePath: string; parentScopePath: string | null; repeatContext: Array<{ level: number; path: string; note?: string }> | null }> = {};
    for (const id of ids) {
      const ancestors = getRepeatAncestors(store.pageNodes as SDUINode[], id) ?? [];
      const depth = ancestors.length;
      const repeatContext = buildRepeatContext(ancestors);
      results[id] = {
        repeatDepth: depth,
        scopePath: depth > 0 ? 'context?.item?.data?.*' : '(none — not inside any repeat)',
        parentScopePath: depth >= 2 ? 'context?.item?.parent?.data?.*' : null,
        repeatContext,
      };
    }

    // If single node requested, also expose flat fields for convenience
    const single = ids.length === 1 ? results[ids[0]] : null;

    return {
      success: true,
      data: {
        note: 'Use scopePath for this node\'s own fields. parentScopePath is only valid when repeatDepth >= 2 (nested repeat). Never use .parent.data.* when repeatDepth is 1.',
        ...(single ?? {}),
        nodes: results,
      },
    };
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

  // ── Add component (palette-based, no JSON) ─────────────────────────────────

  add_component(input, getStore) {
    const store = getStore();
    const label = input.label as string;
    const template = getTemplate(label);

    if (!template) {
      return { success: false, error: `Unknown component label: "${label}". Available: ${Object.keys(COMPONENT_SCHEMA).join(', ')}` };
    }

    // Server validates the nodeId and passes rawInput unchanged — read nodeId directly.
    // _assignedNodeId is no longer injected by the server for add_component.
    const requestedId = input.nodeId as string | undefined;
    if (requestedId && isUUIDFormat(requestedId)) {
      (template as unknown as Record<string, unknown>).id = requestedId;
    }

    // Apply the optional name (Layers-panel label) if provided, avoiding a separate rename_node call.
    if (input.name && typeof input.name === 'string') {
      (template as unknown as Record<string, unknown>).name = input.name;
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
    const nodeErr = requireNode(store, input.nodeId as string | undefined);
    if (nodeErr) return nodeErr;
    const nodeId = input.nodeId as string;
    // Treat absent or page-ID values as null → insertNode places node at root level.
    // A page ID (e.g. "page-1774821895009") is NOT a node in the tree; passing it to
    // patchNodeById silently no-ops, so the node is removed but never reinserted.
    const rawParent = input.targetParentId as string | undefined;
    const targetParentId = rawParent && !rawParent.startsWith('page-') ? rawParent : null;
    // Default to MAX_SAFE_INTEGER so omitting atIndex truly appends at end (insertNode clamps it).
    const atIndex = (input.atIndex as number | undefined) ?? Number.MAX_SAFE_INTEGER;
    store.moveNode(nodeId, targetParentId, atIndex);
    return { success: true, data: { message: `Moved node to "${targetParentId ?? 'page root'}" at index ${atIndex === Number.MAX_SAFE_INTEGER ? 'last' : atIndex}` } };
  },

  wrap_in_container(input, getStore) {
    const store = getStore();
    const ids = input.nodeIds as string[];
    const direction = (input.direction as string) || 'column';
    const cls = direction === 'row'
      ? 'flex flex-row items-center gap-[16px] w-full'
      : 'flex flex-col gap-[16px] w-full';
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
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    let text = input.text as string;
    // AI sometimes double-escapes string literals as \"...\" (literal backslashes) instead of '...'.
    // Sanitize before formula detection so the evaluator sees valid JS single-quoted strings.
    text = text.replace(/\\"([^"\\]*?)\\"/g, "'$1'");

    // Convert to { formula: expr } when the text is a formula expression.
    // Three cases:
    //   1. Pure {{expression}} wrapper — strip braces, store as formula.
    //   2. Plain formula expression (no {{...}}) — detected by known scope identifiers.
    //      Only applies when there are no {{ }} template interpolation markers present,
    //      so "Our {{variables['count-uuid']}} Features" stays as a template string
    //      handled by the renderer, while "variables['uuid'] === 'monthly' ? '/month' : '/year'"
    //      is stored as a formula.
    //   3. Literal text ("Get Started") or template strings — stored as-is.
    const storedText: unknown = toTextValue(text);

    store.patchProp(nodeId, 'text', storedText);
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
    const nodeErr = requireNode(store, input.nodeId as string);
    if (nodeErr) return nodeErr;

    if (input.icon === undefined && input.color === undefined && input.size === undefined) {
      return { success: false, error: 'set_icon requires at least one of: icon, color, size.' };
    }

    // Theme token → CSS variable map for icon colors.
    const ICON_THEME_VARS: Record<string, string> = {
      primary:                'var(--theme-primary)',
      'primary-foreground':   'var(--theme-primary-foreground)',
      secondary:              'var(--theme-secondary)',
      'secondary-foreground': 'var(--theme-secondary-foreground)',
      accent:                 'var(--theme-accent)',
      'accent-foreground':    'var(--theme-accent-foreground)',
      muted:                  'var(--theme-muted)',
      'muted-foreground':     'var(--theme-muted-foreground)',
      foreground:             'var(--theme-foreground)',
      background:             'var(--theme-background)',
      destructive:            'var(--theme-destructive)',
      card:                   'var(--theme-card)',
      'card-foreground':      'var(--theme-card-foreground)',
      border:                 'var(--theme-border)',
    };

    const nodeId = input.nodeId as string;

    // Handle icon name — static string or formula expression string.
    let iconLabel = '';
    if (input.icon !== undefined) {
      iconLabel = typeof input.icon === 'string' ? (input.icon as string) : '';
      if (isFormulaExpression(input.icon as string)) {
        patchNodeStyle(store, nodeId, { icon: { formula: input.icon as string } });
        store.patchProp(nodeId, 'props.icon', '');
        iconLabel = '(formula)';
      } else {
        store.patchProp(nodeId, 'props.icon', input.icon);
        iconLabel = input.icon as string;
      }
      // Clear any stale top-level text field left by Phase 2 set_text calls on Icon nodes.
      store.patchProp(nodeId, 'text', undefined);
    }

    if (input.size) {
      store.patchProp(nodeId, 'props.width', input.size);
      store.patchProp(nodeId, 'props.height', input.size);
    }

    if (input.color) {
      if (isFormulaExpression(input.color as string)) {
        const sanitized = resolveFormulaTokens(input.color as string);
        store.patchProp(nodeId, 'props.color', { formula: sanitized });
      } else {
        const resolved = ICON_THEME_VARS[input.color as string] ?? (input.color as string);
        store.patchProp(nodeId, 'props.color', resolved);
      }
    }

    const parts: string[] = [];
    if (iconLabel) parts.push(`icon → "${iconLabel}"`);
    if (input.color !== undefined) parts.push(`color updated`);
    if (input.size  !== undefined) parts.push(`size → ${input.size}px`);
    return { success: true, data: { message: `Updated icon: ${parts.join(', ')}` } };
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
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    let cls = getNodeClassName(store, nodeId);

    if (input.bg != null) {
      const bgVal = input.bg as string;
      if (bgVal.startsWith('rgba(')) {
        return { success: false, error: `rgba() is not supported by set_background. Use Tailwind opacity notation instead: "black/40", "white/20", "#000000/40". Example: set_background(id, {bg:"black/40"}) for a 40% black overlay.` };
      }
      const scopeErr = validateRepeatScopeFormula(store, nodeId, bgVal);
      if (scopeErr) return scopeErr;
      if (isFormulaExpression(bgVal)) {
        const sanitized = resolveFormulaTokens(bgVal);
        patchNodeStyle(store, nodeId, { backgroundColor: { formula: sanitized } });
        cls = replaceTwToken(cls, 'bg-', '');
        setNodeClassName(store, nodeId, cls);
        return { success: true, data: { message: 'Updated background (formula)' } };
      }
      const rawBgClass = resolveColorClass(bgVal, 'bg');
      // Force !bg- prefix for theme-variable classes so they override Gluestack's default
      // background variants (same pattern as set_text_color which always adds !text-).
      const bgClass = rawBgClass.includes('var(--theme-') && !rawBgClass.startsWith('!')
        ? `!${rawBgClass}`
        : rawBgClass;
      cls = replaceTwToken(cls, 'bg-', bgClass);
      removeNodeStyleKeys(store, nodeId, ['backgroundColor']);
    }

    if (input.fillOpacity != null) {
      const fo = Math.round(Math.min(100, Math.max(0, Number(input.fillOpacity))));
      cls = cls.split(' ').filter(t => !/^bg-opacity-/.test(t)).join(' ').trim();
      if (fo < 100) cls = `${cls} bg-opacity-${fo}`.trim();
    }

    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: 'Updated background' } };
  },

  set_text_color(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    const colorVal = input.color as string;
    if (isFormulaExpression(colorVal)) {
      const sanitized = resolveFormulaTokens(colorVal);
      patchNodeStyle(store, nodeId, { color: { formula: sanitized } });
      return { success: true, data: { message: 'Set text color (formula)' } };
    }
    // Always use ! prefix so Gluestack's default typography color tokens (text-typography-900 etc.)
    // don't override the explicitly requested color on Heading/Text components.
    const rawColorClass = resolveColorClass(colorVal, 'text');
    const colorClass = rawColorClass.startsWith('!') ? rawColorClass : `!${rawColorClass}`;

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
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    let cls = getNodeClassName(store, nodeId);

    if (input.size != null) {
      const sizePx = Number(input.size);
      cls = replaceTokenGroup(cls, TEXT_SIZE_PREFIXES, ''); // strip scale tokens
      cls = removeAllWithPrefix(cls, 'text-[');             // strip existing arbitrary text-[Xpx]
      if (!Number.isNaN(sizePx) && sizePx > 0) cls = `${cls} text-[${sizePx}px]`.trim();
    }
    if (input.weight)   cls = replaceTokenGroup(cls, FONT_WEIGHT_PREFIXES, `font-${input.weight}`);
    if (input.align) {
      const alignRaw = input.align as string;
      if (isFormulaExpression(alignRaw)) {
        // Formula/ternary — write to inline style; left/center/right/justify are valid CSS text-align values
        patchNodeStyle(store, nodeId, { textAlign: { formula: alignRaw } });
        cls = replaceTokenGroup(cls, TEXT_ALIGN_PREFIXES, ''); // strip any existing text-left/center/right class
      } else {
        cls = replaceTokenGroup(cls, TEXT_ALIGN_PREFIXES, `text-${alignRaw}`);
      }
    }
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
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    let cls = getNodeClassName(store, nodeId);

    if (input.width != null) {
      const widthRaw = input.width as string | number;
      if (typeof widthRaw === 'string' && isFormulaExpression(widthRaw)) {
        patchNodeStyle(store, nodeId, { borderWidth: { formula: widthRaw } });
      } else {
        const widthPx = Number(widthRaw);
        cls = replaceTokenGroup(cls, BORDER_WIDTH_PREFIXES, ''); // strip scale tokens
        cls = removeAllWithPrefix(cls, 'border-[');              // strip existing arbitrary border-[Xpx]
        if (!Number.isNaN(widthPx) && widthPx > 0) cls = `${cls} border-[${widthPx}px]`.trim();
      }
    }
    if (input.style) {
      cls = replaceTokenGroup(cls, BORDER_STYLE_PREFIXES, `border-${input.style}`);
    }
    if (input.color) {
      const colorRaw = input.color as string;
      // Divider nodes (h-px) have no visible border — their fill is a bg class.
      // Redirect color to backgroundColor so the AI can use set_border naturally on Dividers.
      const isDivider = cls.split(' ').includes('h-px');
      if (isDivider) {
        if (isFormulaExpression(colorRaw)) {
          const sanitized = resolveFormulaTokens(colorRaw);
          patchNodeStyle(store, nodeId, { backgroundColor: { formula: sanitized } });
          removeNodeStyleKeys(store, nodeId, ['borderColor']);
        } else {
          const bgClass = resolveColorClass(colorRaw, 'bg');
          cls = replaceTwToken(cls, 'bg-', bgClass);
          removeNodeStyleKeys(store, nodeId, ['borderColor']);
        }
      } else if (isFormulaExpression(colorRaw)) {
        const sanitized = resolveFormulaTokens(colorRaw);
        patchNodeStyle(store, nodeId, { borderColor: { formula: sanitized } });
      } else {
        const borderColorClass = resolveColorClass(colorRaw, 'border');
        cls = stripBorderColorTokens(cls);
        cls = `${cls} ${borderColorClass}`.replace(/\s+/g, ' ').trim();
      }
    }
    if (input.radius != null) {
      const radiusPx = Number(input.radius);
      // Remove all rounded tokens (scale + arbitrary, global + per-corner)
      cls = replaceTokenGroup(cls, ROUNDED_PREFIXES, '');
      cls = removeAllWithPrefix(cls, 'rounded-tl-');
      cls = removeAllWithPrefix(cls, 'rounded-tr-');
      cls = removeAllWithPrefix(cls, 'rounded-br-');
      cls = removeAllWithPrefix(cls, 'rounded-bl-');
      cls = removeAllWithPrefix(cls, 'rounded-[');
      if (!Number.isNaN(radiusPx) && radiusPx >= 0) cls = `${cls} rounded-[${radiusPx}px]`.trim();
    }
    // Per-corner radii — accept number (px)
    const cornerMap: [string, string][] = [
      ['radiusTL', 'rounded-tl-'],
      ['radiusTR', 'rounded-tr-'],
      ['radiusBR', 'rounded-br-'],
      ['radiusBL', 'rounded-bl-'],
    ];
    for (const [key, prefix] of cornerMap) {
      if (input[key] != null) {
        const cornerPx = Number(input[key]);
        cls = removeAllWithPrefix(cls, prefix); // strip scale + arbitrary
        if (!Number.isNaN(cornerPx) && cornerPx >= 0) cls = `${cls} ${prefix}[${cornerPx}px]`.trim();
      }
    }

    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: 'Updated border' } };
  },

  set_shadow(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;

    if (input.remove) {
      const node = findNode(store.pageNodes as SDUINode[], nodeId);
      const currentStyle = { ...((node?.props as Record<string, unknown>)?.style as Record<string, unknown> ?? {}) };
      delete currentStyle.boxShadow;
      delete currentStyle.shadowColor;
      delete currentStyle.shadowOffset;
      delete currentStyle.shadowRadius;
      delete currentStyle.shadowOpacity;
      delete currentStyle.elevation;
      store.patchProp(nodeId, 'props.style', currentStyle);
      return { success: true, data: { message: 'Removed shadow' } };
    }

    // boxShadow: full CSS string or formula/ternary expression
    const boxShadowRaw = input.boxShadow as string | undefined;
    if (boxShadowRaw) {
      if (isFormulaExpression(boxShadowRaw)) {
        const sanitized = resolveFormulaTokens(boxShadowRaw);
        patchNodeStyle(store, nodeId, { boxShadow: { formula: sanitized } });
        return { success: true, data: { message: 'Set shadow (formula)' } };
      }
      // Static CSS boxShadow string — parse x/y/blur/spread/color for RN shadow props
      const m = boxShadowRaw.match(/^(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(-?[\d.]+)px\s+(.+)$/);
      if (m) {
        const bx = parseFloat(m[1]), by = parseFloat(m[2]), bBlur = parseFloat(m[3]), bColor = m[5].trim();
        patchNodeStyle(store, nodeId, {
          boxShadow: boxShadowRaw,
          shadowColor: bColor,
          shadowOffset: { width: bx, height: by },
          shadowRadius: bBlur,
          shadowOpacity: 1,
          elevation: Math.max(0, Math.round(bBlur / 2)),
        });
      } else {
        patchNodeStyle(store, nodeId, { boxShadow: boxShadowRaw });
      }
      return { success: true, data: { message: `Set shadow: ${boxShadowRaw}` } };
    }

    // Raw values mode: compose CSS boxShadow from individual params
    const color  = (input.color  as string)  || '#000000';
    const blur   = Number(input.blur   ?? 20);
    const spread = Number(input.spread ?? 0);
    const x      = Number(input.x      ?? 0);
    const y      = Number(input.y      ?? 4);
    if (isNaN(blur) || isNaN(spread) || isNaN(x) || isNaN(y)) {
      return { success: false, error: 'blur/spread/x/y must be plain integers. For per-item shadows use: set_shadow(id, { boxShadow: "ternary formula" })' };
    }

    patchNodeStyle(store, nodeId, {
      boxShadow: `${x}px ${y}px ${blur}px ${spread}px ${color}`,
      shadowColor: color,
      shadowOffset: { width: x, height: y },
      shadowRadius: blur,
      shadowOpacity: 1,
      elevation: Math.max(0, Math.round(blur / 2)),
    });
    return { success: true, data: { message: `Set shadow: blur=${blur}px spread=${spread}px color=${color}` } };
  },

  set_opacity(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    let cls = getNodeClassName(store, nodeId);
    const value = Math.min(100, Math.max(0, Number(input.opacity)));
    // Write to style.opacity as a number (0–1 float) — React Native requires a numeric opacity.
    // Use undefined for 100% so the key is removed from style (fully visible is the default).
    const opacityFloat: number | undefined = value >= 100 ? undefined : value / 100;
    // Clear any Tailwind opacity-* class that would conflict
    cls = cls.split(' ').filter(t => !/^opacity-/.test(t)).join(' ').replace(/\s+/g, ' ').trim();
    patchNodeStyle(store, nodeId, { opacity: opacityFloat });
    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: `Set opacity to ${value}%` } };
  },

  set_spacing(input, getStore) {
    if (input.gridCols !== undefined) {
      return { success: false, error: 'gridCols is not a set_spacing param. Use set_layout(nodeId, { gridCols: N }) instead.' };
    }
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
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
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    let cls = getNodeClassName(store, nodeId);

    if (input.width != null) {
      {
      const w = input.width as string;
      if (isFormulaExpression(w)) {
        // Sanitize tool-parameter tokens (px:N, fill, fit, screen) to valid CSS before storing.
        const sanitized = resolveFormulaTokens(w, SIZE_WIDTH_TOKEN_MAP);
        patchNodeStyle(store, nodeId, { width: { formula: sanitized } });
        cls = cls.split(' ').filter(t => !/^w-/.test(t) && !/^grow$/.test(t) && !/^min-w-/.test(t)).join(' ').trim();
        setNodeClassName(store, nodeId, cls);
        return { success: true, data: { message: 'Set width (formula)' } };
      }
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
    }
    if (input.height != null) {
      {
      const h = input.height as string;
      if (isFormulaExpression(h)) {
        // Sanitize tool-parameter tokens (px:N, vh:N, fill, fit, screen) to valid CSS before storing.
        const sanitized = resolveFormulaTokens(h, SIZE_HEIGHT_TOKEN_MAP);
        patchNodeStyle(store, nodeId, { height: { formula: sanitized } });
        cls = cls.split(' ').filter(t => !/^h-/.test(t) && !/^flex-1/.test(t) && !/^min-h-/.test(t)).join(' ').trim();
        setNodeClassName(store, nodeId, cls);
        return { success: true, data: { message: 'Set height (formula)' } };
      }
      if (h === 'min-screen') {
        cls = replaceTwToken(cls, 'min-h-', 'min-h-screen');
      } else       if (h === 'fill') {
        cls = removeTwToken(removeTwToken(removeTwToken(cls, 'h-'), 'flex-1'), 'min-h-');
        cls = `${cls} flex-1`.trim();
      } else if (h === 'full') {
        cls = removeTwToken(removeTwToken(removeTwToken(cls, 'h-'), 'flex-1'), 'min-h-');
        cls = `${cls} h-full`.trim();
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
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    let cls = getNodeClassName(store, nodeId);

    if (input.position) cls = replaceTokenGroup(cls, POSITION_TOKENS, input.position as string);
    if (input.zIndex != null) {
      const zNum = Number(input.zIndex);
      cls = replaceTokenGroup(cls, Z_PREFIXES, ''); // strip scale tokens (z-0, z-10, …)
      cls = removeAllWithPrefix(cls, 'z-[');        // strip existing arbitrary z-[N]
      if (!Number.isNaN(zNum)) cls = `${cls} z-[${Math.round(zNum)}]`.trim();
    }

    // Inset: formula values stored in props.style, plain integers as Tailwind classes
    const parseInset = (v: unknown): number | null => {
      if (v == null) return null;
      if (typeof v === 'number') return v;
      const n = Number(String(v).replace(/^px:/, ''));
      return Number.isNaN(n) ? null : n;
    };
    const insetStylePatch: Record<string, unknown> = {};
    const insetKeysToRemoveFromStyle: string[] = [];
    for (const [key, val] of [['top', input.top], ['right', input.right], ['bottom', input.bottom], ['left', input.left]] as [string, unknown][]) {
      if (val == null) continue;
      if (typeof val === 'string' && isFormulaExpression(val)) {
        const sanitized = resolveFormulaTokens(val);
        insetStylePatch[key] = { formula: sanitized };
        cls = cls.split(' ').filter(t => !new RegExp(`^${key}-`).test(t)).join(' ').trim();
      } else {
        const px = parseInset(val);
        if (px != null) {
          cls = cls.split(' ').filter(t => !new RegExp(`^${key}-`).test(t)).join(' ').trim();
          cls = `${cls} ${key}-[${px}px]`.trim();
          insetKeysToRemoveFromStyle.push(key);
        }
      }
    }
    if (Object.keys(insetStylePatch).length > 0) patchNodeStyle(store, nodeId, insetStylePatch);
    if (insetKeysToRemoveFromStyle.length > 0) removeNodeStyleKeys(store, nodeId, insetKeysToRemoveFromStyle);
    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: 'Updated position' } };
  },

  set_transform(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
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
    if (input.translateX !== undefined) {
      const txVal = input.translateX;
      if (typeof txVal === 'string' && txVal.trim()) {
        // Formula expression — write as FormulaValue object
        patchNodeStyle(store, nodeId, { translateX: { formula: txVal } });
      } else {
        const n = Number(txVal);
        patchNodeStyle(store, nodeId, { translateX: n === 0 ? '' : `${n}px` });
      }
    }
    if (input.translateY !== undefined) {
      const tyVal = input.translateY;
      if (typeof tyVal === 'string' && tyVal.trim()) {
        patchNodeStyle(store, nodeId, { translateY: { formula: tyVal } });
      } else {
        const n = Number(tyVal);
        patchNodeStyle(store, nodeId, { translateY: n === 0 ? '' : `${n}px` });
      }
    }
    if (Object.keys(stylePatch).length > 0) patchNodeStyle(store, nodeId, stylePatch);
    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: 'Updated transform properties' } };
  },

  set_overflow(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    let cls = getNodeClassName(store, nodeId);
    if (input.clip !== undefined) {
      if (input.clip) {
        if (!cls.includes('overflow-hidden')) cls = `${cls} overflow-hidden`.trim();
      } else {
        cls = cls.split(' ').filter(t => t !== 'overflow-hidden').join(' ').trim();
      }
    }
    if (input.pointerEvents !== undefined) {
      // Remove any existing pointer-events classes first
      cls = cls.split(' ').filter(t => !t.startsWith('pointer-events-')).join(' ').trim();
      if (input.pointerEvents === 'none') {
        cls = `${cls} pointer-events-none`.trim();
      }
      // 'auto' = remove the class (browser default)
    }
    setNodeClassName(store, nodeId, cls);
    const msgs: string[] = [];
    if (input.clip !== undefined) msgs.push((input.clip as boolean) ? 'clip:on' : 'clip:off');
    if (input.pointerEvents !== undefined) msgs.push(`pointer-events:${input.pointerEvents as string}`);
    return { success: true, data: { message: msgs.join(', ') || 'no changes' } };
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
    // Form field settings
    if (input.fieldName) store.patchNodeField(targetId, 'props.name', input.fieldName);
    if (input.initialValue !== undefined) store.patchNodeField(targetId, '_initialValue', input.initialValue);
    if (input.autocomplete !== undefined) store.patchProp(targetId, 'props.autoComplete', input.autocomplete ? 'on' : 'off');
    if (input.validationTrigger !== undefined) {
      // Read existing _validation and update trigger
      const node = findNode(store.pageNodes as SDUINode[], targetId);
      const existing = ((node as unknown as Record<string, unknown>)?._validation ?? {}) as Record<string, unknown>;
      store.patchNodeField(targetId, '_validation', { ...existing, trigger: input.validationTrigger });
    }
    if (input.debounce !== undefined || input.debounceEnabled !== undefined) {
      const node = findNode(store.pageNodes as SDUINode[], targetId);
      const existingDebounce = ((node as unknown as Record<string, unknown>)?._debounce ?? {}) as Record<string, unknown>;
      const newDebounce: Record<string, unknown> = { ...existingDebounce };
      if (input.debounce !== undefined) newDebounce.delay = Number(input.debounce);
      if (input.debounceEnabled !== undefined) newDebounce.enabled = input.debounceEnabled;
      store.patchNodeField(targetId, '_debounce', newDebounce);
    }
    return { success: true, data: { message: 'Updated input properties' } };
  },

  // ── Layout ─────────────────────────────────────────────────────────────────

  set_layout(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    const node = findNode(store.pageNodes, nodeId);
    const current = (node?.props as { className?: string })?.className ?? '';

    // Formula-expression guard: justify and align can receive ternary strings.
    // buildLayoutClass would blindly concatenate them into "justify-<formula>" — invalid Tailwind.
    // Intercept them before the class builder runs, then write to inline style instead.
    const justifyVal = input.justify as string | undefined;
    const alignVal   = input.align   as string | undefined;
    const isJustifyFormula = !!justifyVal && isFormulaExpression(justifyVal);
    const isAlignFormula   = !!alignVal   && isFormulaExpression(alignVal);
    const layoutInput = {
      ...input,
      ...(isJustifyFormula ? { justify: undefined } : {}),
      ...(isAlignFormula   ? { align:   undefined } : {}),
    };
    let updated = buildLayoutClass(layoutInput, current);

    if (isJustifyFormula) {
      patchNodeStyle(store, nodeId, { justifyContent: { formula: justifyVal } });
      updated = updated.split(' ').filter(t => !/^justify-/.test(t)).join(' ').trim();
    }
    if (isAlignFormula) {
      patchNodeStyle(store, nodeId, { alignItems: { formula: alignVal } });
      updated = updated.split(' ').filter(t => !/^items-/.test(t)).join(' ').trim();
    }

    // gap is a pixel number — write as arbitrary Tailwind class, not inline style
    if (input.gap != null) {
      updated = updated.split(' ').filter(t => !/^gap(-[xy])?-/.test(t)).join(' ').replace(/\s+/g, ' ').trim();
      updated = `${updated} gap-[${input.gap}px]`.trim();
      removeNodeStyleKeys(store, nodeId, ['gap', 'columnGap', 'rowGap']);
    }
    if (input.self) {
      const selfVal = input.self as string;
      if (isFormulaExpression(selfVal)) {
        patchNodeStyle(store, nodeId, { alignSelf: { formula: selfVal } });
        updated = updated.split(' ').filter(t => !/^self-/.test(t)).join(' ').trim();
      } else {
        updated = replaceTokenGroup(updated, SELF_PREFIXES, `self-${selfVal}`);
      }
    }
    if (input.cursor) updated = replaceTokenGroup(updated, CURSOR_PREFIXES, `cursor-${input.cursor}`);
    if (input.gridCols) {
      updated = replaceTokenGroup(updated, DISPLAY_TOKENS, 'grid');
      updated = replaceTwToken(updated, 'grid-cols-', `grid-cols-${input.gridCols}`);
    }
    if (input.gridRows) updated = replaceTwToken(updated, 'grid-rows-', `grid-rows-${input.gridRows}`);
    if (input.colSpan) {
      const span = input.colSpan as number;
      updated = replaceTwToken(updated, 'col-span-', span > 12 ? 'col-span-full' : `col-span-${span}`);
    }
    if (input.flexWrap) updated = replaceTokenGroup(updated, ['flex-wrap', 'flex-nowrap', 'flex-wrap-reverse'], `flex-${input.flexWrap}`);
    store.patchProp(nodeId, 'props.className', updated);
    return { success: true, data: { message: 'Updated layout' } };
  },

  // ── Logic ──────────────────────────────────────────────────────────────────

  set_condition(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    let condition = input.condition as string | undefined;
    if (condition && condition.startsWith('!') && !condition.startsWith('!=')) {
      condition = `not(${condition.slice(1)})`;
    }
    const condValue = condition ? (condition as unknown as object) : null;
    store.patchCondition(nodeId, condValue);
    return { success: true, data: { message: condition ? `Set condition` : 'Removed condition' } };
  },

  set_repeat(input, getStore) {
    const store = getStore();
    // Accept `expression` as an alias for `mapPath` — Phase 3 Haiku may call with the wrong key.
    // Guard against null/undefined path to prevent silently clearing an existing repeat binding.
    const mapPath = (input.mapPath ?? input.expression) as string | undefined;
    const keyField = (input.keyField as string | undefined) ?? 'id';
    if (!mapPath) {
      return { success: false, error: 'set_repeat requires mapPath — skipping to avoid clearing existing repeat binding.' };
    }
    store.patchMap(input.nodeId as string, mapPath, keyField);
    return { success: true, data: { message: `Set repeat over "${mapPath}"` } };
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

    const PROHIBITED_STEP_TYPES = new Set(['customJavaScript', 'animate']);
    const prohibitedError = findProhibitedStep(steps, PROHIBITED_STEP_TYPES);
    if (prohibitedError) {
      return { success: false, error: prohibitedError };
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
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;

    // Read existing animation to merge (preserve unspecified fields)
    const node = findNode(store.pageNodes as SDUINode[], nodeId);
    const existing = ((node as unknown as Record<string, unknown>)?.animation ?? {}) as Record<string, unknown>;
    const animation: Record<string, unknown> = { ...existing };

    if (input.enter !== undefined) {
      if (input.enter === 'none') {
        delete animation.enter;
      } else {
        const enterCfg: Record<string, unknown> = {
          type: input.enter,
          duration: Number(input.enterDuration ?? 300),
        };
        if (input.enterDelay !== undefined) enterCfg.delay = Number(input.enterDelay);
        if (input.enterStagger !== undefined) enterCfg.stagger = Number(input.enterStagger);
        if (input.enterEasing !== undefined) enterCfg.easing = input.enterEasing;
        if (input.enterSpring !== undefined) enterCfg.spring = input.enterSpring;
        if (input.enterStiffness !== undefined) enterCfg.stiffness = Number(input.enterStiffness);
        if (input.enterDamping !== undefined) enterCfg.damping = Number(input.enterDamping);
        if (input.enterMass !== undefined) enterCfg.mass = Number(input.enterMass);
        animation.enter = enterCfg;
      }
    } else {
      // Apply individual enter overrides if only modifier params provided (no enter type change)
      if (animation.enter) {
        const ec = animation.enter as Record<string, unknown>;
        if (input.enterDuration !== undefined) ec.duration = Number(input.enterDuration);
        if (input.enterDelay !== undefined) ec.delay = Number(input.enterDelay);
        if (input.enterEasing !== undefined) ec.easing = input.enterEasing;
        if (input.enterSpring !== undefined) ec.spring = input.enterSpring;
        if (input.enterStiffness !== undefined) ec.stiffness = Number(input.enterStiffness);
        if (input.enterDamping !== undefined) ec.damping = Number(input.enterDamping);
        if (input.enterMass !== undefined) ec.mass = Number(input.enterMass);
      }
    }

    if (input.exit !== undefined) {
      if (input.exit === 'none') {
        delete animation.exit;
      } else {
        const exitCfg: Record<string, unknown> = { type: input.exit, duration: Number(input.exitDuration ?? 300) };
        if (input.exitDelay !== undefined) exitCfg.delay = Number(input.exitDelay);
        if (input.exitEasing !== undefined) exitCfg.easing = input.exitEasing;
        animation.exit = exitCfg;
      }
    } else {
      if (animation.exit) {
        const ec = animation.exit as Record<string, unknown>;
        if (input.exitDuration !== undefined) ec.duration = Number(input.exitDuration);
        if (input.exitDelay !== undefined) ec.delay = Number(input.exitDelay);
        if (input.exitEasing !== undefined) ec.easing = input.exitEasing;
      }
    }

    if (input.loop !== undefined) {
      if (input.loop === 'none') {
        delete animation.loop;
      } else {
        const loopCfg: Record<string, unknown> = {
          type: input.loop,
          duration: Number(input.loopDuration ?? 1500),
          repeatCount: input.loopRepeatCount !== undefined ? Number(input.loopRepeatCount) : -1,
          direction: (input.loopDirection as string | undefined) ?? 'alternate',
        };
        if (input.loopDelay !== undefined) loopCfg.delay = Number(input.loopDelay);
        if (input.loopColor !== undefined) loopCfg.color = input.loopColor;
        animation.loop = loopCfg;
      }
    } else {
      if (animation.loop) {
        const lc = animation.loop as Record<string, unknown>;
        if (input.loopDuration !== undefined) lc.duration = Number(input.loopDuration);
        if (input.loopDelay !== undefined) lc.delay = Number(input.loopDelay);
        if (input.loopRepeatCount !== undefined) lc.repeatCount = Number(input.loopRepeatCount);
        if (input.loopDirection !== undefined) lc.direction = input.loopDirection;
        if (input.loopColor !== undefined) lc.color = input.loopColor;
      }
    }

    if (input.hover !== undefined || input.hoverScale !== undefined || input.hoverOpacity !== undefined ||
        input.hoverY !== undefined || input.hoverDuration !== undefined || input.hoverEasing !== undefined) {
      if (input.hover === 'none') {
        delete animation.hover;
      } else {
        // HoverConfig fields: scale, opacity, y, duration, easing — no "type" or "value"
        const existingHover = (animation.hover as Record<string, unknown> | undefined) ?? {};
        let hoverCfg: Record<string, unknown> = { ...existingHover };
        if (input.hover === 'scale') hoverCfg = { scale: 1.05, duration: 200, ...hoverCfg };
        else if (input.hover === 'lift') hoverCfg = { y: -4, duration: 200, ...hoverCfg };
        if (input.hoverScale !== undefined) hoverCfg.scale = Number(input.hoverScale);
        if (input.hoverOpacity !== undefined) hoverCfg.opacity = Number(input.hoverOpacity) / 100;
        if (input.hoverY !== undefined) hoverCfg.y = Number(input.hoverY);
        if (input.hoverDuration !== undefined) hoverCfg.duration = Number(input.hoverDuration);
        if (input.hoverEasing !== undefined) hoverCfg.easing = input.hoverEasing;
        if (Object.keys(hoverCfg).length) animation.hover = hoverCfg;
      }
    }

    if (input.press !== undefined || input.pressScale !== undefined || input.pressOpacity !== undefined ||
        input.pressX !== undefined || input.pressY !== undefined || input.pressDuration !== undefined || input.pressEasing !== undefined) {
      if (input.press === 'none') {
        delete animation.press;
      } else {
        // PressConfig fields: scale, opacity, x, y, duration, easing — no "type" or "value"
        const existingPress = (animation.press as Record<string, unknown> | undefined) ?? {};
        let pressCfg: Record<string, unknown> = { ...existingPress };
        if (input.press === 'scale') pressCfg = { scale: 0.95, duration: 100, ...pressCfg };
        else if (input.press === 'bounce') pressCfg = { scale: 0.9, duration: 100, ...pressCfg };
        if (input.pressScale !== undefined) pressCfg.scale = Number(input.pressScale);
        if (input.pressOpacity !== undefined) pressCfg.opacity = Number(input.pressOpacity) / 100;
        if (input.pressX !== undefined) pressCfg.x = Number(input.pressX);
        if (input.pressY !== undefined) pressCfg.y = Number(input.pressY);
        if (input.pressDuration !== undefined) pressCfg.duration = Number(input.pressDuration);
        if (input.pressEasing !== undefined) pressCfg.easing = input.pressEasing;
        if (Object.keys(pressCfg).length) animation.press = pressCfg;
      }
    }

    if (input.scroll !== undefined) {
      if (input.scroll === 'none') {
        delete animation.scroll;
      } else {
        const scrollCfg: Record<string, unknown> = { type: input.scroll, duration: Number(input.scrollDuration ?? 500) };
        if (input.scrollDelay !== undefined) scrollCfg.delay = Number(input.scrollDelay);
        if (input.scrollThreshold !== undefined) scrollCfg.threshold = Number(input.scrollThreshold);
        if (input.scrollOnce !== undefined) scrollCfg.once = input.scrollOnce;
        if (input.scrollEasing !== undefined) scrollCfg.easing = input.scrollEasing;
        animation.scroll = scrollCfg;
      }
    } else {
      if (animation.scroll) {
        const sc = animation.scroll as Record<string, unknown>;
        if (input.scrollDuration !== undefined) sc.duration = Number(input.scrollDuration);
        if (input.scrollDelay !== undefined) sc.delay = Number(input.scrollDelay);
        if (input.scrollThreshold !== undefined) sc.threshold = Number(input.scrollThreshold);
        if (input.scrollOnce !== undefined) sc.once = input.scrollOnce;
        if (input.scrollEasing !== undefined) sc.easing = input.scrollEasing;
      }
    }

    if (input.shimmer !== undefined) {
      if (input.shimmer === false || input.shimmer === 'none') {
        delete animation.shimmer;
      } else {
        animation.shimmer = { baseColor: '#e5e7eb', highlightColor: '#f9fafb', duration: 1500 };
      }
    }

    if (input.filterBlur !== undefined) {
      const blurVal = Number(input.filterBlur);
      const existingFilter = (animation.filter ?? {}) as Record<string, unknown>;
      if (blurVal <= 0) {
        const { blur: _b, ...restFilter } = existingFilter;
        animation.filter = Object.keys(restFilter).length ? { ...restFilter, enabled: true } : undefined;
      } else {
        animation.filter = { ...existingFilter, enabled: true, blur: blurVal };
      }
    }

    // Color/FX filters — write into animation.filter object
    const filterKeys = ['filterBrightness', 'filterContrast', 'filterSaturate', 'filterGrayscale', 'filterHueRotate'] as const;
    const filterFieldMap: Record<string, string> = {
      filterBrightness: 'brightness',
      filterContrast: 'contrast',
      filterSaturate: 'saturate',
      filterGrayscale: 'grayscale',
      filterHueRotate: 'hueRotate',
    };
    for (const key of filterKeys) {
      if (input[key] !== undefined) {
        const existingFilter = (animation.filter ?? {}) as Record<string, unknown>;
        animation.filter = { ...existingFilter, enabled: true, [filterFieldMap[key]]: Number(input[key]) };
      }
    }

    if (input.backdropBlur !== undefined) {
      const bdVal = Number(input.backdropBlur);
      const existingFilter = (animation.filter ?? {}) as Record<string, unknown>;
      if (bdVal <= 0) {
        const { backdropBlur: _b, ...restFilter } = existingFilter;
        animation.filter = Object.keys(restFilter).length ? { ...restFilter, enabled: true } : undefined;
      } else {
        animation.filter = { ...existingFilter, enabled: true, backdropBlur: bdVal };
      }
    }

    if (input.gradientColors !== undefined) {
      const colors = input.gradientColors as string[];
      if (!colors || colors.length < 2) {
        // Remove gradient
        const { backgroundImage: _bi, backgroundSize: _bs, backgroundRepeat: _br, ...restOuter } = (animation.outerStyle ?? {}) as Record<string, unknown>;
        animation.outerStyle = Object.keys(restOuter).length ? restOuter : undefined;
        // Also remove gradientDrift loop if present
        if ((animation.loop as Record<string, unknown>)?.type === 'gradientDrift') delete animation.loop;
      } else {
        // Repeat first color at end for seamless loop
        const gradient = `linear-gradient(to right, ${[...colors, colors[0]].join(', ')})`;
        animation.outerStyle = {
          ...((animation.outerStyle ?? {}) as Record<string, unknown>),
          backgroundImage: gradient,
          backgroundSize: '300% 100%',
          backgroundRepeat: 'no-repeat',
        };
        // Auto-enable gradientDrift loop if not already set
        if (!(animation.loop as Record<string, unknown>)?.type) {
          animation.loop = { type: 'gradientDrift', duration: 3000, repeatCount: -1, direction: 'alternate' };
        }
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
    const nodeErr = requireNode(store, input.nodeId as string);
    if (nodeErr) return nodeErr;
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
 * The AI generates its own UUIDs for nodeId on every add_component call and uses
 * those same UUIDs as parentId for children in the same batch. No alias resolution
 * needed — UUIDs pass through directly.
 */
export async function executeTools(
  toolCalls: Array<{ name: string; input: ToolInput; id: string }>,
  getStore: StoreGetter,
): Promise<Array<{ id: string; result: ToolResult }>> {
  const results: Array<{ id: string; result: ToolResult }> = [];
  for (const call of toolCalls) {
    const result = await executeTool(call.name, call.input, getStore);
    results.push({ id: call.id, result });
  }
  return results;
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

// ─── Shared formula detection used by set_text and generate_structure ────────

const FORMULA_SCOPE_RE = /variables\s*\[|context[?.]+item|context\s*\.\s*item|theme\s*\??\s*\[|route\s*\??\s*\.|auth\s*\??\s*\.|_workflow\s*\??\s*\.|local\s*\??\s*\.|collections\s*\[|event\s*\??\s*\.|pages\s*\??\s*\[|globalContext\s*\??\s*\[/;

function toTextValue(raw: string): unknown {
  const templateMatch = raw.match(/^\{\{([\s\S]+)\}\}$/);
  const hasTemplateMarkers = /\{\{/.test(raw);
  if (templateMatch) return { formula: templateMatch[1] };
  if (FORMULA_SCOPE_RE.test(raw) && !hasTemplateMarkers) return { formula: raw };
  return raw;
}

// ─── generate_structure — materialize full tree from server-assigned UUIDs ───

handlers['generate_structure'] = function generateStructure(input, getStore) {
  const store = getStore();
  const treeInput = input.tree as Record<string, unknown>;
  const parentId = (input.parentId as string | null) ?? null;
  const atIdx = input.atIndex as number | undefined;

  if (parentId && !findNode(store.pageNodes as SDUINode[], parentId)) {
    return { success: false, error: `Parent node "${parentId}" not found in the current page. Call get_page_tree first to get valid node IDs, or omit parentId to add at the page root.` };
  }

  // _pageId is set by parallel build mode to insert into a non-active page.
  const targetPageId = input._pageId as string | undefined;

  // Deferred ops: repeat/condition collected during materialize, applied after addNode.
  const deferredOps: Array<{ nodeId: string; repeat?: string; keyField?: string; condition?: string }> = [];
  // Label tracking: nodeId → original label (for Switch auto-wiring).
  const labelMap = new Map<string, string>();

  // Walk tree: materialize each node via getTemplate(label) + merge AI props over defaults.
  // Server has pre-assigned crypto.randomUUID() to every node.id — we preserve them.
  //
  // inheritedBase: when the parent compound component's defaultNode has a corresponding child at
  // this position, that child object is passed as inheritedBase so this node inherits the compound
  // parent's specific styling rather than the generic primitive's defaultNode.  This cascades
  // recursively to any depth — each inherited base carries its own children array which becomes
  // the source for the next level's inheritedBase values.
  function materialize(node: Record<string, unknown>, inheritedBase?: Record<string, unknown>, repeatDepth = 0): SDUINode {
    const label = node.label as string | undefined;
    const base: Record<string, unknown> = inheritedBase
      ? { ...inheritedBase, props: { ...(inheritedBase.props as Record<string, unknown> ?? {}) } }
      : label
        ? ((getTemplate(label) ?? { id: node.id, type: label, props: {} }) as unknown as Record<string, unknown>)
        : { id: node.id, type: node.type ?? 'Box', props: {} };

    // Preserve server-assigned UUID
    base.id = node.id;

    // Track original label for Switch auto-wiring
    if (label) labelMap.set(base.id as string, label);

    // Strip no-op conditions before storing
    if (node.condition === 'true' || node.condition === 'false') {
      delete node.condition;
    }

    const childDepth = node.repeat ? repeatDepth + 1 : repeatDepth;

    // Fix parent scope misuse — context?.item?.parent is only valid inside a nested repeat (depth >= 2).
    // At depth < 2 there is no outer repeat, so parent resolves to undefined.
    if (repeatDepth < 2) {
      for (const field of ['text', 'icon'] as const) {
        if (node[field] && typeof node[field] === 'string') {
          node[field] = (node[field] as string).replace(
            /context\?\.\s*item\?\.\s*parent\?\.\s*data/g,
            'context?.item?.data',
          );
        }
      }
    }

    // Collect inline repeat/condition for deferred application after addNode
    if (node.repeat || node.condition) {
      const op: { nodeId: string; repeat?: string; keyField?: string; condition?: string } = { nodeId: base.id as string };
      if (node.repeat) { op.repeat = node.repeat as string; op.keyField = (node.keyField as string) ?? 'id'; }
      if (node.condition) op.condition = node.condition as string;
      deferredOps.push(op);
    }

    // Auto-inject video defaults so Video nodes in generate_structure behave like add_video
    if (label === 'Video') {
      const vProps = ((base.props ?? {}) as Record<string, unknown>);
      if (vProps.autoPlay === undefined) vProps.autoPlay = true;
      if (vProps.loop === undefined)     vProps.loop = true;
      if (vProps.muted === undefined)    vProps.muted = true;
      if (vProps.controls === undefined) vProps.controls = false;
      if (vProps.objectFit === undefined) vProps.objectFit = 'cover';
      base.props = vProps;
    }

    // Apply name (layers label)
    if (node.name) base.name = node.name;

    // Apply direction shortcut — "row" or "column" sets flex direction on this container.
    // Expressed in the tree definition so no separate set_layout call is needed.
    // We call buildLayoutClass directly because the node hasn't been inserted into the store yet.
    if (node.direction === 'row' || node.direction === 'column') {
      const currentCls = ((base.props as Record<string, unknown>)?.className as string) ?? '';
      const newCls = buildLayoutClass({ direction: node.direction as string }, currentCls);
      (base.props as Record<string, unknown>).className = newCls;
    }

    // Apply text shortcut — apply formula detection so formula expressions are stored as
    // { formula: "..." } instead of literal strings (same logic as set_text handler).
    if (node.text) {
      const textVal = toTextValue(node.text as string);
      base.text = textVal;
      (base.props as Record<string, unknown>).text = textVal;
    }

    // Allow user-pasted src on Image nodes; strip from Video so AI is forced to call search_videos.
    if (node.src && label !== 'Video') base.src = node.src;

    // Recurse: AI children override template children when provided.
    // When base comes from a compound defaultNode (via inheritedBase), its children array holds
    // the compound-specific defaults for each child position.  Pass each as inheritedBase so
    // the child inherits the compound's styling instead of the generic primitive's defaultNode.
    const aiChildren = Array.isArray(node.children) ? node.children as Record<string, unknown>[] : null;
    const baseChildren = Array.isArray(base.children) ? base.children as Record<string, unknown>[] : [];
    if (aiChildren && aiChildren.length > 0) {
      base.children = aiChildren.map((c, i) => materialize(c, baseChildren[i] as Record<string, unknown> | undefined, childDepth));
    } else if (!base.children) {
      base.children = [];
    }

    // Propagate node.text to the first Text/Heading child when the parent has children
    // (e.g. Badge Box with text: "Most Popular" should pass that text to its inner Text node).
    if (node.text && Array.isArray(base.children)) {
      const textChild = (base.children as Record<string, unknown>[]).find(c =>
        c.type === 'Text' || c.type === 'Heading'
      );
      if (textChild) {
        const textVal = toTextValue(node.text as string);
        textChild.text = textVal;
        if (!textChild.props) textChild.props = {};
        (textChild.props as Record<string, unknown>).text = textVal;
      }
    }

    return base as unknown as SDUINode;
  }

  const materializedTree = materialize(treeInput);

  // ── Merge duplicate repeat siblings ──────────────────────────────────────────
  // The AI sometimes creates two sibling templates with opposite conditions
  // (e.g. Card with condition !featured + Card with condition featured) both
  // repeating over the same array. This doubles styling work and renders items
  // out of order. Detect and merge: keep the richer template, strip its
  // root condition, remove the duplicate.
  (function deduplicateRepeatSiblings(node: SDUINode) {
    const children = node.children as SDUINode[] | undefined;
    if (!Array.isArray(children) || children.length < 2) {
      children?.forEach(c => deduplicateRepeatSiblings(c));
      return;
    }

    // Group children by their repeat path (from deferredOps)
    const repeatByChild = new Map<string, string>();
    for (const op of deferredOps) {
      if (op.repeat) repeatByChild.set(op.nodeId, op.repeat);
    }

    const groups = new Map<string, number[]>();
    for (let i = 0; i < children.length; i++) {
      const childId = (children[i] as { id?: string }).id;
      if (!childId) continue;
      const rp = repeatByChild.get(childId);
      if (!rp) continue;
      if (!groups.has(rp)) groups.set(rp, []);
      groups.get(rp)!.push(i);
    }

    // Count total descendants for tie-breaking
    function countNodes(n: SDUINode): number {
      let c = 1;
      if (Array.isArray(n.children)) for (const ch of n.children as SDUINode[]) c += countNodes(ch);
      return c;
    }

    const removeIndices = new Set<number>();
    for (const [, indices] of groups) {
      if (indices.length < 2) continue;
      // Keep the sibling with the most descendants (likely the "featured" variant with extra Badge)
      indices.sort((a, b) => countNodes(children[b]) - countNodes(children[a]));
      const keepIdx = indices[0];
      const keepId = (children[keepIdx] as { id?: string }).id!;

      // Strip root-level condition from the kept template so it shows for ALL items
      const keepOp = deferredOps.find(op => op.nodeId === keepId);
      if (keepOp) delete keepOp.condition;

      for (let k = 1; k < indices.length; k++) removeIndices.add(indices[k]);
    }

    if (removeIndices.size > 0) {
      const removedIds = new Set<string>();
      const sorted = [...removeIndices].sort((a, b) => b - a);
      for (const idx of sorted) {
        const removedId = (children[idx] as { id?: string }).id;
        if (removedId) removedIds.add(removedId);
        children.splice(idx, 1);
      }
      // Purge deferredOps for removed nodes
      for (let i = deferredOps.length - 1; i >= 0; i--) {
        if (removedIds.has(deferredOps[i].nodeId)) deferredOps.splice(i, 1);
      }
    }

    children.forEach(c => deduplicateRepeatSiblings(c));
  })(materializedTree);

  if (targetPageId) {
    store.insertNodeIntoPage(targetPageId, materializedTree);
    // Switch the active page immediately so that set_text / set_repeat calls
    // in the same batch can find the newly-inserted nodes via store.pageNodes.
    store.navigatePage(targetPageId);
  } else {
    store.addNode(materializedTree, parentId, atIdx);
  }

  // Apply deferred inline repeat/condition from tree nodes
  for (const op of deferredOps) {
    if (op.repeat) {
      const normalizedRepeat = op.repeat.replace(/\?\./g, '.');
      store.patchMap(op.nodeId, normalizedRepeat, op.keyField ?? 'id');
    }
    if (op.condition) {
      let cond = op.condition;
      if (typeof cond === 'string' && cond.startsWith('!') && !cond.startsWith('!=')) {
        cond = `not(${cond.slice(1)})`;
      }
      store.patchCondition(op.nodeId, cond as unknown as object);
    }
  }

  // Auto-wire Switch/Switch On sibling pairs with boolean variable conditions
  const boolVarIds = (input._boolVarIds ?? []) as string[];
  if (boolVarIds.length > 0) {
    const boolVarId = boolVarIds[0];
    (function autoWireSwitchPairs(node: SDUINode) {
      if (!Array.isArray(node.children)) return;
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i] as SDUINode;
        const next = node.children[i + 1] as SDUINode | undefined;
        if (!child?.id || !next?.id) continue;
        const childLabel = labelMap.get(child.id);
        const nextLabel = labelMap.get(next.id);
        if (childLabel === 'Switch' && nextLabel === 'Switch On') {
          if (!child.condition) store.patchCondition(child.id, `not(variables['${boolVarId}'])` as unknown as object);
          if (!next.condition) store.patchCondition(next.id, `variables['${boolVarId}']` as unknown as object);
        }
        autoWireSwitchPairs(child);
      }
    })(materializedTree);
  }

  return { success: true, data: { message: 'Structure inserted.' } };
};

// ─── bulk_apply — apply same style tool to multiple nodes ──────────────────

handlers['bulk_apply'] = function bulkApply(input, getStore) {
  const nodeIds = input.nodeIds as string[];
  const toolName = input.tool as string;
  const params = input.params as Record<string, unknown>;

  const SUPPORTED = new Set([
    'set_spacing', 'set_border', 'set_background', 'set_typography', 'set_opacity', 'set_size', 'set_position',
    'set_layout', 'set_icon', 'set_text_color', 'set_animation',
  ]);
  if (!SUPPORTED.has(toolName)) {
    return { success: false, error: `Unsupported tool "${toolName}". Supported: ${[...SUPPORTED].join(', ')}` };
  }

  const errors: string[] = [];
  for (const nodeId of nodeIds) {
    const handler = handlers[toolName];
    if (!handler) { errors.push(`${nodeId}: handler for "${toolName}" not found`); continue; }
    const res = handler({ ...params, nodeId }, getStore) as ToolResult;
    if (!res.success) errors.push(`${nodeId}: ${res.error ?? 'unknown error'}`);
  }

  if (errors.length) return { success: false, error: errors.join('\n') };
  return { success: true, data: { message: `Applied ${toolName} to ${nodeIds.length} nodes.` } };
};

// ─── Mutation tool set (executed client-side) ─────────────────────────────────

export const CLIENT_SIDE_TOOLS = new Set([
  'generate_structure', 'bulk_apply',
  'add_component', 'add_icon', 'add_image', 'add_video',
  'delete_node', 'duplicate_node', 'move_node_up', 'move_node_down', 'move_node', 'wrap_in_container',
  'set_text', 'set_placeholder', 'set_href', 'set_src', 'set_icon', 'set_video_props',
  'set_background', 'set_text_color', 'set_typography', 'set_border', 'set_shadow',
  'set_opacity', 'set_spacing', 'set_size', 'set_position', 'set_transform', 'set_overflow',
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
