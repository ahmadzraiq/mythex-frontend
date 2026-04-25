'use client';

/**
 * _store-node-helpers.ts
 *
 * Pure node-tree utilities extracted from _store.ts.
 * These functions are free of Zustand state — they take a node array and return
 * a new array (immutable transforms). Import here rather than _store.ts when you
 * only need tree operations without pulling in the full Zustand store.
 *
 * Exports:
 *  - REQUIRED_PARENT   — nodes that must stay inside a specific parent type
 *  - ALLOWED_CHILDREN  — per-parent child allowlist
 *  - findNode          — deep search by id
 *  - findParentNode    — find parent of a node id
 *  - patchNodeById     — immutable patch of a node by id
 *  - insertNode        — insert a new node at a position
 */

import type { SDUINode } from '@/lib/sdui/types/node';
import { FORM_REGISTERABLE_TYPES } from '@/lib/sdui/controlled-component-registry';
import { patchThemeColors } from '@/lib/sdui/engine-static-data';

/**
 * Nodes that must always remain inside a specific parent type.
 * Exported so _canvas.tsx can use the same source of truth for drag escalation.
 */
export const REQUIRED_PARENT: Record<string, string> = {
  CheckboxIndicator:  'Checkbox',
  CheckboxLabel:      'Checkbox',
  RadioIndicator:     'Radio',
  RadioLabel:         'Radio',
  SelectInput:        'Select',
  SelectTrigger:      'Select',
  SelectItem:         'Select',
  SelectContent:      'Select',
  SelectPortal:       'Select',
  SelectBackdrop:     'Select',
  SliderThumb:        'Slider',
  SliderTrack:        'Slider',
  SliderFilledTrack:  'Slider',
  ProgressFilledTrack: 'Progress',
  TextareaInput:      'Textarea',
  SkeletonText:       'Skeleton',
  Radio:              'RadioGroup',
  TooltipContent:     'Tooltip',
  TooltipText:        'TooltipContent',
};

/**
 * Returns true when a node is a structural container that cannot be
 * dragged/reordered (e.g. a popover content wrapper).
 */
export function isNonDraggable(node: SDUINode | null | undefined): boolean {
  return !!node?._popoverContent;
}

/**
 * Nodes that may only accept a specific set of child types.
 * Exported so _canvas.tsx can pre-check before routing a drag "inside".
 */
export const ALLOWED_CHILDREN: Record<string, Set<string>> = {
  Checkbox:      new Set(['CheckboxIndicator', 'CheckboxLabel']),
  Radio:         new Set(['RadioIndicator', 'RadioLabel']),
  Select:        new Set(['SelectTrigger', 'SelectInput', 'SelectPortal', 'SelectBackdrop', 'SelectContent', 'SelectItem']),
  Slider:        new Set(['SliderTrack', 'SliderThumb', 'SliderFilledTrack']),
  Progress:      new Set(['ProgressFilledTrack']),
  Textarea:      new Set(['TextareaInput']),
  Skeleton:      new Set(['SkeletonText']),
  RadioGroup:    new Set(['Radio']),
  CheckboxGroup: new Set(['Checkbox']),
  Tooltip:       new Set(['TooltipContent', 'Box', 'Text']),
  TooltipContent: new Set(['TooltipText']),
};

/**
 * Convert a hex color string to a space-separated RGB triplet,
 * which is the format ThemeStyles uses for CSS custom properties
 * so that Tailwind's `rgb(var(--X) / alpha)` syntax works.
 * Non-hex values (font strings, 'inherit', etc.) are passed through unchanged.
 */
export function hexToRgbTriplet(value: string): string {
  if (!value.startsWith('#')) return value;
  const clean = value.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

/**
 * Managed <style> tag helpers.
 *
 * WHY style tags instead of inline styles:
 *   Inline styles on document.documentElement have the highest specificity and
 *   override EVERY CSS rule — including `.dark {}` rules. This breaks dark mode
 *   because the light-mode inline values win even when the `dark` class is active.
 *
 *   Using :root {} and .dark {} style tags instead keeps everything at the same
 *   specificity (0,1,0). The builder's style tags are appended AFTER ThemeStyles
 *   in the <head>, so they win by DOM order. And our dark override tag comes after
 *   our light override tag, so .dark {} correctly wins in dark mode. ✓
 */
export function _getManagedStyle(id: string): HTMLStyleElement {
  if (typeof document === 'undefined') return {} as HTMLStyleElement;
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    // Append to document.body (not document.head) so our overrides come AFTER
    // the ThemeStyles <style> tag which React renders at the start of <body>.
    // CSS cascade: same specificity → last declaration in document order wins.
    // ThemeStyles sets `body { --font-heading: var(--font-space-grotesk) }` and
    // we need our `body { --font-heading: 'Lora', serif }` to beat it.
    (document.body ?? document.head).appendChild(el);
  }
  return el;
}

/**
 * Injects light-mode overrides.
 *
 * Colors (hex/RGB values) go into `html:not(.dark) {}` so they are
 * invisible to dark-mode CSS — dark overrides in `.dark {}` take over
 * without any specificity fight.
 *
 * Non-color values (fonts, radius) go into `:root {}` so they apply in
 * both light AND dark mode.
 */
/**
 * Gluestack's Checkbox, Radio, Switch etc. use internal `--color-primary-*`
 * tokens set as inline styles via NativeWind vars(). We bridge them to our
 * `--primary` variable using `!important`, which (per the CSS spec) is the
 * only way to override inline-style custom properties from a stylesheet rule.
 */
export const GLUESTACK_PRIMARY_BRIDGE = [
  '  --color-primary-400: var(--primary) !important;',
  '  --color-primary-500: var(--primary) !important;',
  '  --color-primary-600: var(--primary) !important;',
  '  --color-primary-700: var(--primary) !important;',
  '  --color-primary-800: var(--primary) !important;',
].join('\n');

export function _applyLightOverrides(overrides: Record<string, string>) {
  const el = _getManagedStyle('builder-light-overrides');

  const colorLines: string[] = [];
  const fontLines: string[]  = [];
  const baseLines: string[]  = [];

  for (const [k, v] of Object.entries(overrides)) {
    if (v.startsWith('#')) {
      // hex color → convert to RGB triplet for the design-system var, scope to light mode only
      colorLines.push(`  --${k}: ${hexToRgbTriplet(v)};`);
      // Also keep --theme-${k} (hex) in sync so component defaultNodes using
      // var(--theme-foreground) etc. reflect the live theme, not the stale config/theme.json value.
      colorLines.push(`  --theme-${k}: ${v};`);
    } else if (v.startsWith('rgba(') || v.startsWith('rgb(')) {
      // RGBA/RGB color — extract triplet for Gluestack compat, store full value as --theme-X
      const m = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/);
      if (m) {
        colorLines.push(`  --${k}: ${m[1]} ${m[2]} ${m[3]};`);
        colorLines.push(`  --theme-${k}: ${v};`);
      } else {
        colorLines.push(`  --${k}: ${v};`);
        colorLines.push(`  --theme-${k}: ${v};`);
      }
    } else if (k === 'font-heading' || k === 'font-body') {
      // Font vars MUST go on body{} — ThemeStyles sets them there too, and a body{}
      // value shadows any :root{} value for all descendants. DOM order makes our
      // style tag win over ThemeStyles (we're appended later in <head>).
      fontLines.push(`  --${k}: ${v};`);
    } else {
      // radius, spacing, etc. → applies in both modes
      baseLines.push(`  --${k}: ${v};`);
    }
  }

  const parts: string[] = [];
  if (baseLines.length) parts.push(`:root {\n${baseLines.join('\n')}\n}`);
  if (fontLines.length) parts.push(`body {\n${fontLines.join('\n')}\n}`);
  // Always include the bridge so Gluestack components follow the active --primary
  parts.push(`html:not(.dark) {\n${colorLines.join('\n')}${colorLines.length ? '\n' : ''}${GLUESTACK_PRIMARY_BRIDGE}\n}`);
  el.textContent = parts.join('\n\n');
  // Notify components that subscribe to CSS variable changes (e.g. IconifyIcon).
  // We can't use a MutationObserver on :root for this because the vars are set via
  // a <style> tag's textContent, not via element.style.setProperty().
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('builder:css-vars-updated'));
  }
  // Keep THEME_OBJ.colors in sync so formula expressions like
  // theme?.['colors']?.['primary-foreground'] resolve to the live hex value.
  patchThemeColors(overrides, 'light');
}

/**
 * Injects dark-mode overrides as `html.dark { }` (specificity 0,1,1) so they
 * beat ThemeStyles's `.dark { }` (specificity 0,1,0) without relying on DOM order.
 * Also bridges Gluestack's internal primary tokens to `--primary` with !important.
 */
export function _applyDarkOverrides(overrides: Record<string, string>) {
  const el = _getManagedStyle('builder-dark-overrides');
  const vars = Object.entries(overrides)
    .map(([k, v]) => {
      const isHex = v.startsWith('#');
      const isRgb = v.startsWith('rgb(') || v.startsWith('rgba(');
      let tripletLine: string;
      let themeLine = '';
      if (isHex) {
        tripletLine = `  --${k}: ${hexToRgbTriplet(v)};`;
        themeLine = `\n  --theme-${k}: ${v};`;
      } else if (isRgb) {
        // Extract triplet for Gluestack compat, store full value as --theme-X
        const m = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/);
        if (m) {
          tripletLine = `  --${k}: ${m[1]} ${m[2]} ${m[3]};`;
          themeLine = `\n  --theme-${k}: ${v};`;
        } else {
          tripletLine = `  --${k}: ${v};`;
          themeLine = `\n  --theme-${k}: ${v};`;
        }
      } else {
        tripletLine = `  --${k}: ${v};`;
      }
      return tripletLine + themeLine;
    })
    .join('\n');
  el.textContent = `html.dark {\n${vars ? vars + '\n' : ''}${GLUESTACK_PRIMARY_BRIDGE}\n}`;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('builder:css-vars-updated'));
  }
  patchThemeColors(overrides, 'dark');
}

/**
 * Inject Google Font <link> tags for any font-heading / font-body values in the
 * given overrides map. Called after applying theme overrides from saved config so
 * the browser loads the font even before the user opens the Theme panel.
 */
export function injectFontsFromOverrides(overrides: Record<string, string>): void {
  if (typeof document === 'undefined') return;
  const FONT_GOOGLE_URLS: Record<string, string> = {
    "'Inter', sans-serif":              'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    "'DM Sans', sans-serif":            'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap',
    "'Space Grotesk', sans-serif":      'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap',
    "'Nunito', sans-serif":             'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap',
    "'Poppins', sans-serif":            'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap',
    "'Montserrat', sans-serif":         'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap',
    "'Raleway', sans-serif":            'https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700&display=swap',
    "'Josefin Sans', sans-serif":       'https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@400;500;600;700&display=swap',
    "'Jost', sans-serif":               'https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700&display=swap',
    "'Open Sans', sans-serif":          'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap',
    "'Roboto', sans-serif":             'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
    "'Comfortaa', cursive":             'https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;600;700&display=swap',
    "'Playfair Display', serif":        'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap',
    "'Lora', serif":                    'https://fonts.googleapis.com/css2?family=Lora:wght@400;600;700&display=swap',
    "'Merriweather', serif":            'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&display=swap',
    "'Fraunces', serif":                'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&display=swap',
    "'Cormorant Garamond', serif":      'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&display=swap',
    "'Crimson Text', serif":            'https://fonts.googleapis.com/css2?family=Crimson+Text:wght@400;600;700&display=swap',
    "'Source Sans 3', sans-serif":      'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap',
    "'Roboto Mono', monospace":         'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500&display=swap',
  };

  const fontVars = ['font-heading', 'font-body'];
  for (const varName of fontVars) {
    const val = overrides[varName];
    if (!val) continue;
    const url = FONT_GOOGLE_URLS[val];
    if (url && !document.querySelector(`link[href="${url}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      document.head.appendChild(link);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function clone<T>(v: T): T {
  return structuredClone(v);
}

/**
 * Returns all traversable child arrays for a node.
 * Used by tree walkers to search/patch/remove across all sub-trees.
 */
export function getNodeSubtrees(node: SDUINode): SDUINode[][] {
  const subs: SDUINode[][] = [];
  if (node.children?.length) subs.push(node.children as SDUINode[]);
  return subs;
}

export function findNode(nodes: SDUINode[], targetId: string): SDUINode | null {
  for (const node of nodes) {
    if (node.id === targetId) return node;
    for (const sub of getNodeSubtrees(node)) {
      const found = findNode(sub, targetId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Returns the parent node of `targetId`, or null if it is a root node.
 * Returns undefined if `targetId` is not found anywhere.
 */
export function findParentNode(
  nodes: SDUINode[],
  targetId: string,
  _parent: SDUINode | null = null
): SDUINode | null | undefined {
  for (const node of nodes) {
    if (node.id === targetId) return _parent;
    for (const sub of getNodeSubtrees(node)) {
      const result = findParentNode(sub, targetId, node);
      if (result !== undefined) return result;
    }
  }
  return undefined;
}

export function patchNodeById(
  nodes: SDUINode[],
  targetId: string,
  patcher: (n: SDUINode) => SDUINode
): SDUINode[] {
  let changed = false;
  const result = nodes.map(node => {
    if (node.id === targetId) {
      const patched = patcher(node);
      if (patched !== node) changed = true;
      return patched;
    }
    if (node.children?.length) {
      const newChildren = patchNodeById(node.children as SDUINode[], targetId, patcher);
      if (newChildren !== node.children) {
        changed = true;
        return { ...node, children: newChildren };
      }
    }
    return node;
  });
  return changed ? result : nodes;
}

export function removeNodesByIds(nodes: SDUINode[], ids: Set<string>): SDUINode[] {
  const filtered = nodes.filter(n => !ids.has(n.id ?? ''));
  const recurse = (n: SDUINode): SDUINode => {
    let patched = n;
    if (n.children?.length) {
      const newC = removeNodesByIds(n.children as SDUINode[], ids);
      if (newC !== n.children) patched = { ...patched, children: newC };
    }
    return patched;
  };
  if (filtered.length === nodes.length) {
    let changed = false;
    const mapped = filtered.map(n => {
      const p = recurse(n);
      if (p !== n) changed = true;
      return p;
    });
    return changed ? mapped : nodes;
  }
  return filtered.map(recurse);
}

/**
 * Slugify a string for use as a field name (lowercase, replace spaces/special with camelCase).
 */
export function slugifyFieldName(s: string): string {
  const trimmed = String(s || '').trim();
  if (!trimmed) return '';
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

export const FORM_CONTROLLED_TYPES = FORM_REGISTERABLE_TYPES;
export const FORM_CONTAINER_TYPE = 'FormContainer';

/**
 * Check if node `targetId` has any ancestor with type FormContainer.
 */
export function hasFormContainerAncestor(nodes: SDUINode[], targetId: string, _path: SDUINode[] = []): boolean {
  for (const node of nodes) {
    const pathHere = [..._path, node];
    if (node.id === targetId) {
      return _path.some((a) => (a.type as string) === FORM_CONTAINER_TYPE);
    }
    for (const sub of getNodeSubtrees(node)) {
      if (hasFormContainerAncestor(sub, targetId, pathHere)) return true;
    }
  }
  return false;
}

/** Insert `newNode` as a child of `parentId`, or at root level if parentId is null */
export function insertNode(
  nodes: SDUINode[],
  newNode: SDUINode,
  parentId: string | null,
  atIdx?: number
): SDUINode[] {
  if (!parentId) {
    const copy = [...nodes];
    const idx = atIdx !== undefined ? atIdx : copy.length;
    copy.splice(idx, 0, newNode);
    return copy;
  }
  return patchNodeById(nodes, parentId, parent => {
    const children = [...((parent.children ?? []) as SDUINode[])];
    const idx = atIdx !== undefined ? atIdx : children.length;
    children.splice(idx, 0, newNode);
    return { ...parent, children };
  });
}

/**
 * Walk up from `nodeId` through the parent chain looking for the nearest
 * ancestor (or self) that is a *linked instance root* — i.e. carries either
 * `_shared` (shared component) or `_system` (system component) metadata.
 *
 * Pass `kind` to restrict the search:
 *   - 'shared' — only `_shared` roots (legacy SC behaviour, still the default)
 *   - 'system' — only `_system` roots
 *   - 'any'    — whichever is encountered first walking upward
 */
export function findLinkedRoot(
  nodes: SDUINode[],
  nodeId: string,
  kind: 'shared' | 'system' | 'any' = 'shared',
): SDUINode | null {
  let current: string | undefined = nodeId;
  while (current) {
    const node = findNode(nodes, current);
    if (node) {
      const rec = node as unknown as Record<string, unknown>;
      const hasShared = !!rec._shared;
      const hasSystem = !!rec._system;
      if (kind === 'shared' && hasShared) return node;
      if (kind === 'system' && hasSystem) return node;
      if (kind === 'any' && (hasShared || hasSystem)) return node;
    }
    const parent = findParentNode(nodes, current);
    if (parent === null || parent === undefined) break;
    current = parent.id;
  }
  return null;
}

/**
 * Backwards-compatible alias — previously only matched `_shared`. Callers that
 * need to also recognise system-component roots should use `findLinkedRoot`
 * with `kind: 'system'` or `kind: 'any'`.
 */
export function findSharedRoot(nodes: SDUINode[], nodeId: string): SDUINode | null {
  return findLinkedRoot(nodes, nodeId, 'shared');
}

/** Deep-clone a node tree, assigning fresh UUIDs to every node. */
export function cloneWithFreshIds(node: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...node, id: crypto.randomUUID() };
  const children = (result.children ?? []) as Record<string, unknown>[];
  if (children.length > 0) {
    result.children = children.map(c => cloneWithFreshIds(JSON.parse(JSON.stringify(c)) as Record<string, unknown>));
  }
  return result;
}

/**
 * Deep-clone a node tree, assigning fresh UUIDs to `id` but PRESERVING
 * `_sharedKey` on every node. Used when spawning a new SC instance so the
 * instance nodes share identity with the model by sharedKey (not by id).
 *
 * Also strips instance-only metadata fields on descendants (`_overrides`,
 * `_descendantOverrides`, `_removedKeys`, `_localInsertions`, `_shared`
 * markers on nested roots are preserved since nested SCs must keep their
 * own `_shared`).
 */
export function cloneWithFreshIdsKeepSharedKey(
  node: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...node, id: crypto.randomUUID() };
  const children = (result.children ?? []) as Record<string, unknown>[];
  if (children.length > 0) {
    result.children = children.map(c =>
      cloneWithFreshIdsKeepSharedKey(JSON.parse(JSON.stringify(c)) as Record<string, unknown>)
    );
  }
  return result;
}

/**
 * Walk a tree and ensure every node has a stable `_sharedKey`. Fresh UUIDs
 * are minted for any node missing one; existing keys are preserved. This is
 * the migration/self-heal entry point called when an SC is created or when
 * legacy content is first encountered.
 */
export function stampSharedKeys(node: Record<string, unknown>): Record<string, unknown> {
  if (typeof node._sharedKey !== 'string' || !node._sharedKey) {
    node._sharedKey = crypto.randomUUID();
  }
  const children = (node.children ?? []) as Record<string, unknown>[];
  for (const c of children) stampSharedKeys(c);
  return node;
}

