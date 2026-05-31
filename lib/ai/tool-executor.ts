/**
 * Tool Executor — maps AI tool calls to builder Zustand store actions.
 *
 * Design: The AI uses semantic builder actions, never raw JSON.
 * - add_component("Label") → looks up COMPONENT_SCHEMA[label] → inserts template
 * - set_text(id, "Hello") → patchProp(id, "text", "Hello")
 * - set_background(id, {bg:"primary"}) → resolves to bg-[var(--theme-primary)], patches className
 *
 * All node mutations auto-push to history via the store actions.
 */

import type { SDUINode } from '@/lib/sdui/types/node';
import type { BuilderStore, CustomVar, DataSourceConfig, GlobalFormulaDef, GlobalFormulaParam } from '@/app/dev/builder/_store-types';
import { COMPONENT_SCHEMA } from './sdui-component-schema';
import {
  validateWorkflowFormulas,
  findProhibitedStep,
  validateStepTypes,
  validateMultiOptionBranches,
  validateChangeVariableUUIDs,
  SUPPORTED_STEP_TYPES,
} from './workflow-validator';
import { replaceTwToken, removeTwToken } from '@/app/dev/builder/_tw-utils';
import { getSharedComponents, createSharedComponent, updateSharedComponent, deleteSharedComponent } from '@/lib/builder/shared-component-data';
import { cloneWithFreshIdsKeepSharedKey, stampSharedKeys } from '@/app/dev/builder/_store-node-helpers';
import { findThemePreset, THEME_PRESETS } from '@/lib/builder/theme-presets';
import {
  type ToolGroup,
  getCapabilities,
  buildCapabilityNote,
  buildBlockedGroupSuggestion,
} from './component-capabilities';

export type ToolInput = Record<string, unknown>;

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type StoreGetter = () => BuilderStore;

// ─── Formula validator ────────────────────────────────────────────────────────
// validateFormula, validateWorkflowFormulas, findProhibitedStep, and
// PROHIBITED_STEP_TYPES are imported from ./workflow-validator (shared with route.ts).

// Converts stringified binding wrappers to proper objects.
// The AI sometimes stringifies the binding wrapper instead of emitting a real JSON object.
// Handles both legacy "{ formula: \"...\" }" and modern "{ js: \"...\" }" strings.
function tryCoerceStringFormula(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  const jsMatch = trimmed.match(/^\{\s*js:\s*"([\s\S]*)"\s*\}$/);
  if (jsMatch) return { js: jsMatch[1].replace(/\\"/g, '"') };
  const jsSqMatch = trimmed.match(/^\{\s*js:\s*'([\s\S]*)'\s*\}$/);
  if (jsSqMatch) return { js: jsSqMatch[1].replace(/\\'/g, "'") };
  const dqMatch = trimmed.match(/^\{\s*formula:\s*"([\s\S]*)"\s*\}$/);
  if (dqMatch) return { js: dqMatch[1].replace(/\\"/g, '"') };
  const sqMatch = trimmed.match(/^\{\s*formula:\s*'([\s\S]*)'\s*\}$/);
  if (sqMatch) return { js: sqMatch[1].replace(/\\'/g, "'") };
  return value;
}

// Extracts the plain formula string from a "{ formula: \"...\" }" wrapper string.
// Used for condition fields (branch, multiOptionBranch, etc.) where the value must be a
// plain string, not a { formula: "..." } object.
function tryCoerceConditionString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  const dqMatch = trimmed.match(/^\{\s*formula:\s*"([\s\S]*)"\s*\}$/);
  if (dqMatch) return dqMatch[1].replace(/\\"/g, '"');
  const sqMatch = trimmed.match(/^\{\s*formula:\s*'([\s\S]*)'\s*\}$/);
  if (sqMatch) return sqMatch[1].replace(/\\'/g, "'");
  return value;
}

const CONDITION_STEP_TYPES = new Set(['branch', 'multiOptionBranch', 'passThroughCondition', 'whileLoop']);

// Recursively coerces all changeVariableValue config.value fields in steps and their nested branches/loops.
function coerceStepFormulas(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return steps.map(step => {
    const out = { ...step };
    if (step.type === 'changeVariableValue') {
      const cfg = step.config as Record<string, unknown> | undefined;
      if (cfg) {
        const coerced = tryCoerceStringFormula(cfg.value);
        if (coerced !== cfg.value) out.config = { ...cfg, value: coerced };
      }
    }
    // Coerce condition fields for branch/multiOptionBranch/passThroughCondition/whileLoop.
    // The AI sometimes wraps conditions in "{ formula: \"...\" }" strings, which at runtime
    // evaluate to a truthy object that never matches any branch match value → all clicks are no-ops.
    if (CONDITION_STEP_TYPES.has(step.type as string)) {
      const cfg = step.config as Record<string, unknown> | undefined;
      if (cfg && typeof cfg.condition === 'string') {
        const coerced = tryCoerceConditionString(cfg.condition);
        if (coerced !== cfg.condition) out.config = { ...(out.config as Record<string, unknown> ?? cfg), condition: coerced };
      }
    }
    if (Array.isArray(step.trueBranch)) out.trueBranch = coerceStepFormulas(step.trueBranch as Array<Record<string, unknown>>);
    if (Array.isArray(step.falseBranch)) out.falseBranch = coerceStepFormulas(step.falseBranch as Array<Record<string, unknown>>);
    if (Array.isArray(step.loopBody)) out.loopBody = coerceStepFormulas(step.loopBody as Array<Record<string, unknown>>);
    if (Array.isArray(step.defaultBranch)) out.defaultBranch = coerceStepFormulas(step.defaultBranch as Array<Record<string, unknown>>);
    if (Array.isArray(step.branches)) {
      out.branches = (step.branches as Array<Record<string, unknown>>).map(b => ({
        ...b,
        steps: Array.isArray(b.steps) ? coerceStepFormulas(b.steps as Array<Record<string, unknown>>) : b.steps,
      }));
    }
    return out;
  });
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

/** Find the direct parent of a node by childId. */


/**
 * Locate a node anywhere in the project — focused page first, then every other
 * page, then canvas roots. Used by tool handlers so the AI agent can mutate
 * nodes on a non-focused page without the canvas having to switch focus
 * (the store's `patchAnyNode` writes to `pages[i].nodes` directly when the
 * node lives off-screen).
 *
 * Returning the focused page first keeps the common interactive-edit path
 * O(1) on tree traversal — only AI multi-page tool calls fall through to the
 * cross-page scan.
 */
function findNodeInStore(store: BuilderStore, id: string): SDUINode | null {
  const focused = findNode(store.pageNodes as SDUINode[], id);
  if (focused) return focused;
  const pages = (store as { pages?: Array<{ id: string; nodes?: SDUINode[] }> }).pages ?? [];
  const focusedPageId = (store as { focusedPageId?: string }).focusedPageId;
  for (const p of pages) {
    if (p.id === focusedPageId) continue;
    const found = findNode((p.nodes ?? []) as SDUINode[], id);
    if (found) return found;
  }
  return null;
}


// ─── Require a node to exist — used by all setter tools ──────────────────────

function requireNode(
  store: BuilderStore,
  nodeId: string | undefined,
): { success: false; error: string } | null {
  if (!nodeId) return { success: false, error: 'nodeId is required.' };
  if (!findNodeInStore(store, nodeId)) {
    return {
      success: false,
      error: `Node "${nodeId}" not found in any page. Call get_page_tree first to get valid node UUIDs, or check whether a prior add_component step failed.`,
    };
  }
  return null;
}

// ─── Check component capability against the registry ─────────────────────────
//
// Returns { success: false, error } when the component type does not support
// the given tool group. Returns null when the call is allowed to proceed.
// Universal tools (opacity, position, animation, condition, etc.) are never
// passed here — they skip the capability check entirely.

function checkCapability(
  store: BuilderStore,
  nodeId: string,
  group: ToolGroup,
): { success: false; error: string } | null {
  const node = findNodeInStore(store, nodeId);
  if (!node) return null; // requireNode handles the missing-node error
  const componentType = (node.type as string | undefined) ?? 'Unknown';
  const caps = getCapabilities(componentType);
  if (caps === null) return null; // unknown type → no restriction
  if (!caps.includes(group)) {
    const suggestion = buildBlockedGroupSuggestion(group, componentType);
    return {
      success: false,
      error:
        `"${group}" tools are not supported on ${componentType}. ${suggestion} ` +
        `${buildCapabilityNote(componentType)}`,
    };
  }
  return null;
}

// ─── Navigate path validator — checks navigateTo.config.path against known pages ──

function validateNavigatePaths(
  steps: Array<Record<string, unknown>>,
  store: BuilderStore,
): string | null {
  const pages = (store as { pages?: Array<{ route?: string }> }).pages ?? [];
  const knownRoutes = new Set(pages.map(p => p.route).filter(Boolean));
  // Only validate when at least one page has a defined route.
  if (knownRoutes.size === 0) return null;

  for (const step of steps) {
    if (step.type === 'navigateTo') {
      const stepId = (step.id as string | undefined) ?? '?';
      const cfg = step.config as Record<string, unknown> | undefined;
      const path = cfg?.path as string | undefined;
      if (path && typeof path === 'string' && !path.startsWith('{{') && !path.includes('?')) {
        // Strip trailing slash for comparison
        const normalised = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
        if (!knownRoutes.has(normalised) && !knownRoutes.has(path)) {
          const suggestions = Array.from(knownRoutes).slice(0, 8).join(', ');
          return `Step "${stepId}" (navigateTo): path "${path}" does not match any known page route. Known routes: ${suggestions}. Call get_pages to see all pages.`;
        }
      }
    }
    for (const branch of ['trueBranch', 'falseBranch', 'loopBody', 'defaultBranch'] as const) {
      if (Array.isArray(step[branch])) {
        const err = validateNavigatePaths(step[branch] as Array<Record<string, unknown>>, store);
        if (err) return err;
      }
    }
    if (Array.isArray(step.branches)) {
      for (const b of step.branches as Array<Record<string, unknown>>) {
        if (Array.isArray(b.steps)) {
          const err = validateNavigatePaths(b.steps as Array<Record<string, unknown>>, store);
          if (err) return err;
        }
      }
    }
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
  const caps = getCapabilities(n.type as string);
  const base: Record<string, unknown> = {
    id: n.id,
    type: n.type,
    name: node.name,
    text: typeof node.text === 'string' ? (node.text as string).slice(0, 80) : undefined,
    className: (n.props as { className?: string })?.className?.slice(0, 100),
    // When map is set this node is a REPEAT TEMPLATE — it renders once per item.
    // Row/grid/gap layout for arranging multiple items belongs on the PARENT, not here.
    map: node.map,
    // tools lists the capability groups this component supports.
    // Universal tools (set_opacity, set_animation, set_condition, set_repeat,
    // bind_action, rename_node, set_transform) are always available and are
    // not listed here to keep the output compact.
    tools: caps ?? 'all',
  };
  if (depth > 0 && n.children?.length) {
    base.children = (n.children as SDUINode[]).map(c => summarizeNode(c, depth - 1));
  } else if (n.children?.length) {
    base.childCount = n.children.length;
  }
  return base;
}

// ─── Apply set_layout helper ─────────────────────────────────────────────────

/** Map CSS justify-content wording to Tailwind justify-* suffix (both forms accepted). */
function normJustifyCssToTwSuffix(v: string): string {
  let s = v.trim().replace(/^space-/, '');
  // Strip leading "justify-" if the AI passes the full class name (e.g. "justify-between" → "between")
  if (s.startsWith('justify-')) s = s.slice('justify-'.length);
  if (s === 'flex-start') s = 'start';
  if (s === 'flex-end') s = 'end';
  return s;
}

/** Map CSS align-items wording to Tailwind items-* suffix (both forms accepted). */
function normAlignCssToTwSuffix(v: string): string {
  let s = v.trim();
  // Strip leading "items-" if the AI passes the full class name (e.g. "items-start" → "start")
  if (s.startsWith('items-')) s = s.slice('items-'.length);
  if (s === 'flex-start') s = 'start';
  if (s === 'flex-end')   s = 'end';
  return s;
}

function buildLayoutClass(input: ToolInput, current = ''): string {
  let cls = current;

  if (input.direction === 'row') {
    cls = cls.replace(/\bflex-col\b/g, '').trim();
    if (!cls.includes('flex-row')) cls += ' flex-row';
    // Ensure display:flex is present — flex-row alone does not set it on web
    if (!cls.split(' ').includes('flex')) cls = `flex ${cls}`.trim();
  } else if (input.direction === 'column') {
    cls = cls.replace(/\bflex-row\b/g, '').trim();
    if (!cls.includes('flex-col')) cls += ' flex-col';
    if (!cls.split(' ').includes('flex')) cls = `flex ${cls}`.trim();
  }

  if (input.align)   cls = replaceTwToken(cls, 'items-', `items-${normAlignCssToTwSuffix(String(input.align))}`);
  if (input.justify) cls = replaceTwToken(cls, 'justify-', `justify-${normJustifyCssToTwSuffix(String(input.justify))}`);
  // gap is handled via inline style (written after buildLayoutClass via patchNodeStyle in set_layout executor)

  // Process padding in a single pass
  if (input.padding) {
    cls = cls.split(' ').filter(t => !/^p[xyblrt]?-/.test(t)).join(' ');
    cls += ` ${input.padding}`;
  }

  return cls.replace(/\s+/g, ' ').trim();
}

// ─── Semantic design helpers ──────────────────────────────────────────────────

function getNodeClassName(store: BuilderStore, nodeId: string): string {
  const node = findNodeInStore(store, nodeId);
  return (node?.props as { className?: string })?.className ?? '';
}

function setNodeClassName(store: BuilderStore, nodeId: string, cls: string): void {
  store.patchProp(nodeId, 'props.className', cls.replace(/\s+/g, ' ').trim());
}

// Helper: read the node's current inline style object.
function getNodeStyle(store: BuilderStore, nodeId: string): Record<string, unknown> {
  const node = findNodeInStore(store, nodeId);
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

/**
 * Unwraps a serialized formula object string that the AI sometimes produces
 * instead of a real nested JSON object. For example:
 *   '{"formula": "if(equal(...), \'#ff9500\', \'#333\')"}' → 'if(equal(...), \'#ff9500\', \'#333\')'
 * This happens because the AI encodes { "formula": "..." } as a JSON string
 * in the tool-call arguments rather than as a nested object.
 */
function unwrapSerializedFormula(val: string): string {
  const trimmed = val.trim();
  if (trimmed.startsWith('{') && trimmed.includes('"formula"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof (parsed as Record<string, unknown>).formula === 'string') {
        return (parsed as Record<string, string>).formula;
      }
    } catch {
      // not valid JSON — return as-is
    }
  }
  return val;
}

// Map friendly color names to CSS-variable Tailwind classes.
// prefix: 'bg' | 'text' | 'border'
// Resolves a theme token name or any color value to a raw CSS color string
// suitable for use inside CSS functions like linear-gradient().
// Unlike resolveColorClass(), this returns CSS var() references, not Tailwind classes.
function resolveColorForCSS(value: string): string {
  if (value.startsWith('theme:')) value = value.slice(6);
  const CSS_TOKENS: Record<string, string> = {
    primary:                'var(--theme-primary)',
    'primary-foreground':   'var(--theme-primary-foreground)',
    secondary:              'var(--theme-secondary)',
    'secondary-foreground': 'var(--theme-secondary-foreground)',
    card:                   'var(--theme-card)',
    'card-foreground':      'var(--theme-card-foreground)',
    background:             'var(--theme-background)',
    foreground:             'var(--theme-foreground)',
    muted:                  'var(--theme-muted)',
    'muted-foreground':     'var(--theme-muted-foreground)',
    accent:                 'var(--theme-accent)',
    'accent-foreground':    'var(--theme-accent-foreground)',
    destructive:            'var(--theme-destructive)',
    border:                 'var(--theme-border)',
  };
  return CSS_TOKENS[value] ?? value; // passthrough for hex, rgba, hsl, var(), etc.
}

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
  'min-screen': '100vh',
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

/** Coerce handler result — set_style delegates only sync handlers. */
function asSyncResult(r: ToolResult | Promise<ToolResult>): ToolResult {
  return r as ToolResult;
}

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
    const found: SDUINode[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const node = findNodeInStore(store, id);
      if (node) found.push(node);
      else missing.push(id);
    }
    if (missing.length > 0) {
      return {
        success: false,
        error: `Nodes not found: ${missing.join(', ')}. Call get_page_tree() to get valid node IDs.`,
        data: found.map(n => summarizeNode(n, 3)),
      };
    }
    return { success: true, data: found.map(n => summarizeNode(n, 3)) };
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

  get_formulas(_, getStore) {
    const store = getStore();
    return { success: true, data: store.globalFormulas ?? {} };
  },

  add_formula(input, getStore) {
    const store = getStore();
    const name = input.name as string;
    const formulaBody = (input.formula as string) ?? '';
    if (!name) return { success: false, error: 'add_formula requires name.' };
    const formulaId =
      (input.formulaId as string | undefined) && typeof input.formulaId === 'string'
        ? (input.formulaId as string)
        : crypto.randomUUID();
    const rawParams = (input.params as GlobalFormulaParam[] | undefined) ?? [];
    const params: GlobalFormulaParam[] = rawParams.map((p, i) => ({
      id: typeof p?.id === 'string' ? p.id : `p${i}`,
      name: typeof p?.name === 'string' ? p.name : `arg${i}`,
      type: (p?.type as GlobalFormulaParam['type']) ?? 'Text',
      testValue: p?.testValue,
    }));
    const def: GlobalFormulaDef = {
      name,
      params,
      formula: formulaBody,
      folder: input.folder as string | undefined,
      description: input.description as string | undefined,
    };
    store.setGlobalFormula(formulaId, def);
    return { success: true, data: { formulaId, name } };
  },

  update_formula(input, getStore) {
    const store = getStore();
    const formulaId = input.formulaId as string;
    const prev = store.globalFormulas?.[formulaId];
    if (!prev) return { success: false, error: `Formula "${formulaId}" not found.` };
    const next: GlobalFormulaDef = {
      ...prev,
      ...(input.name != null ? { name: input.name as string } : {}),
      ...(input.params != null ? { params: input.params as GlobalFormulaParam[] } : {}),
      ...(input.formula != null ? { formula: input.formula as string } : {}),
      ...(input.folder != null ? { folder: input.folder as string | undefined } : {}),
      ...(input.description != null ? { description: input.description as string | undefined } : {}),
    };
    store.setGlobalFormula(formulaId, next);
    return { success: true, data: { formulaId } };
  },

  update_formula_body(input, getStore) {
    const store = getStore();
    const formulaId = input.formulaId as string;
    const body = input.formula as string;
    const prev = store.globalFormulas?.[formulaId];
    if (!prev) return { success: false, error: `Formula "${formulaId}" not found.` };
    store.setGlobalFormula(formulaId, { ...prev, formula: body });
    return { success: true, data: { formulaId } };
  },

  delete_formula(input, getStore) {
    const store = getStore();
    const formulaId = input.formulaId as string;
    if (!store.globalFormulas?.[formulaId]) {
      return { success: false, error: `Formula "${formulaId}" not found.` };
    }
    store.removeGlobalFormula(formulaId);
    return { success: true, data: { formulaId } };
  },

  set_app_config(input, getStore) {
    const store = getStore();
    if (typeof input.projectAppName === 'string') {
      store.setProjectContext({ appName: input.projectAppName });
    }
    if (input.appPreviewData && typeof input.appPreviewData === 'object') {
      store.setAppPreviewData(input.appPreviewData as Record<string, unknown>);
    }
    const conv: Record<string, unknown> = {};
    if (typeof input.graphqlEndpoint === 'string') conv.graphqlEndpoint = input.graphqlEndpoint;
    if (input.graphqlHeaders && typeof input.graphqlHeaders === 'object') {
      conv.graphqlHeaders = input.graphqlHeaders;
    }
    if (typeof input.graphqlCredentials === 'string') conv.graphqlCredentials = input.graphqlCredentials;
    if (Object.keys(conv).length) {
      store.patchEngineConventions(conv as Parameters<typeof store.patchEngineConventions>[0]);
    }
    return { success: true, data: { message: 'App config updated.' } };
  },

  set_auth_config(input, getStore) {
    const store = getStore();
    const patch = input.patch as Record<string, unknown> | undefined;
    if (!patch || typeof patch !== 'object') {
      return { success: false, error: 'set_auth_config requires { patch: object }.' };
    }
    store.setAuthConfig({ ...(store.authConfig ?? {}), ...patch } as Parameters<typeof store.setAuthConfig>[0]);
    return { success: true, data: { message: 'Auth config merged.' } };
  },

  create_folder(input, getStore) {
    const store = getStore();
    const kind = input.kind as string;
    const name = input.name as string;
    const folderId = (input.folderId as string | undefined) ?? crypto.randomUUID();
    const parentId = (input.parentId as string | null | undefined) ?? null;
    if (!name) return { success: false, error: 'create_folder requires name.' };
    if (kind === 'variables') {
      store.addVarFolder({ id: folderId, name, parentId });
      return { success: true, data: { folderId, kind } };
    }
    if (kind === 'data-sources') {
      store.addDsFolder({ id: folderId, name, parentId });
      return { success: true, data: { folderId, kind } };
    }
    if (kind === 'colors') {
      store.addColorFolder({ id: folderId, name, parentId });
      return { success: true, data: { folderId, kind } };
    }
    return { success: false, error: `Folder kind "${kind}" is not supported yet (use variables, data-sources, colors).` };
  },

  rename_folder(input, getStore) {
    const store = getStore();
    const kind = input.kind as string;
    const folderId = input.folderId as string;
    const name = input.name as string;
    if (kind === 'variables') store.updateVarFolder(folderId, name);
    else if (kind === 'data-sources') store.updateDsFolder(folderId, name);
    else if (kind === 'colors') store.updateColorFolder(folderId, name);
    else return { success: false, error: `Unknown folder kind "${kind}".` };
    return { success: true, data: { folderId, name } };
  },

  delete_folder(input, getStore) {
    const store = getStore();
    const kind = input.kind as string;
    const folderId = input.folderId as string;
    if (kind === 'variables') store.removeVarFolder(folderId);
    else if (kind === 'data-sources') store.removeDsFolder(folderId);
    else if (kind === 'colors') store.removeColorFolder(folderId);
    else return { success: false, error: `Unknown folder kind "${kind}".` };
    return { success: true, data: { folderId } };
  },

  update_data_source_schema(input, getStore) {
    const store = getStore();
    const sourceId = input.sourceId as string;
    const list = store.pageDataSources ?? [];
    const idx = list.findIndex((d: DataSourceConfig) => d.id === sourceId);
    if (idx < 0) return { success: false, error: `Data source "${sourceId}" not found.` };
    const cur = list[idx] as DataSourceConfig;
    const patch: Partial<DataSourceConfig> = {};
    const assign = <K extends keyof DataSourceConfig>(k: K, v: unknown) => {
      if (v !== undefined) (patch as Record<string, unknown>)[k as string] = v;
    };
    assign('name', input.name);
    assign('_label', input.name);
    assign('type', input.type);
    assign('url', input.url);
    assign('method', input.method);
    assign('endpoint', input.endpoint);
    assign('query', input.query);
    assign('variables', input.variables);
    assign('headers', input.headers);
    assign('body', input.body);
    assign('queryParams', input.queryParams);
    assign('auth', input.auth);
    assign('responsePath', input.responsePath);
    assign('storeIn', input.storeIn);
    assign('trigger', input.trigger);
    store.updatePageDataSource(sourceId, { ...cur, ...patch });
    return { success: true, data: { sourceId } };
  },

  update_variable_initial_value(input, getStore) {
    const store = getStore();
    const variableId = input.variableId as string;
    const v = input.initialValue;
    const custom = store.customVars ?? [];
    const found = custom.find(x => x.id === variableId || x.name === variableId);
    if (!found) return { success: false, error: `Variable "${variableId}" not found.` };
    store.updateCustomVar(found.name, { initialValue: v });
    return { success: true, data: { variableId: found.id, name: found.name } };
  },

  patch_variable_item(input, getStore) {
    const store = getStore();
    const variableId = input.variableId as string;
    const index = input.index as number;
    const fields = input.fields as Record<string, unknown>;
    const found = (store.customVars ?? []).find(x => x.id === variableId || x.name === variableId);
    if (!found) return { success: false, error: `Variable "${variableId}" not found.` };
    const arr = Array.isArray(found.initialValue) ? [...(found.initialValue as unknown[])] : [];
    if (index < 0 || index >= arr.length) return { success: false, error: `index ${index} out of range (array length ${arr.length}).` };
    arr[index] = { ...(arr[index] as object), ...fields };
    store.updateCustomVar(found.name, { initialValue: arr });
    return { success: true, data: { variableId: found.id, name: found.name, index, updatedKeys: Object.keys(fields) } };
  },

  patch_variable_items(input, getStore) {
    const store = getStore();
    const variableId = input.variableId as string;
    const updates = input.updates as Array<{ index: number; fields: Record<string, unknown> }>;
    const found = (store.customVars ?? []).find(x => x.id === variableId || x.name === variableId);
    if (!found) return { success: false, error: `Variable "${variableId}" not found.` };
    const arr = Array.isArray(found.initialValue) ? [...(found.initialValue as unknown[])] : [];
    const errors: string[] = [];
    for (const { index, fields } of updates) {
      if (index < 0 || index >= arr.length) { errors.push(`index ${index} out of range`); continue; }
      arr[index] = { ...(arr[index] as object), ...fields };
    }
    store.updateCustomVar(found.name, { initialValue: arr });
    return { success: true, data: { variableId: found.id, name: found.name, patchedCount: updates.length - errors.length, errors } };
  },

  patch_variable_fields(input, getStore) {
    const store = getStore();
    const variableId = input.variableId as string;
    const fields = input.fields as Record<string, unknown>;
    const found = (store.customVars ?? []).find(x => x.id === variableId || x.name === variableId);
    if (!found) return { success: false, error: `Variable "${variableId}" not found.` };
    const current = (typeof found.initialValue === 'object' && found.initialValue !== null && !Array.isArray(found.initialValue))
      ? found.initialValue as Record<string, unknown>
      : {};
    store.updateCustomVar(found.name, { initialValue: { ...current, ...fields } });
    return { success: true, data: { variableId: found.id, name: found.name, updatedKeys: Object.keys(fields) } };
  },

  append_variable_item(input, getStore) {
    const store = getStore();
    const variableId = input.variableId as string;
    const item = input.item;
    const found = (store.customVars ?? []).find(x => x.id === variableId || x.name === variableId);
    if (!found) return { success: false, error: `Variable "${variableId}" not found.` };
    const arr = Array.isArray(found.initialValue) ? [...(found.initialValue as unknown[])] : [];
    arr.push(item);
    store.updateCustomVar(found.name, { initialValue: arr });
    return { success: true, data: { variableId: found.id, name: found.name, newLength: arr.length, newIndex: arr.length - 1 } };
  },

  remove_variable_item(input, getStore) {
    const store = getStore();
    const variableId = input.variableId as string;
    const index = input.index as number;
    const found = (store.customVars ?? []).find(x => x.id === variableId || x.name === variableId);
    if (!found) return { success: false, error: `Variable "${variableId}" not found.` };
    const arr = Array.isArray(found.initialValue) ? [...(found.initialValue as unknown[])] : [];
    if (index < 0 || index >= arr.length) return { success: false, error: `index ${index} out of range (array length ${arr.length}).` };
    arr.splice(index, 1);
    store.updateCustomVar(found.name, { initialValue: arr });
    return { success: true, data: { variableId: found.id, name: found.name, removedIndex: index, newLength: arr.length } };
  },

  update_workflow_steps(input, getStore) {
    const store = getStore();
    const workflowName = input.workflowName as string;
    let rawSteps = input.steps as Array<Record<string, unknown>>;
    if (typeof rawSteps === 'string') {
      try {
        const parsed = JSON.parse(rawSteps as unknown as string);
        if (Array.isArray(parsed)) rawSteps = parsed;
      } catch { /* noop */ }
    }
    if (!Array.isArray(rawSteps)) {
      return { success: false, error: 'update_workflow_steps requires steps array.' };
    }
    const steps = coerceStepFormulas(rawSteps.map((s, i) => ({
      id: (s.id as string) ?? `step-${i + 1}`,
      ...s,
    })));
    const formulaError = validateWorkflowFormulas(steps);
    if (formulaError) return { success: false, error: formulaError };
    const prohibitedError = findProhibitedStep(steps);
    if (prohibitedError) return { success: false, error: prohibitedError };
    if (!store.pageWorkflows?.[workflowName]) {
      return { success: false, error: `Workflow "${workflowName}" not found. Use the exact workflowName from your WORKFLOW ROSTER.` };
    }
    store.setPageWorkflow(workflowName, steps as object[]);
    return { success: true, data: { workflowName, stepCount: steps.length } };
  },

  create_shared_component(input, getStore) {
    void getStore;
    const name = input.name as string;
    if (!name) return { success: false, error: 'create_shared_component requires name.' };
    const modelId = (input.id as string | undefined) ?? (input.modelId as string | undefined) ?? crypto.randomUUID();
    createSharedComponent({
      id: modelId,
      name,
      folder: input.folder as string | undefined,
      description: input.description as string | undefined,
      content: input.content as Record<string, unknown> | undefined,
      properties: input.properties as Parameters<typeof createSharedComponent>[0]['properties'] | undefined,
      variables: input.variables as Parameters<typeof createSharedComponent>[0]['variables'] | undefined,
      formulas: input.formulas as Parameters<typeof createSharedComponent>[0]['formulas'] | undefined,
      workflows: input.workflows as Parameters<typeof createSharedComponent>[0]['workflows'] | undefined,
      triggers: input.triggers as Parameters<typeof createSharedComponent>[0]['triggers'] | undefined,
    });
    return { success: true, data: { modelId, name } };
  },

  update_shared_component_metadata(input, getStore) {
    void getStore;
    const modelId = input.modelId as string;
    const prev = getSharedComponents()[modelId];
    if (!prev) return { success: false, error: `Shared component "${modelId}" not found.` };
    const patch: Record<string, unknown> = { id: modelId };
    if (input.name != null) patch.name = input.name;
    if (input.folder != null) patch.folder = input.folder;
    if (input.description != null) patch.description = input.description;
    if (input.valueVariable !== undefined) {
      patch.valueVariable = input.valueVariable === '' ? undefined : input.valueVariable;
    }
    updateSharedComponent(patch as Parameters<typeof updateSharedComponent>[0]);
    return { success: true, data: { modelId } };
  },

  delete_shared_component(input, getStore) {
    void getStore;
    const modelId = input.modelId as string;
    if (!deleteSharedComponent(modelId)) {
      return { success: false, error: `Shared component "${modelId}" not found.` };
    }
    return { success: true, data: { modelId } };
  },

  update_shared_component_properties(input, getStore) {
    void getStore;
    const modelId = input.modelId as string;
    const model = getSharedComponents()[modelId];
    if (!model) return { success: false, error: `Model "${modelId}" not found.` };
    const ops = input.ops as Array<Record<string, unknown>>;
    let props = [...(model.properties ?? [])];
    for (const op of ops) {
      const kind = op.op as string;
      if (kind === 'add' && op.property) {
        props.push(op.property as never);
      } else if (kind === 'remove' && op.propertyId) {
        props = props.filter(p => (p as { id?: string }).id !== op.propertyId);
      } else if (kind === 'update' && op.propertyId && op.property) {
        props = props.map(p =>
          (p as { id?: string }).id === op.propertyId ? { ...p, ...(op.property as object) } : p,
        );
      }
    }
    updateSharedComponent({ id: modelId, properties: props });
    return { success: true, data: { modelId, count: props.length } };
  },

  update_shared_component_variables(input, getStore) {
    void getStore;
    const modelId = input.modelId as string;
    const model = getSharedComponents()[modelId];
    if (!model) return { success: false, error: `Model "${modelId}" not found.` };
    const vars = { ...(model.variables ?? {}) };
    const ops = input.ops as Array<Record<string, unknown>>;
    for (const op of ops) {
      const kind = op.op as string;
      if (kind === 'add' && op.variable && op.uuid) {
        vars[op.uuid as string] = op.variable as never;
      } else if (kind === 'remove' && op.uuid) {
        delete vars[op.uuid as string];
      } else if (kind === 'update' && op.uuid && op.variable) {
        vars[op.uuid as string] = { ...vars[op.uuid as string], ...(op.variable as object) } as never;
      }
    }
    updateSharedComponent({ id: modelId, variables: vars });
    return { success: true, data: { modelId } };
  },

  update_shared_component_formulas(input, getStore) {
    void getStore;
    const modelId = input.modelId as string;
    const model = getSharedComponents()[modelId];
    if (!model) return { success: false, error: `Model "${modelId}" not found.` };
    const fms = { ...(model.formulas ?? {}) };
    const ops = input.ops as Array<Record<string, unknown>>;
    for (const op of ops) {
      const kind = op.op as string;
      if (kind === 'add' && op.formula && op.formulaId) {
        fms[op.formulaId as string] = op.formula as never;
      } else if (kind === 'remove' && op.formulaId) {
        delete fms[op.formulaId as string];
      } else if (kind === 'update' && op.formulaId && op.formula) {
        fms[op.formulaId as string] = { ...fms[op.formulaId as string], ...(op.formula as object) } as never;
      }
    }
    updateSharedComponent({ id: modelId, formulas: fms });
    return { success: true, data: { modelId } };
  },

  update_shared_component_triggers(input, getStore) {
    void getStore;
    const modelId = input.modelId as string;
    const model = getSharedComponents()[modelId];
    if (!model) return { success: false, error: `Model "${modelId}" not found.` };
    let triggers = [...(model.triggers ?? [])];
    const ops = input.ops as Array<Record<string, unknown>>;
    for (const op of ops) {
      const kind = op.op as string;
      if (kind === 'add' && op.trigger) {
        triggers.push(op.trigger as never);
      } else if (kind === 'remove' && op.triggerId) {
        triggers = triggers.filter(t => (t as { id?: string }).id !== op.triggerId);
      } else if (kind === 'update' && op.triggerId && op.trigger) {
        triggers = triggers.map(t =>
          (t as { id?: string }).id === op.triggerId ? { ...t, ...(op.trigger as object) } : t,
        );
      }
    }
    updateSharedComponent({ id: modelId, triggers });
    return { success: true, data: { modelId } };
  },

  enter_shared_component_edit(input, getStore) {
    const store = getStore();
    const modelId = input.modelId as string;
    const model = getSharedComponents()[modelId];
    if (!model) return { success: false, error: `Model "${modelId}" not found.` };
    store.enterSharedComponentEdit(modelId, model.content as unknown as SDUINode, model as unknown as Record<string, unknown>, undefined, true, 'shared');
    return { success: true, data: { modelId } };
  },

  exit_shared_component_edit(_input, getStore) {
    getStore().exitSharedComponentEdit();
    return { success: true, data: { message: 'Exited shared component edit mode.' } };
  },

  set_instance_controlled(input, getStore) {
    const store = getStore();
    const instanceId = input.instanceId as string;
    const controlled = input.controlled as boolean;
    const node = findNodeInStore(store, instanceId);
    if (!node) return { success: false, error: `Node "${instanceId}" not found.` };
    const rec = node as unknown as Record<string, unknown>;
    const shared = rec._shared as { id?: string } | undefined;
    if (!shared?.id) return { success: false, error: 'set_instance_controlled requires a shared-component instance node.' };
    store.patchNodeField(instanceId, '_controlled', controlled);
    return { success: true, data: { instanceId, controlled } };
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
    if (parentId && !findNodeInStore(store, parentId)) {
      return { success: false, error: `Parent node "${parentId}" not found in the current page. Call get_page_tree first to get valid node IDs, or omit parentId to add at the page root.` };
    }

    store.addNode(template, parentId, atIdx);

    return { success: true, data: { nodeId: template.id, type: (template as { type?: string }).type, message: `Added ${label} with nodeId ${template.id}` } };
  },

  add_icon(input, getStore) {
    const store = getStore();
    const nodeId = (input._assignedNodeId as string | undefined) ?? uuid();
    const parentId = (input.parentId as string | null) ?? null;
    if (parentId && !findNodeInStore(store, parentId)) {
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
    if (parentId && !findNodeInStore(store, parentId)) {
      return { success: false, error: `Parent node "${parentId}" not found in the current page. Call get_page_tree first to get valid node IDs, or omit parentId to add at the page root.` };
    }
    const node = {
      id: nodeId,
      type: 'Image',
      src: input.src as string,
      props: {
        alt: (input.alt as string) || '',
        ...(input.objectFit ? { objectFit: input.objectFit as string } : {}),
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
    if (parentId && !findNodeInStore(store, parentId)) {
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
    if (!Array.isArray(ids) || ids.length === 0) {
      return { success: false, error: 'wrap_in_container requires at least one nodeId.' };
    }
    const rootIds = new Set((store.pageNodes ?? []).map(n => n.id).filter(Boolean) as string[]);
    const missing = ids.filter(id => !findNodeInStore(store, id));
    if (missing.length > 0) {
      return { success: false, error: `Nodes not found: ${missing.join(', ')}. Call get_page_tree() to get valid IDs.` };
    }
    const nonRoot = ids.filter(id => !rootIds.has(id));
    if (nonRoot.length > 0) {
      return {
        success: false,
        error: `wrap_in_container currently supports root-level nodes only. These IDs are nested: ${nonRoot.join(', ')}.`,
      };
    }
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
    const capErr = checkCapability(store, nodeId, 'text');
    if (capErr) return capErr;
    let text = input.text as string;
    // AI sometimes double-escapes string literals as \"...\" (literal backslashes) instead of '...'.
    // Sanitize before formula detection so the evaluator sees valid JS single-quoted strings.
    text = text.replace(/\\"([^"\\]*?)\\"/g, "'$1'");

    // Convert to { js: expr } when the text is a formula expression.
    // Three cases:
    //   1. Pure {{expression}} wrapper — strip braces, store as { js }.
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
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    const capErr = checkCapability(store, nodeId, 'text');
    if (capErr) return capErr;
    const placeholder = input.placeholder as string;
    // Input is now a flat node (InputWithField) — set placeholder directly on it
    store.patchProp(nodeId, 'props.placeholder', placeholder);
    return { success: true, data: { message: `Set placeholder` } };
  },

  set_href(input, getStore) {
    const store = getStore();
    const nodeErr = requireNode(store, input.nodeId as string | undefined);
    if (nodeErr) return nodeErr;
    store.patchProp(input.nodeId as string, 'props.href', input.href);
    return { success: true, data: { message: `Set href to "${input.href}"` } };
  },

  set_src(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const node = findNodeInStore(store, nodeId);
    if (!node) return { success: false, error: `Node "${nodeId}" not found on the current page.` };
    // Phase 4c: set_src accepts a static URL or JS expression on any node type.
    // The capabilities check for 'src' is intentionally NOT called here — the media
    // agent and binding agent both call set_src; restricting by node type was an invented
    // rule. The engine stores a static string or { formula } and ignores it on nodes that
    // don't render src.
    const nodeType = node.type as string | undefined;
    // Image nodes store URL at top-level src; Video uses props.src.
    // Formula expressions (e.g. "context?.item?.data?.avatar") are stored as { formula }
    // so the renderer evaluates them per repeat item — enabling per-card images/videos.
    if (input.src !== undefined) {
      const srcVal = input.src as string;
      const isFormula = isFormulaExpression(srcVal) || srcVal.startsWith('context');
      const stored = isFormula ? { js: srcVal } : srcVal;
      if (nodeType === 'Image') {
        store.patchProp(nodeId, 'src', stored);
      } else {
        store.patchProp(nodeId, 'props.src', stored);
      }
    }
    if (input.alt !== undefined) {
      const altVal = input.alt as string;
      const isAltFormula = isFormulaExpression(altVal) || altVal.startsWith('context');
      store.patchProp(nodeId, 'props.alt', isAltFormula ? { js: altVal } : altVal);
    }
    if (input.objectFit  !== undefined) store.patchProp(nodeId, 'props.objectFit', input.objectFit);
    if (input.poster     !== undefined) store.patchProp(nodeId, 'props.poster',    input.poster);
    return { success: true, data: { message: 'Updated source' } };
  },

  set_icon_src(input, getStore) {
    const store = getStore();
    const nodeErr = requireNode(store, input.nodeId as string);
    if (nodeErr) return nodeErr;
    const capErr = checkCapability(store, input.nodeId as string, 'icon');
    if (capErr) return capErr;

    if (input.icon === undefined) {
      return { success: false, error: 'set_icon_src requires an icon name. Use set_style for color and size.' };
    }

    const nodeId = input.nodeId as string;

    // Handle icon name — static string or formula expression string.
    let iconLabel = '';
    if (isFormulaExpression(input.icon as string)) {
      // Store as props.icon formula so resolveProps evaluates it with full repeat scope.
      store.patchProp(nodeId, 'props.icon', { js: input.icon as string });
      iconLabel = '(formula)';
    } else {
      store.patchProp(nodeId, 'props.icon', input.icon);
      iconLabel = input.icon as string;
    }
    // Clear any stale top-level text field left by set_text calls on Icon nodes.
    store.patchProp(nodeId, 'text', undefined);

    return { success: true, data: { message: `Updated icon: icon → "${iconLabel}"` } };
  },

  set_video_props(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
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
    // Capability check replaces the old hand-written Image/Video guard.
    const capErr = checkCapability(store, nodeId, 'background');
    if (capErr) return capErr;
    let cls = getNodeClassName(store, nodeId);

    if (input.bg != null) {
      const bgVal = unwrapSerializedFormula(input.bg as string);
      const scopeErr = validateRepeatScopeFormula(store, nodeId, bgVal);
      if (scopeErr) return scopeErr;
      if (isFormulaExpression(bgVal)) {
        const sanitized = resolveFormulaTokens(bgVal);
        patchNodeStyle(store, nodeId, { backgroundColor: { js: sanitized } });
        cls = replaceTwToken(cls, 'bg-', '');
        setNodeClassName(store, nodeId, cls);
        return { success: true, data: { message: 'Updated background (js)' } };
      }
      // rgb()/rgba()/hsl() — store as inline backgroundColor (arbitrary values not reliable in Tailwind JIT)
      if (bgVal.startsWith('rgb(') || bgVal.startsWith('rgba(') || bgVal.startsWith('hsl(') || bgVal.startsWith('hsla(')) {
        patchNodeStyle(store, nodeId, { backgroundColor: bgVal });
        cls = replaceTwToken(cls, 'bg-', '');
        setNodeClassName(store, nodeId, cls);
        return { success: true, data: { message: 'Updated background (inline color)' } };
      }
      // Gradient strings — must go to backgroundImage, not a bg-* class
      if (bgVal.startsWith('linear-gradient(') || bgVal.startsWith('radial-gradient(')) {
        patchNodeStyle(store, nodeId, { backgroundImage: bgVal });
        cls = replaceTwToken(cls, 'bg-', '');
        setNodeClassName(store, nodeId, cls);
        return { success: true, data: { message: 'Updated background (gradient → backgroundImage)' } };
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
      if (fo < 100) cls = `${cls} bg-opacity-[${fo}%]`.trim();
    }

    // Background image (URL or gradient) — stored in props.style.backgroundImage.
    // Batch all four background style properties into ONE patchNodeStyle call so they
    // all survive. Separate calls share a stale store.pageNodes snapshot (captured at
    // store = getStore()), so each call overwrites the previous one's write.
    const bgStylePatch: Record<string, unknown> = {};
    if (input.bgImage != null) {
      const urlVal = input.bgImage as string;
      // Gradient strings must NOT be wrapped in url() — only actual URLs need wrapping
      const isGradient = urlVal.startsWith('linear-gradient(') || urlVal.startsWith('radial-gradient(');
      const wrapped = (urlVal.trim() && !urlVal.startsWith('url(') && !isGradient) ? `url(${urlVal})` : urlVal;
      if (!isGradient && wrapped) {
        // When a photo URL is applied, compose with any SEMI-TRANSPARENT gradient the styling agent
        // already wrote. Agents run in parallel: styling agent writes first (fast, no API call),
        // media agent writes second (slow, needs image search).
        // Only compose when the gradient has transparency (rgba, 'transparent' keyword, CSS color-level-4
        // slash-opacity, or 4-arg rgb). An opaque gradient (#rrggbb, #rgb, hsl without alpha) would
        // completely cover the photo — in that case the photo wins (gradient discarded).
        // store was captured via getStore() at handler entry, so it reflects the styling agent's
        // prior patchNodeStyle write — safe to read here without double-stale-snapshot risk.
        const existingBg = getNodeStyle(store, nodeId).backgroundImage as string | undefined;
        const existingIsGradient = !!existingBg &&
          (existingBg.startsWith('linear-gradient(') || existingBg.startsWith('radial-gradient('));
        // A gradient is only "transparent enough" to compose with a photo if its alpha values
        // are actually low. rgba(0,0,0,0.95) technically contains rgba() but is 95% opaque —
        // that would completely obscure the photo. We extract all alpha values and only compose
        // when the MAXIMUM alpha across all color stops is below 0.7 (≤70% opacity).
        const existingHasTransparency = !!existingBg && (() => {
          if (existingBg.includes('transparent')) return true; // CSS keyword = fully transparent

          // Collect alpha values from rgba(r, g, b, alpha) stops
          const allAlphas: number[] = [];
          const rgbaRe = /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/g;
          let rm: RegExpExecArray | null;
          while ((rm = rgbaRe.exec(existingBg)) !== null) allAlphas.push(parseFloat(rm[1]));

          // Collect alpha values from CSS color-level-4 slash syntax (e.g. hsl(200 50% 50% / 0.3))
          const slashRe = /\/\s*([\d.]+)/g;
          let sm: RegExpExecArray | null;
          while ((sm = slashRe.exec(existingBg)) !== null) allAlphas.push(parseFloat(sm[1]));

          if (allAlphas.length === 0) return false; // solid hex / rgb / hsl with no alpha → opaque

          // Compose only when ALL stops are below the opacity threshold (photo remains visible)
          return Math.max(...allAlphas) < 0.7;
        })();
        if (existingIsGradient && existingHasTransparency) {
          // Strip any url() layers from the existing value — the styling agent may have
          // hard-coded a placeholder URL alongside the gradient. The media agent always owns
          // the photo layer, so we discard the old url() and insert the searched one.
          const gradientsOnly = existingBg
            .replace(/,?\s*url\([^)]*\)/gi, '')
            .replace(/,\s*,/g, ',')
            .replace(/^,\s*|,\s*$/g, '')
            .trim();
          bgStylePatch.backgroundImage = gradientsOnly
            ? `${gradientsOnly}, ${wrapped}`
            : wrapped;
        } else {
          bgStylePatch.backgroundImage = wrapped;
        }
      } else {
        bgStylePatch.backgroundImage = wrapped || '';
      }
    }
    if (input.bgSize != null)     bgStylePatch.backgroundSize     = input.bgSize as string;
    if (input.bgPosition != null) bgStylePatch.backgroundPosition = input.bgPosition as string;
    if (input.bgRepeat != null)   bgStylePatch.backgroundRepeat   = input.bgRepeat as string;
    if (Object.keys(bgStylePatch).length > 0) patchNodeStyle(store, nodeId, bgStylePatch);

    // Static gradient — props.style only (animation.outerStyle is for gradientDrift / set_animation)
    if (input.gradient != null) {
      const grad = input.gradient as { colors: string[]; direction?: string; radial?: boolean };
      if (grad.colors && grad.colors.length >= 2) {
        const dir = grad.direction ?? 'to bottom';
        const colorList = grad.colors.map(resolveColorForCSS).join(', ');
        const gradientStr = grad.radial
          ? `radial-gradient(circle at center, ${colorList})`
          : `linear-gradient(${dir}, ${colorList})`;
        patchNodeStyle(store, nodeId, { backgroundImage: gradientStr, backgroundRepeat: 'no-repeat' });
        const node = findNodeInStore(store, nodeId);
        const existingAnim = ((node as unknown as Record<string, unknown>)?.animation ?? {}) as Record<string, unknown>;
        const loop = existingAnim.loop as { type?: string } | undefined;
        if (loop?.type !== 'gradientDrift') {
          const outer = { ...((existingAnim.outerStyle ?? {}) as Record<string, unknown>) };
          if ('backgroundImage' in outer || 'backgroundRepeat' in outer) {
            delete outer.backgroundImage;
            delete outer.backgroundRepeat;
            const nextAnim = { ...existingAnim } as Record<string, unknown>;
            if (Object.keys(outer).length > 0) nextAnim.outerStyle = outer;
            else delete nextAnim.outerStyle;
            store.patchNodeField(nodeId, 'animation', nextAnim);
          }
        }
      }
    }

    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: 'Updated background' } };
  },

  set_text_color(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    const capErr = checkCapability(store, nodeId, 'typography');
    if (capErr) return capErr;
    const colorVal = unwrapSerializedFormula(input.color as string);
    if (isFormulaExpression(colorVal)) {
      const sanitized = resolveFormulaTokens(colorVal);
      patchNodeStyle(store, nodeId, { color: { js: sanitized } });
      return { success: true, data: { message: 'Set text color (js)' } };
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

  set_border(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    const capErr = checkCapability(store, nodeId, 'border');
    if (capErr) return capErr;
    let cls = getNodeClassName(store, nodeId);

    if (input.width != null) {
      const widthRaw = input.width as string | number;
      if (typeof widthRaw === 'string' && isFormulaExpression(widthRaw)) {
        patchNodeStyle(store, nodeId, { borderWidth: { js: widthRaw } });
      } else {
        // Use parseFloat so "2px" strings are handled correctly (Number("2px") = NaN)
        const widthPx = parseFloat(String(widthRaw));
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
          patchNodeStyle(store, nodeId, { backgroundColor: { js: sanitized } });
          removeNodeStyleKeys(store, nodeId, ['borderColor']);
        } else {
          const bgClass = resolveColorClass(colorRaw, 'bg');
          cls = replaceTwToken(cls, 'bg-', bgClass);
          removeNodeStyleKeys(store, nodeId, ['borderColor']);
        }
      } else if (isFormulaExpression(colorRaw)) {
        const sanitized = resolveFormulaTokens(colorRaw);
        patchNodeStyle(store, nodeId, { borderColor: { js: sanitized } });
      } else {
        const borderColorClass = resolveColorClass(colorRaw, 'border');
        cls = stripBorderColorTokens(cls);
        cls = `${cls} ${borderColorClass}`.replace(/\s+/g, ' ').trim();
      }
    }
    if (input.radius != null) {
      // Use parseFloat so "8px" strings are handled correctly (Number("8px") = NaN)
      const radiusPx = parseFloat(String(input.radius));
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
        const cornerPx = parseFloat(String(input[key]));
        cls = removeAllWithPrefix(cls, prefix);
        if (!Number.isNaN(cornerPx) && cornerPx >= 0) cls = `${cls} ${prefix}[${cornerPx}px]`.trim();
      }
    }

    // Per-side border width — arbitrary classes: border-t-[Npx] border-r-[Npx] etc.
    const sideWidthMap: [string, string][] = [
      ['topWidth',    'border-t-'],
      ['rightWidth',  'border-r-'],
      ['bottomWidth', 'border-b-'],
      ['leftWidth',   'border-l-'],
    ];
    for (const [key, prefix] of sideWidthMap) {
      if (input[key] != null) {
        const px = parseFloat(String(input[key]));
        cls = cls.split(' ').filter(t => !t.startsWith(prefix)).join(' ').trim();
        if (!Number.isNaN(px) && px > 0) cls = `${cls} ${prefix}[${px}px]`.trim();
      }
    }

    // Per-side border color — arbitrary classes: border-t-[color] etc.
    const sideColorMap: [string, string, string][] = [
      ['topColor',    'border-t-', 'borderTopColor'],
      ['rightColor',  'border-r-', 'borderRightColor'],
      ['bottomColor', 'border-b-', 'borderBottomColor'],
      ['leftColor',   'border-l-', 'borderLeftColor'],
    ];
    for (const [key, prefix, styleProp] of sideColorMap) {
      if (input[key] != null) {
        const colorRaw = input[key] as string;
        if (isFormulaExpression(colorRaw)) {
          patchNodeStyle(store, nodeId, { [styleProp]: { js: resolveFormulaTokens(colorRaw) } });
        } else {
          const colorClass = resolveColorClass(colorRaw, 'border');
          // e.g. "border-red-500" → "border-t-red-500"
          const sideColorClass = colorClass.replace(/^border-/, `${prefix}`);
          cls = cls.split(' ').filter(t => !t.startsWith(prefix) || t.match(/^border-[trbl]-\d/)).join(' ').trim();
          cls = `${cls} ${sideColorClass}`.trim();
        }
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
    const capErr = checkCapability(store, nodeId, 'shadow');
    if (capErr) return capErr;

    if (input.remove) {
      const node = findNodeInStore(store, nodeId);
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

    // Extracts alpha from rgba/rgb color strings so shadowOpacity reflects transparency.
    // Returns base color (rgb form, no alpha) + opacity float 0-1.
    // Hex colors pass through unchanged with opacity 1 (fully opaque).
    function extractRgba(color: string): { base: string; opacity: number } {
      const m = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
      if (m) {
        const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
        return { base: `rgb(${m[1]},${m[2]},${m[3]})`, opacity: a };
      }
      return { base: color, opacity: 1 };
    }

    // boxShadow: full CSS string or formula/ternary expression
    const boxShadowRaw = input.boxShadow as string | undefined;
    if (boxShadowRaw) {
      if (isFormulaExpression(boxShadowRaw)) {
        const sanitized = resolveFormulaTokens(boxShadowRaw);
        patchNodeStyle(store, nodeId, { boxShadow: { js: sanitized } });
        return { success: true, data: { message: 'Set shadow (js)' } };
      }
      // Static CSS boxShadow string — parse x/y/blur/spread/color for RN shadow props
      const m = boxShadowRaw.match(/^(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(-?[\d.]+)px\s+(.+)$/);
      if (m) {
        const bx = parseFloat(m[1]), by = parseFloat(m[2]), bBlur = parseFloat(m[3]), bColor = m[5].trim();
        const { base: shadowColorBase, opacity: shadowOpacity } = extractRgba(bColor);
        patchNodeStyle(store, nodeId, {
          boxShadow: boxShadowRaw,
          shadowColor: shadowColorBase,
          shadowOffset: { width: bx, height: by },
          shadowRadius: bBlur,
          shadowOpacity,
          elevation: Math.max(0, Math.round(bBlur / 2)),
        });
      } else {
        patchNodeStyle(store, nodeId, { boxShadow: boxShadowRaw });
      }
      return { success: true, data: { message: `Set shadow: ${boxShadowRaw}` } };
    }

    // Raw values mode: compose CSS boxShadow from individual params
    const color  = (input.color  as string)  || 'rgba(0,0,0,0.1)';
    const blur   = Number(input.blur   ?? 20);
    const spread = Number(input.spread ?? 0);
    const x      = Number(input.x      ?? 0);
    const y      = Number(input.y      ?? 4);
    if (isNaN(blur) || isNaN(spread) || isNaN(x) || isNaN(y)) {
      return { success: false, error: 'blur/spread/x/y must be plain integers. For per-item shadows use: set_shadow(id, { boxShadow: "ternary formula" })' };
    }

    const { base: shadowColorBase, opacity: shadowOpacity } = extractRgba(color);
    patchNodeStyle(store, nodeId, {
      boxShadow: `${x}px ${y}px ${blur}px ${spread}px ${color}`,
      shadowColor: shadowColorBase,
      shadowOffset: { width: x, height: y },
      shadowRadius: blur,
      shadowOpacity,
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
    const rawOpacity = Number(input.opacity);
    if (Number.isNaN(rawOpacity)) {
      return { success: false, error: `opacity must be a number 0–100, got: ${JSON.stringify(input.opacity)}` };
    }
    const value = Math.min(100, Math.max(0, rawOpacity));
    // Write to style.opacity as a number (0–1 float) — React Native requires a numeric opacity.
    // Use undefined for 100% so the key is removed from style (fully visible is the default).
    const opacityFloat: number | undefined = value >= 100 ? undefined : value / 100;
    // Clear any Tailwind opacity-* class that would conflict
    cls = cls.split(' ').filter(t => !/^opacity-/.test(t)).join(' ').replace(/\s+/g, ' ').trim();
    patchNodeStyle(store, nodeId, { opacity: opacityFloat });
    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: `Set opacity to ${value}%` } };
  },

  // set_size is kept as a backward-compat alias — delegates to set_layout.
  // (size params width/height/minWidth/maxWidth/minHeight/maxHeight are now handled in set_layout)
  set_size(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    const capErr = checkCapability(store, nodeId, 'size');
    if (capErr) return capErr;

    const node = findNodeInStore(store, nodeId);
    const isImage = node?.type === 'Image';

    // Normalise number → px string. Strings pass through as-is (CSS values).
    const toCss = (v: unknown): string =>
      typeof v === 'number' && Number.isFinite(v) ? `${v}px` : String(v).trim();

    const stylePatch: Record<string, unknown> = {};
    let cls = getNodeClassName(store, nodeId);
    let stripImageStyleWidth = false;
    let stripImageStyleHeight = false;

    if (input.width != null) {
      const w = toCss(input.width);
      if (isImage && !isFormulaExpression(w)) {
        const twClass = w === '100%' ? 'w-full' : `w-[${w}]`;
        cls = cls.split(' ').filter(t => !/^w-/.test(t) && !/^grow$/.test(t) && !/^min-w-/.test(t)).join(' ').trim();
        cls = `${cls} ${twClass}`.trim();
        stripImageStyleWidth = true;
      } else {
        if (isFormulaExpression(w)) {
          stylePatch.width = { js: resolveFormulaTokens(w, SIZE_WIDTH_TOKEN_MAP) };
        } else {
          stylePatch.width = w;
        }
        cls = cls.split(' ').filter(t => !/^w-/.test(t) && !/^grow$/.test(t) && !/^min-w-/.test(t)).join(' ').trim();
      }
    }

    if (input.height != null) {
      const h = toCss(input.height);
      if (isImage && !isFormulaExpression(h)) {
        const twClass = h === '100%' ? 'h-full' : `h-[${h}]`;
        cls = cls.split(' ').filter(t => !/^h-/.test(t) && !/^grow$/.test(t) && !/^min-h-/.test(t) && t !== 'self-stretch').join(' ').trim();
        cls = `${cls} ${twClass}`.trim();
        stripImageStyleHeight = true;
      } else {
        if (isFormulaExpression(h)) {
          stylePatch.height = { js: resolveFormulaTokens(h, SIZE_HEIGHT_TOKEN_MAP) };
        } else {
          stylePatch.height = h;
        }
        cls = cls.split(' ').filter(t => !/^h-/.test(t) && !/^grow$/.test(t) && !/^min-h-/.test(t) && t !== 'self-stretch').join(' ').trim();
      }
    }

    if (input.flex != null) {
      cls = cls.split(' ').filter(t => !/^flex-\d/.test(t) && !/^flex-\[/.test(t) && !/^grow$/.test(t)).join(' ').trim();
      cls = `${cls} flex-1`.trim();
    }

    if (input.maxWidth  != null) stylePatch.maxWidth  = toCss(input.maxWidth);
    if (input.minWidth  != null) stylePatch.minWidth  = toCss(input.minWidth);
    if (input.maxHeight != null) stylePatch.maxHeight = toCss(input.maxHeight);
    if (input.minHeight != null) stylePatch.minHeight = toCss(input.minHeight);

    if (stripImageStyleWidth || stripImageStyleHeight) {
      removeNodeStyleKeys(store, nodeId, [
        ...(stripImageStyleWidth ? ['width'] : []),
        ...(stripImageStyleHeight ? ['height'] : []),
      ]);
    }
    if (Object.keys(stylePatch).length > 0) patchNodeStyle(store, nodeId, stylePatch);
    setNodeClassName(store, nodeId, cls);
    return { success: true, data: { message: 'Updated size' } };
  },

  set_transform(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    let cls = getNodeClassName(store, nodeId);
    const stylePatch: Record<string, string> = {};

    // ── CSS transform string parser ────────────────────────────────────────
    // Accepts a full CSS transform string and unpacks it into individual style keys.
    // e.g. "translate(-50%, -50%)" → { translateX: "-50%", translateY: "-50%" }
    if (input.transform) {
      const t = input.transform as string;
      // Guard: ternary/formula expressions can't be parsed as CSS — the regex would
      // extract the first match inside the ternary and apply it statically to all
      // cards in a repeat template. Return an actionable error instead.
      if (isFormulaExpression(t)) {
        return {
          success: false,
          error:
            'Formula ternary in `transform` is not supported — the CSS parser would extract only the first value and apply it to every card. For conditional card elevation in repeat templates use animation instead: set_animation(id, { hover: { y: -12, duration: 300 } }).',
        };
      }
      // translate(-50%, -50%) → both X and Y
      const tBoth = t.match(/\btranslate\(\s*([^,]+),\s*([^)]+)\)/);
      if (tBoth) {
        patchNodeStyle(store, nodeId, { translateX: tBoth[1].trim(), translateY: tBoth[2].trim() });
      } else {
        // translateX(-50%) → just X
        const tX = t.match(/\btranslateX\(\s*([^)]+)\)/);
        if (tX) patchNodeStyle(store, nodeId, { translateX: tX[1].trim() });
        // translateY(-50%) → just Y
        const tY = t.match(/\btranslateY\(\s*([^)]+)\)/);
        if (tY) patchNodeStyle(store, nodeId, { translateY: tY[1].trim() });
      }
      // rotate(45deg) → style.transform
      const rot = t.match(/\brotate\(\s*([^)]+)\)/);
      if (rot) stylePatch.transform = `rotate(${rot[1].trim()})`;
    }

    if (input.rotate != null) {
      const deg = Number(input.rotate);
      if (!Number.isNaN(deg)) {
        // Literal number — build the CSS transform string (existing behaviour)
        stylePatch.transform = deg === 0 ? '' : `rotate(${deg}deg)`;
      } else {
        // CSS angle string ("5deg"), formula/js object, or expression string —
        // pass through as-is to style.rotate. resolveProps evaluates formula/js
        // objects at render time. Agent is responsible for the correct CSS value
        // (e.g. { formula: "variables['UUID'] + 'deg'" }).
        stylePatch.rotate = input.rotate as string;
      }
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
        // Only write as FormulaValue when the string contains a runtime expression.
        // Plain CSS values like "-50%", "100px" must stay as strings so the renderer
        // can compose them into transform: "translateX(-50%)" correctly.
        if (isFormulaExpression(txVal)) {
          patchNodeStyle(store, nodeId, { translateX: { js: txVal } });
        } else {
          patchNodeStyle(store, nodeId, { translateX: txVal });
        }
      } else {
        const n = Number(txVal);
        patchNodeStyle(store, nodeId, { translateX: n === 0 ? '' : `${n}px` });
      }
    }
    if (input.translateY !== undefined) {
      const tyVal = input.translateY;
      if (typeof tyVal === 'string' && tyVal.trim()) {
        // Only write as FormulaValue when the string contains a runtime expression.
        // Plain CSS values like "-50%", "100px" must stay as strings so the renderer
        // can compose them into transform: "translateY(-50%)" correctly.
        if (isFormulaExpression(tyVal)) {
          patchNodeStyle(store, nodeId, { translateY: { js: tyVal } });
        } else {
          patchNodeStyle(store, nodeId, { translateY: tyVal });
        }
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
    const capErr = checkCapability(store, nodeId, 'overflow');
    if (capErr) return capErr;
    let cls = getNodeClassName(store, nodeId);

    // Handle new `mode` enum (replaces old `clip` boolean)
    if (input.mode != null) {
      const mode = input.mode as string;
      // Strip all existing overflow-* classes
      cls = cls.split(' ').filter(t => !/^overflow(-[xy])?-/.test(t)).join(' ').trim();
      if (mode === 'clip')   cls = `${cls} overflow-hidden`.trim();
      else if (mode === 'visible') cls = `${cls} overflow-visible`.trim();
      else if (mode === 'auto')   cls = `${cls} overflow-auto`.trim();
      else if (mode === 'scroll') cls = `${cls} overflow-scroll`.trim();
      else if (mode === 'x-auto') cls = `${cls} overflow-x-auto overflow-y-hidden`.trim();
      else if (mode === 'y-auto') cls = `${cls} overflow-y-auto overflow-x-hidden`.trim();
      // 'none' = remove all overflow classes (already stripped above)
    }

    // Legacy `clip` boolean — kept for backwards compat
    if (input.clip !== undefined && input.mode == null) {
      if (input.clip) {
        cls = cls.split(' ').filter(t => !/^overflow(-[xy])?-/.test(t)).join(' ').trim();
        cls = `${cls} overflow-hidden`.trim();
      } else {
        cls = cls.split(' ').filter(t => t !== 'overflow-hidden').join(' ').trim();
      }
    }

    if (input.pointerEvents !== undefined) {
      cls = cls.split(' ').filter(t => !t.startsWith('pointer-events-')).join(' ').trim();
      if (input.pointerEvents === 'none') {
        cls = `${cls} pointer-events-none`.trim();
      }
    }
    setNodeClassName(store, nodeId, cls);
    const msgs: string[] = [];
    if (input.mode != null) msgs.push(`overflow:${input.mode as string}`);
    else if (input.clip !== undefined) msgs.push((input.clip as boolean) ? 'clip:on' : 'clip:off');
    if (input.pointerEvents !== undefined) msgs.push(`pointer-events:${input.pointerEvents as string}`);
    return { success: true, data: { message: msgs.join(', ') || 'no changes' } };
  },

  // ── Unified Styling Tool ───────────────────────────────────────────────────
  // set_style delegates to existing handlers for each property group,
  // silently skipping groups that are blocked on the target component type.
  // This eliminates the split-agent coupling bug (border radius on one agent,
  // overflow:hidden on another) by giving one agent all visual properties.

  set_style(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;

    const bpGuard = (input.breakpoint as string | undefined);

    // ── Responsive breakpoint routing ──────────────────────────────────────────
    // When a non-desktop breakpoint is specified, route style overrides to
    // node.responsive.{bp}.styles instead of modifying the base className.
    const bp = (input.breakpoint as string | undefined) ?? 'desktop';
    if (bp !== 'desktop' && (bp === 'laptop' || bp === 'tablet' || bp === 'mobile')) {
      const styleOverrides: Record<string, string | number | null> = {};
      const CSS_MAP: Record<string, string> = {
        direction: 'flexDirection', gap: 'gap',
        p: '_padding', px: '_paddingX', py: '_paddingY',
        pt: 'paddingTop', pr: 'paddingRight', pb: 'paddingBottom', pl: 'paddingLeft',
        m: '_margin', mx: '_marginX', my: '_marginY',
        mt: 'marginTop', mr: 'marginRight', mb: 'marginBottom', ml: 'marginLeft',
        width: 'width', height: 'height',
        minWidth: 'minWidth', maxWidth: 'maxWidth', minHeight: 'minHeight', maxHeight: 'maxHeight',
        fontSize: 'fontSize', position: 'position', zIndex: 'zIndex',
        top: 'top', right: 'right', bottom: 'bottom', left: 'left',
        bg: 'backgroundColor', color: 'color',
        radius: 'borderRadius', borderWidth: 'borderWidth', borderColor: 'borderColor',
        opacity: 'opacity', overflow: 'overflow', display: 'display',
      };
      const DIRECTION_MAP: Record<string, string> = { row: 'row', column: 'column' };
      for (const [key, cssProp] of Object.entries(CSS_MAP)) {
        if (!(key in input)) continue;
        let val = input[key];
        if (key === 'direction') val = DIRECTION_MAP[String(val)] ?? val;
        if (key === 'gap' || key === 'pt' || key === 'pr' || key === 'pb' || key === 'pl' ||
            key === 'mt' || key === 'mr' || key === 'mb' || key === 'ml' ||
            key === 'top' || key === 'right' || key === 'bottom' || key === 'left') {
          val = `${val}px`;
        }
        if (cssProp === '_padding') {
          const v = `${val}px`;
          styleOverrides.paddingTop = v; styleOverrides.paddingRight = v;
          styleOverrides.paddingBottom = v; styleOverrides.paddingLeft = v;
        } else if (cssProp === '_paddingX') {
          const v = `${val}px`; styleOverrides.paddingLeft = v; styleOverrides.paddingRight = v;
        } else if (cssProp === '_paddingY') {
          const v = `${val}px`; styleOverrides.paddingTop = v; styleOverrides.paddingBottom = v;
        } else if (cssProp === '_margin') {
          const v = `${val}px`;
          styleOverrides.marginTop = v; styleOverrides.marginRight = v;
          styleOverrides.marginBottom = v; styleOverrides.marginLeft = v;
        } else if (cssProp === '_marginX') {
          const v = val === 'auto' ? 'auto' : `${val}px`;
          styleOverrides.marginLeft = v; styleOverrides.marginRight = v;
        } else if (cssProp === '_marginY') {
          const v = val === 'auto' ? 'auto' : `${val}px`;
          styleOverrides.marginTop = v; styleOverrides.marginBottom = v;
        } else {
          styleOverrides[cssProp] = typeof val === 'number' ? `${val}px` : String(val);
        }
      }
      if (input.align) styleOverrides._alignItems = String(input.align);
      if (input.justify) styleOverrides._justifyContent = String(input.justify);
      if (Object.keys(styleOverrides).length > 0) {
        for (const [prop, val] of Object.entries(styleOverrides)) {
          store.patchResponsive(nodeId, bp, `styles.${prop}`, val);
        }
      }
      // Handle non-style responsive overrides
      if ('condition' in input) {
        const cond = input.condition;
        store.patchResponsive(nodeId, bp, 'condition', cond === '' ? null : cond === 'false' ? false : cond);
      }
      store._pushHistory();
      return {
        success: true,
        data: { message: `Applied responsive overrides for ${bp} breakpoint` },
      };
    }

    const node = findNodeInStore(store, nodeId);
    const componentType = (node?.type as string | undefined) ?? 'Unknown';
    const caps = getCapabilities(componentType); // null = no restriction
    const has = (group: ToolGroup): boolean => caps === null || caps.includes(group);

    const msgs: string[] = [];

    // ── Icon nodes: route color + size directly to props (bypasses Tailwind classes) ──
    if (componentType === 'Icon') {
      // Theme token → CSS variable map (mirrors the old set_icon resolution logic).
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
      if (input.color !== undefined) {
        const colorInput = unwrapSerializedFormula(input.color as string);
        if (isFormulaExpression(colorInput)) {
          const sanitized = resolveFormulaTokens(colorInput);
          store.patchProp(nodeId, 'props.color', { js: sanitized });
        } else {
          let colorKey = colorInput;
          if (colorKey.startsWith('theme:')) colorKey = colorKey.slice(6);
          store.patchProp(nodeId, 'props.color', ICON_THEME_VARS[colorKey] ?? colorKey);
        }
        msgs.push('color');
      }
      // Accept width or a numeric size as the icon pixel size.
      const sizeRaw = input.width ?? input.size;
      if (sizeRaw !== undefined) {
        const sz = Number(sizeRaw);
        if (!isNaN(sz) && sz > 0) {
          store.patchProp(nodeId, 'props.size', sz);
          msgs.push('size');
        }
      }
      return {
        success: true,
        data: { message: msgs.length > 0 ? `Updated: ${msgs.join(', ')}` : 'No changes applied' },
      };
    }

    // ── Layout / spacing / size / typography / position ──────────────────────
    // Position params (position, zIndex, top, right, bottom, left) are universal
    // in set_layout (no capability check). We split out blocked groups before
    // calling set_layout so it doesn't error on the first blocked param.
    const LAYOUT_KEYS  = ['direction','align','justify','self','cursor','gridCols','gridRows','gridFlow','colSpan','flexWrap','flex'];
    const SPACING_KEYS = ['gap','p','px','py','pt','pr','pb','pl','m','mx','my','mt','mr','mb','ml'];
    const SIZE_KEYS    = ['width','height','minWidth','maxWidth','minHeight','maxHeight'];
    const TYPO_KEYS    = ['fontSize','weight','textAlign','leading','tracking','italic','decoration','textTransform','textOverflow','whitespace','wordBreak'];
    const POS_KEYS     = ['position','zIndex','top','right','bottom','left']; // always allowed

    const layoutSub: Record<string, unknown> = { nodeId };
    let hasLayoutSub = false;
    for (const k of LAYOUT_KEYS)  if (k in input && has('layout'))     { layoutSub[k] = input[k]; hasLayoutSub = true; }
    for (const k of SPACING_KEYS) if (k in input && has('spacing'))    { layoutSub[k] = input[k]; hasLayoutSub = true; }
    for (const k of SIZE_KEYS)    if (k in input && has('size'))       { layoutSub[k] = input[k]; hasLayoutSub = true; }
    const droppedTypoKeys = TYPO_KEYS.filter(k => k in input && !has('typography'));
    for (const k of TYPO_KEYS)    if (k in input && has('typography')) { layoutSub[k] = input[k]; hasLayoutSub = true; }
    for (const k of POS_KEYS)     if (k in input)                      { layoutSub[k] = input[k]; hasLayoutSub = true; }
    const subErrors: string[] = [];

    if (hasLayoutSub) {
      const r = asSyncResult(handlers.set_layout(layoutSub, getStore));
      if (r && !r.success && r.error) {
        subErrors.push(r.error);
      } else {
        msgs.push('layout');
      }
    }

    // ── Overflow (capability-gated) ───────────────────────────────────────────
    if (('overflow' in input || 'pointerEvents' in input) && has('overflow')) {
      const overflowSub: Record<string, unknown> = { nodeId };
      if ('overflow' in input) overflowSub.mode = input.overflow;
      if ('pointerEvents' in input) overflowSub.pointerEvents = input.pointerEvents;
      const r = asSyncResult(handlers.set_overflow(overflowSub, getStore));
      if (r && !r.success && r.error) subErrors.push(r.error); else msgs.push('overflow');
    }

    // ── Background (capability-gated) ─────────────────────────────────────────
    const BG_KEYS = ['bg','fillOpacity','bgImage','bgSize','bgPosition','bgRepeat','gradient'];
    const bgSub: Record<string, unknown> = { nodeId };
    let hasBg = false;
    for (const k of BG_KEYS) if (k in input) { bgSub[k] = input[k]; hasBg = true; }
    if (hasBg && has('background')) {
      const r = asSyncResult(handlers.set_background(bgSub, getStore));
      if (r && !r.success && r.error) subErrors.push(r.error); else msgs.push('background');
    }

    // ── Text color (capability-gated via 'typography') ─────────────────────────
    if ('color' in input && has('typography')) {
      const r = asSyncResult(handlers.set_text_color({ nodeId, color: input.color }, getStore));
      if (r && !r.success && r.error) subErrors.push(r.error); else msgs.push('color');
    }

    // ── Border (capability-gated) ─────────────────────────────────────────────
    // set_style uses borderWidth/borderStyle/borderColor to avoid collision with
    // the size 'width' param. Remap to set_border's expected width/style/color.
    const borderSub: Record<string, unknown> = { nodeId };
    let hasBorder = false;
    const borderRemap: [string, string][] = [
      ['borderWidth', 'width'], ['borderStyle', 'style'], ['borderColor', 'color'],
      ['radius', 'radius'], ['radiusTL', 'radiusTL'], ['radiusTR', 'radiusTR'],
      ['radiusBR', 'radiusBR'], ['radiusBL', 'radiusBL'],
      ['topWidth', 'topWidth'], ['rightWidth', 'rightWidth'],
      ['bottomWidth', 'bottomWidth'], ['leftWidth', 'leftWidth'],
      ['topColor', 'topColor'], ['rightColor', 'rightColor'],
      ['bottomColor', 'bottomColor'], ['leftColor', 'leftColor'],
    ];
    for (const [from, to] of borderRemap) {
      if (from in input) { borderSub[to] = input[from]; hasBorder = true; }
    }
    if (hasBorder && has('border')) {
      const r = asSyncResult(handlers.set_border(borderSub, getStore));
      if (r && !r.success && r.error) subErrors.push(r.error); else msgs.push('border');
    }

    // ── Shadow (capability-gated) ─────────────────────────────────────────────
    if ('shadow' in input && has('shadow')) {
      const shadowData = (input.shadow as Record<string, unknown>) ?? {};
      const r = asSyncResult(handlers.set_shadow({ nodeId, ...shadowData }, getStore));
      if (r && !r.success && r.error) subErrors.push(r.error); else msgs.push('shadow');
    }

    // ── Opacity (universal — no capability check) ─────────────────────────────
    if ('opacity' in input) {
      const r = asSyncResult(handlers.set_opacity({ nodeId, opacity: input.opacity }, getStore));
      if (r && !r.success && r.error) subErrors.push(r.error); else msgs.push('opacity');
    }

    // ── Transform (universal — no capability check) ───────────────────────────
    const TRANSFORM_KEYS = ['transform','rotate','flipX','flipY','translateX','translateY'];
    const transformSub: Record<string, unknown> = { nodeId };
    let hasTransform = false;
    for (const k of TRANSFORM_KEYS) if (k in input) { transformSub[k] = input[k]; hasTransform = true; }
    if (hasTransform) {
      const r = asSyncResult(handlers.set_transform(transformSub, getStore));
      if (r && !r.success && r.error) subErrors.push(r.error); else msgs.push('transform');
    }

    // ── Auto-cascade typography keys from non-text containers to Text children ──
    // The agent often passes textAlign / fontSize / weight on the parent Box (because
    // that's how CSS works). Instead of silently dropping it, propagate it to every
    // direct Text child that doesn't already define the same key. This eliminates the
    // "WARNING: textAlign not applied" noise without forcing the agent to enumerate
    // every leaf Text node by hand.
    const cascadedTypoKeys: string[] = [];
    if (droppedTypoKeys.length > 0) {
      const parent = findNodeInStore(store, nodeId);
      const directChildren = (parent?.children as SDUINode[] | undefined) ?? [];
      for (const child of directChildren) {
        if (!child?.id || child.type !== 'Text') continue;
        const childCaps = getCapabilities(child.type as string);
        if (childCaps !== null && !childCaps.includes('typography')) continue;
        const childInput: Record<string, unknown> = { nodeId: child.id };
        let any = false;
        for (const k of droppedTypoKeys) {
          if (input[k] === undefined) continue;
          // Don't overwrite a value the styling agent has already set on the child.
          const existing = (child.props as Record<string, unknown> | undefined)?.[k];
          if (existing !== undefined) continue;
          childInput[k] = input[k];
          any = true;
        }
        if (any) {
          asSyncResult(handlers.set_layout(childInput, getStore));
          for (const k of droppedTypoKeys) {
            if (k in childInput && !cascadedTypoKeys.includes(k)) cascadedTypoKeys.push(k);
          }
        }
      }
    }

    const stillDroppedTypoKeys = droppedTypoKeys.filter(k => !cascadedTypoKeys.includes(k));
    const typoWarnings = stillDroppedTypoKeys.length > 0
      ? [`WARNING: ${stillDroppedTypoKeys.join(', ')} not applied — only Text nodes support typography. Apply these props to each Text child instead.`]
      : [];
    if (cascadedTypoKeys.length > 0) {
      msgs.push(`typography (cascaded to Text children: ${cascadedTypoKeys.join(', ')})`);
    }

    const allWarnings = [...typoWarnings, ...subErrors.map(e => `ERROR: ${e}`)];

    // ── Batched breakpoints dict ──────────────────────────────────────────────
    // When the agent passes { breakpoints: { tablet: {...}, mobile: {...} } }
    // we process each breakpoint entry by re-invoking the handler with the
    // breakpoint set — this takes the responsive routing branch above.
    if (input.breakpoints && typeof input.breakpoints === 'object') {
      const bpsInput = input.breakpoints as Record<string, Record<string, unknown>>;
      const BP_ORDER: Array<'laptop' | 'tablet' | 'mobile'> = ['laptop', 'tablet', 'mobile'];
      for (const bpName of BP_ORDER) {
        const bpStyles = bpsInput[bpName];
        if (!bpStyles || typeof bpStyles !== 'object') continue;
        asSyncResult(handlers.set_style({ ...bpStyles, nodeId, breakpoint: bpName }, getStore));
      }
    }

    return {
      success: true,
      data: { message: [msgs.length > 0 ? `Updated: ${msgs.join(', ')}` : 'No changes applied', ...allWarnings].join(' | ') },
    };
  },

  set_submit(input, getStore) {
    const store = getStore();
    const nodeErr = requireNode(store, input.nodeId as string | undefined);
    if (nodeErr) return nodeErr;
    const capErr = checkCapability(store, input.nodeId as string, 'submit');
    if (capErr) return capErr;
    // Toggle props.type='submit' — mirrors the builder Settings panel "Submit" toggle
    store.patchProp(input.nodeId as string, 'props.type', input.submit ? 'submit' : null);
    return { success: true, data: { message: input.submit ? 'Set button as form submit' : 'Cleared button submit type' } };
  },

  set_input_props(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    const capErr = checkCapability(store, nodeId, 'input-props');
    if (capErr) return capErr;
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
    if (input.fieldName) store.patchProp(targetId, 'props.name', input.fieldName);
    if (input.initialValue !== undefined) store.patchNodeField(targetId, '_initialValue', input.initialValue);
    if (input.autocomplete !== undefined) store.patchProp(targetId, 'props.autoComplete', input.autocomplete ? 'on' : 'off');
    if (input.validationTrigger !== undefined) {
      // Read existing _validation and update trigger
      const node = findNodeInStore(store, targetId);
      const existing = ((node as unknown as Record<string, unknown>)?._validation ?? {}) as Record<string, unknown>;
      store.patchNodeField(targetId, '_validation', { ...existing, trigger: input.validationTrigger });
    }
    if (input.debounce !== undefined || input.debounceEnabled !== undefined) {
      const node = findNodeInStore(store, targetId);
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

    // Per-param-group capability checks:
    // Layout params require the 'layout' capability; spacing params require 'spacing'.
    const LAYOUT_PARAMS  = new Set(['direction', 'align', 'justify', 'self', 'cursor', 'gridCols', 'gridRows', 'gridFlow', 'colSpan', 'flexWrap']);
    const SPACING_PARAMS = new Set(['gap', 'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml']);
    const SIZE_PARAMS    = new Set(['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight']);
    const TYPO_PARAMS    = new Set(['fontSize', 'textAlign', 'weight', 'leading', 'tracking', 'italic', 'decoration', 'textTransform', 'textOverflow', 'whitespace', 'wordBreak']);
    const hasLayoutParam  = Object.keys(input).some(k => LAYOUT_PARAMS.has(k));
    const hasSpacingParam = Object.keys(input).some(k => SPACING_PARAMS.has(k));
    const hasSizeParam    = Object.keys(input).some(k => SIZE_PARAMS.has(k));
    const hasTypoParam    = Object.keys(input).some(k => TYPO_PARAMS.has(k));
    if (hasLayoutParam) {
      const capErr = checkCapability(store, nodeId, 'layout');
      if (capErr) return capErr;
    }
    if (hasSpacingParam) {
      const capErr = checkCapability(store, nodeId, 'spacing');
      if (capErr) return capErr;
    }
    if (hasSizeParam) {
      const capErr = checkCapability(store, nodeId, 'size');
      if (capErr) return capErr;
    }
    if (hasTypoParam) {
      const capErr = checkCapability(store, nodeId, 'typography');
      if (capErr) return capErr;
    }

    const node = findNodeInStore(store, nodeId);
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
      patchNodeStyle(store, nodeId, { justifyContent: { js: justifyVal } });
      updated = updated.split(' ').filter(t => !/^justify-/.test(t)).join(' ').trim();
    }
    if (isAlignFormula) {
      patchNodeStyle(store, nodeId, { alignItems: { js: alignVal } });
      updated = updated.split(' ').filter(t => !/^items-/.test(t)).join(' ').trim();
    }

    // ── Spacing (padding, margin, gap) ────────────────────────────────────────
    // Normalise any spacing value: 40 → 40, "40px" → 40, "40" → 40.
    // "auto" and non-numeric strings return null (no-op) — the builder has no auto-spacing support.
    const normalizeSpacingVal = (v: unknown): number | null => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? null : n; }
      return null;
    };
    // Apply a single spacing token: 0 strips existing token, null = no-op, positive = px class.
    const applySpacingTok = (c: string, stripRe: RegExp, prefix: string, n: number | null): string => {
      if (n === null) return c;
      const stripped = c.split(' ').filter(t => !stripRe.test(t)).join(' ').trim();
      if (n === 0) return stripped;
      return `${stripped} ${prefix}-[${n}px]`.trim();
    };
    const stripPShorthand = (c: string) => c.split(' ').filter(t => !/^p-/.test(t)).join(' ').trim();
    const stripMShorthand = (c: string) => c.split(' ').filter(t => !/^-?m-/.test(t)).join(' ').trim();

    if (input.p != null) {
      const n = normalizeSpacingVal(input.p);
      if (n !== null) {
        updated = updated.split(' ').filter(t => !/^p[xyblrt]?-/.test(t)).join(' ').trim();
        // Emit shorthand p-[Npx] instead of four per-side classes for uniform padding
        if (n !== 0) updated = `${updated} p-[${n}px]`.trim();
      }
    }
    if (input.px != null) {
      const n = normalizeSpacingVal(input.px);
      if (n !== null) {
        updated = stripPShorthand(updated.split(' ').filter(t => !/^p[xlr]-/.test(t)).join(' ').trim());
        if (n !== 0) updated = `${updated} pl-[${n}px] pr-[${n}px]`.trim();
      }
    }
    if (input.py != null) {
      const n = normalizeSpacingVal(input.py);
      if (n !== null) {
        updated = stripPShorthand(updated.split(' ').filter(t => !/^p[ybt]-/.test(t)).join(' ').trim());
        if (n !== 0) updated = `${updated} pt-[${n}px] pb-[${n}px]`.trim();
      }
    }
    if (input.pt != null) { updated = applySpacingTok(stripPShorthand(updated), /^pt-/, 'pt', normalizeSpacingVal(input.pt)); }
    if (input.pr != null) { updated = applySpacingTok(stripPShorthand(updated), /^pr-/, 'pr', normalizeSpacingVal(input.pr)); }
    if (input.pb != null) { updated = applySpacingTok(stripPShorthand(updated), /^pb-/, 'pb', normalizeSpacingVal(input.pb)); }
    if (input.pl != null) { updated = applySpacingTok(stripPShorthand(updated), /^pl-/, 'pl', normalizeSpacingVal(input.pl)); }

    if (input.m != null) {
      if (input.m === 'auto') {
        updated = updated.split(' ').filter(t => !/^-?m[xyblrt]?-/.test(t) && t !== 'm-auto' && t !== 'mx-auto' && t !== 'my-auto').join(' ').trim();
        updated = `${updated} m-auto`.trim();
      } else {
        const n = normalizeSpacingVal(input.m);
        if (n !== null) {
          updated = updated.split(' ').filter(t => !/^-?m[xyblrt]?-/.test(t)).join(' ').trim();
          // Emit shorthand m-[Npx] instead of four per-side classes for uniform margin
          if (n !== 0) updated = `${updated} m-[${n}px]`.trim();
        }
      }
    }
    if (input.mx != null) {
      if (input.mx === 'auto') {
        updated = stripMShorthand(updated.split(' ').filter(t => !/^-?m[xlr]-/.test(t) && t !== 'mx-auto' && t !== 'm-auto').join(' ').trim());
        updated = `${updated} mx-auto`.trim();
      } else {
        const n = normalizeSpacingVal(input.mx);
        if (n !== null) {
          updated = stripMShorthand(updated.split(' ').filter(t => !/^-?m[xlr]-/.test(t)).join(' ').trim());
          if (n !== 0) updated = `${updated} ml-[${n}px] mr-[${n}px]`.trim();
        }
      }
    }
    if (input.my != null) {
      if (input.my === 'auto') {
        updated = stripMShorthand(updated.split(' ').filter(t => !/^-?m[ybt]-/.test(t) && t !== 'my-auto' && t !== 'm-auto').join(' ').trim());
        updated = `${updated} my-auto`.trim();
      } else {
        const n = normalizeSpacingVal(input.my);
        if (n !== null) {
          updated = stripMShorthand(updated.split(' ').filter(t => !/^-?m[ybt]-/.test(t)).join(' ').trim());
          if (n !== 0) updated = `${updated} mt-[${n}px] mb-[${n}px]`.trim();
        }
      }
    }
    if (input.mt != null) { updated = applySpacingTok(stripMShorthand(updated), /^-?mt-/, 'mt', normalizeSpacingVal(input.mt)); }
    if (input.mr != null) { updated = applySpacingTok(stripMShorthand(updated), /^-?mr-/, 'mr', normalizeSpacingVal(input.mr)); }
    if (input.mb != null) { updated = applySpacingTok(stripMShorthand(updated), /^-?mb-/, 'mb', normalizeSpacingVal(input.mb)); }
    if (input.ml != null) { updated = applySpacingTok(stripMShorthand(updated), /^-?ml-/, 'ml', normalizeSpacingVal(input.ml)); }

    if (input.gap != null) {
      const n = normalizeSpacingVal(input.gap);
      if (n !== null) {
        if (n < 0) {
          return { success: false, error: 'gap must be >= 0. Use set_layout with offsets (top/right/bottom/left) for overlapping elements.' };
        }
        updated = applySpacingTok(
          updated.split(' ').filter(t => !/^gap-/.test(t) && !/^gap-[xy]-/.test(t)).join(' ').trim(),
          /^gap-/, 'gap', n,
        );
      }
    }

    // Strip any residual inline spacing styles
    if (hasSpacingParam) {
      removeNodeStyleKeys(store, nodeId, [
        'paddingTop','paddingRight','paddingBottom','paddingLeft','paddingBlock','paddingInline',
        'marginTop','marginRight','marginBottom','marginLeft',
        'gap','columnGap','rowGap',
      ]);
    }
    // ── End spacing ───────────────────────────────────────────────────────────

    if (input.self) {
      const selfVal = input.self as string;
      if (isFormulaExpression(selfVal)) {
        patchNodeStyle(store, nodeId, { alignSelf: { js: selfVal } });
        updated = updated.split(' ').filter(t => !/^self-/.test(t)).join(' ').trim();
      } else {
        updated = replaceTokenGroup(updated, SELF_PREFIXES, `self-${selfVal}`);
      }
    }
    if (input.cursor) updated = replaceTokenGroup(updated, CURSOR_PREFIXES, `cursor-${input.cursor}`);
    if (input.gridCols) {
      updated = replaceTokenGroup(updated, DISPLAY_TOKENS, 'grid');
      const gridColsVal = String(input.gridCols);
      if (gridColsVal.includes(' ')) {
        // fr-unit template (e.g. "3fr 2fr") — cannot go in a class; write as inline style
        updated = updated.split(' ').filter(t => !/^grid-cols-/.test(t)).join(' ').trim();
        patchNodeStyle(store, nodeId, { gridTemplateColumns: gridColsVal });
      } else {
        updated = replaceTwToken(updated, 'grid-cols-', `grid-cols-${gridColsVal}`);
        removeNodeStyleKeys(store, nodeId, ['gridTemplateColumns']);
      }
    }
    if (input.gridRows) updated = replaceTwToken(updated, 'grid-rows-', `grid-rows-${input.gridRows}`);
    if (input.gridFlow) {
      // grid-flow-row | grid-flow-col | grid-flow-dense | grid-flow-row-dense | grid-flow-col-dense
      const GRID_FLOW_TOKENS = ['grid-flow-row', 'grid-flow-col', 'grid-flow-dense', 'grid-flow-row-dense', 'grid-flow-col-dense'];
      updated = replaceTokenGroup(updated, GRID_FLOW_TOKENS, `grid-flow-${input.gridFlow}`);
    }
    if (input.colSpan) {
      const span = input.colSpan as number;
      updated = replaceTwToken(updated, 'col-span-', span > 12 ? 'col-span-full' : `col-span-${span}`);
    }
    if (input.flexWrap) updated = replaceTokenGroup(updated, ['flex-wrap', 'flex-nowrap', 'flex-wrap-reverse'], `flex-${input.flexWrap}`);
    if (input.flex != null) {
      updated = updated.split(' ').filter(t => !/^flex-\d/.test(t) && !/^flex-\[/.test(t) && !/^grow$/.test(t)).join(' ').trim();
      updated = `${updated} flex-1`.trim();
      removeNodeStyleKeys(store, nodeId, ['flex']);
    }
    // ── Size ──────────────────────────────────────────────────────────────────
    if (hasSizeParam) {
      // Keyword → Tailwind class mapping (applies to ALL node types)
      const W_KEYWORDS: Record<string, string> = {
        'fit-content': 'w-fit', 'fit': 'w-fit',
        '100%': 'w-full', 'auto': 'w-auto',
        '100vw': 'w-screen', 'screen': 'w-screen',
      };
      const H_KEYWORDS: Record<string, string> = {
        'fit-content': 'h-fit', 'fit': 'h-fit',
        '100%': 'h-full', 'auto': 'h-auto',
        '100vh': 'h-screen', 'screen': 'h-screen',
        '100svh': 'h-svh',
      };

      const toCssSize = (v: unknown): string =>
        typeof v === 'number' && Number.isFinite(v) ? `${v}px` : String(v).trim();

      const sizePatch: Record<string, unknown> = {};
      let stripSizeStyleWidth = false;
      let stripSizeStyleHeight = false;

      if (input.width != null) {
        const w = toCssSize(input.width);
        // Strip existing width/grow/flex-1/min-w classes first
        updated = updated.split(' ').filter(t => !/^w-/.test(t) && !/^grow$/.test(t) && !/^min-w-/.test(t)).join(' ').trim();
        if (isFormulaExpression(w)) {
          sizePatch.width = { js: resolveFormulaTokens(w, SIZE_WIDTH_TOKEN_MAP) };
        } else {
          const twClass = W_KEYWORDS[w] ?? `w-[${w}]`;
          updated = `${updated} ${twClass}`.trim();
          stripSizeStyleWidth = true;
        }
      }

      if (input.height != null) {
        const h = toCssSize(input.height);
        // Strip existing height/grow/min-h/self-stretch classes first
        updated = updated.split(' ').filter(t => !/^h-/.test(t) && !/^grow$/.test(t) && !/^min-h-/.test(t) && t !== 'self-stretch').join(' ').trim();
        if (isFormulaExpression(h)) {
          sizePatch.height = { js: resolveFormulaTokens(h, SIZE_HEIGHT_TOKEN_MAP) };
        } else {
          const twClass = H_KEYWORDS[h] ?? `h-[${h}]`;
          updated = `${updated} ${twClass}`.trim();
          stripSizeStyleHeight = true;
        }
      }

      if (input.maxWidth != null) {
        const mw = toCssSize(input.maxWidth);
        updated = updated.split(' ').filter(t => !/^max-w-/.test(t)).join(' ').trim();
        updated = `${updated} max-w-[${mw}]`.trim();
      }
      if (input.minWidth != null) {
        const mw = toCssSize(input.minWidth);
        updated = updated.split(' ').filter(t => !/^min-w-/.test(t)).join(' ').trim();
        updated = `${updated} min-w-[${mw}]`.trim();
      }
      if (input.maxHeight != null) {
        const mh = toCssSize(input.maxHeight);
        updated = updated.split(' ').filter(t => !/^max-h-/.test(t)).join(' ').trim();
        updated = `${updated} max-h-[${mh}]`.trim();
      }
      if (input.minHeight != null) {
        const mh = toCssSize(input.minHeight);
        updated = updated.split(' ').filter(t => !/^min-h-/.test(t)).join(' ').trim();
        updated = `${updated} min-h-[${mh}]`.trim();
      }

      if (stripSizeStyleWidth || stripSizeStyleHeight) {
        removeNodeStyleKeys(store, nodeId, [
          ...(stripSizeStyleWidth  ? ['width']  : []),
          ...(stripSizeStyleHeight ? ['height'] : []),
        ]);
      }
      removeNodeStyleKeys(store, nodeId, ['maxWidth', 'minWidth', 'maxHeight', 'minHeight']);
      if (Object.keys(sizePatch).length > 0) patchNodeStyle(store, nodeId, sizePatch);
    }

    // ── Typography ────────────────────────────────────────────────────────────
    if (hasTypoParam) {
      if (input.fontSize != null) {
        // Accept plain numbers (56), px-strings ("56px"), and unit-strings ("1.125rem", "2em").
        // Preserve the original unit — parseFloat strips it, producing text-[1.125px] for rem inputs.
        updated = replaceTokenGroup(updated, TEXT_SIZE_PREFIXES, '');
        updated = removeAllWithPrefix(updated, 'text-[');
        if (typeof input.fontSize === 'number') {
          if (input.fontSize > 0) updated = `${updated} text-[${input.fontSize}px]`.trim();
        } else {
          const raw = String(input.fontSize).trim();
          // String with non-px unit — preserve as-is (e.g. "1.125rem" → text-[1.125rem])
          if (/^[\d.]+(?:rem|em|vw|vh|ch|ex|lh)$/.test(raw)) {
            updated = `${updated} text-[${raw}]`.trim();
          } else {
            const sizePx = parseFloat(raw);
            if (!isNaN(sizePx) && sizePx > 0) updated = `${updated} text-[${sizePx}px]`.trim();
          }
        }
      }
      if (input.weight)   updated = replaceTokenGroup(updated, FONT_WEIGHT_PREFIXES, `font-${input.weight}`);
      if (input.textAlign) {
        const alignRaw = input.textAlign as string;
        if (isFormulaExpression(alignRaw)) {
          patchNodeStyle(store, nodeId, { textAlign: { js: alignRaw } });
          updated = replaceTokenGroup(updated, TEXT_ALIGN_PREFIXES, '');
        } else {
          updated = replaceTokenGroup(updated, TEXT_ALIGN_PREFIXES, `text-${alignRaw}`);
        }
      }
      if (input.leading)  updated = replaceTokenGroup(updated, LEADING_PREFIXES, `leading-${input.leading}`);
      if (input.tracking) updated = replaceTokenGroup(updated, TRACKING_PREFIXES, `tracking-${input.tracking}`);
      if (input.italic !== undefined) {
        updated = replaceTokenGroup(updated, ITALIC_TOKENS, input.italic ? 'italic' : 'not-italic');
      }
      if (input.decoration) {
        const dec = input.decoration as string;
        // Accept both 'none' and 'no-underline' as the "remove underline" value
        const isReset = dec === 'none' || dec === 'no-underline';
        updated = replaceTokenGroup(updated, DECORATION_TOKENS, isReset ? '' : dec);
        if (isReset) updated = `${updated} no-underline`.trim();
      }
      if (input.textTransform) {
        const tt = input.textTransform as string;
        // Accept both 'none' and 'normal-case' as the "clear transform" value
        const isReset = tt === 'none' || tt === 'normal-case';
        updated = replaceTokenGroup(updated, TRANSFORM_TOKENS, isReset ? 'normal-case' : tt);
      }
      if (input.textOverflow) {
        const ov = input.textOverflow as string;
        updated = updated.split(' ').filter(t => t !== 'truncate' && t !== 'overflow-clip' && t !== 'text-ellipsis' && t !== 'text-clip').join(' ').trim();
        if (ov === 'truncate') updated = `${updated} truncate`.trim();
        else if (ov === 'clip') updated = `${updated} overflow-clip text-clip`.trim();
        else if (ov === 'ellipsis') updated = `${updated} text-ellipsis overflow-hidden`.trim();
      }
      if (input.whitespace) {
        const ws = input.whitespace as string;
        updated = updated.split(' ').filter(t => !/^whitespace-/.test(t)).join(' ').trim();
        if (ws !== 'normal') updated = `${updated} whitespace-${ws}`.trim();
      }
      if (input.wordBreak) {
        const wb = input.wordBreak as string;
        updated = updated.split(' ').filter(t => !/^break-/.test(t)).join(' ').trim();
        if (wb !== 'normal') updated = `${updated} break-${wb}`.trim();
      }
    }
    // ── End typography ────────────────────────────────────────────────────────

    // ── Position & insets ─────────────────────────────────────────────────────
    if (input.position) updated = replaceTokenGroup(updated, POSITION_TOKENS, input.position as string);
    if (input.zIndex != null) {
      const zNum = Number(input.zIndex);
      updated = replaceTokenGroup(updated, Z_PREFIXES, '');
      updated = removeAllWithPrefix(updated, 'z-[');
      if (!Number.isNaN(zNum)) updated = `${updated} z-[${Math.round(zNum)}]`.trim();
    }
    const insetStylePatch: Record<string, unknown> = {};
    const insetKeysToRemoveFromStyle: string[] = [];
    const parseInset = (v: unknown): number | null => {
      if (v == null) return null;
      if (typeof v === 'number') return v;
      const strVal = String(v).replace(/^px:/, '');
      const rawPx = strVal.match(/^(-?\d+(?:\.\d+)?)px$/)?.[1];
      const n = rawPx != null ? Number(rawPx) : Number(strVal);
      return Number.isNaN(n) ? null : n;
    };
    for (const [key, val] of [['top', input.top], ['right', input.right], ['bottom', input.bottom], ['left', input.left]] as [string, unknown][]) {
      if (val == null) continue;
      if (typeof val === 'string' && isFormulaExpression(val)) {
        insetStylePatch[key] = { js: resolveFormulaTokens(val) };
        updated = updated.split(' ').filter(t => !new RegExp(`^-?${key}-`).test(t)).join(' ').trim();
      } else if (typeof val === 'string' && /^\d+(\.\d+)?%$/.test(val)) {
        updated = updated.split(' ').filter(t => !new RegExp(`^-?${key}-`).test(t)).join(' ').trim();
        updated = `${updated} ${key}-[${val}]`.trim();
        insetKeysToRemoveFromStyle.push(key);
      } else if (typeof val === 'string' && /^-?[\d.]+(?:vh|rem|em|ch|ex|vw)$/.test(val)) {
        // Unit-suffixed non-px values (e.g. "10vh", "2rem") — write as arbitrary class token
        updated = updated.split(' ').filter(t => !new RegExp(`^-?${key}-`).test(t)).join(' ').trim();
        updated = `${updated} ${key}-[${val}]`.trim();
        insetKeysToRemoveFromStyle.push(key);
      } else if (typeof val === 'string' && val.startsWith('calc(')) {
        // calc() expressions — write as inline style (can't go in a class)
        insetStylePatch[key] = val;
        updated = updated.split(' ').filter(t => !new RegExp(`^-?${key}-`).test(t)).join(' ').trim();
      } else {
        const px = parseInset(val);
        if (px != null) {
          updated = updated.split(' ').filter(t => !new RegExp(`^-?${key}-`).test(t)).join(' ').trim();
          updated = `${updated} ${key}-[${px}px]`.trim();
          insetKeysToRemoveFromStyle.push(key);
        }
      }
    }
    if (Object.keys(insetStylePatch).length > 0) patchNodeStyle(store, nodeId, insetStylePatch);
    if (insetKeysToRemoveFromStyle.length > 0) removeNodeStyleKeys(store, nodeId, insetKeysToRemoveFromStyle);
    // ── End position ──────────────────────────────────────────────────────────

    store.patchProp(nodeId, 'props.className', updated);

    // Warn if absolute node is missing insets
    const finalCls = updated;
    const hasAbsolute = /\babsolute\b/.test(finalCls);
    const hasHorizInset = /(?:^|\s)(?:left|right)-/.test(finalCls) || /(?:^|\s)inset-x-/.test(finalCls) || /(?:^|\s)inset-0\b/.test(finalCls) || /(?:^|\s)inset-\[/.test(finalCls);
    const hasVertInset  = /(?:^|\s)(?:top|bottom)-/.test(finalCls)  || /(?:^|\s)inset-y-/.test(finalCls)  || /(?:^|\s)inset-0\b/.test(finalCls) || /(?:^|\s)inset-\[/.test(finalCls);
    let layoutMsg = 'Updated layout';
    if (hasAbsolute && !hasHorizInset) layoutMsg += ' — WARNING: absolute node has no horizontal inset (left/right). Placement may drift.';
    if (hasAbsolute && !hasVertInset)  layoutMsg += ' — WARNING: absolute node has no vertical inset (top/bottom). Placement may drift.';

    return { success: true, data: { message: layoutMsg } };
  },

  // ── Logic ──────────────────────────────────────────────────────────────────

  set_condition(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
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
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    // Image, Video, and Icon nodes cannot serve as repeat templates — they have no children
    // to template over. The correct pattern is to place set_repeat on the Box wrapper that
    // contains them, then use set_src/set_icon_src with formula expressions for per-item data.
    const node = findNodeInStore(store, nodeId);
    const nodeType = (node?.type as string | undefined) ?? '';
    if (['Image', 'Video', 'Icon'].includes(nodeType)) {
      return {
        success: false,
        error: `set_repeat is not valid on ${nodeType} nodes. ${nodeType} cannot be a repeat template. Place set_repeat on the Box wrapper that contains the ${nodeType}, then use ${nodeType === 'Icon' ? 'set_icon_src with a formula expression' : 'set_src with a formula expression'} for per-item data.`,
      };
    }
    // Accept `expression` as an alias for `mapPath` — Phase 3 Haiku may call with the wrong key.
    // Empty string/null removes repeat binding.
    const rawMapPath = (input.mapPath ?? input.expression) as string | undefined | null;
    const mapPath = typeof rawMapPath === 'string' ? rawMapPath.trim() : rawMapPath;
    const keyField = (input.keyField as string | undefined) ?? 'id';
    if (mapPath === '' || mapPath == null) {
      store.patchMap(nodeId, null, undefined);
      return { success: true, data: { message: 'Removed repeat binding' } };
    }
    // Formula-based map paths (e.g. getByIndex(...)) must be stored as { formula: "..." }
    // so the runtime renderer evaluates them dynamically per outer-repeat item.
    // Detection: path matches formula scope identifiers AND contains a function call (parens).
    const isFormulaMapPath = FORMULA_SCOPE_RE.test(mapPath) && /\(/.test(mapPath);
    if (isFormulaMapPath) {
      store.patchNodeField(nodeId, 'map', { formula: mapPath });
      if (keyField) store.patchNodeField(nodeId, 'key', keyField);
      return { success: true, data: { message: `Set repeat over formula "${mapPath}"` } };
    }
    // Normalize optional-chaining in plain map paths — `context?.item?.data?.features` breaks
    // scope resolution because `context?` is not a recognized scope variable prefix.
    // Plain dot notation (`context.item.data.features`) is required for nested repeats.
    // generate_structure already does this normalization for inline tree repeat fields.
    const normalizedMapPath = mapPath.replace(/\?\./g, '.');
    store.patchMap(nodeId, normalizedMapPath, keyField);
    return { success: true, data: { message: `Set repeat over "${mapPath}"` } };
  },

  bind_action(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    const workflowName = input.workflowName as string;
    // Validate that the workflow exists — binding to a ghost workflow creates a silent no-op action
    const wfExists = !!store.pageWorkflows?.[workflowName];
    if (!wfExists) {
      return {
        success: false,
        error: `Workflow "${workflowName}" not found. Use the exact workflowName from your WORKFLOW ROSTER.`,
      };
    }
    const trigger = (input.trigger as string | undefined)?.trim();
    const node = findNodeInStore(store, nodeId);
    const existing = Array.isArray(node?.actions) ? [...(node.actions as Array<{ action: string; trigger?: string }>)] : [];
    // Phase 4c: idempotent — if this workflow+trigger is already bound, succeed silently
    // instead of erroring. The compact tree annotates existing bindings so the AI rarely
    // re-binds, but when it does, a no-op success is safer than a hard failure.
    const matches = (a: { action: string; trigger?: string }) =>
      a.action === workflowName && (a.trigger ?? null) === (trigger ?? null);
    if (existing.some(matches)) {
      return {
        success: true,
        data: {
          message: trigger
            ? `Workflow "${workflowName}" already bound to node on trigger "${trigger}" — no change.`
            : `Workflow "${workflowName}" already bound to node — no change.`,
        },
      };
    }
    const next: { action: string; trigger?: string } = trigger
      ? { action: workflowName, trigger }
      : { action: workflowName };
    const updated = [...existing, next];
    store.patchActions(nodeId, updated as unknown as Record<string, unknown>);
    return {
      success: true,
      data: {
        message: trigger
          ? `Bound workflow "${workflowName}" to node on trigger "${trigger}"`
          : `Bound workflow "${workflowName}" to node`,
      },
    };
  },

  unbind_action(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    const workflowName = input.workflowName as string;
    const node = findNodeInStore(store, nodeId);
    const existing = Array.isArray(node?.actions) ? [...(node.actions as Array<{ action: string }>)] : [];
    const updated = existing.filter(a => a.action !== workflowName);
    store.patchActions(nodeId, updated as unknown as Record<string, unknown>);
    return { success: true, data: { message: `Unbound workflow "${workflowName}" from node` } };
  },

  create_workflow(input, getStore) {
    const store = getStore();
    const name = input.name as string;
    const trigger = (input.trigger as string) ?? 'click';
    let rawSteps = input.steps as Array<Record<string, unknown>>;

    if (!name || typeof name !== 'string') {
      return { success: false, error: 'create_workflow requires a non-empty "name".' };
    }
    // steps is now optional — agents may use add_workflow_step calls instead.
    if (rawSteps === undefined || rawSteps === null) {
      rawSteps = [];
    }
    // The AI sometimes serializes the steps array as a JSON string instead of a real array.
    if (typeof rawSteps === 'string') {
      try {
        const parsed = JSON.parse(rawSteps as unknown as string);
        if (Array.isArray(parsed)) rawSteps = parsed;
      } catch (e) {
        return {
          success: false,
          error: `"steps" was passed as a JSON string but could not be parsed: ${(e as Error).message}. Pass steps as a real JSON array, not a string.`,
        };
      }
    }
    if (!Array.isArray(rawSteps)) {
      rawSteps = [];
    }

    const steps = coerceStepFormulas(rawSteps.map((s, i) => ({
      id: s.id ?? `step-${i + 1}`,
      ...s,
    })));

    const formulaError = validateWorkflowFormulas(steps);
    if (formulaError) {
      return { success: false, error: formulaError };
    }

    const prohibitedError = findProhibitedStep(steps);
    if (prohibitedError) {
      return { success: false, error: prohibitedError };
    }

    const stepTypeError = validateStepTypes(steps);
    if (stepTypeError) {
      return { success: false, error: stepTypeError };
    }

    const multiOptionError = validateMultiOptionBranches(steps);
    if (multiOptionError) {
      return { success: false, error: multiOptionError };
    }

    const uuidError = validateChangeVariableUUIDs(steps);
    if (uuidError) {
      return { success: false, error: uuidError };
    }

    const navError = validateNavigatePaths(steps, store);
    if (navError) {
      return { success: false, error: navError };
    }

    store.setPageWorkflow(name, steps);
    const meta: Record<string, unknown> = { id: name, name, trigger };
    if (input.isTrigger || input.isAppTrigger || input.pageScope) {
      meta.isTrigger = true;
    }
    if (input.isAppTrigger) {
      meta.isAppTrigger = true;
    } else if (input.pageScope) {
      meta.pageScope = input.pageScope as string;
    }
    if (input.folder) meta.folder = input.folder as string;
    store.setPageWorkflowMeta(name, meta as Parameters<typeof store.setPageWorkflowMeta>[1]);

    if (input.bindToNodeId) {
      const nodeId = input.bindToNodeId as string;
      // Re-fetch the store after setPageWorkflow/setPageWorkflowMeta to get the freshest
      // pageNodes. Parallel agents (binding, styling, workflows) run concurrently and their
      // SSE tool events are interleaved on the client. A binding/styling tool call processed
      // between two create_workflow calls may have updated pageNodes to a new Zustand state
      // object, making the original `store` snapshot stale. getStore() always returns the
      // true current state.
      const freshStore = getStore();
      const bindErr = requireNode(freshStore, nodeId);
      if (bindErr) return bindErr;
      const node = findNode(freshStore.pageNodes as SDUINode[], nodeId);
      const existing = Array.isArray(node?.actions) ? [...(node.actions as unknown[])] : [];
      const newActions = [...existing, { action: name }];
      freshStore.patchActions(nodeId, newActions as unknown as Record<string, unknown>);
    }

    const bindHint = !input.bindToNodeId
      ? `To bind to a node: call bind_action({ nodeId: "<nodeId>", workflowName: "${name}", trigger: "${trigger}" })`
      : undefined;

    return {
      success: true,
      data: {
        name,
        trigger,
        stepCount: steps.length,
        message: `Created workflow "${name}" (trigger: ${trigger}, ${steps.length} step${steps.length !== 1 ? 's' : ''})${input.bindToNodeId ? ` and bound to node` : ''}`,
        ...(bindHint ? { bindHint } : {}),
      },
    };
  },

  delete_workflow(input, getStore) {
    const store = getStore();
    const workflowName = input.workflowName as string;
    const exists = !!store.pageWorkflows?.[workflowName];
    if (!exists) {
      return { success: false, error: `Workflow "${workflowName}" was not found.` };
    }
    store.removePageWorkflow(workflowName);
    return { success: true, data: { message: `Deleted workflow "${workflowName}"` } };
  },

  add_workflow_step(input, getStore) {
    const store = getStore();
    const workflowId = (input.workflowId ?? input.workflowName) as string;
    const stepId = input.stepId as string;
    const type = input.type as string;

    if (!workflowId) return { success: false, error: 'add_workflow_step requires workflowId.' };
    if (!stepId) return { success: false, error: 'add_workflow_step requires stepId.' };
    if (!type) return { success: false, error: 'add_workflow_step requires type.' };

    const pageWorkflows = (store.pageWorkflows ?? {}) as Record<string, unknown>;
    const pageWorkflowMeta = (store.pageWorkflowMeta ?? {}) as Record<string, { id?: string }>;

    // Resolve workflowId → actual store key (workflowName).
    // The ROSTER shows the UUID minted by the structure agent (e.g. "wf-hero-cta-primary").
    // The store key is the derived human-readable name (e.g. "cta_primary_onClick").
    // Try direct key match first (handles models that pass the name), then UUID match via meta.
    let workflowName: string | undefined;
    if (workflowId in pageWorkflows) {
      workflowName = workflowId;
    } else {
      const entry = Object.entries(pageWorkflowMeta).find(([, m]) => m.id === workflowId);
      if (entry) workflowName = entry[0];
    }
    if (!workflowName) {
      return {
        success: false,
        error: `Workflow "${workflowId}" not found. Use the exact workflowId from your WORKFLOW ROSTER.`,
      };
    }
    // Build the step config from flat params.
    const config: Record<string, unknown> = {};
    const step: Record<string, unknown> = { id: stepId, type };

    switch (type) {
      case 'changeVariableValue': {
        if (!input.variableName) return { success: false, error: 'add_workflow_step: changeVariableValue requires variableName.' };
        config.variableName = input.variableName;
        const rawVal = input.value as string | undefined;
        const normalized = (rawVal ?? '').trim();
        // changeVariableValue value is always a JS expression to evaluate, never a code block.
        // Explicitly wrap with return() so ensureReturn doesn't skip multi-line literals (arrays, objects).
        const isCodeBlock = !normalized || /\breturn\b/.test(normalized) || /^(const|let|var)\b/m.test(normalized);
        config.value = { js: isCodeBlock ? normalized : `return (${normalized});` };
        break;
      }
      case 'resetVariableValue': {
        if (!input.variableName) return { success: false, error: 'add_workflow_step: resetVariableValue requires variableName.' };
        config.variableName = input.variableName;
        if (input.defaultValue !== undefined) config.defaultValue = input.defaultValue;
        break;
      }
      case 'branch': {
        if (!input.condition) return { success: false, error: 'add_workflow_step: branch requires condition.' };
        config.condition = input.condition;
        step.trueBranch = [];
        step.falseBranch = [];
        break;
      }
      case 'multiOptionBranch': {
        if (!input.condition) return { success: false, error: 'add_workflow_step: multiOptionBranch requires condition.' };
        config.condition = input.condition;
        step.branches = [];
        step.defaultBranch = [];
        break;
      }
      case 'passThroughCondition': {
        if (!input.condition) return { success: false, error: 'add_workflow_step: passThroughCondition requires condition.' };
        config.condition = input.condition;
        break;
      }
      case 'forEach': {
        if (!input.listPath) return { success: false, error: 'add_workflow_step: forEach requires listPath.' };
        config.listPath = input.listPath;
        step.loopBody = [];
        break;
      }
      case 'whileLoop': {
        if (!input.condition) return { success: false, error: 'add_workflow_step: whileLoop requires condition.' };
        config.condition = input.condition;
        step.loopBody = [];
        break;
      }
      case 'breakLoop':
      case 'continueLoop':
      case 'printPdf':
      case 'stopPropagation':
      case 'resetForm':
        // no config needed
        break;
      case 'navigateTo': {
        if (input.navPath) config.path = input.navPath;
        if (input.navExternalUrl) config.externalUrl = input.navExternalUrl;
        config.linkType = (input.navLinkType as string) ?? 'internal';
        if (input.navNewTab) config.newTab = input.navNewTab;
        if (input.navReplace) config.replace = input.navReplace;
        if (input.navQueryParamsJson) {
          try { config.queryParams = JSON.parse(input.navQueryParamsJson as string); } catch { /* ignore */ }
        }
        break;
      }
      case 'navigatePrev': {
        if (input.navDefaultPath) config.defaultPath = input.navDefaultPath;
        break;
      }
      case 'runJavaScript': {
        if (!input.code) return { success: false, error: 'add_workflow_step: runJavaScript requires code.' };
        config.code = input.code;
        config.async = (input.isAsync as boolean) ?? true;
        break;
      }
      case 'timeDelay': {
        config.time = Number(input.delayMs ?? 0);
        break;
      }
      case 'copyToClipboard': {
        config.value = input.copyValue ?? '';
        break;
      }
      case 'fetchData': {
        if (!input.fetchUrl) return { success: false, error: 'add_workflow_step: fetchData requires fetchUrl.' };
        config.url = input.fetchUrl;
        config.method = (input.fetchMethod as string) ?? 'GET';
        if (input.fetchBody) config.body = input.fetchBody;
        if (input.fetchContentType) config.contentType = input.fetchContentType;
        break;
      }
      case 'graphql': {
        if (!input.gqlEndpoint) return { success: false, error: 'add_workflow_step: graphql requires gqlEndpoint.' };
        if (!input.gqlQuery) return { success: false, error: 'add_workflow_step: graphql requires gqlQuery.' };
        config.endpoint = input.gqlEndpoint;
        config.query = input.gqlQuery;
        break;
      }
      case 'fetchCollection': {
        if (!input.collectionId) return { success: false, error: 'add_workflow_step: fetchCollection requires collectionId.' };
        config.collectionId = input.collectionId;
        break;
      }
      case 'fetchCollectionsParallel': {
        if (!input.collectionIds) return { success: false, error: 'add_workflow_step: fetchCollectionsParallel requires collectionIds.' };
        config.collections = (input.collectionIds as string).split(',').map(s => s.trim()).filter(Boolean);
        break;
      }
      case 'updateCollection': {
        if (!input.collectionId) return { success: false, error: 'add_workflow_step: updateCollection requires collectionId.' };
        config.collectionId = input.collectionId;
        if (input.updateType) config.updateType = input.updateType;
        if (input.collectionData) config.data = input.collectionData;
        if (input.idKey) config.idKey = input.idKey;
        if (input.idValue) config.idValue = input.idValue;
        break;
      }
      case 'runProjectWorkflow': {
        if (!input.projectWorkflowId) return { success: false, error: 'add_workflow_step: runProjectWorkflow requires projectWorkflowId.' };
        config.workflowId = input.projectWorkflowId;
        break;
      }
      case 'setFormState': {
        if (input.formIsSubmitting !== undefined) config.isSubmitting = input.formIsSubmitting;
        if (input.formIsSubmitted !== undefined) config.isSubmitted = input.formIsSubmitted;
        break;
      }
      case 'pickFile': {
        if (!input.pickStoreIn) return { success: false, error: 'add_workflow_step: pickFile requires pickStoreIn.' };
        config.storeIn = input.pickStoreIn;
        if (input.pickAccept) config.accept = input.pickAccept;
        if (input.pickMultiple !== undefined) config.multiple = input.pickMultiple;
        break;
      }
      case 'addSharedComponent': {
        if (!input.scComponentId) return { success: false, error: 'add_workflow_step: addSharedComponent requires scComponentId.' };
        config.componentId = input.scComponentId;
        if (input.scWaitClose !== undefined) config.waitClose = input.scWaitClose;
        break;
      }
      case 'deleteSharedComponent':
      case 'deleteAllSharedComponents':
        break;
      case 'emitComponentTrigger': {
        if (!input.emitTriggerId) return { success: false, error: 'add_workflow_step: emitComponentTrigger requires emitTriggerId.' };
        config.triggerId = input.emitTriggerId;
        if (input.emitPayload !== undefined) config.payload = input.emitPayload;
        break;
      }
      case 'returnValue': {
        if (input.copyValue !== undefined) config.value = input.copyValue;
        break;
      }
      case 'createUrlFromBase64': {
        if (!input.base64) return { success: false, error: 'add_workflow_step: createUrlFromBase64 requires base64.' };
        config.base64 = input.base64;
        if (input.mimeType) config.mimeType = input.mimeType;
        if (input.storeIn) config.storeIn = input.storeIn;
        break;
      }
      case 'encodeFileAsBase64': {
        if (!input.dataUrl) return { success: false, error: 'add_workflow_step: encodeFileAsBase64 requires dataUrl.' };
        config.dataUrl = input.dataUrl;
        if (input.storeIn) config.storeIn = input.storeIn;
        break;
      }
      case 'downloadFileFromUrl': {
        if (!input.downloadUrl) return { success: false, error: 'add_workflow_step: downloadFileFromUrl requires downloadUrl.' };
        config.url = input.downloadUrl;
        break;
      }
      default:
        // Unknown type — store with empty config and let validator decide
        break;
    }

    if (Object.keys(config).length > 0) {
      step.config = config;
    }

    // ── Locate the target array and insert the step ──────────────────────────
    const currentSteps = (store.pageWorkflows![workflowName] ?? []) as Array<Record<string, unknown>>;
    const cloned = JSON.parse(JSON.stringify(currentSteps)) as Array<Record<string, unknown>>;

    const parentStepId = input.parentStepId as string | undefined;
    const branchKey = input.branchKey as string | undefined;

    /** Recursively find a step by id in a steps array and all nested branches. */
    function findStepById(
      steps: Array<Record<string, unknown>>,
      id: string,
    ): Record<string, unknown> | null {
      for (const s of steps) {
        if (s.id === id) return s;
        // Check all possible sub-arrays
        for (const key of ['trueBranch', 'falseBranch', 'defaultBranch', 'loopBody']) {
          if (Array.isArray(s[key])) {
            const found = findStepById(s[key] as Array<Record<string, unknown>>, id);
            if (found) return found;
          }
        }
        if (Array.isArray(s.branches)) {
          for (const b of s.branches as Array<Record<string, unknown>>) {
            if (Array.isArray(b.steps)) {
              const found = findStepById(b.steps as Array<Record<string, unknown>>, id);
              if (found) return found;
            }
          }
        }
      }
      return null;
    }

    let targetArray: Array<Record<string, unknown>>;

    if (!parentStepId) {
      // Root level
      targetArray = cloned;
    } else {
      const parentStep = findStepById(cloned, parentStepId);
      if (!parentStep) {
        return {
          success: false,
          error: `add_workflow_step: parent step "${parentStepId}" not found in workflow "${workflowName}".`,
        };
      }

      if (!branchKey) {
        return {
          success: false,
          error: 'add_workflow_step: branchKey is required when parentStepId is provided. Use "trueBranch", "falseBranch", "branches.{match}", "defaultBranch", or "loopBody".',
        };
      }

      if (branchKey.startsWith('branches.')) {
        // multiOptionBranch — find or create the branch entry
        const matchValue = branchKey.slice('branches.'.length);
        if (!Array.isArray(parentStep.branches)) parentStep.branches = [];
        const branches = parentStep.branches as Array<Record<string, unknown>>;
        let branchEntry = branches.find(b => b.match === matchValue) as Record<string, unknown> | undefined;
        if (!branchEntry) {
          branchEntry = { match: matchValue, steps: [] };
          branches.push(branchEntry);
        }
        if (!Array.isArray(branchEntry.steps)) branchEntry.steps = [];
        targetArray = branchEntry.steps as Array<Record<string, unknown>>;
      } else {
        // trueBranch, falseBranch, defaultBranch, loopBody
        if (!Array.isArray(parentStep[branchKey])) parentStep[branchKey] = [];
        targetArray = parentStep[branchKey] as Array<Record<string, unknown>>;
      }
    }

    // Validate the NEW step's type before pushing — do NOT validate pre-existing
    // steps in the workflow. Stale steps (e.g. set_repeat from a prior build)
    // must not block valid new additions.
    const newStepType = step.type as string | undefined;
    if (newStepType && !SUPPORTED_STEP_TYPES.has(newStepType)) {
      return {
        success: false,
        error: `Step type "${newStepType}" is not a supported workflow step type. Did you mean one of: changeVariableValue, navigateTo, branch, multiOptionBranch, forEach, runJavaScript, fetchData, graphql, fetchCollection? See the full list in the workflow step reference.`,
      };
    }

    targetArray.push(step);

    // Run formula + prohibited validators on the full updated tree.
    // validateStepTypes is intentionally NOT run on the full tree — only the new step was validated above.
    const coerced = coerceStepFormulas(cloned);
    const formulaError = validateWorkflowFormulas(coerced);
    if (formulaError) return { success: false, error: formulaError };
    const prohibitedError = findProhibitedStep(coerced);
    if (prohibitedError) return { success: false, error: prohibitedError };

    store.setPageWorkflow(workflowName, coerced as object[]);

    const location = parentStepId
      ? `${branchKey} of step "${parentStepId}"`
      : 'root';
    return {
      success: true,
      data: {
        workflowName,
        stepId,
        type,
        location,
        message: `Added "${type}" step "${stepId}" to workflow "${workflowName}" at ${location}.`,
      },
    };
  },

  set_animation(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    const ENTER_TYPES = new Set(['none', 'fadeIn', 'slideInUp', 'slideInDown', 'slideInLeft', 'slideInLeftSubtle', 'slideInRight', 'riseFade', 'dropIn', 'zoomIn', 'expandIn', 'bounceIn', 'flipInX', 'flipInY', 'flipIn3D', 'tiltIn', 'skewIn', 'skewInY', 'blurIn', 'glowIn', 'rollIn', 'revealUp', 'charFall', 'charBounce']);
    const EXIT_TYPES = new Set(['none', 'fadeOut', 'slideOutUp', 'slideOutDown', 'slideOutLeft', 'slideOutRight', 'zoomOut', 'shrinkOut', 'blurOut', 'skewOut']);
    const LOOP_TYPES = new Set(['none', 'pulse', 'breathe', 'float', 'shake', 'wiggle', 'wobble', 'swing', 'spin', 'ticker', 'bounce', 'heartbeat', 'flash', 'ripple', 'glowPulse', 'gradientDrift']);
    const SCROLL_TYPES = new Set(['none', 'fadeIn', 'slideInUp', 'slideInDown', 'slideInLeft', 'slideInRight', 'riseFade', 'dropIn', 'zoomIn', 'expandIn', 'bounceIn', 'blurIn']);
    const HOVER_TYPES = new Set(['scale', 'lift', 'none']);
    const PRESS_TYPES = new Set(['scale', 'bounce', 'none']);
    const validateEnum = (name: string, value: unknown, allowed: Set<string>): ToolResult | null => {
      if (value === undefined || value === null) return null;
      const s = String(value);
      if (allowed.has(s)) return null;
      return { success: false, error: `${name} value "${s}" is not supported. Allowed: ${Array.from(allowed).join(', ')}` };
    };
    const enumErr =
      validateEnum('enter', input.enter, ENTER_TYPES) ??
      validateEnum('exit', input.exit, EXIT_TYPES) ??
      validateEnum('loop', input.loop, LOOP_TYPES) ??
      validateEnum('scroll', input.scroll, SCROLL_TYPES) ??
      validateEnum('hover', input.hover, HOVER_TYPES) ??
      validateEnum('press', input.press, PRESS_TYPES);
    if (enumErr) return enumErr;

    // Read existing animation to merge (preserve unspecified fields)
    const node = findNodeInStore(store, nodeId);
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
        if (input.enterStagger !== undefined) ec.stagger = Number(input.enterStagger);
      } else if (input.enterStagger !== undefined) {
        // enterStagger provided without an enter type and no existing enter animation.
        // Auto-add a default enter so the stagger has something to work with instead of
        // producing an empty animation object (which would wipe all existing animations).
        animation.enter = {
          type: 'fadeIn',
          duration: Number(input.enterDuration ?? 400),
          stagger: Number(input.enterStagger),
        };
        if (input.enterDelay !== undefined) (animation.enter as Record<string, unknown>).delay = Number(input.enterDelay);
        if (input.enterEasing !== undefined) (animation.enter as Record<string, unknown>).easing = input.enterEasing;
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
        if (input.loopIntensity !== undefined) loopCfg.intensity = Math.max(0, Math.min(1, Number(input.loopIntensity)));
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
        if (input.loopIntensity !== undefined) lc.intensity = Math.max(0, Math.min(1, Number(input.loopIntensity)));
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

    // ── Nested config passthrough (Phase D+) ────────────────────────────────
    // Advanced animation surfaces are accepted as nested objects so the AI can
    // configure every panel feature without exploding flat-prop count. Each
    // accepted key maps 1:1 to AnimationConfig in lib/sdui/components/animated-node.tsx.
    const NESTED_KEYS = [
      'tilt', 'mouseParallax', 'focus', 'flip', 'parallax', 'scrollProgress',
      'color', 'layout', 'morphShape', 'drag', 'splitText', 'states',
      'gesture', 'particles', 'noise', 'svgStroke', 'gradientAnimation',
      'clipPath', 'mask', 'pseudoElement', 'timeline', 'imperativeTrigger',
      'customBezier',
    ] as const;
    for (const key of NESTED_KEYS) {
      const raw = (input as Record<string, unknown>)[key];
      if (raw === undefined) continue;
      if (raw === null || raw === false) {
        delete animation[key];
      } else if (typeof raw === 'object') {
        const next = { ...((animation[key] as Record<string, unknown> | undefined) ?? {}), ...(raw as Record<string, unknown>) };
        animation[key] = next;
      } else if (Array.isArray(raw)) {
        animation[key] = raw;
      } else {
        animation[key] = raw;
      }
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
    const nodeErr = requireNode(store, input.nodeId as string | undefined);
    if (nodeErr) return nodeErr;
    const capErr = checkCapability(store, input.nodeId as string, 'input-props');
    if (capErr) return capErr;
    const trigger = input.trigger === 'change' ? 'change' : 'submit';
    const VALID_RULE_TYPES = new Set(['required', 'email', 'phone', 'url', 'minLength', 'maxLength', 'pattern', 'formula', 'equalsField']);
    const rules = (input.rules as Array<Record<string, unknown>> | undefined) ?? [];
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      const t = String(r?.type ?? '');
      if (!VALID_RULE_TYPES.has(t)) {
        return { success: false, error: `rules[${i}].type "${t}" is invalid. Valid: ${[...VALID_RULE_TYPES].join(', ')}.` };
      }
      if (typeof r.message !== 'string' || !r.message) {
        return { success: false, error: `rules[${i}] requires a non-empty "message".` };
      }
      if ((t === 'minLength' || t === 'maxLength') && typeof r.value !== 'number') {
        return { success: false, error: `rules[${i}] of type "${t}" requires numeric "value".` };
      }
      if (t === 'pattern' && typeof r.value !== 'string') {
        return { success: false, error: `rules[${i}] of type "pattern" requires string "value" (regex source).` };
      }
      if (t === 'formula' && typeof r.formula !== 'string') {
        return { success: false, error: `rules[${i}] of type "formula" requires string "formula".` };
      }
      if (t === 'equalsField' && typeof r.value !== 'string') {
        return { success: false, error: `rules[${i}] of type "equalsField" requires string "value" (other field name).` };
      }
    }
    store.patchNodeField(input.nodeId as string, '_validation', { trigger, rules });
    return { success: true, data: { message: `Set ${rules.length} validation rule(s) (trigger: ${trigger})` } };
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
    const nodeErr = requireNode(store, input.nodeId as string | undefined);
    if (nodeErr) return nodeErr;
    const capErr = checkCapability(store, input.nodeId as string, 'disabled');
    if (capErr) return capErr;
    store.patchProp(input.nodeId as string, 'disabled', input.disabled);
    return { success: true, data: { message: `Set disabled to ${JSON.stringify(input.disabled)}` } };
  },

  set_loading_state(input, getStore) {
    const store = getStore();
    const nodeErr = requireNode(store, input.nodeId as string | undefined);
    if (nodeErr) return nodeErr;
    const rawState = String(input.state ?? '').trim();
    // Backward-compat: accept legacy capitalised values like "Loading" / "None".
    const lower = rawState.toLowerCase();
    const VALID = new Set(['loading', 'empty', 'default', 'custom', 'none']);
    if (!VALID.has(lower)) {
      return { success: false, error: `Unknown state "${rawState}". Use one of: loading, empty, default, custom, none.` };
    }
    let stored: string | null;
    if (lower === 'none') stored = null;
    else if (lower === 'custom') {
      const name = (input.customStateName as string | undefined)?.trim();
      if (!name) return { success: false, error: 'state="custom" requires a non-empty "customStateName".' };
      stored = name;
    } else stored = lower;
    store.patchNodeField(input.nodeId as string, '_stateTag', stored);
    return { success: true, data: { message: stored === null ? 'Removed state tag' : `Set state tag to "${stored}"` } };
  },

  // ── Variables ──────────────────────────────────────────────────────────────

  add_variable(input, getStore) {
    const store = getStore();
    const requestedId = (input.variableId as string | undefined)
      ?? (input._assignedVarId as string | undefined)
      ?? uuid();

    // If the variable already exists with this ID, return it as-is (idempotent).
    // Previously this generated a new UUID, which orphaned the new variable and left
    // the varRoster referencing the old ID — causing agents to write to stale state.
    const existingVar = store.customVars?.find((cv: CustomVar) => cv.id === requestedId);
    if (existingVar) {
      return { success: true, data: { id: requestedId, name: existingVar.name, message: `Variable "${existingVar.name}" (${requestedId}) already exists — reusing.` } };
    }
    const id = requestedId;

    // Resolve folder name → folderId (auto-create folder entity if it doesn't exist yet)
    let folderId: string | undefined;
    const folderName = (input.folder as string) || undefined;
    if (folderName) {
      const existing = store.varFolders.find((f: { id: string; name: string }) => f.name === folderName);
      if (existing) {
        folderId = existing.id;
      } else {
        const newFolderId = uuid();
        store.addVarFolder({ id: newFolderId, name: folderName, parentId: null });
        folderId = newFolderId;
      }
    }

    const vBase: Record<string, unknown> = {
      id,
      name: input.name as string,
      type: input.type as CustomVar['type'],
      initialValue: input.initialValue,
      description: (input.description as string) || undefined,
      folderId: (input.folderId as string | undefined) ?? folderId,
    };
    if (input.label !== undefined) vBase.label = input.label;
    if (typeof input.saveInLocalStorage === 'boolean') vBase.saveInLocalStorage = input.saveInLocalStorage;
    if (input.fields !== undefined) vBase.fields = input.fields;
    if (input.scope !== undefined) vBase.scope = input.scope;
    if (input.componentModelId !== undefined) vBase.componentModelId = input.componentModelId;
    const v = vBase as unknown as CustomVar;
    store.addCustomVar(v);
    return { success: true, data: { id, name: v.name, message: `Created variable "${v.name}" (${id})` } };
  },

  update_variable(input, getStore) {
    const store = getStore();
    const variableId = input.variableId as string;
    const patchBase: Record<string, unknown> = {};
    if (input.name !== undefined)               patchBase.name = input.name as string;
    if (input.type !== undefined)               patchBase.type = input.type as CustomVar['type'];
    if (input.initialValue !== undefined)       patchBase.initialValue = input.initialValue;
    if (input.label !== undefined)              patchBase.label = input.label;
    if (input.description !== undefined)        patchBase.description = input.description as string;
    if (typeof input.saveInLocalStorage === 'boolean') patchBase.saveInLocalStorage = input.saveInLocalStorage;
    if (input.folderId !== undefined)           patchBase.folderId = input.folderId as string;
    if (input.fields !== undefined)             patchBase.fields = input.fields;
    if (input.scope !== undefined)              patchBase.scope = input.scope;
    if (input.componentModelId !== undefined)   patchBase.componentModelId = input.componentModelId;
    const found = store.customVars?.find(cv => cv.id === variableId || cv.name === variableId);
    if (!found) {
      return { success: false, error: `Variable "${variableId}" not found. Call get_variables.` };
    }
    store.updateCustomVar(found.name, patchBase as unknown as Partial<CustomVar>);
    return { success: true, data: { message: `Updated variable "${variableId}"` } };
  },

  delete_variable(input, getStore) {
    const store = getStore();
    const variableId = input.variableId as string;
    const found = store.customVars?.find(cv => cv.id === variableId || cv.name === variableId);
    if (!found) return { success: false, error: `Variable "${variableId}" not found.` };
    store.removeCustomVar(found.name);
    return { success: true, data: { message: `Deleted variable "${found.name}"` } };
  },

  // ── Data Sources ───────────────────────────────────────────────────────────

  add_data_source(input, getStore) {
    const store = getStore();
    const id = (input.dataSourceId as string | undefined) ?? uuid();

    // Resolve folder name → folderId (auto-create)
    let folderId = input.folderId as string | undefined;
    const folderName = (input.folder as string | undefined) ?? undefined;
    if (folderName && !folderId) {
      const folders = (store as unknown as { dataSourceFolders?: Array<{ id: string; name: string; parentId: string | null }>; addDataSourceFolder?: (f: { id: string; name: string; parentId: string | null }) => void })
        .dataSourceFolders ?? [];
      const existing = folders.find(f => f.name === folderName);
      if (existing) folderId = existing.id;
      else {
        const newFolderId = uuid();
        const adder = (store as unknown as { addDataSourceFolder?: (f: { id: string; name: string; parentId: string | null }) => void }).addDataSourceFolder;
        if (typeof adder === 'function') {
          adder({ id: newFolderId, name: folderName, parentId: null });
          folderId = newFolderId;
        }
      }
    }

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
    const extras = cfg as unknown as Record<string, unknown>;
    if (input.headers !== undefined)         extras.headers = input.headers;
    if (input.body !== undefined)            extras.body = input.body;
    if (input.queryParams !== undefined)     extras.queryParams = input.queryParams;
    if (input.auth !== undefined)            extras.auth = input.auth;
    if (input.variables !== undefined)       extras.variables = input.variables;
    if (input.responsePath !== undefined)    extras.responsePath = input.responsePath;
    if (input.proxy !== undefined)           extras.proxy = !!input.proxy;
    if (input.sendCredentials !== undefined) extras.sendCredentials = !!input.sendCredentials;
    if (folderId)                            extras.folderId = folderId;
    if (input.triggerActionName !== undefined) extras.triggerActionName = input.triggerActionName;
    if (input.cacheTag !== undefined)        extras.cacheTag = input.cacheTag;
    if (typeof input.cacheTTL === 'number')  extras.cacheTTL = input.cacheTTL;
    if (Array.isArray(input.cacheKeyVars))   extras.cacheKeyVars = input.cacheKeyVars;

    store.addPageDataSource(cfg);

    // Auto-fetch for mount-mode REST GET sources so the result panel and schema
    // inference are immediately populated without a manual "Run" click.
    if (cfg.type === 'rest' && cfg.url && (cfg.method ?? 'GET') === 'GET' && cfg.trigger !== 'action') {
      fetch(cfg.url)
        .then(r => r.json())
        .then(data => store.updatePageDataSource(id, { _lastFetch: { status: 'success', data, fetchedAt: Date.now() } }))
        .catch(err => store.updatePageDataSource(id, { _lastFetch: { status: 'error', error: String(err), fetchedAt: Date.now() } }));
    }

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

  set_theme_mode(input) {
    const mode = input.mode as 'light' | 'dark' | 'system';
    if (!['light', 'dark', 'system'].includes(mode)) {
      return { success: false, error: 'mode must be "light", "dark", or "system".' };
    }
    if (typeof document !== 'undefined' && document.documentElement) {
      const root = document.documentElement;
      const resolved = mode === 'system'
        ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : mode;
      root.classList.remove('light', 'dark');
      root.classList.add(resolved);
      root.style.colorScheme = resolved;
    }
    return { success: true, data: { message: `Set theme mode to "${mode}"` } };
  },

  apply_theme_preset(input, getStore) {
    const store = getStore();
    const presetName = input.presetName as string;
    if (!presetName || typeof presetName !== 'string') {
      return { success: false, error: 'apply_theme_preset requires a non-empty "presetName".' };
    }
    const preset = findThemePreset(presetName);
    if (!preset) {
      const known = THEME_PRESETS.map(p => p.name).join(', ');
      return { success: false, error: `Unknown theme preset "${presetName}". Available: ${known}.` };
    }
    store.applyThemePreset(preset.light, preset.dark, preset.fonts);
    return {
      success: true,
      data: { message: `Applied theme preset "${preset.name}"`, presetId: preset.id, presetName: preset.name },
    };
  },

  add_custom_color(input, getStore) {
    const store = getStore();
    const name = input.name as string;
    const light = input.light as string;
    const dark = input.dark as string;
    if (!name || !light || !dark) {
      return { success: false, error: 'add_custom_color requires "name", "light", and "dark".' };
    }
    const id = (input.colorId as string | undefined) || `color-${uuid()}`;
    const color = {
      id,
      name,
      light,
      dark,
      ...(input.label ? { label: input.label as string } : {}),
      ...(input.description ? { description: input.description as string } : {}),
      ...(input.folderId ? { folderId: input.folderId as string } : {}),
    } as Parameters<typeof store.addCustomColor>[0];
    store.addCustomColor(color);
    return { success: true, data: { id, message: `Added custom color "${name}" (${id})` } };
  },

  delete_custom_color(input, getStore) {
    const store = getStore();
    const colorId = input.colorId as string;
    if (!colorId) return { success: false, error: 'delete_custom_color requires "colorId".' };
    store.removeCustomColor(colorId);
    return { success: true, data: { message: `Deleted custom color "${colorId}"` } };
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
    const pageId = input.pageId as string;
    const pages = store.pages as Array<{ id: string; name: string }>;
    const exists = pages.some(p => p.id === pageId);
    if (!exists) {
      return {
        success: false,
        error: `Page "${pageId}" not found. Valid page IDs: ${pages.map(p => `${p.id} ("${p.name}")`).join(', ')}`,
      };
    }
    store.navigatePage(pageId);
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
    // Map external "public" → internal "everyone"; "guest" maps to access:"everyone" + guestOnly:true.
    const rawAccess = input.access as string | undefined;
    if (rawAccess !== undefined || input.accessCondition !== undefined || input.guestOnly !== undefined) {
      let accessFlag: 'everyone' | 'authenticated' = 'everyone';
      let guestOnly = !!input.guestOnly;
      if (rawAccess === 'authenticated') accessFlag = 'authenticated';
      else if (rawAccess === 'guest') { accessFlag = 'everyone'; guestOnly = true; }
      else if (rawAccess === 'public') { accessFlag = 'everyone'; guestOnly = !!input.guestOnly; }
      const condition = typeof input.accessCondition === 'string' ? (input.accessCondition as string) : undefined;
      store.setCurrentPageAccess(accessFlag, guestOnly, condition);
    }
    return { success: true, data: { message: `Updated page config` } };
  },

  // ── Shared Components ──────────────────────────────────────────────────────

  get_shared_components() {
    const map = getSharedComponents();
    const list = Object.values(map).map(m => ({
      id: m.id,
      name: m.name,
      folder: m.folder,
      description: m.description,
      properties: m.properties ?? [],
      variables: m.variables ?? {},
      formulas: m.formulas ?? {},
      workflows: m.workflows ?? {},
      triggers: m.triggers ?? [],
      valueVariable: (m as { valueVariable?: string }).valueVariable,
    }));
    return { success: true, data: { sharedComponents: list, count: list.length } };
  },

  add_shared_component_instance(input, getStore) {
    const store = getStore();
    const modelId = input.modelId as string;
    const requestedId = input.nodeId as string | undefined;
    if (!modelId) return { success: false, error: 'add_shared_component_instance requires "modelId".' };
    if (!requestedId || !isUUIDFormat(requestedId)) {
      return { success: false, error: 'add_shared_component_instance requires a pre-minted UUID "nodeId".' };
    }
    const model = getSharedComponents()[modelId];
    if (!model) {
      return { success: false, error: `Shared component "${modelId}" not found. Call get_shared_components() to list available models.` };
    }
    const parentId = (input.parentId as string | null) ?? null;
    if (parentId && !findNodeInStore(store, parentId)) {
      return { success: false, error: `Parent node "${parentId}" not found in the current page.` };
    }

    const modelContent = JSON.parse(JSON.stringify(model.content)) as Record<string, unknown>;
    stampSharedKeys(modelContent);
    const cloned = cloneWithFreshIdsKeepSharedKey(modelContent);
    cloned.id = requestedId;
    cloned._shared = { id: model.id, name: model.name };
    cloned._overrides = [];
    if (input.name && typeof input.name === 'string') {
      cloned.name = input.name;
    }
    if (input.props && typeof input.props === 'object') {
      const existing = (cloned.props ?? {}) as Record<string, unknown>;
      cloned.props = { ...existing, ...(input.props as Record<string, unknown>) };
    }
    const atIdx = input.atIndex as number | undefined;
    store.addNode(cloned as unknown as SDUINode, parentId, atIdx);
    return {
      success: true,
      data: {
        nodeId: requestedId,
        modelId,
        message: `Placed shared component "${model.name}" with nodeId ${requestedId}`,
      },
    };
  },

  set_component_props(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    const node = findNodeInStore(store, nodeId);
    const sharedRef = (node as { _shared?: { id?: string } } | null)?._shared;
    if (!sharedRef?.id) {
      return {
        success: false,
        error: `Node "${nodeId}" is not a shared-component instance. set_component_props is only for nodes whose _shared metadata is set — use set_style / set_text on regular nodes.`,
      };
    }
    const incoming = input.props as Record<string, unknown> | undefined;
    if (!incoming || typeof incoming !== 'object') {
      return { success: false, error: 'set_component_props requires a "props" object.' };
    }
    const model = getSharedComponents()[sharedRef.id];
    if (model) {
      const declared = new Set((model.properties ?? []).map(p => p.name));
      const unknownKeys = Object.keys(incoming).filter(k => !declared.has(k));
      if (unknownKeys.length > 0) {
        return {
          success: false,
          error: `Unknown property keys for shared component "${model.name}": ${unknownKeys.join(', ')}. Declared: ${[...declared].join(', ') || '(none)'}.`,
        };
      }
    }
    for (const [key, value] of Object.entries(incoming)) {
      store.patchProp(nodeId, `props.${key}`, value);
    }
    return { success: true, data: { message: `Updated component props on node` } };
  },

  // ── Responsive overrides ──────────────────────────────────────────────────

  set_responsive_override(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    const breakpoint = input.breakpoint as 'laptop' | 'tablet' | 'mobile';
    if (!['laptop', 'tablet', 'mobile'].includes(breakpoint)) {
      return { success: false, error: 'breakpoint must be "laptop", "tablet", or "mobile" (desktop is the base — no override).' };
    }
    const field = input.field as string;
    if (!field || typeof field !== 'string') {
      return { success: false, error: 'set_responsive_override requires a non-empty "field" path.' };
    }
    const value = input.value;
    if (value === undefined) {
      return { success: false, error: 'set_responsive_override requires a "value" (use clear_responsive_override to delete).' };
    }
    store.patchResponsive(nodeId, breakpoint, field, value);
    return { success: true, data: { message: `Set responsive override [${breakpoint}].${field}` } };
  },

  clear_responsive_override(input, getStore) {
    const store = getStore();
    const nodeId = input.nodeId as string;
    const nodeErr = requireNode(store, nodeId);
    if (nodeErr) return nodeErr;
    const breakpoint = input.breakpoint as 'laptop' | 'tablet' | 'mobile';
    if (!['laptop', 'tablet', 'mobile'].includes(breakpoint)) {
      return { success: false, error: 'breakpoint must be "laptop", "tablet", or "mobile".' };
    }
    const field = (input.field as string | undefined) ?? undefined;
    store.removeResponsiveOverride(nodeId, breakpoint, field);
    return {
      success: true,
      data: { message: field ? `Cleared [${breakpoint}].${field}` : `Cleared [${breakpoint}] override slice` },
    };
  },

  set_workflow_params(input, getStore) {
    const store = getStore();
    const workflowName = input.workflowName as string;
    if (!workflowName) return { success: false, error: 'set_workflow_params requires "workflowName".' };
    const wfExists = !!store.pageWorkflows?.[workflowName];
    if (!wfExists) {
      return { success: false, error: `Workflow "${workflowName}" not found. Use the exact workflowName from your WORKFLOW ROSTER.` };
    }
    const params = input.params;
    if (!Array.isArray(params)) {
      return { success: false, error: 'set_workflow_params requires "params" to be an array.' };
    }
    const TYPE_ALIASES: Record<string, 'Text' | 'Number' | 'Boolean' | 'Object' | 'Array'> = {
      string: 'Text', text: 'Text', Text: 'Text',
      number: 'Number', Number: 'Number',
      boolean: 'Boolean', Boolean: 'Boolean',
      object: 'Object', Object: 'Object',
      array: 'Array', Array: 'Array',
    };
    const cleaned = params.map((p, i) => {
      const obj = (p ?? {}) as Record<string, unknown>;
      const name = typeof obj.name === 'string' ? obj.name : '';
      const rawType = typeof obj.type === 'string' ? obj.type : 'string';
      const type = TYPE_ALIASES[rawType] ?? 'Text';
      if (!name) throw new Error(`Param at index ${i} requires "name".`);
      const id = typeof obj.id === 'string' ? obj.id : `param-${i + 1}`;
      const out = { id, name, type } as { id: string; name: string; type: typeof type; allowMultiple?: boolean; testValue?: unknown };
      if (typeof obj.allowMultiple === 'boolean') out.allowMultiple = obj.allowMultiple;
      if ('defaultValue' in obj) out.testValue = obj.defaultValue;
      else if ('testValue' in obj) out.testValue = obj.testValue;
      return out;
    });
    store.setPageWorkflowMeta(workflowName, { params: cleaned });
    return {
      success: true,
      data: {
        message: `Declared ${cleaned.length} param${cleaned.length === 1 ? '' : 's'} on "${workflowName}"`,
        paramCount: cleaned.length,
      },
    };
  },

  // ── Canvas ─────────────────────────────────────────────────────────────────

  select_node(input, getStore) {
    const store = getStore();
    const nodeErr = requireNode(store, input.nodeId as string | undefined);
    if (nodeErr) return nodeErr;
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
    // Multi-page support: tool inputs may carry `_pageId` when the AI is editing a node
    // that lives on a non-focused page. We deliberately do NOT switch the focused page
    // here — the canvas should stay on whatever the user picked while parallel agents
    // build pages in the background. The two pieces that actually make this work:
    //
    //   • `findNodeInStore` (this file) scans non-focused pages, so `requireNode` /
    //     `checkCapability` find cross-page targets.
    //   • `patchAnyNode` (in `_store.ts`) writes through to `pages[i].nodes` directly
    //     when the node lives off-screen, leaving `pageNodes` (the focused page)
    //     untouched.
    //
    // `generate_structure` is the one exception: it inserts a brand-new tree onto a
    // specific page and intentionally navigates to it, so we just let its handler run.

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
  if (templateMatch) return { js: templateMatch[1] };
  if (FORMULA_SCOPE_RE.test(raw) && !hasTemplateMarkers) return { js: raw };
  return raw;
}

// ─── generate_structure — materialize full tree from server-assigned UUIDs ───

handlers['generate_structure'] = function generateStructure(input, getStore) {
  const store = getStore();
  const treeInput = input.tree as Record<string, unknown>;
  const parentId = (input.parentId as string | null) ?? null;
  const atIdx = input.atIndex as number | undefined;

  if (parentId && !findNodeInStore(store, parentId)) {
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
    const rawLabel = node.label as string | undefined;
    // Normalize: AI sometimes uses the hint name as the label (e.g. "Dark Overlay" instead of "Box").
    // Remap any unregistered label to "Box" so the node renders as a plain container.
    const label = (rawLabel && getTemplate(rawLabel)) ? rawLabel : (rawLabel ? 'Box' : undefined);
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

    // Strip optional-chaining from repeat/map paths — "context?.item?.data?.x" → "context.item.data.x"
    if (node.repeat && typeof node.repeat === 'string') {
      node.repeat = (node.repeat as string).replace(/\?\./g, '.');
    }
    if (node.map && typeof node.map === 'string') {
      node.map = (node.map as string).replace(/\?\./g, '.');
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
      // Strip any hardcoded width/height from the defaultNode template — the styling
      // agent always sets explicit sizes, and stale pixel values win over w-full/h-full
      // extracted from className (cleanProps.style beats arbStyles in the renderer merge).
      const vStyle = (vProps.style ?? {}) as Record<string, unknown>;
      delete vStyle.width;
      delete vStyle.height;
      if (Object.keys(vStyle).length > 0) vProps.style = vStyle;
      else delete vProps.style;
      base.props = vProps;
    }

    // Auto-route CSS gradient bgImage to props.style.backgroundImage.
    // bgImage is documented as a photo search query for the media agent.
    // If the AI passes a CSS gradient string (linear-gradient / radial-gradient / conic-gradient),
    // skip the photo-search path entirely and apply the gradient as an inline style instead.
    const rawBgImage = node.bgImage as string | undefined;
    if (rawBgImage && /^(linear|radial|conic)-gradient/i.test(rawBgImage.trim())) {
      const bProps = (base.props ?? {}) as Record<string, unknown>;
      const bStyle = (bProps.style ?? {}) as Record<string, unknown>;
      bStyle.backgroundImage = rawBgImage;
      bStyle.backgroundSize = bStyle.backgroundSize ?? 'cover';
      bProps.style = bStyle;
      base.props = bProps;
      delete node.bgImage; // prevent media agent from treating this as a photo search
    }

    // Apply name (layers label)
    if (node.name) base.name = node.name;

    // direction is a compact-tree annotation only — the styling agent applies layout via set_style.

    // Apply text shortcut — apply formula detection so formula expressions are stored as
    // { formula: "..." } instead of literal strings (same logic as set_text handler).
    if (node.text) {
      const textVal = toTextValue(node.text as string);
      base.text = textVal;
    }

    // Apply placeholder for Input / Textarea nodes — without this the field renders
    // completely blank with no hint text for the user.
    if (node.placeholder && (label === 'Input' || label === 'Textarea')) {
      (base.props as Record<string, unknown>).placeholder = node.placeholder as string;
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

    // Propagate node.text to the first Text child when the parent has children
    // (e.g. Badge Box with text: "Most Popular" should pass that text to its inner Text node).
    if (node.text && Array.isArray(base.children)) {
      const textChild = (base.children as Record<string, unknown>[]).find(c =>
        c.type === 'Text'
      );
      if (textChild) {
        const textVal = toTextValue(node.text as string);
        textChild.text = textVal;
      }
    }

    return base as unknown as SDUINode;
  }

  const materializedTree = materialize(treeInput);

  // ── Purge build-time searchQuery from materialized props ─────────────────────
  // searchQuery is extracted server-side by extractMediaFromTree (build-time only).
  // It must NOT persist in props — it's never used by the renderer and can contain
  // garbage values (UUID fragments, stale queries) that pollute the node data.
  const autoFixedSearchQuery: string[] = [];
  (function walkAndPurgeSearchQuery(node: SDUINode, parentName?: string) {
    const n = node as unknown as Record<string, unknown>;
    const nodeType = n.type as string | undefined;
    const nodeName = (n.name as string | undefined) ?? '';
    if (nodeType === 'Image' || nodeType === 'Video') {
      const nProps = (n.props ?? {}) as Record<string, unknown>;
      // Always purge searchQuery from props — it is build-time metadata only.
      if ('searchQuery' in nProps) { delete nProps.searchQuery; n.props = nProps; }
      // Also purge from top-level node field (set by some code paths).
      if ('searchQuery' in n) delete n.searchQuery;
      // Log warning when this Image/Video had no searchQuery in the raw tree.
      // (The check is best-effort — we warn on any Image/Video that survived without one.)
    }
    const kids = n.children as SDUINode[] | undefined;
    if (Array.isArray(kids)) kids.forEach(c => walkAndPurgeSearchQuery(c, nodeName || parentName));
  })(materializedTree);
  // ── End searchQuery purge ─────────────────────────────────────────────────────

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
    const pageExists = (store.pages as Array<{ id: string }>).some(p => p.id === targetPageId);
    if (pageExists) {
      // Insert directly into the target page. We do NOT call navigatePage here —
      // findNodeInStore + patchAnyNode now resolve nodes across pages, so follow-up
      // tools (set_style, set_animation, etc.) reach the inserted nodes regardless
      // of which page is focused. Keeping focus stable means parallel multi-page
      // builds don't make the canvas flicker between pages.
      store.insertNodeIntoPage(targetPageId, materializedTree);
    } else {
      // _pageId points to a non-existent page (e.g. AI hallucinated the ID).
      // Fall back to inserting into the current page so nodes remain findable.
      store.addNode(materializedTree, parentId, atIdx);
    }
  } else {
    store.addNode(materializedTree, parentId, atIdx);
  }

  // Apply deferred inline repeat/condition from tree nodes
  for (const op of deferredOps) {
    if (op.repeat) {
      const normalizedRepeat = op.repeat.replace(/\?\./g, '.');
      // Formula-based map paths (e.g. getByIndex(...)) must be stored as { formula: "..." }
      const isFormulaRepeat = FORMULA_SCOPE_RE.test(normalizedRepeat) && /\(/.test(normalizedRepeat);
      if (isFormulaRepeat) {
        store.patchNodeField(op.nodeId, 'map', { formula: normalizedRepeat });
        store.patchNodeField(op.nodeId, 'key', op.keyField ?? 'id');
      } else {
        store.patchMap(op.nodeId, normalizedRepeat, op.keyField ?? 'id');
      }
    }
    if (op.condition) {
      let cond = op.condition;
      if (typeof cond === 'string' && cond.startsWith('!') && !cond.startsWith('!=')) {
        cond = `not(${cond.slice(1)})`;
      }
      store.patchCondition(op.nodeId, cond as unknown as object);
    }
  }

  void autoFixedSearchQuery; // unused — kept for future warning extension

  // ── Mint empty workflow stubs from declared actions[] / pageActions[] ─────────
  // The structure agent pre-assigns UUIDs and triggers in the tree. We create empty
  // workflows here (deterministically, no AI model involved) and bind them to their
  // nodes so the workflows agent only has to add steps — it never calls create_workflow
  // or bind_action.
  const mintedStubs: Array<{ workflowId: string; name: string; trigger: string; attachedTo?: string }> = [];

  // Walk treeInput (raw AI input), not materializedTree — materialize() never copies the
  // `actions` field to the SDUI node base, so walking the materialized tree always sees
  // n.actions === undefined and mints nothing. treeInput preserves id, name, and actions.
  function mintNodeActions(n: Record<string, unknown>) {
    const nodeActions = Array.isArray(n.actions) ? n.actions as Array<{ workflowId?: string; trigger?: string }> : [];
    for (const act of nodeActions) {
      const wfId = act.workflowId;
      const trigger = act.trigger ?? 'click';
      if (!wfId || typeof wfId !== 'string') continue;
      // Idempotency: skip if this UUID is already registered
      if ((getStore().pageWorkflows as Record<string, unknown>)?.[wfId]) continue;
      // Derive a human-readable display name (stored in meta.name, NOT as the store key).
      const nodeName = (n.name as string | undefined) ?? (n.type as string | undefined) ?? 'Node';
      const displayName = `${nodeName}_on${trigger.charAt(0).toUpperCase()}${trigger.slice(1)}`;
      const freshStore = getStore();
      // Store under the UUID — add_workflow_step's first check (workflowId in pageWorkflows)
      // succeeds immediately without any meta.id bridge. Matches the globalWorkflows convention.
      freshStore.setPageWorkflow(wfId, []);
      const effectivePageId = targetPageId ?? (getStore().pages as Array<{ id: string }>)[0]?.id;
      const meta: Record<string, unknown> = { id: wfId, name: displayName, trigger };
      if (effectivePageId) meta.pageScope = effectivePageId;
      freshStore.setPageWorkflowMeta(wfId, meta as Parameters<typeof freshStore.setPageWorkflowMeta>[1]);
      // Bind to node: push { action: wfId, trigger } — UUID is both the store key and the action ref
      const nodeId = (n.id as string | undefined);
      if (nodeId) {
        const latestStore = getStore();
        const existingNodeActions = Array.isArray((findNode(latestStore.pageNodes as SDUINode[], nodeId) as unknown as Record<string, unknown> | undefined)?.['actions'])
          ? [...((findNode(latestStore.pageNodes as SDUINode[], nodeId) as unknown as Record<string, unknown>)['actions'] as unknown[])]
          : [];
        const alreadyBound = (existingNodeActions as Array<{ action?: string }>).some(a => a.action === wfId);
        if (!alreadyBound) {
          latestStore.patchActions(nodeId, [...existingNodeActions, { action: wfId, trigger }] as unknown as Record<string, unknown>);
        }
      }
      mintedStubs.push({ workflowId: wfId, name: displayName, trigger, attachedTo: n.id as string | undefined });
    }
    if (Array.isArray(n.children)) {
      for (const child of n.children as Record<string, unknown>[]) mintNodeActions(child);
    }
  }

  mintNodeActions(treeInput);

  // Page-lifecycle workflows (pageActions at generate_structure top level)
  const pageActionsInput = Array.isArray(input.pageActions) ? input.pageActions as Array<{ workflowId?: string; trigger?: string }> : [];
  for (const pa of pageActionsInput) {
    const wfId = pa.workflowId;
    const trigger = pa.trigger ?? 'pageLoad';
    if (!wfId || typeof wfId !== 'string') continue;
    // Idempotency: skip if this UUID is already registered
    if ((getStore().pageWorkflows as Record<string, unknown>)?.[wfId]) continue;
    const displayPageName = `Page_on${trigger.charAt(0).toUpperCase()}${trigger.slice(1)}`;
    const freshStore = getStore();
    freshStore.setPageWorkflow(wfId, []);
    const effectivePageId = targetPageId ?? (getStore().pages as Array<{ id: string }>)[0]?.id;
    const meta: Record<string, unknown> = { id: wfId, name: displayPageName, trigger, isTrigger: true };
    if (effectivePageId) meta.pageScope = effectivePageId;
    freshStore.setPageWorkflowMeta(wfId, meta as Parameters<typeof freshStore.setPageWorkflowMeta>[1]);
    mintedStubs.push({ workflowId: wfId, name: displayPageName, trigger });
  }

  return {
    success: true,
    data: {
      message: 'Structure inserted.',
      mintedWorkflows: mintedStubs.length > 0 ? mintedStubs : undefined,
    },
  };
};


// ─── Mutation tool set (executed client-side) ─────────────────────────────────

export const CLIENT_SIDE_TOOLS = new Set([
  'generate_structure',
  'add_component', 'add_icon', 'add_image', 'add_video',
  'add_shared_component_instance', 'set_component_props',
  'delete_node', 'duplicate_node', 'move_node_up', 'move_node_down', 'move_node', 'wrap_in_container',
  'set_text', 'set_placeholder', 'set_href', 'set_src', 'set_icon_src', 'set_video_props',
  'set_background', 'set_text_color', 'set_border', 'set_shadow',
  'set_opacity', 'set_size', 'set_transform', 'set_overflow',
  'set_submit', 'set_input_props',
  'set_layout',
  'set_style',
  'set_responsive_override', 'clear_responsive_override',
  'set_condition', 'set_repeat', 'bind_action', 'unbind_action', 'create_workflow',
  'add_workflow_step', 'delete_workflow', 'set_workflow_params', 'set_animation', 'set_validation',
  'rename_node', 'set_disabled', 'set_loading_state',
  'get_workflows', 'get_data_sources', 'get_shared_components', 'get_formulas',
  'add_variable', 'update_variable', 'delete_variable', 'update_variable_initial_value',
  'patch_variable_item', 'patch_variable_items', 'patch_variable_fields',
  'append_variable_item', 'remove_variable_item',
  'add_data_source', 'delete_data_source', 'update_data_source_schema',
  'add_formula', 'update_formula', 'update_formula_body', 'delete_formula',
  'set_app_config', 'set_auth_config',
  'create_folder', 'rename_folder', 'delete_folder',
  'create_shared_component', 'update_shared_component_metadata', 'delete_shared_component',
  'update_shared_component_properties', 'update_shared_component_variables',
  'update_shared_component_formulas', 'update_shared_component_triggers',
  'enter_shared_component_edit', 'exit_shared_component_edit', 'set_instance_controlled',
  'update_workflow_steps',
  'set_theme_color', 'set_theme_mode', 'apply_theme_preset',
  'add_custom_color', 'delete_custom_color',
  'add_page', 'switch_page', 'rename_page', 'remove_page', 'set_page_config',
  'select_node', 'undo',
]);
