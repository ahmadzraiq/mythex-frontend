/**
 * responsive-resolver.ts
 *
 * Desktop-first responsive cascade for SDUI nodes.
 *
 * Breakpoints: desktop (base) → laptop → tablet → mobile
 *
 * The resolver takes a node and the current breakpoint, then merges
 * responsive overrides using a cascading strategy:
 *   - `styles` overrides individual CSS properties (parsed from className);
 *     only overridden properties change, everything else inherits.
 *   - `condition`, `text`, `props`, `style` override the base at that breakpoint.
 *
 * The resolved node is structurally identical to a regular SDUINode —
 * the renderer does not need to know about responsive internals.
 */

import type { SDUINode, BreakpointKey, ResponsiveOverride } from './types/node';
import { BREAKPOINT_CASCADE, BREAKPOINT_MAX_WIDTHS } from './types/node';

export type ActiveBreakpoint = 'desktop' | BreakpointKey;

/**
 * Determine the active breakpoint from a viewport width (desktop-first).
 *   >= 1280  → desktop
 *   >= 1024  → laptop
 *   >= 768   → tablet
 *   < 768    → mobile
 */
export function getBreakpointFromWidth(width: number): ActiveBreakpoint {
  if (width >= BREAKPOINT_MAX_WIDTHS.laptop) return 'desktop';
  if (width >= BREAKPOINT_MAX_WIDTHS.tablet) return 'laptop';
  if (width >= BREAKPOINT_MAX_WIDTHS.mobile) return 'tablet';
  return 'mobile';
}

/**
 * CSS property → Tailwind class prefix mapping.
 * Used to replace specific class tokens in the base className when responsive
 * style overrides target a particular CSS property.
 */
const CSS_PROP_TO_CLASS_PREFIX: Record<string, string[]> = {
  width:             ['w-'],
  height:            ['h-'],
  minWidth:          ['min-w-'],
  maxWidth:          ['max-w-'],
  minHeight:         ['min-h-'],
  maxHeight:         ['max-h-'],
  paddingTop:        ['pt-', 'py-', 'p-'],
  paddingRight:      ['pr-', 'px-', 'p-'],
  paddingBottom:     ['pb-', 'py-', 'p-'],
  paddingLeft:       ['pl-', 'px-', 'p-'],
  marginTop:         ['mt-', 'my-', 'm-'],
  marginRight:       ['mr-', 'mx-', 'm-'],
  marginBottom:      ['mb-', 'my-', 'm-'],
  marginLeft:        ['ml-', 'mx-', 'm-'],
  gap:               ['gap-'],
  columnGap:         ['gap-x-'],
  rowGap:            ['gap-y-'],
  top:               ['top-'],
  right:             ['right-'],
  bottom:            ['bottom-'],
  left:              ['left-'],
  opacity:           ['opacity-'],
  borderRadius:      ['rounded-'],
  borderTopLeftRadius: ['rounded-tl-'],
  borderTopRightRadius: ['rounded-tr-'],
  borderBottomRightRadius: ['rounded-br-'],
  borderBottomLeftRadius: ['rounded-bl-'],
  zIndex:            ['z-'],
  borderWidth:       ['border-'],
  fontSize:          ['text-'],
  backgroundColor:   ['bg-'],
  color:             ['text-'],
  borderColor:       ['border-'],
  flexDirection:     ['flex-row', 'flex-col', 'flex-row-reverse', 'flex-col-reverse'],
  flexWrap:          ['flex-wrap', 'flex-nowrap'],
  justifyContent:    ['justify-start', 'justify-end', 'justify-center', 'justify-between', 'justify-around', 'justify-evenly'],
  alignItems:        ['items-start', 'items-end', 'items-center', 'items-stretch', 'items-baseline'],
  alignSelf:         ['self-auto', 'self-start', 'self-end', 'self-center', 'self-stretch', 'self-baseline'],
  position:          ['absolute', 'relative', 'fixed', 'sticky', 'static'],
  overflow:          ['overflow-'],
  display:           ['hidden', 'block', 'inline', 'flex', 'grid', 'inline-flex', 'inline-block', 'contents'],
  cursor:            ['cursor-pointer', 'cursor-default', 'cursor-not-allowed', 'cursor-wait', 'cursor-text', 'cursor-move', 'cursor-grab'],
  borderStyle:       ['border-solid', 'border-dashed', 'border-dotted', 'border-none'],
  fontWeight:        ['font-thin', 'font-extralight', 'font-light', 'font-normal', 'font-medium', 'font-semibold', 'font-bold', 'font-extrabold', 'font-black'],
  textAlign:         ['text-left', 'text-center', 'text-right', 'text-justify'],
  textDecoration:    ['underline', 'line-through', 'no-underline'],
  textTransform:     ['uppercase', 'lowercase', 'capitalize', 'normal-case'],
  gridTemplateColumns: ['grid-cols-'],
  gridTemplateRows:  ['grid-rows-'],
};

/**
 * Keyword values for CSS properties that map to bare Tailwind utilities (no arbitrary value).
 */
const CSS_VALUE_TO_TOKEN: Record<string, Record<string, string>> = {
  flexDirection: {
    row: 'flex-row', column: 'flex-col',
    'row-reverse': 'flex-row-reverse', 'column-reverse': 'flex-col-reverse',
  },
  flexWrap: { wrap: 'flex-wrap', nowrap: 'flex-nowrap' },
  justifyContent: {
    'flex-start': 'justify-start', 'flex-end': 'justify-end', center: 'justify-center',
    'space-between': 'justify-between', 'space-around': 'justify-around', 'space-evenly': 'justify-evenly',
  },
  alignItems: {
    'flex-start': 'items-start', 'flex-end': 'items-end', center: 'items-center',
    stretch: 'items-stretch', baseline: 'items-baseline',
  },
  alignSelf: {
    auto: 'self-auto', 'flex-start': 'self-start', 'flex-end': 'self-end',
    center: 'self-center', stretch: 'self-stretch', baseline: 'self-baseline',
  },
  position: {
    absolute: 'absolute', relative: 'relative',
    fixed: 'fixed', sticky: 'sticky', static: 'static',
  },
  width: {
    '100%': 'w-full', 'auto': 'w-auto', 'fit-content': 'w-fit',
    '100vw': 'w-screen', 'max-content': 'w-max', 'min-content': 'w-min',
  },
  height: {
    '100%': 'h-full', 'auto': 'h-auto', 'fit-content': 'h-fit',
    '100vh': 'h-screen', 'max-content': 'h-max', 'min-content': 'h-min',
  },
  overflow: {
    hidden: 'overflow-hidden', auto: 'overflow-auto',
    scroll: 'overflow-scroll', visible: 'overflow-visible',
  },
  display: {
    none: 'hidden', block: 'block', flex: 'flex', grid: 'grid',
    'inline-flex': 'inline-flex', 'inline-block': 'inline-block',
    inline: 'inline', contents: 'contents',
  },
  cursor: {
    pointer: 'cursor-pointer', default: 'cursor-default',
    'not-allowed': 'cursor-not-allowed', wait: 'cursor-wait',
    text: 'cursor-text', move: 'cursor-move', grab: 'cursor-grab',
  },
  borderStyle: {
    solid: 'border-solid', dashed: 'border-dashed',
    dotted: 'border-dotted', none: 'border-none',
  },
  fontWeight: {
    '100': 'font-thin', '200': 'font-extralight', '300': 'font-light',
    '400': 'font-normal', '500': 'font-medium', '600': 'font-semibold',
    '700': 'font-bold', '800': 'font-extrabold', '900': 'font-black',
  },
  textAlign: { left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify' },
  textDecoration: { underline: 'underline', 'line-through': 'line-through', none: 'no-underline' },
  textTransform: { uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize', none: 'normal-case' },
};

/**
 * CSS property → Tailwind prefix for arbitrary values.
 * e.g. gap: '16px' → 'gap-[16px]'
 */
const CSS_PROP_TO_ARB_PREFIX: Record<string, string> = {
  width: 'w', height: 'h', minWidth: 'min-w', maxWidth: 'max-w', minHeight: 'min-h', maxHeight: 'max-h',
  paddingTop: 'pt', paddingRight: 'pr', paddingBottom: 'pb', paddingLeft: 'pl',
  marginTop: 'mt', marginRight: 'mr', marginBottom: 'mb', marginLeft: 'ml',
  gap: 'gap', columnGap: 'gap-x', rowGap: 'gap-y',
  top: 'top', right: 'right', bottom: 'bottom', left: 'left',
  opacity: 'opacity',
  borderRadius: 'rounded',
  borderTopLeftRadius: 'rounded-tl', borderTopRightRadius: 'rounded-tr',
  borderBottomRightRadius: 'rounded-br', borderBottomLeftRadius: 'rounded-bl',
  zIndex: 'z', borderWidth: 'border', fontSize: 'text',
  backgroundColor: 'bg', color: 'text', borderColor: 'border',
};

/** Bracket-aware tokenizer (same as renderer.tsx) */
function tokenizeClassName(className: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of className) {
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) { tokens.push(cur); cur = ''; }
    } else { cur += ch; }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

/**
 * Check if a className token belongs to a CSS property category.
 * Returns true if the token should be stripped when that property is overridden.
 */
function tokenMatchesProperty(token: string, cssProp: string): boolean {
  const clean = token.startsWith('!') ? token.slice(1) : token;
  const prefixes = CSS_PROP_TO_CLASS_PREFIX[cssProp];
  if (!prefixes) return false;

  for (const pfx of prefixes) {
    if (!pfx.endsWith('-')) {
      if (clean === pfx) return true;
    } else {
      if (clean.startsWith(pfx)) return true;
    }
  }
  return false;
}

/**
 * Convert a CSS property + value to a Tailwind class token.
 */
function cssToToken(prop: string, value: string | number): string | null {
  const strVal = String(value);

  const keywords = CSS_VALUE_TO_TOKEN[prop];
  if (keywords && keywords[strVal]) return keywords[strVal];

  const arbPrefix = CSS_PROP_TO_ARB_PREFIX[prop];
  if (arbPrefix) return `${arbPrefix}-[${strVal}]`;

  return null;
}

/**
 * Apply responsive style overrides to a className string.
 * For each overridden CSS property:
 *   1. Remove existing tokens that target that property
 *   2. Append the new token (unless value is null = remove)
 *
 * Returns { className, inlineOverflows } — properties that couldn't be
 * expressed as Tailwind classes are returned as inline style overrides.
 */
function applyStyleOverrides(
  baseClassName: string | undefined,
  overrides: Record<string, string | number | null>,
): { className: string; inlineOverflows: Record<string, string | number> } {
  const inlineOverflows: Record<string, string | number> = {};
  if (!baseClassName && Object.keys(overrides).length === 0) return { className: '', inlineOverflows };

  const tokens = baseClassName ? tokenizeClassName(baseClassName) : [];

  const propsToOverride = Object.keys(overrides);
  const filtered = tokens.filter(tok => {
    for (const prop of propsToOverride) {
      if (tokenMatchesProperty(tok, prop)) return false;
    }
    return true;
  });

  for (const [prop, value] of Object.entries(overrides)) {
    if (value === null) continue;
    const token = cssToToken(prop, value);
    if (token) {
      filtered.push(token);
    } else {
      inlineOverflows[prop] = value;
    }
  }

  return { className: filtered.join(' '), inlineOverflows };
}

/**
 * Collect cascaded style overrides for a given breakpoint.
 * Desktop-first: laptop overrides cascade to tablet and mobile, etc.
 */
function getCascadedStyles(
  responsive: Partial<Record<BreakpointKey, ResponsiveOverride>>,
  breakpoint: ActiveBreakpoint,
): Record<string, string | number | null> {
  if (breakpoint === 'desktop') return {};

  const bpIndex = BREAKPOINT_CASCADE.indexOf(breakpoint as BreakpointKey);
  if (bpIndex === -1) return {};

  const merged: Record<string, string | number | null> = {};
  for (let i = 0; i <= bpIndex; i++) {
    const bp = BREAKPOINT_CASCADE[i];
    const override = responsive[bp];
    if (override?.styles) {
      Object.assign(merged, override.styles);
    }
  }
  return merged;
}

/**
 * Collect cascaded _disabledOverlay overrides for a given breakpoint.
 * Each field (color, opacity, blur) cascades independently.
 * null for a field means "explicitly removed at this breakpoint".
 */
function getCascadedDisabledOverlay(
  responsive: Partial<Record<BreakpointKey, ResponsiveOverride>>,
  breakpoint: ActiveBreakpoint,
): { color?: string | null; opacity?: number | null; blur?: number | null } {
  if (breakpoint === 'desktop') return {};
  const bpIndex = BREAKPOINT_CASCADE.indexOf(breakpoint as BreakpointKey);
  if (bpIndex === -1) return {};
  const merged: { color?: string | null; opacity?: number | null; blur?: number | null } = {};
  for (let i = 0; i <= bpIndex; i++) {
    const bp = BREAKPOINT_CASCADE[i];
    const override = responsive[bp];
    if (override?._disabledOverlay) {
      Object.assign(merged, override._disabledOverlay);
    }
  }
  return merged;
}

/**
 * Generic deep-merge helper for sparse animation objects.
 * `null` at any leaf is preserved (means "explicitly removed at this breakpoint").
 */
export function deepMergeAnimation(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (val === null) {
      result[key] = null;
    } else if (val !== null && typeof val === 'object' && !Array.isArray(val)
               && typeof result[key] === 'object' && result[key] !== null && !Array.isArray(result[key])) {
      result[key] = deepMergeAnimation(
        result[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      );
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Collect cascaded animation overrides for a given breakpoint via generic deep-merge.
 * `null` for any leaf means "explicitly removed at this breakpoint".
 */
export function getCascadedAnimation(
  responsive: Partial<Record<BreakpointKey, ResponsiveOverride>>,
  breakpoint: ActiveBreakpoint,
): Record<string, unknown> {
  if (breakpoint === 'desktop') return {};

  const bpIndex = BREAKPOINT_CASCADE.indexOf(breakpoint as BreakpointKey);
  if (bpIndex === -1) return {};

  let merged: Record<string, unknown> = {};
  for (let i = 0; i <= bpIndex; i++) {
    const bp = BREAKPOINT_CASCADE[i];
    const anim = responsive[bp]?.animation;
    if (!anim) continue;
    merged = deepMergeAnimation(merged, anim as Record<string, unknown>);
  }
  return merged;
}

/**
 * Get the cascaded value for a non-style field (condition, text, props, style).
 * Returns undefined if no breakpoint in the cascade overrides this field.
 */
function getCascadedField<K extends keyof ResponsiveOverride>(
  responsive: Partial<Record<BreakpointKey, ResponsiveOverride>>,
  breakpoint: ActiveBreakpoint,
  field: K,
): ResponsiveOverride[K] | undefined {
  if (breakpoint === 'desktop') return undefined;

  const bpIndex = BREAKPOINT_CASCADE.indexOf(breakpoint as BreakpointKey);
  if (bpIndex === -1) return undefined;

  let result: ResponsiveOverride[K] | undefined;
  for (let i = 0; i <= bpIndex; i++) {
    const bp = BREAKPOINT_CASCADE[i];
    const override = responsive[bp];
    if (override && field in override) {
      result = override[field];
    }
  }
  return result;
}

/**
 * Resolve a node's responsive overrides for the given breakpoint.
 * Returns a new node with overrides applied — the original is not mutated.
 *
 * If the node has no `responsive` field or the breakpoint is 'desktop',
 * returns the original node (zero-cost passthrough).
 */
export function resolveResponsiveNode(node: SDUINode, breakpoint: ActiveBreakpoint): SDUINode {
  if (!node.responsive || breakpoint === 'desktop') return node;

  const responsive = node.responsive;
  const cascadedStyles = getCascadedStyles(responsive, breakpoint);
  const hasStyleOverrides = Object.keys(cascadedStyles).length > 0;

  const conditionOverride = getCascadedField(responsive, breakpoint, 'condition');
  const textOverride = getCascadedField(responsive, breakpoint, 'text');
  const propsOverride = getCascadedField(responsive, breakpoint, 'props');
  const styleOverride = getCascadedField(responsive, breakpoint, 'style');
  const mapOverride = getCascadedField(responsive, breakpoint, 'map');
  const actionsOverride = getCascadedField(responsive, breakpoint, 'actions');

  const cascadedAnim = getCascadedAnimation(responsive, breakpoint);
  const hasAnimOverrides = Object.keys(cascadedAnim).length > 0;

  const cascadedDisabledOverlay = getCascadedDisabledOverlay(responsive, breakpoint);
  const hasDisabledOverlayOverrides = Object.keys(cascadedDisabledOverlay).length > 0;

  const hasAnyOverride = hasStyleOverrides
    || conditionOverride !== undefined
    || textOverride !== undefined
    || propsOverride !== undefined
    || styleOverride !== undefined
    || mapOverride !== undefined
    || actionsOverride !== undefined
    || hasAnimOverrides
    || hasDisabledOverlayOverrides;

  if (!hasAnyOverride) return node;

  const resolved: SDUINode = { ...node };

  if (hasStyleOverrides) {
    const baseClassName = node.props?.className as string | undefined ?? node.className;
    const { className: newClassName, inlineOverflows } = applyStyleOverrides(baseClassName, cascadedStyles);
    resolved.props = { ...resolved.props, className: newClassName };
    if (resolved.className) {
      resolved.className = newClassName;
    }

    const baseStyle = (resolved.props?.style ?? {}) as Record<string, unknown>;
    const stylePatches: Record<string, unknown> = { ...inlineOverflows };

    for (const prop of Object.keys(cascadedStyles)) {
      if (prop in baseStyle) {
        const val = cascadedStyles[prop];
        stylePatches[prop] = val === null ? undefined : val;
      }
    }

    if (Object.keys(stylePatches).length > 0) {
      resolved.props = {
        ...resolved.props,
        style: { ...baseStyle, ...stylePatches },
      };
    }
  }

  if (conditionOverride !== undefined) {
    if (conditionOverride === false) {
      resolved.condition = 'false';
    } else if (conditionOverride === null) {
      const { condition: _removed, ...rest } = resolved;
      Object.assign(resolved, rest);
      delete resolved.condition;
    } else {
      resolved.condition = conditionOverride;
    }
  }

  if (textOverride !== undefined) {
    resolved.text = textOverride;
  }

  if (propsOverride !== undefined) {
    resolved.props = { ...resolved.props, ...propsOverride };
  }

  if (styleOverride !== undefined) {
    const baseStyle = (resolved.props?.style ?? {}) as Record<string, unknown>;
    resolved.props = {
      ...resolved.props,
      style: { ...baseStyle, ...styleOverride },
    };
  }

  if (hasAnimOverrides) {
    // Animation can live at node.animation (top-level alias) or props.animation (canonical).
    // Deep-merge into whichever exists (and create on canonical if neither does).
    const propsAnim = (resolved.props as Record<string, unknown> | undefined)?.animation as
      | Record<string, unknown>
      | undefined;
    const topAnim = (resolved as unknown as Record<string, unknown>).animation as
      | Record<string, unknown>
      | undefined;

    const mergeAnim = (existing: Record<string, unknown> | undefined): Record<string, unknown> =>
      deepMergeAnimation(existing ?? {}, cascadedAnim);

    if (propsAnim !== undefined) {
      resolved.props = { ...resolved.props, animation: mergeAnim(propsAnim) };
    } else if (topAnim !== undefined) {
      (resolved as unknown as Record<string, unknown>).animation = mergeAnim(topAnim);
    } else {
      resolved.props = { ...resolved.props, animation: mergeAnim(undefined) };
    }
  }

  if (mapOverride !== undefined) {
    if (mapOverride === null) {
      delete resolved.map;
    } else {
      resolved.map = mapOverride;
    }
  }

  if (actionsOverride !== undefined) {
    if (actionsOverride === null) {
      delete resolved.actions;
    } else {
      resolved.actions = actionsOverride;
    }
  }

  if (hasDisabledOverlayOverrides) {
    const base = (resolved as unknown as Record<string, unknown>)._disabledOverlay as
      | { color?: string; opacity?: number; blur?: number }
      | undefined;
    const next = { ...(base ?? {}) } as Record<string, unknown>;
    for (const [k, v] of Object.entries(cascadedDisabledOverlay)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    (resolved as unknown as Record<string, unknown>)._disabledOverlay = next;
  }

  return resolved;
}

/**
 * Recursively resolve responsive overrides for a full node tree.
 * Used when the breakpoint changes so the entire tree is re-resolved.
 */
export function resolveResponsiveTree(nodes: SDUINode[], breakpoint: ActiveBreakpoint): SDUINode[] {
  if (breakpoint === 'desktop') return nodes;
  return nodes.map(node => {
    const resolved = resolveResponsiveNode(node, breakpoint);
    if (resolved.children) {
      return { ...resolved, children: resolveResponsiveTree(resolved.children, breakpoint) };
    }
    return resolved;
  });
}
