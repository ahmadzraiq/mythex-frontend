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

/**
 * Nodes that must always remain inside a specific parent type.
 * Exported so _canvas.tsx can use the same source of truth for drag escalation.
 */
export const REQUIRED_PARENT: Record<string, string> = {
  ButtonText:         'Button',
  ButtonIcon:         'Button',
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
  Button:        new Set(['ButtonText', 'ButtonIcon', 'NavIcon']),
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
    document.head.appendChild(el);
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
  const baseLines: string[]  = [];

  for (const [k, v] of Object.entries(overrides)) {
    if (v.startsWith('#')) {
      // hex color → convert to RGB triplet, scope to light mode only
      colorLines.push(`  --${k}: ${hexToRgbTriplet(v)};`);
    } else {
      // font family string, rem value, etc. → applies in both modes
      baseLines.push(`  --${k}: ${v};`);
    }
  }

  const parts: string[] = [];
  if (baseLines.length) parts.push(`:root {\n${baseLines.join('\n')}\n}`);
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

export const FORM_CONTROLLED_TYPES = new Set(['InputField', 'TextareaInput', 'Checkbox']);
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

/**
 * Recursively walk subtree and add setFormField to InputField/TextareaInput/Checkbox
 * that don't have it. Returns patched node and next field counter.
 */
export function injectSetFormFieldRecursive(
  n: SDUINode,
  fieldCounter: { value: number }
): SDUINode {
  if (!FORM_CONTROLLED_TYPES.has(n.type as string)) {
    return {
      ...n,
      children: n.children?.map((c) => injectSetFormFieldRecursive(c as SDUINode, fieldCounter)),
    };
  }
  const actions = (n.actions ?? {}) as Record<string, unknown>;
  const actionSlot = n.type === 'Checkbox' ? 'valueChange' : 'change';
  const existing = actions[actionSlot];
  const hasSetFormField = (a: unknown): boolean =>
    a && typeof a === 'object' && (a as Record<string, unknown>).type === 'setFormField';
  if (Array.isArray(existing) ? existing.some(hasSetFormField) : hasSetFormField(existing)) {
    return { ...n, children: n.children?.map((c) => injectSetFormFieldRecursive(c as SDUINode, fieldCounter)) };
  }
  const props = (n.props ?? {}) as Record<string, unknown>;
  const fieldName =
    (typeof props.name === 'string' && props.name ? slugifyFieldName(props.name) : null) ||
    (typeof props.placeholder === 'string' && props.placeholder ? slugifyFieldName(props.placeholder) : null) ||
    `field${++fieldCounter.value}`;
  const newAction = { type: 'setFormField', field: fieldName, value: '$event' };
  const newActions = { ...actions, [actionSlot]: newAction };
  return {
    ...n,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actions: newActions as any,
    children: n.children?.map((c) => injectSetFormFieldRecursive(c as SDUINode, fieldCounter)),
  };
}

/**
 * If targetId is inside a FormContainer, patch its subtree to add setFormField to form inputs.
 */
export function autoInjectSetFormFieldIfInForm(nodes: SDUINode[], targetId: string): SDUINode[] {
  const hasForm = hasFormContainerAncestor(nodes, targetId);
  if (!hasForm) return nodes;
  return patchNodeById(nodes, targetId, (n) => injectSetFormFieldRecursive(n, { value: 0 }));
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

