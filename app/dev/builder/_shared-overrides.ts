'use client';

/**
 * Shared Component Overrides — per-instance override tracking.
 *
 * When a node is a shared-component instance (has `_shared`), the user can
 * locally override specific CSS-level fields (e.g. `minWidth`, `paddingTop`)
 * without affecting the shared model or other instances. Overridden fields are
 * recorded on the instance root as `_overrides: string[]` — an array of cssProp
 * keys using the same vocabulary the design panel's `isFieldChanged` uses.
 *
 * When the model is edited and propagated to instances, fields whose cssProp is
 * listed in an instance's `_overrides` are preserved on that instance; all
 * other fields are replaced with the model's new value.
 *
 * Gray / green / orange label logic lives in `_panel-primitives.tsx`
 * (`ChangedLabel`) and `_panel-right.tsx` (`isFieldChanged` /
 * `isInheritedFromShared`). This file only owns the node-level helpers.
 */

import type { SDUINode } from '@/lib/sdui/types/node';
import { parseTwToken, expandPadding, expandMargin, removeTwToken } from './_tw-utils';

// ─── Field taxonomy ──────────────────────────────────────────────────────────

/**
 * Every cssProp we recognise for override tracking. These are the keys the
 * design-panel rows use (SECTION_CSS_PROPS, isFieldChanged, resetField).
 * Kept manually in sync with _panel-right.tsx `PROP_DEFAULTS`.
 */
export const OVERRIDEABLE_CSS_PROPS = [
  // Layout
  'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignSelf',
  // Typography
  'fontWeight', 'textAlign', 'textDecoration', 'textTransform',
  'fontSize', 'color', 'lineHeight', 'letterSpacing',
  // Interaction / Display
  'overflow', 'overflowX', 'overflowY', 'cursor',
  // Dimensions
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'flex',
  // Position
  'position', 'top', 'right', 'bottom', 'left', 'zIndex',
  // Spacing
  'gap', 'columnGap', 'rowGap',
  'gridTemplateColumns', 'gridTemplateRows', 'gridAutoFlow',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  // Fill / gradient
  'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
  'opacity',
  // Border
  'borderWidth', 'borderColor', 'borderStyle',
  'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
  'borderBottomRightRadius', 'borderBottomLeftRadius',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  // Transform
  'translateX', 'translateY', 'transform',
  // Effects
  'boxShadow', 'filterBlur',
] as const;

export type CssProp = typeof OVERRIDEABLE_CSS_PROPS[number];
const CSS_PROP_SET = new Set<string>(OVERRIDEABLE_CSS_PROPS);

/**
 * Non-CSS keys that can be overridden per-descendant inside an SC instance.
 * These live outside of className/style — they are top-level node fields.
 * Used by Phase 4 descendant override tracking.
 */
export const OVERRIDEABLE_NONCSS_KEYS = [
  'text', 'actions', 'animation', 'condition', 'map',
] as const;
export type NonCssProp = typeof OVERRIDEABLE_NONCSS_KEYS[number];
const NONCSS_PROP_SET = new Set<string>(OVERRIDEABLE_NONCSS_KEYS);

/** Returns true if `p` is any recognised override key (CSS or non-CSS). */
export function isOverrideableKey(p: string): boolean {
  return CSS_PROP_SET.has(p) || NONCSS_PROP_SET.has(p);
}

/** cssProp → Tailwind class prefix (same mapping used by `_panel-right.tsx` TW_PROP_PREFIXES). */
const TW_PREFIX: Record<string, string> = {
  flexDirection: 'flex-', flexWrap: 'flex-',
  justifyContent: 'justify-', alignItems: 'items-', alignSelf: 'self-',
  fontWeight: 'font-', textAlign: 'text-', textDecoration: '', textTransform: '',
  overflow: 'overflow-', overflowX: 'overflow-x-', overflowY: 'overflow-y-',
  cursor: 'cursor-',
  gap: 'gap-', columnGap: 'gap-x-', rowGap: 'gap-y-',
  gridTemplateColumns: 'grid-cols-', gridTemplateRows: 'grid-rows-',
  gridAutoFlow: 'grid-flow-',
  width: 'w-', height: 'h-',
  minWidth: 'min-w-', maxWidth: 'max-w-', minHeight: 'min-h-', maxHeight: 'max-h-',
  flex: 'flex-',
  top: 'top-', right: 'right-', bottom: 'bottom-', left: 'left-', zIndex: 'z-',
  borderRadius: 'rounded',
  borderTopLeftRadius: 'rounded-tl-', borderTopRightRadius: 'rounded-tr-',
  borderBottomRightRadius: 'rounded-br-', borderBottomLeftRadius: 'rounded-bl-',
  borderWidth: 'border-', borderStyle: 'border-',
  borderTopWidth: 'border-t-', borderRightWidth: 'border-r-',
  borderBottomWidth: 'border-b-', borderLeftWidth: 'border-l-',
  fontSize: 'text-', lineHeight: 'leading-', letterSpacing: 'tracking-',
  backgroundColor: 'bg-', opacity: 'opacity-',
};

/** Tokens that indicate the `position` CSS property. */
const POSITION_TOKENS_SET = new Set(['static', 'relative', 'absolute', 'fixed', 'sticky']);
/** Tokens that are border-style keywords (must be distinguished from border-width / border-color). */
const BORDER_STYLE_TOKENS_SET = new Set(['border-solid', 'border-dashed', 'border-dotted', 'border-double', 'border-none']);

// ─── Node-level _overrides metadata ──────────────────────────────────────────

export function getOverrides(node: SDUINode | Record<string, unknown> | null | undefined): string[] {
  if (!node) return [];
  const arr = (node as Record<string, unknown>)._overrides;
  return Array.isArray(arr) ? (arr as string[]) : [];
}

export function withOverrides<T extends SDUINode | Record<string, unknown>>(node: T, overrides: string[]): T {
  return { ...(node as object), _overrides: Array.from(new Set(overrides)) } as unknown as T;
}

export function addOverrides<T extends SDUINode | Record<string, unknown>>(node: T, props: string[]): T {
  if (props.length === 0) return node;
  const cur = getOverrides(node);
  const next = Array.from(new Set([...cur, ...props]));
  return withOverrides(node, next);
}

export function removeOverrides<T extends SDUINode | Record<string, unknown>>(node: T, props: string[]): T {
  if (props.length === 0) return node;
  const drop = new Set(props);
  const next = getOverrides(node).filter(p => !drop.has(p));
  return withOverrides(node, next);
}

// ─── Reading a cssProp value off a node ──────────────────────────────────────

type NodePropsLike = {
  props?: { className?: string; style?: Record<string, unknown> } & Record<string, unknown>;
  animation?: Record<string, unknown>;
};

function readClassName(n: NodePropsLike): string {
  return (n.props?.className as string | undefined) ?? '';
}
function readStyle(n: NodePropsLike): Record<string, unknown> {
  return (n.props?.style as Record<string, unknown> | undefined) ?? {};
}
function readAnim(n: NodePropsLike): Record<string, unknown> {
  return (n.animation as Record<string, unknown> | undefined) ?? {};
}

/**
 * Produce a comparable serialised value for a cssProp on a node.
 * Two nodes with the same serialised value for a cssProp are considered equal
 * for that field. Returns `''` when the field is unset.
 */
export function readPropValue(node: SDUINode | Record<string, unknown> | null | undefined, cssProp: string): string {
  if (!node) return '';
  const n = node as NodePropsLike;
  const cls = readClassName(n);
  const style = readStyle(n);

  // Inline-style win over className token when present.
  const styleVal = style[cssProp];
  if (styleVal !== undefined && styleVal !== null && styleVal !== '') return `s:${JSON.stringify(styleVal)}`;

  // Special cases ─────────────────────────────────────────────────────────────
  switch (cssProp) {
    case 'position': {
      const tok = cls.split(/\s+/).find(t => POSITION_TOKENS_SET.has(t));
      return tok ? `c:${tok}` : '';
    }
    case 'paddingTop':    return `exp:${expandPadding(cls).top}`;
    case 'paddingRight':  return `exp:${expandPadding(cls).right}`;
    case 'paddingBottom': return `exp:${expandPadding(cls).bottom}`;
    case 'paddingLeft':   return `exp:${expandPadding(cls).left}`;
    case 'marginTop':     return `exp:${expandMargin(cls).top}`;
    case 'marginRight':   return `exp:${expandMargin(cls).right}`;
    case 'marginBottom':  return `exp:${expandMargin(cls).bottom}`;
    case 'marginLeft':    return `exp:${expandMargin(cls).left}`;
    case 'borderStyle': {
      const tok = cls.split(/\s+/).find(t => BORDER_STYLE_TOKENS_SET.has(t));
      return tok ? `c:${tok}` : '';
    }
    case 'borderWidth': {
      const widthTok = cls.split(/\s+/).find(t => t === 'border' || /^border-(0|2|4|8|\[\d)/.test(t));
      return widthTok ? `c:${widthTok}` : '';
    }
    case 'borderColor': {
      const tok = cls.split(/\s+/).find(t => /^border-\[/.test(t) && !/^border-\[\d/.test(t));
      return tok ? `c:${tok}` : '';
    }
    case 'backgroundImage': {
      const anim = readAnim(n);
      const outer = (anim.outerStyle ?? {}) as Record<string, unknown>;
      const bg = outer.backgroundImage;
      if (typeof bg === 'string' && bg) return `anim:${bg}`;
      if (typeof bg === 'object' && bg !== null) return `anim:${JSON.stringify(bg)}`;
      return '';
    }
    case 'filterBlur': {
      const anim = readAnim(n);
      const filter = (anim.filter ?? {}) as Record<string, unknown>;
      const blur = filter.blur;
      return blur !== undefined ? `anim:${String(blur)}` : '';
    }
    case 'boxShadow': {
      const v = style.boxShadow;
      return v !== undefined && v !== null && v !== '' ? `s:${JSON.stringify(v)}` : '';
    }
    case 'translateX': {
      const v = style.translateX;
      return v !== undefined && v !== null && v !== '' ? `s:${JSON.stringify(v)}` : '';
    }
    case 'translateY': {
      const v = style.translateY;
      return v !== undefined && v !== null && v !== '' ? `s:${JSON.stringify(v)}` : '';
    }
    case 'transform': {
      const v = style.transform;
      return v !== undefined && v !== null && v !== '' ? `s:${JSON.stringify(v)}` : '';
    }
  }

  // Generic className-prefix match
  const prefix = TW_PREFIX[cssProp];
  if (prefix !== undefined && prefix !== '') {
    const tok = parseTwToken(cls, prefix);
    return tok ? `c:${tok}` : '';
  }
  return '';
}

/** Returns cssProps for which `prev` and `next` differ. */
export function diffCssProps(
  prev: SDUINode | Record<string, unknown> | null | undefined,
  next: SDUINode | Record<string, unknown> | null | undefined,
): string[] {
  const out: string[] = [];
  for (const p of OVERRIDEABLE_CSS_PROPS) {
    if (readPropValue(prev, p) !== readPropValue(next, p)) out.push(p);
  }
  return out;
}

/**
 * Serialise a non-CSS override key's current value on a node so two nodes can
 * be compared for equality. Returns `''` when unset.
 */
export function readNonCssValue(
  node: SDUINode | Record<string, unknown> | null | undefined,
  key: string,
): string {
  if (!node) return '';
  const v = (node as Record<string, unknown>)[key];
  if (v === undefined || v === null || v === '') return '';
  return `v:${JSON.stringify(v)}`;
}

/** Returns non-CSS keys for which `prev` and `next` differ. */
export function diffNonCssProps(
  prev: SDUINode | Record<string, unknown> | null | undefined,
  next: SDUINode | Record<string, unknown> | null | undefined,
): string[] {
  const out: string[] = [];
  for (const k of OVERRIDEABLE_NONCSS_KEYS) {
    if (readNonCssValue(prev, k) !== readNonCssValue(next, k)) out.push(k);
  }
  return out;
}

/** Returns ALL overrideable props (CSS + non-CSS) for which `prev` and `next` differ. */
export function diffAllOverrideableProps(
  prev: SDUINode | Record<string, unknown> | null | undefined,
  next: SDUINode | Record<string, unknown> | null | undefined,
): string[] {
  return [...diffCssProps(prev, next), ...diffNonCssProps(prev, next)];
}

/**
 * Copy a non-CSS override key's value from `source` to `target` (mutating
 * `target`). If source has no value, the target key is deleted.
 */
export function copyNonCssProp(
  source: SDUINode | Record<string, unknown> | null | undefined,
  target: Record<string, unknown>,
  key: string,
): void {
  if (!source) return;
  const v = (source as Record<string, unknown>)[key];
  if (v === undefined) {
    delete target[key];
  } else {
    target[key] = v;
  }
}

// ─── Writing / copying cssProps between nodes ────────────────────────────────

type MutableNode = {
  props?: { className?: string; style?: Record<string, unknown> } & Record<string, unknown>;
  animation?: Record<string, unknown>;
} & Record<string, unknown>;

function cloneShallow<T>(v: T): T {
  return v == null ? v : (Array.isArray(v) ? [...v] : (typeof v === 'object' ? { ...(v as object) } : v)) as T;
}

function ensureProps(n: MutableNode) {
  if (!n.props) n.props = {};
  else n.props = cloneShallow(n.props)!;
  return n.props!;
}
function ensureStyle(n: MutableNode) {
  const p = ensureProps(n);
  const s = (p.style as Record<string, unknown> | undefined) ?? {};
  p.style = { ...s };
  return p.style as Record<string, unknown>;
}
function ensureAnim(n: MutableNode) {
  n.animation = { ...(n.animation ?? {}) };
  return n.animation;
}
function ensureOuter(n: MutableNode) {
  const a = ensureAnim(n);
  a.outerStyle = { ...((a.outerStyle as Record<string, unknown> | undefined) ?? {}) };
  return a.outerStyle as Record<string, unknown>;
}
function ensureFilter(n: MutableNode) {
  const a = ensureAnim(n);
  a.filter = { ...((a.filter as Record<string, unknown> | undefined) ?? {}) };
  return a.filter as Record<string, unknown>;
}

/**
 * Copy the value of `cssProp` from `source` to `target` (mutating `target`).
 * This handles className-token transplant, inline-style transplant, and
 * animation.* transplant depending on where the cssProp is stored.
 *
 * After this call, `readPropValue(target, cssProp) === readPropValue(source, cssProp)`.
 */
export function copyCssProp(source: SDUINode | Record<string, unknown> | null | undefined, target: MutableNode, cssProp: string): void {
  if (!source) return;
  const src = source as NodePropsLike;
  const srcCls = readClassName(src);
  const srcStyle = readStyle(src);

  // ── 1) Clear the target's current value for this cssProp ───────────────────
  {
    const tgtProps = ensureProps(target);
    // Remove matching className tokens
    const curCls = (tgtProps.className as string | undefined) ?? '';
    let nextCls = curCls;
    const prefix = TW_PREFIX[cssProp];

    switch (cssProp) {
      case 'position':
        nextCls = nextCls.split(/\s+/).filter(t => !POSITION_TOKENS_SET.has(t)).join(' ');
        break;
      case 'borderStyle':
        nextCls = nextCls.split(/\s+/).filter(t => !BORDER_STYLE_TOKENS_SET.has(t)).join(' ');
        break;
      case 'borderWidth':
        nextCls = nextCls.split(/\s+/).filter(t => !(t === 'border' || /^border-(0|2|4|8|\[\d)/.test(t))).join(' ');
        break;
      case 'borderColor':
        nextCls = nextCls.split(/\s+/).filter(t => !(/^border-\[/.test(t) && !/^border-\[\d/.test(t))).join(' ');
        break;
      case 'paddingTop': case 'paddingRight': case 'paddingBottom': case 'paddingLeft':
      case 'marginTop':  case 'marginRight':  case 'marginBottom':  case 'marginLeft':
        // Leave compound padding/margin tokens in place — spacing gets fully restored from source below.
        break;
      default:
        if (prefix) nextCls = removeTwToken(nextCls, prefix);
    }
    if (nextCls !== curCls) {
      tgtProps.className = nextCls.replace(/\s+/g, ' ').trim();
    }

    // Remove matching inline-style key
    if (cssProp in (tgtProps.style as Record<string, unknown> | undefined ?? {})) {
      const ns = { ...(tgtProps.style as Record<string, unknown>) };
      delete ns[cssProp];
      tgtProps.style = ns;
    }
    // Remove animation-backed values
    if (cssProp === 'backgroundImage') {
      const anim = (target.animation ?? {}) as Record<string, unknown>;
      const outer = (anim.outerStyle ?? {}) as Record<string, unknown>;
      if ('backgroundImage' in outer) {
        const { backgroundImage: _drop, ...rest } = outer;
        void _drop;
        const a = ensureAnim(target);
        a.outerStyle = rest;
      }
    }
    if (cssProp === 'filterBlur') {
      const anim = (target.animation ?? {}) as Record<string, unknown>;
      const filter = (anim.filter ?? {}) as Record<string, unknown>;
      if ('blur' in filter) {
        const { blur: _drop, ...rest } = filter;
        void _drop;
        const a = ensureAnim(target);
        a.filter = rest;
      }
    }
  }

  // ── 2) Copy the source's value back in ─────────────────────────────────────
  const copyFromStyle = () => {
    if (cssProp in srcStyle) {
      const ns = ensureStyle(target);
      (ns as Record<string, unknown>)[cssProp] = srcStyle[cssProp];
    }
  };

  switch (cssProp) {
    case 'position': {
      const tok = srcCls.split(/\s+/).find(t => POSITION_TOKENS_SET.has(t));
      if (tok) {
        const p = ensureProps(target);
        p.className = `${(p.className as string | undefined) ?? ''} ${tok}`.replace(/\s+/g, ' ').trim();
      }
      copyFromStyle();
      return;
    }
    case 'borderStyle': {
      const tok = srcCls.split(/\s+/).find(t => BORDER_STYLE_TOKENS_SET.has(t));
      if (tok) {
        const p = ensureProps(target);
        p.className = `${(p.className as string | undefined) ?? ''} ${tok}`.replace(/\s+/g, ' ').trim();
      }
      copyFromStyle();
      return;
    }
    case 'borderWidth': {
      const tok = srcCls.split(/\s+/).find(t => t === 'border' || /^border-(0|2|4|8|\[\d)/.test(t));
      if (tok) {
        const p = ensureProps(target);
        p.className = `${(p.className as string | undefined) ?? ''} ${tok}`.replace(/\s+/g, ' ').trim();
      }
      copyFromStyle();
      return;
    }
    case 'borderColor': {
      const tok = srcCls.split(/\s+/).find(t => /^border-\[/.test(t) && !/^border-\[\d/.test(t));
      if (tok) {
        const p = ensureProps(target);
        p.className = `${(p.className as string | undefined) ?? ''} ${tok}`.replace(/\s+/g, ' ').trim();
      }
      copyFromStyle();
      return;
    }
    case 'backgroundImage': {
      const srcAnim = readAnim(src);
      const srcOuter = (srcAnim.outerStyle ?? {}) as Record<string, unknown>;
      if ('backgroundImage' in srcOuter) {
        const outer = ensureOuter(target);
        outer.backgroundImage = srcOuter.backgroundImage;
      }
      copyFromStyle();
      return;
    }
    case 'filterBlur': {
      const srcAnim = readAnim(src);
      const srcFilter = (srcAnim.filter ?? {}) as Record<string, unknown>;
      if ('blur' in srcFilter) {
        const filter = ensureFilter(target);
        filter.blur = srcFilter.blur;
      }
      return;
    }
    case 'paddingTop': case 'paddingRight': case 'paddingBottom': case 'paddingLeft':
    case 'marginTop':  case 'marginRight':  case 'marginBottom':  case 'marginLeft': {
      // Spacing is encoded in compound tokens (p-4, px-2, mt-6, my-auto, arbitrary
      // p-[12px] etc.). Copying a single side cleanly requires re-assembling the
      // compound tokens. Simplest reliable strategy: mirror the source's entire
      // spacing-token set for that axis. We do this by replacing all padding/margin
      // tokens in target with those from source that affect this side.
      const isPadding = cssProp.startsWith('padding');
      const p = ensureProps(target);
      const curCls = (p.className as string | undefined) ?? '';
      // Strip every padding (or margin) token from target
      const tgtTokens = curCls.split(/\s+/).filter(t => {
        if (isPadding) return !/^p[xytblr]?-/.test(t);
        return !/^m[xytblr]?-/.test(t);
      });
      // Add every padding (or margin) token from source
      const srcTokens = srcCls.split(/\s+/).filter(t => {
        if (isPadding) return /^p[xytblr]?-/.test(t);
        return /^m[xytblr]?-/.test(t);
      });
      p.className = [...tgtTokens, ...srcTokens].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      copyFromStyle();
      return;
    }
    default: {
      const prefix = TW_PREFIX[cssProp];
      if (prefix) {
        const tok = parseTwToken(srcCls, prefix);
        if (tok) {
          const p = ensureProps(target);
          p.className = `${(p.className as string | undefined) ?? ''} ${tok}`.replace(/\s+/g, ' ').trim();
        }
      }
      copyFromStyle();
      return;
    }
  }
}

/**
 * Overlay every cssProp listed in `overrideProps` from `source` onto `target`.
 * Convenience wrapper around `copyCssProp`.
 */
export function overlayOverrides(source: SDUINode | Record<string, unknown> | null | undefined, target: MutableNode, overrideProps: string[]): void {
  for (const p of overrideProps) {
    if (CSS_PROP_SET.has(p)) {
      copyCssProp(source, target, p);
    } else if (NONCSS_PROP_SET.has(p)) {
      copyNonCssProp(source, target as Record<string, unknown>, p);
    }
  }
}
