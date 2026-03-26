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

/**
 * Nodes that must always remain inside a specific parent type.
 * Exported so _canvas.tsx can use the same source of truth for drag escalation.
 */
export const REQUIRED_PARENT: Record<string, string> = {
  ButtonText:         'Button',
  InputField:         'Input',
  InputSlot:          'Input',
  InputIcon:          'Input',
  CheckboxIndicator:  'Checkbox',
  CheckboxIcon:       'Checkbox',
  CheckboxLabel:      'Checkbox',
  RadioIndicator:     'Radio',
  RadioLabel:         'Radio',
  RadioIcon:          'Radio',
  SelectInput:        'Select',
  SelectIcon:         'Select',
  SelectTrigger:      'Select',
  SelectItem:         'Select',
  SelectContent:      'Select',
  SelectPortal:       'Select',
  SelectBackdrop:     'Select',
  AccordionItem:      'Accordion',
  AccordionTrigger:   'Accordion',
  AccordionContent:   'Accordion',
  AccordionHeader:    'Accordion',
  SliderThumb:        'Slider',
  SliderTrack:        'Slider',
  SliderFilledTrack:  'Slider',
  BadgeText:          'Badge',
  BadgeIcon:          'Badge',
  FabLabel:           'Fab',
  AvatarImage:        'Avatar',
  AvatarFallbackText: 'Avatar',
  ProgressFilledTrack: 'Progress',
  TextareaInput:      'Textarea',
  SkeletonText:       'Skeleton',
  AlertText:          'Alert',
  LinkText:           'Link',
  Radio:              'RadioGroup',
  ModalBackdrop:      'Modal',
  ModalContent:       'Modal',
  ModalHeader:        'ModalContent',
  ModalBody:          'ModalContent',
  ModalFooter:        'ModalContent',
  ModalCloseButton:   'ModalContent',
  TooltipContent:     'Tooltip',
  TooltipText:        'TooltipContent',
  AlertDialogBackdrop:    'AlertDialog',
  AlertDialogContent:     'AlertDialog',
  AlertDialogHeader:      'AlertDialogContent',
  AlertDialogBody:        'AlertDialogContent',
  AlertDialogFooter:      'AlertDialogContent',
  AlertDialogCloseButton: 'AlertDialogContent',
};

/**
 * Nodes that may only accept a specific set of child types.
 * Exported so _canvas.tsx can pre-check before routing a drag "inside".
 */
export const ALLOWED_CHILDREN: Record<string, Set<string>> = {
  Button:        new Set(['ButtonText', 'NavIcon']),
  Input:         new Set(['InputField', 'InputSlot', 'InputIcon']),
  Checkbox:      new Set(['CheckboxIndicator', 'CheckboxIcon', 'CheckboxLabel']),
  Radio:         new Set(['RadioIndicator', 'RadioLabel', 'RadioIcon']),
  Select:        new Set(['SelectTrigger', 'SelectInput', 'SelectIcon', 'SelectPortal', 'SelectBackdrop', 'SelectContent', 'SelectItem']),
  Accordion:     new Set(['AccordionItem', 'AccordionTrigger', 'AccordionContent', 'AccordionHeader']),
  Slider:        new Set(['SliderTrack', 'SliderThumb', 'SliderFilledTrack']),
  Badge:         new Set(['BadgeText', 'BadgeIcon']),
  Fab:           new Set(['FabLabel', 'FabIcon', 'NavIcon', 'Text']),
  Avatar:        new Set(['AvatarImage', 'AvatarFallbackText']),
  Progress:      new Set(['ProgressFilledTrack']),
  Textarea:      new Set(['TextareaInput']),
  Skeleton:      new Set(['SkeletonText']),
  Alert:         new Set(['AlertIcon', 'AlertText', 'NavIcon']),
  Link:          new Set(['LinkText']),
  RadioGroup:    new Set(['Radio']),
  CheckboxGroup: new Set(['Checkbox']),
  Modal:         new Set(['ModalBackdrop', 'ModalContent']),
  ModalContent:  new Set(['ModalHeader', 'ModalBody', 'ModalFooter', 'ModalCloseButton']),
  Tooltip:       new Set(['TooltipContent', 'Pressable', 'Box', 'Text']),
  TooltipContent: new Set(['TooltipText']),
  AlertDialog:        new Set(['AlertDialogBackdrop', 'AlertDialogContent']),
  AlertDialogContent: new Set(['AlertDialogHeader', 'AlertDialogBody', 'AlertDialogFooter', 'AlertDialogCloseButton']),
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
      // hex color → convert to RGB triplet, scope to light mode only
      colorLines.push(`  --${k}: ${hexToRgbTriplet(v)};`);
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
}

/**
 * Injects dark-mode overrides as `html.dark { }` (specificity 0,1,1) so they
 * beat ThemeStyles's `.dark { }` (specificity 0,1,0) without relying on DOM order.
 * Also bridges Gluestack's internal primary tokens to `--primary` with !important.
 */
export function _applyDarkOverrides(overrides: Record<string, string>) {
  const el = _getManagedStyle('builder-dark-overrides');
  const vars = Object.entries(overrides)
    .map(([k, v]) => `  --${k}: ${hexToRgbTriplet(v)};`)
    .join('\n');
  el.textContent = `html.dark {\n${vars ? vars + '\n' : ''}${GLUESTACK_PRIMARY_BRIDGE}\n}`;
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

export function findNode(nodes: SDUINode[], targetId: string): SDUINode | null {
  for (const node of nodes) {
    if (node.id === targetId) return node;
    if (node.children?.length) {
      const found = findNode(node.children as SDUINode[], targetId);
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
    if (node.children?.length) {
      const result = findParentNode(node.children as SDUINode[], targetId, node);
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
  return nodes.map(node => {
    if (node.id === targetId) return patcher(node);
    if (node.children?.length) {
      return { ...node, children: patchNodeById(node.children as SDUINode[], targetId, patcher) };
    }
    return node;
  });
}

export function removeNodesByIds(nodes: SDUINode[], ids: Set<string>): SDUINode[] {
  return nodes
    .filter(n => !ids.has(n.id ?? ''))
    .map(n => ({
      ...n,
      children: n.children?.length
        ? removeNodesByIds(n.children as SDUINode[], ids)
        : n.children,
    }));
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
    if (node.children?.length) {
      const found = hasFormContainerAncestor(node.children as SDUINode[], targetId, pathHere);
      if (found) return true;
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
    const copy = clone(nodes);
    const idx = atIdx !== undefined ? atIdx : copy.length;
    copy.splice(idx, 0, newNode);
    return copy;
  }
  return patchNodeById(nodes, parentId, parent => {
    const children = clone((parent.children ?? []) as SDUINode[]);
    const idx = atIdx !== undefined ? atIdx : children.length;
    children.splice(idx, 0, newNode);
    return { ...parent, children };
  });
}

