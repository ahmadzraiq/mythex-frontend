'use client';

/**
 * SDUI Renderer - Fine-grained reactivity
 * Each node subscribes only to the variables it uses - no unnecessary re-renders
 *
 * Prop-mutation helpers and element-wrapping utilities live in renderer-node-props.tsx.
 * This file is responsible only for the rendering lifecycle: state setup, map expansion,
 * hook orchestration, and JSX composition.
 */

import React, { memo, useSyncExternalStore, useContext, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { AnimatedNode } from './components/animated-node';
import type { AnimationConfig } from './components/animated-node';
import type { PopoverHostProps } from './components/PopoverHost';
import { FormContext, FormScopeContext } from './form-context';
import { getNestedValue } from './nested-utils';
import { trackFormFieldProps, useFormFieldRegistration, useExternalNodeValueSync, useExternalFormSync } from './form-field-tracker';
import { evaluateFormula } from './formula-evaluator';
import { getComponent } from './component-registry';
import { evaluateCondition, resolveProps, resolveText } from './utils';
import { createVariableStore, useVariablePaths } from './variable-store';
import { extractNodeDependencies } from './dependency-extractor';
import type { SDUINode, SDUIContext } from './types';
import { isScreenScopedPath } from './path-utils';

const _warnedTypes = new Set<string>();
const _ACCEPTS_ON_VALUE_CHANGE = new Set<string>([]);
const _CONTROLLED_VALUE_KEYS = ['value', 'selectedValue', 'defaultValue', 'isChecked', 'isSelected'];
import { createGet } from './create-get';
import { bindActionsToProps } from './action-binding';
import { registerInstanceTriggerDispatcher } from './component-trigger-registry';
import { useBuilderMode, usePopoverShown } from './builder-context';
import { resolveResponsiveNode } from './responsive-resolver';
import { InputParentContext, useParentInputId } from './input-parent-context';
import { PARENT_CONTEXT_PROVIDER_TYPES } from './controlled-component-registry';
import {
  PRESS_ONLY_TYPES, CHANGE_TEXT_TYPES,
  applyFormContextBindings, applyStateOverrides, applyClassFormulas, applyAutofill,
  injectControlledProps, applyBuilderAnnotation,
  wrapWithClickHandler, renderWithDisabledOverlay,
  DataSourceWrapper,
} from './renderer-node-props';

/** Stable empty object for useSyncExternalStore fallback — avoids infinite loop from new {} each call */
const STABLE_EMPTY_OBJECT: Record<string, unknown> = {};

/**
 * Resolve a shared-component model by id.
 * Tries the builder data layer first (live, user-editable), then falls back
 * to the static JSON seed.
 */
function getLinkedComponentModel(
  _kind: 'shared',
  id: string,
): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@/lib/builder/shared-component-data').getSharedComponents()[id];
  } catch { /* noop */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@/config/shared-components.json')[id];
  } catch { /* noop */ }
  return undefined;
}

/**
 * Extract arbitrary-value Tailwind classes (e.g. `w-[1228px]`, `pt-[120px]`, `gap-[32px]`)
 * into equivalent inline style properties.
 *
 * Tailwind's JIT can only compile classes found in scanned source files. Classes that come
 * from JSON config at runtime are never compiled, so they would have no visual effect without
 * this fallback. Only numeric values (px, vh, vw, %) are extracted — color and CSS-variable
 * classes (bg-[#hex], text-[var(--x)]) are left to NativeWind to handle.
 *
 * The JSON remains class-only; this is purely a render-time enrichment.
 */
// Bracket-aware tokenizer for Tailwind className strings.
// className.split(/\s+/) breaks classes with spaces inside [...] brackets — e.g.
// "w-[calc(33.333% - 22px)]" splits into 3 fragments. This tokenizer never splits
// inside an open bracket, keeping such classes as a single token.
function tokenizeClassName(className: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of className) {
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) { tokens.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function classToInlineStyle(className: string | undefined): Record<string, string> & { _consumed?: Set<string> } {
  if (!className) return {};
  const style: Record<string, string> & { _consumed?: Set<string> } = {};
  const consumed = new Set<string>();

  // Handle non-arbitrary position and inset keywords (no [value] suffix).
  // These are bare Tailwind utilities compiled by JIT for source files but NOT for
  // JSON config — so we convert them to inline styles here as a fallback.
  const POSITION_KW: Record<string, string> = {
    absolute: 'absolute', relative: 'relative',
    fixed: 'fixed', sticky: 'sticky', static: 'static',
  };
  for (const tok of tokenizeClassName(className)) {
    const clean = tok.startsWith('!') ? tok.slice(1) : tok;
    if (POSITION_KW[clean]) { style.position = POSITION_KW[clean]; }
    // inset-0 / inset-x-0 / inset-y-0 bare keywords → top/right/bottom/left = 0
    else if (clean === 'inset-0')   { style.top = style.right = style.bottom = style.left = '0px'; }
    else if (clean === 'inset-x-0') { style.left = style.right = '0px'; }
    else if (clean === 'inset-y-0') { style.top  = style.bottom = '0px'; }
    // pointer-events
    else if (clean === 'pointer-events-none') { (style as Record<string, string>).pointerEvents = 'none'; }
    else if (clean === 'pointer-events-auto') { (style as Record<string, string>).pointerEvents = 'auto'; }
    // overflow
    else if (clean === 'overflow-hidden')  { (style as Record<string, string>).overflow = 'hidden'; }
    else if (clean === 'overflow-auto')    { (style as Record<string, string>).overflow = 'auto'; }
    else if (clean === 'overflow-scroll')  { (style as Record<string, string>).overflow = 'scroll'; }
    else if (clean === 'overflow-visible') { (style as Record<string, string>).overflow = 'visible'; }
    else if (clean === 'overflow-x-hidden')  { (style as Record<string, string>).overflowX = 'hidden'; }
    else if (clean === 'overflow-x-auto')    { (style as Record<string, string>).overflowX = 'auto'; }
    else if (clean === 'overflow-x-scroll')  { (style as Record<string, string>).overflowX = 'scroll'; }
    else if (clean === 'overflow-y-hidden')  { (style as Record<string, string>).overflowY = 'hidden'; }
    else if (clean === 'overflow-y-auto')    { (style as Record<string, string>).overflowY = 'auto'; }
    else if (clean === 'overflow-y-scroll')  { (style as Record<string, string>).overflowY = 'scroll'; }
    // word-break
    else if (clean === 'break-all')    { (style as Record<string, string>).wordBreak = 'break-all'; }
    else if (clean === 'break-words')  { (style as Record<string, string>).wordBreak = 'break-word'; }
    else if (clean === 'break-normal') { (style as Record<string, string>).wordBreak = 'normal'; }
    // white-space
    else if (clean === 'whitespace-nowrap')   { (style as Record<string, string>).whiteSpace = 'nowrap'; }
    else if (clean === 'whitespace-pre')      { (style as Record<string, string>).whiteSpace = 'pre'; }
    else if (clean === 'whitespace-pre-wrap') { (style as Record<string, string>).whiteSpace = 'pre-wrap'; }
    else if (clean === 'whitespace-normal')   { (style as Record<string, string>).whiteSpace = 'normal'; }
    // text-overflow
    else if (clean === 'truncate') {
      (style as Record<string, string>).overflow = 'hidden';
      (style as Record<string, string>).textOverflow = 'ellipsis';
      (style as Record<string, string>).whiteSpace = 'nowrap';
    }
    else if (clean === 'text-ellipsis') { (style as Record<string, string>).textOverflow = 'ellipsis'; }
    else if (clean === 'text-clip')     { (style as Record<string, string>).textOverflow = 'clip'; }
    // border-style keywords — needed so the outer Animated.View wrapper gets
    // border-style when border-width comes from a formula (props.style.borderWidth).
    // Without this, the outer wrapper has border-width but no border-style → no visible border.
    else if (clean === 'border-solid')  { (style as Record<string, string>).borderStyle = 'solid'; consumed.add(tok); }
    else if (clean === 'border-dashed') { (style as Record<string, string>).borderStyle = 'dashed'; consumed.add(tok); }
    else if (clean === 'border-dotted') { (style as Record<string, string>).borderStyle = 'dotted'; consumed.add(tok); }
    else if (clean === 'border-none')   { (style as Record<string, string>).borderStyle = 'none';   consumed.add(tok); }
    // flex-grow / flex-shrink bare keywords
    else if (clean === 'grow')     { (style as Record<string, string>).flexGrow = '1'; }
    else if (clean === 'grow-0')   { (style as Record<string, string>).flexGrow = '0'; }
    else if (clean === 'shrink')   { (style as Record<string, string>).flexShrink = '1'; }
    else if (clean === 'shrink-0') { (style as Record<string, string>).flexShrink = '0'; }
    // grid column/row span utilities — NOT compiled by NativeWind JIT for JSON-config classes.
    // Must emit as inline styles so the outer Animated.View wrapper forwards gridColumn/gridRow
    // to the grid container and col-span-* / row-span-* work correctly on mapped nodes.
    else if (clean === 'col-span-full') { (style as Record<string, string>).gridColumn = '1 / -1'; }
    else if (/^col-span-(\d+)$/.test(clean)) { (style as Record<string, string>).gridColumn = `span ${clean.split('-')[2]}`; }
    else if (clean === 'row-span-full') { (style as Record<string, string>).gridRow = '1 / -1'; }
    else if (/^row-span-(\d+)$/.test(clean)) { (style as Record<string, string>).gridRow = `span ${clean.split('-')[2]}`; }
    // margin-auto utilities — critical for centering animated nodes that use mx-auto.
    // classToInlineStyle only handles arbitrary [Npx] values, not keyword values like auto.
    // Without emitting them as inline styles, the outer Animated.View wrapper (which carries
    // the positioning in builder mode) gets no margin, and mx-auto has zero centering effect
    // on the outer wrapper (only on the inner element via NativeWind compiled CSS, which
    // doesn't affect the wrapper's position in the flex parent).
    // sizeOverride forwards marginLeft/marginRight to outerStyle → the outer wrapper
    // self-centers within its flex parent even when align-self:auto applies stretch.
    else if (clean === 'm-auto')  { (style as Record<string, string>).margin = 'auto'; }
    else if (clean === 'mx-auto') { (style as Record<string, string>).marginLeft = 'auto'; (style as Record<string, string>).marginRight = 'auto'; }
    else if (clean === 'my-auto') { (style as Record<string, string>).marginTop = 'auto';  (style as Record<string, string>).marginBottom = 'auto'; }
    else if (clean === 'ml-auto') { (style as Record<string, string>).marginLeft = 'auto'; }
    else if (clean === 'mr-auto') { (style as Record<string, string>).marginRight = 'auto'; }
    else if (clean === 'mt-auto') { (style as Record<string, string>).marginTop = 'auto'; }
    else if (clean === 'mb-auto') { (style as Record<string, string>).marginBottom = 'auto'; }
    // width / height keyword utilities (non-arbitrary). These are NOT compiled by Tailwind JIT
    // for JSON-config classes, so we must emit them as inline styles so the outer Animated.View
    // wrapper can forward them (e.g. w-fit on a button must make the outer wrapper fit-content
    // wide, not stretch to fill the flex parent).
    else if (clean === 'w-fit')     { (style as Record<string, string>).width = 'fit-content'; }
    else if (clean === 'w-max')     { (style as Record<string, string>).width = 'max-content'; }
    else if (clean === 'w-min')     { (style as Record<string, string>).width = 'min-content'; }
    else if (clean === 'w-auto')    { (style as Record<string, string>).width = 'auto'; }
    else if (clean === 'w-full')    { (style as Record<string, string>).width = '100%'; }
    else if (clean === 'w-screen')  { (style as Record<string, string>).width = '100vw'; }
    else if (clean === 'h-fit')     { (style as Record<string, string>).height = 'fit-content'; }
    else if (clean === 'h-max')     { (style as Record<string, string>).height = 'max-content'; }
    else if (clean === 'h-min')     { (style as Record<string, string>).height = 'min-content'; }
    else if (clean === 'h-auto')    { (style as Record<string, string>).height = 'auto'; }
    else if (clean === 'h-full')    { (style as Record<string, string>).height = '100%'; }
    else if (clean === 'h-screen')  { (style as Record<string, string>).height = '100vh'; }
  }

  for (const token of tokenizeClassName(className)) {
    // Strip the ! importance prefix so "!bg-[#0f172a]" is handled the same as "bg-[#0f172a]"
    const clean = token.startsWith('!') ? token.slice(1) : token;
    const m = clean.match(/^([\w-]+)-\[(.+)\]$/);
    if (!m) continue;
    const [, prefix, rawValue] = m;
    // Tailwind uses underscores for spaces inside arbitrary values (e.g. calc(33%_-_22px)).
    // Convert them back to spaces so the CSS value is valid.
    const value = rawValue.replace(/_/g, ' ');
    const _sizeBefore = Object.keys(style).length;

    // Determine value category so we can apply the right CSS property below.
    const isNumeric  = /^-?\d/.test(value);           // 96px, 900px, 80vh, -10px
    const isHexColor = /^#[0-9a-fA-F]/.test(value);  // #0f172a, #cbd5e1
    const isCssFn    = /^\w[\w-]*\(/.test(value);     // calc(...), rgb(...), rgba(...), hsl(...), var(--)
    // A value is a valid dimension: numeric OR a CSS function (calc, min, max, clamp, etc.)
    const isDimension = isNumeric || isCssFn;

    switch (prefix) {
      // ── Numeric layout ────────────────────────────────────────────────────────
      // For vw/vh values, use CSS custom properties --builder-vw/--builder-vh
      // so the builder preview uses the canvas frame dimensions instead of the
      // browser window viewport. The fallback (1vw / 1vh) makes it correct in
      // the deployed app where no custom property is set.
      // CSS functions like calc(), min(), max() are also valid dimension values.
      case 'w':
        if (isDimension) {
          const n = isNumeric ? parseFloat(value) : NaN;
          style.width = !isNaN(n) && value.endsWith('vw')
            ? `calc(${n} * var(--builder-vw, 1vw))`
            : value;
        }
        break;
      case 'h':
        if (isDimension) {
          const n = isNumeric ? parseFloat(value) : NaN;
          style.height = !isNaN(n) && value.endsWith('vh')
            ? `calc(${n} * var(--builder-vh, 1vh))`
            : value;
        }
        break;
      case 'min-w':
        if (isDimension) {
          const n = isNumeric ? parseFloat(value) : NaN;
          style.minWidth = !isNaN(n) && value.endsWith('vw') ? `calc(${n} * var(--builder-vw, 1vw))` : value;
        }
        break;
      case 'max-w':
        if (isDimension) {
          const n = isNumeric ? parseFloat(value) : NaN;
          style.maxWidth = !isNaN(n) && value.endsWith('vw') ? `calc(${n} * var(--builder-vw, 1vw))` : value;
        }
        break;
      case 'min-h':
        if (isDimension) {
          const n = isNumeric ? parseFloat(value) : NaN;
          style.minHeight = !isNaN(n) && value.endsWith('vh') ? `calc(${n} * var(--builder-vh, 1vh))` : value;
        }
        break;
      case 'max-h':
        if (isDimension) {
          const n = isNumeric ? parseFloat(value) : NaN;
          style.maxHeight = !isNaN(n) && value.endsWith('vh') ? `calc(${n} * var(--builder-vh, 1vh))` : value;
        }
        break;
      case 'p':       if (isNumeric) { style.paddingTop = style.paddingRight = style.paddingBottom = style.paddingLeft = value; } break;
      case 'pt':      if (isNumeric) { style.paddingTop    = value; } break;
      case 'pr':      if (isNumeric) { style.paddingRight  = value; } break;
      case 'pb':      if (isNumeric) { style.paddingBottom = value; } break;
      case 'pl':      if (isNumeric) { style.paddingLeft   = value; } break;
      case 'px':      if (isNumeric) { style.paddingLeft   = style.paddingRight = value; } break;
      case 'py':      if (isNumeric) { style.paddingTop    = style.paddingBottom = value; } break;
      case 'm':       if (isNumeric) { style.marginTop = style.marginRight = style.marginBottom = style.marginLeft = value; } break;
      case 'mt':      if (isNumeric) { style.marginTop     = value; } break;
      case 'mr':      if (isNumeric) { style.marginRight   = value; } break;
      case 'mb':      if (isNumeric) { style.marginBottom  = value; } break;
      case 'ml':      if (isNumeric) { style.marginLeft    = value; } break;
      case 'mx':      if (isNumeric) { style.marginLeft    = style.marginRight = value; } break;
      case 'my':      if (isNumeric) { style.marginTop     = style.marginBottom = value; } break;
      case 'gap':     if (isNumeric) { style.gap           = value; } break;
      case 'gap-x':   if (isNumeric) { style.columnGap     = value; } break;
      case 'gap-y':   if (isNumeric) { style.rowGap        = value; } break;
      case 'top':     if (isDimension) { style.top           = value; } break;
      case 'right':   if (isDimension) { style.right         = value; } break;
      case 'bottom':  if (isDimension) { style.bottom        = value; } break;
      case 'left':    if (isDimension) { style.left          = value; } break;
      case 'inset':   if (isDimension) { style.top = style.right = style.bottom = style.left = value; } break;
      case 'inset-x': if (isDimension) { style.left = style.right = value; } break;
      case 'inset-y': if (isDimension) { style.top  = style.bottom = value; } break;
      case 'opacity':     if (isNumeric) { style.opacity               = value; } break;
      // ── Border radius — matches styleToClassName inverse ─────────────────────
      case 'rounded':     if (isNumeric) { style.borderRadius           = value; } break;
      case 'rounded-tl':  if (isNumeric) { style.borderTopLeftRadius    = value; } break;
      case 'rounded-tr':  if (isNumeric) { style.borderTopRightRadius   = value; } break;
      case 'rounded-br':  if (isNumeric) { style.borderBottomRightRadius = value; } break;
      case 'rounded-bl':  if (isNumeric) { style.borderBottomLeftRadius = value; } break;
      // ── Z-index ───────────────────────────────────────────────────────────────
      case 'z':           if (isNumeric) { style.zIndex                 = value; } break;
      // ── Translate — stored as separate properties, combined into transform by the renderer ──
      case 'translate-x': if (isNumeric) { style.translateX = value; } break;
      case 'translate-y': if (isNumeric) { style.translateY = value; } break;

      // ── Rotation — rotate-[45deg] → transform: rotate(45deg) ─────────────────
      case 'rotate':
        (style as Record<string, string>).transform = `rotate(${value})`;
        break;

      // ── Drop shadow — shadow-[0px_5px_21px_1px_#000] ─────────────────────────
      // Underscores are already converted to spaces by line 210 above.
      case 'shadow':
        (style as Record<string, string>).boxShadow = value;
        break;

      // ── Backdrop filter — backdrop-blur-[14px] ───────────────────────────────
      case 'backdrop-blur':
        if (isDimension) {
          (style as Record<string, string>).backdropFilter = `blur(${value})`;
          (style as Record<string, string>).WebkitBackdropFilter = `blur(${value})`;
        }
        break;

      // ── Colors — hex, rgb/rgba values, css variables, url() images ─────────────
      case 'bg':
        if (isHexColor || isCssFn) {
          // Gradients and image URLs belong on backgroundImage, not backgroundColor
          if (value.startsWith('linear-gradient(') || value.startsWith('radial-gradient(') || value.startsWith('url(')) {
            (style as Record<string, string>).backgroundImage = value;
          } else {
            style.backgroundColor = value;
          }
        }
        break;
      // text with hex or css-fn value → color; text with pixel value → fontSize
      case 'text':
        if (isHexColor || isCssFn) style.color = value;
        else if (isNumeric) style.fontSize = value;
        break;
      // border with hex or css-fn value → borderColor; border with numeric value → borderWidth
      case 'border':
        if (isHexColor || isCssFn) style.borderColor = value;
        else if (isNumeric) style.borderWidth = value;
        break;
      // ── Per-side border ───────────────────────────────────────────────────────
      case 'border-t':
        if (isHexColor || isCssFn) style.borderTopColor = value;
        else if (isNumeric) style.borderTopWidth = value;
        break;
      case 'border-r':
        if (isHexColor || isCssFn) style.borderRightColor = value;
        else if (isNumeric) style.borderRightWidth = value;
        break;
      case 'border-b':
        if (isHexColor || isCssFn) style.borderBottomColor = value;
        else if (isNumeric) style.borderBottomWidth = value;
        break;
      case 'border-l':
        if (isHexColor || isCssFn) style.borderLeftColor = value;
        else if (isNumeric) style.borderLeftWidth = value;
        break;
      // ── A4: Additional CSS properties ─────────────────────────────────────────
      // aspect-ratio: aspect-[16/9] or aspect-[1]
      case 'aspect':
        if (value) style.aspectRatio = value;
        break;
      // flex-grow: grow-[2]
      case 'grow':
        if (isNumeric) (style as Record<string, string>).flexGrow = value;
        break;
      // flex-shrink: shrink-[2]
      case 'shrink':
        if (isNumeric) (style as Record<string, string>).flexShrink = value;
        break;
      // flex-basis: basis-[200px]
      case 'basis':
        if (isNumeric) (style as Record<string, string>).flexBasis = value;
        break;
      // line-clamp: line-clamp-[3]
      case 'line-clamp':
        if (isNumeric) {
          (style as Record<string, string>).WebkitLineClamp = value;
          (style as Record<string, string>).WebkitBoxOrient = 'vertical';
          (style as Record<string, string>).display = '-webkit-box';
          (style as Record<string, string>).overflow = 'hidden';
        }
        break;
      // text-decoration-color: decoration-[#hex]
      case 'decoration':
        if (isHexColor || isCssFn) (style as Record<string, string>).textDecorationColor = value;
        break;
    }
    if (Object.keys(style).length > _sizeBefore) consumed.add(token);
  }

  if (consumed.size > 0) style._consumed = consumed;
  return style;
}

/** No-op subscribe — used by useSyncExternalStore when we don't need a subscription */
const NOOP_SUBSCRIBE_FN = (_cb: () => void) => () => {};

interface RendererContext {
  store: ReturnType<typeof createVariableStore>;
  mergedStore?: { getState: () => { merged: Record<string, unknown>; patchVersion: number }; subscribe: (cb: () => void) => () => void };
  mergedState?: Record<string, unknown>;
  runAction: SDUIContext['runAction'];
  fetchData: SDUIContext['fetchData'];
  actionsConfig?: Record<string, unknown>;
  screenName?: string;
  screenScopedAliases?: string[];
  /** Active preview state in builder mode — used to apply _stateOverrides per node */
  previewState?: string;
}

interface RendererProps {
  node: SDUINode;
  context: RendererContext;
  scope?: Record<string, unknown>;
  /** Stable tree path string used for builder node IDs (e.g. "0", "0-1", "0-1-2") */
  builderPath?: string;
  /** When this node is a rendered instance of a map/repeat template, the 0-based
   *  instance index. Written as `data-builder-map-index` so the builder overlay can
   *  identify the specific instance that was clicked (weWeb-style repeat selection). */
  builderMapIndex?: number;
}

const LazyPopoverHost = lazy(() => import('./components/PopoverHost'));

function PopoverHostLazy(props: Omit<PopoverHostProps, 'builderPopoverShown'>) {
  const shownPopovers = usePopoverShown();
  return (
    <Suspense fallback={props.trigger}>
      <LazyPopoverHost
        {...props}
        builderPopoverShown={shownPopovers?.has(`popover:${props.nodeId}`)}
      />
    </Suspense>
  );
}

const SDURendererInner = memo(function SDURendererInner({ node: rawNode, context, scope, builderPath = '0', builderMapIndex }: RendererProps) {
  const builderCtx = useBuilderMode();
  const { builderMode, activeBreakpoint } = builderCtx;

  // Resolve responsive overrides before any other processing.
  // In builder mode, activeBreakpoint comes from the builder's viewport preset.
  // In production, it comes from the engine's BreakpointContext (window.innerWidth).
  // Memoized so unrelated re-renders (variable-store bumps, hover, preview-state
  // toggles) skip className tokenization. The resolver is pure and short-circuits
  // to the same input reference when no responsive field applies, which also keeps
  // downstream memoization stable when only irrelevant state changed.
  const node = useMemo(
    () => (activeBreakpoint ? resolveResponsiveNode(rawNode, activeBreakpoint) : rawNode),
    [rawNode, activeBreakpoint],
  );

  const { store, mergedStore, mergedState, runAction, fetchData, actionsConfig, screenName, screenScopedAliases = [], previewState } = context;

  // ── _shared scope injection: make context.component.* available to children ──
  let effectiveScope = scope;
  const _rawMeta = node as unknown as Record<string, unknown>;
  const _sharedMetaRaw = _rawMeta._shared as { id: string; name: string } | undefined;
  const _linkedMeta = _sharedMetaRaw;
  const _linkedKind: 'shared' | null = _sharedMetaRaw ? 'shared' : null;
  // Stable instanceId — uses the node's id so it survives re-renders.
  const _instanceId = _linkedMeta
    ? ((_rawMeta.id as string | undefined) ?? _linkedMeta.id)
    : null;

  // Hoisted so the sync useEffect and useSyncExternalStore below can use them without recomputing.
  let _scControlledVar: string | null = null;
  let _scControlledPageKey: string | null = null;

  if (_linkedMeta && _linkedKind) {
    let scModel: {
      properties?: Array<{ name: string; defaultValue?: unknown }>;
      variables?: Record<string, { initialValue: unknown }>;
      formulas?: Record<string, { name: string; formula: string; params: unknown[] }>;
      workflows?: Record<string, { trigger: string; steps: unknown[]; params: unknown[] }>;
    } | undefined;
    scModel = getLinkedComponentModel(_linkedKind, _linkedMeta.id) as typeof scModel;
    const nodeProps = (node.props ?? {}) as Record<string, unknown>;
    const resolvedProps: Record<string, unknown> = {};
    for (const prop of (scModel?.properties ?? [])) {
      let val = prop.name in nodeProps ? nodeProps[prop.name] : prop.defaultValue;
      if (val && typeof val === 'object' && ('formula' in (val as Record<string, unknown>) || 'js' in (val as Record<string, unknown>))) {
        const _merged = mergedStore ? mergedStore.getState().merged : (mergedState ?? {});
        const _evalState = _merged ? { ...store.getState().getFullState(), ..._merged } : store.getState().getFullState();
        val = evaluateFormula(val as object, _evalState).value;
      }
      resolvedProps[prop.name] = val;
    }

    // Ensure per-instance variable slot exists, then read current instance variable values.
    const _instanceVars = scModel?.variables ?? {};
    let _currentInstanceVarValues: Record<string, unknown> = {};
    if (_instanceId && Object.keys(_instanceVars).length > 0) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const vs = require('@/lib/sdui/global-variable-store');
        vs.ensureComponentInstanceSlot(_instanceId, _instanceVars);
        _currentInstanceVarValues = vs.getComponentInstanceVars(_instanceId) ?? {};
      } catch { /* non-fatal */ }
    }

    // _controlled remap: if this SC instance is marked controlled, override the
    // valueVariable's slot with the global page variable value so formulas that
    // read context.component.variables[<valueVariable>] see the global value.
    const _controlled = _rawMeta._controlled as { variable?: string } | undefined;
    // Page-level variable key is always ${instanceId}-value — no globalId stored in JSON.
    const _controlledPageKey = _controlled?.variable && _instanceId ? `${_instanceId}-value` : null;
    // Hoist to outer scope for the sync hooks.
    _scControlledVar = _controlled?.variable ?? null;
    _scControlledPageKey = _controlledPageKey;
    if (_controlled?.variable && _controlledPageKey) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const vs = require('@/lib/sdui/global-variable-store');
        const gStore = vs.getGlobalVariableStore();
        const gState = gStore.getState().data as Record<string, unknown>;
        // Seed global slot with initialValue if still undefined.
        if (gState[_controlledPageKey] === undefined && _instanceVars[_controlled.variable] !== undefined) {
          const initVal = (_instanceVars[_controlled.variable] as { initialValue?: unknown }).initialValue;
          // Use .getState().set() — correct API (same as form-field-tracker.ts).
          gStore.getState().set(_controlledPageKey, initVal ?? null);
        }
        // Inject global value into instance vars snapshot so effectiveScope is correct.
        const globalVal = gStore.getState().data[_controlledPageKey];
        _currentInstanceVarValues = { ..._currentInstanceVarValues, [_controlled.variable]: globalVal };
      } catch { /* non-fatal */ }
    }

    effectiveScope = {
      ...scope,
      context: {
        ...((scope?.context as Record<string, unknown>) ?? {}),
        component: {
          props: resolvedProps,
          id: _linkedMeta.id,
          name: _linkedMeta.name,
          instanceId: _instanceId,
          model: scModel ?? null,
          // Expose live instance variable values so templates like
          // {{context.component.variables['uuid']}} resolve correctly.
          variables: _currentInstanceVarValues,
          // Expose _controlled so action handlers can detect the remap.
          _controlled: _controlled ?? null,
        },
      },
    };
  }

  // ── Component lifecycle triggers ──────────────────────────────────────────────
  const _runActionRef = useRef(runAction);
  _runActionRef.current = runAction;
  const _effectiveScopeRef = useRef(effectiveScope);
  _effectiveScopeRef.current = effectiveScope;
  const _sharedMetaRef = useRef(_linkedMeta);
  _sharedMetaRef.current = _linkedMeta;
  const _linkedKindRef = useRef(_linkedKind);
  _linkedKindRef.current = _linkedKind;
  const _instanceIdRef = useRef(_instanceId);
  _instanceIdRef.current = _instanceId;

  // Fire 'created' and 'mounted' lifecycle workflows on first mount.
  // Skipped in builder mode: page workflows (auth guards, redirects, data fetches)
  // must not run inside the canvas — the builder only renders, it does not execute.
  const _lifecycleFiredRef = useRef(false);
  useEffect(() => {
    if (builderMode) return;
    if (_lifecycleFiredRef.current) return;
    const meta = _sharedMetaRef.current;
    if (!meta) return;
    _lifecycleFiredRef.current = true;

    // Helper: dispatch a component workflow by workflowId via the executeComponentAction step type.
    // Uses the second fallback in runOne: { type: 'executeComponentAction', ... } with no named action
    // gets wrapped as a single-step workflow and dispatched to workflow-steps-handler's inline handler.
    const fireLifecycle = (wfId: string) => {
      try {
        // Dispatch as a workflow with a single executeComponentAction step.
        // IMPORTANT: do NOT include an `action` string field — runOne's alias
        // redirect (`return runOne({action: ...})`) strips `steps` in recursion.
        // Include `type` so runOne's fallback (line ~443) promotes the object
        // to actionDef, then dispatchToHandler sees the steps array and routes
        // to workflowStepsHandler (which handles executeComponentAction inline).
        _runActionRef.current(
          {
            type: 'workflow',
            steps: [
              {
                id: `lifecycle-${wfId}`,
                type: 'executeComponentAction',
                config: { action: wfId, modelId: meta.id },
              },
            ],
          } as unknown as Parameters<typeof runAction>[0],
          undefined,
          _effectiveScopeRef.current,
        );
      } catch (err) {
        if (typeof window !== 'undefined') console.warn('[renderer] fireLifecycle error', wfId, err);
      }
    };

    const kind = _linkedKindRef.current;
    if (!kind) return;
    const scModel = getLinkedComponentModel(kind, meta.id) as
      | { workflows?: Record<string, { trigger: string }> }
      | undefined;
    if (!scModel?.workflows) return;

    for (const [wfId, wf] of Object.entries(scModel.workflows)) {
      if (wf.trigger === 'created') fireLifecycle(wfId);
    }

    // 'mounted' fires after children render (microtask)
    queueMicrotask(() => {
      if (!scModel?.workflows) return;
      for (const [wfId, wf] of Object.entries(scModel.workflows)) {
        if (wf.trigger === 'mounted') fireLifecycle(wfId);
      }
    });

    return () => {
      // 'beforeUnmount' fires on cleanup
      if (!scModel?.workflows) return;
      for (const [wfId, wf] of Object.entries(scModel.workflows)) {
        if (wf.trigger === 'beforeUnmount') fireLifecycle(wfId);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 'propertyChange' fires whenever any resolved prop changes value (skips first mount).
  const _prevPropsRef = useRef<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (builderMode) return;
    const meta = _sharedMetaRef.current;
    if (!meta) return;
    const current = _effectiveScopeRef.current?.context
      ? (((_effectiveScopeRef.current.context as Record<string, unknown>).component as Record<string, unknown> | undefined)?.props as Record<string, unknown> | undefined) ?? {}
      : {};
    const prev = _prevPropsRef.current;
    // Skip first render (prev is null) — propertyChange shouldn't fire on mount.
    if (prev === null) {
      _prevPropsRef.current = current;
      return;
    }
    const changed = Object.keys(current).some(k => current[k] !== prev[k]) ||
      Object.keys(prev).some(k => !(k in current));
    _prevPropsRef.current = current;
    if (!changed) return;

    const kind = _linkedKindRef.current;
    if (!kind) return;
    const scModel = getLinkedComponentModel(kind, meta.id) as
      | { workflows?: Record<string, { trigger: string }> }
      | undefined;
    if (!scModel?.workflows) return;

    for (const [wfId, wf] of Object.entries(scModel.workflows)) {
      if (wf.trigger === 'propertyChange') {
        try {
          _runActionRef.current(
            {
              type: 'workflow',
              steps: [
                {
                  id: `propchange-${wfId}`,
                  type: 'executeComponentAction',
                  config: { action: wfId, modelId: meta.id },
                },
              ],
            } as unknown as Parameters<typeof runAction>[0],
            undefined,
            _effectiveScopeRef.current,
          );
        } catch { /* non-fatal */ }
      }
    }
  });

  // ── Custom-trigger dispatcher registration (SC instances only) ───────────────
  // Each SC instance registers a dispatcher keyed by its stable `instanceId`
  // so the `emitComponentTrigger` workflow step (fired from inside the
  // component) can look this instance up and fan the trigger out to matching
  // parent-page listener workflows bound on `node.actions`.
  const _nodeActionsRef = useRef<SDUINode['actions']>(node?.actions);
  _nodeActionsRef.current = node?.actions;
  const _actionsConfigRef = useRef(actionsConfig);
  _actionsConfigRef.current = actionsConfig;
  useEffect(() => {
    if (!_instanceId || !_linkedMeta) return;
    const unregister = registerInstanceTriggerDispatcher(_instanceId, (triggerId, payload) => {
      const actions = _nodeActionsRef.current;
      if (!Array.isArray(actions) || actions.length === 0) return;
      const cfg = _actionsConfigRef.current;
      const baseScope = _effectiveScopeRef.current ?? {};
      const listenerScope = {
        ...baseScope,
        context: {
          ...((baseScope.context as Record<string, unknown> | undefined) ?? {}),
          event: payload,
        },
      };
      for (const item of actions) {
        if (!item || typeof item !== 'object') continue;
        const ref = item as unknown as Record<string, unknown>;
        // New format: { trigger, workflowId } — trigger is inline, workflowId identifies the workflow
        const refTrigger = typeof ref.trigger === 'string' ? ref.trigger : null;
        if (refTrigger !== triggerId) continue;
        const wfName = typeof ref.workflowId === 'string' ? ref.workflowId
          : typeof ref.action === 'string' ? ref.action : '';
        if (!wfName) continue;
        try {
          Promise.resolve(
            _runActionRef.current(item as Parameters<typeof runAction>[0], undefined, listenerScope),
          ).catch(() => { /* listener errors don't abort siblings */ });
        } catch { /* non-fatal */ }
      }
    });
    return unregister;
  }, [_instanceId, _linkedMeta]);

  // Both builder and production read merged at render time (not via blanket subscription).
  // useVariablePaths (below) is the sole re-render scheduler — it subscribes to mergedStore
  // with JSON.stringify comparison on specific dep values, so only nodes whose deps actually
  // changed will re-render.
  //
  // Subscribe to patchVersion in all render modes (builder AND preview/production).
  // patchVersion bumps on: preview state/data changes, and formula registration (via _formulas_v).
  // This forces all nodes to re-evaluate bindings after formulas become available.
  useSyncExternalStore(
    mergedStore ? mergedStore.subscribe : NOOP_SUBSCRIBE_FN,
    () => mergedStore ? mergedStore.getState().patchVersion : 0,
    () => 0,
  );
  const merged = mergedStore
    ? mergedStore.getState().merged
    : (mergedState ?? STABLE_EMPTY_OBJECT);

  // FormScopeContext: set by FormContainer — scopes local.data.form.* to the
  // nearest enclosing FormContainer's isolated store instead of the shared singleton.
  const activeFormKey = useContext(FormScopeContext);

  const rawDeps = extractNodeDependencies(node);
  const screenMappedDeps =
    screenName && rawDeps.some((p) => isScreenScopedPath(p, screenScopedAliases))
      ? rawDeps.map((p) => (isScreenScopedPath(p, screenScopedAliases) ? `screens.${screenName}.${p}` : p))
      : rawDeps;
  // When inside a FormContainer, redirect local.data.form.* subscriptions to the
  // per-container isolated store (variables['formKey'].*) so only this container's
  // state changes trigger re-renders for this node — not other containers' submits.
  const LOCAL_FORM = 'local.data.form';
  const formMappedDeps = activeFormKey
    ? screenMappedDeps.map(p => {
        // Normalize optional-chaining dots so paths like "local?.data?.form?.fields?.x"
        // match the LOCAL_FORM prefix check. Return the normalized path (without ?.) so
        // getNestedValue can split on plain dots and navigate correctly in the snapshot.
        const pn = p.replace(/\?\./g, '.');
        if (pn === LOCAL_FORM) return `variables['${activeFormKey}']`;
        if (pn.startsWith(LOCAL_FORM + '.')) return `variables['${activeFormKey}'].${pn.slice(LOCAL_FORM.length + 1)}`;
        return p;
      })
    : screenMappedDeps;

  // Component instance variable subscription: when a map/text/condition references
  // `context.component.variables['UUID']`, translate the dep to the actual global
  // store path `_componentInstances.{instanceId}.UUID` so useVariablePaths
  // subscribes to the source-of-truth and re-renders when it changes.
  // Without this, `context.component.variables` is only a snapshot on scope and
  // the node never re-renders when the per-instance value updates.
  const currentInstanceId = effectiveScope?.context
    ? ((((effectiveScope.context as Record<string, unknown>).component as Record<string, unknown> | undefined)?.instanceId) as string | undefined)
    : undefined;
  // Extract _controlled metadata from the active SC context so read/write remap is applied to children too.
  // (Must be derived before deps mapping so we can redirect controlled-key deps to global slot.)
  const _ctxControlledForDeps = currentInstanceId
    ? ((((effectiveScope?.context as Record<string, unknown> | undefined)?.component as Record<string, unknown> | undefined)?._controlled) as { variable?: string } | null | undefined)
    : undefined;

  const deps = currentInstanceId
    ? formMappedDeps.map(p => {
        if (typeof p !== 'string') return p;
        // Normalize optional-chaining so context?.component?.variables?.['x'] matches the same as context.component.variables['x']
        const pn = p.replace(/\?\./g, '.');
        // Match both bracket and dot forms: context.component.variables['UUID'] or context.component.variables.UUID
        const mBracket = pn.match(/^context\.component\.variables\s*\[\s*['"]([^'"]+)['"]\s*\](.*)$/);
        if (mBracket) {
          const uuid = mBracket[1];
          const rest = mBracket[2] ?? '';
          // Controlled remap: watch global slot so re-renders fire when global var changes.
          if (_ctxControlledForDeps?.variable === uuid && currentInstanceId) {
            return `variables.${currentInstanceId}-value${rest}`;
          }
          return `_componentInstances.${currentInstanceId}.${uuid}${rest}`;
        }
        const mDot = pn.match(/^context\.component\.variables\.([A-Za-z0-9_-]+)(.*)$/);
        if (mDot) {
          const varKey = mDot[1];
          const rest = mDot[2] ?? '';
          if (_ctxControlledForDeps?.variable === varKey && currentInstanceId) {
            return `variables.${currentInstanceId}-value${rest}`;
          }
          return `_componentInstances.${currentInstanceId}.${varKey}${rest}`;
        }
        return p;
      })
    : formMappedDeps;

  const _ctxControlled = _ctxControlledForDeps;

  const _trackerDeps = (CHANGE_TEXT_TYPES.has(node.type as string) && node.id)
    ? [...deps, `${node.id}-value`]
    : deps;
  useVariablePaths(store, _trackerDeps, effectiveScope, mergedStore);
  // When inside an SC instance scope, replace the stale `context.component.variables` snapshot
  // on `effectiveScope` with a LIVE snapshot read from `_componentInstances.{instanceId}`.
  // This ensures children that re-render via `_componentInstances.*` subscriptions also see
  // the latest values when formulas/templates evaluate against `stateWithScope`.
  if (currentInstanceId && effectiveScope?.context) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const vsMod = require('@/lib/sdui/global-variable-store');
      let liveVars = vsMod.getComponentInstanceVars?.(currentInstanceId) ?? {};
      // Apply _controlled override: inject global value for the controlled variable key.
      if (_ctxControlled?.variable && currentInstanceId) {
        const globalVal = vsMod.getGlobalVariableStore().getState().data[`${currentInstanceId}-value`];
        liveVars = { ...liveVars, [_ctxControlled.variable]: globalVal };
      }
      const ctx = effectiveScope.context as Record<string, unknown>;
      const comp = ctx.component as Record<string, unknown> | undefined;
      if (comp && comp.variables !== liveVars) {
        effectiveScope = {
          ...effectiveScope,
          context: {
            ...ctx,
            component: { ...comp, variables: liveVars },
          },
        };
      }
    } catch { /* non-fatal */ }
  }
  const rawGet = createGet(store, merged, effectiveScope, mergedStore, screenName, screenScopedAliases);
  // Always resolve `context.component.variables['UUID']` paths from the live
  // `_componentInstances.{instanceId}` slot, NOT from the stale `context.component.variables`
  // snapshot that was placed on `scope` at the SC root render. Without this, nodes that
  // re-render due to `_componentInstances.*` subscription would still read the frozen snapshot
  // from their `scope` prop and display stale values (e.g. empty calendar grid).
  // If the variable is the _controlled key, redirect to the global store instead.
  const get: typeof rawGet = currentInstanceId
    ? (path: string, s?: Record<string, unknown>) => {
        if (typeof path === 'string' && path.includes('context.component.variables')) {
          const mBracket = path.match(/^context\.component\.variables\s*\[\s*['"]([^'"]+)['"]\s*\](.*)$/);
          if (mBracket) {
            const varKey = mBracket[1];
            const rest = mBracket[2] ?? '';
            // Controlled remap: redirect to global slot.
            if (_ctxControlled?.variable === varKey && currentInstanceId) {
              return rawGet(`variables.${currentInstanceId}-value${rest}`, s);
            }
            const redirected = `_componentInstances.${currentInstanceId}.${varKey}${rest}`;
            return rawGet(redirected, s);
          }
          const mDot = path.match(/^context\.component\.variables\.([A-Za-z0-9_-]+)(.*)$/);
          if (mDot) {
            const varKey = mDot[1];
            const rest = mDot[2] ?? '';
            // Controlled remap: redirect to global slot.
            if (_ctxControlled?.variable === varKey && currentInstanceId) {
              return rawGet(`variables.${currentInstanceId}-value${rest}`, s);
            }
            const redirected = `_componentInstances.${currentInstanceId}.${varKey}${rest}`;
            return rawGet(redirected, s);
          }
        }
        return rawGet(path, s);
      }
    : rawGet;
  const storeState = store.getState().getFullState();
  const state = merged ? { ...storeState, ...merged } : storeState;
  const stateBase = effectiveScope
    ? {
        ...state,
        // Legacy scope vars — kept for backward compat
        $item: effectiveScope.$item, $index: effectiveScope.$index, $parent: effectiveScope.$parent,
        // Pass through the already-structured context.item built by the map loop above,
        // so context.item.data / context.item.parent / context.item.index all resolve correctly.
        context: effectiveScope.context ?? { item: effectiveScope.$item, index: effectiveScope.$index, parent: effectiveScope.$parent },
        // Spread any additional custom scope keys (e.g. shared component context).
        ...Object.fromEntries(
          Object.entries(effectiveScope).filter(([k]) => !['$item', '$index', '$parent', 'context'].includes(k))
        ),
      }
    : state;

  // Inject per-FormContainer local scope: override state.local so that any formula
  // or template expression using local.data.form.* resolves against THIS container's
  // isolated store (variables[formKey]) rather than the shared singleton.
  //
  // Read DIRECTLY from the current global store (not from the rAF-batched mergedStore).
  // doSubmit() writes validation errors to the global store synchronously before calling
  // setFormState(), which triggers this render. Reading from mergedStore here would use
  // stale pre-error values because the rAF hasn't fired yet, causing the inside-card
  // error nodes to show nothing on the first submit click.
  const formStateForScope = activeFormKey
    ? (store.getState().getFullState()[activeFormKey] as Record<string, unknown> | undefined) ?? null
    : null;
  // Evaluate node.locals[] into the scope — render-body const declarations preserved
  // from <For>/{definePage with consts} are injected by name here so { js: "varName" }
  // bindings in child nodes resolve without any compiler rewriting.
  let stateWithLocals = formStateForScope
    ? { ...stateBase, local: { data: { form: formStateForScope } } }
    : stateBase;
  const _nodeLocals = (node as { locals?: Array<{ name: string; js: string }> }).locals;
  if (_nodeLocals && _nodeLocals.length > 0) {
    const localsScope: Record<string, unknown> = {};
    for (const local of _nodeLocals) {
      try {
        const result = evaluateFormula({ js: local.js }, stateWithLocals);
        localsScope[local.name] = result.value;
        // Make the evaluated value available for subsequent locals in this list
        stateWithLocals = { ...stateWithLocals, ...localsScope };
      } catch { /* non-fatal — local remains undefined */ }
    }
    stateWithLocals = { ...stateWithLocals, ...localsScope };
  }
  const stateWithScope = stateWithLocals;

  // Scoped getter: redirect local.data.form.* to the per-FC isolated store
  // so {{local.data.form.formData.x}} template interpolation also resolves correctly.
  const scopedGet = formStateForScope
    ? (path: string, s?: Record<string, unknown>) => {
        if (path === LOCAL_FORM) return formStateForScope;
        if (path.startsWith(LOCAL_FORM + '.')) return getNestedValue(formStateForScope, path.slice(LOCAL_FORM.length + 1));
        return get(path, s);
      }
    : get;

  // When inside a FormContainer, pre-set _activeFormKey before any action runs so
  // setFormStateHandler writes state to the correct per-container isolated store
  // (variables[formKey]) — not only to the shared local.data.form slot.
  const scopedRunAction: SDUIContext['runAction'] = activeFormKey
    ? (action, event, actionScope) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const vsm = require('@/lib/sdui/global-variable-store') as { getGlobalVariableStore: () => { getState: () => { setState: (fn: (prev: Record<string,unknown>) => Record<string,unknown>) => void } } };
        vsm.getGlobalVariableStore().getState().setState(prev => ({ ...prev, _activeFormKey: activeFormKey }));
        return runAction(action, event, actionScope);
      }
    : runAction;

  const sduiContext: SDUIContext = {
    state: stateWithScope,
    setState: (updater) => store.getState().setState(updater),
    get: scopedGet,
    runAction: scopedRunAction,
    fetchData,
  };

  // Form field registration: handles all controlled components generically.
  // See lib/sdui/form-field-tracker.ts for the full implementation.
  const formCtx = useContext(FormContext);
  const parentInputId = useParentInputId();
  useFormFieldRegistration(node, formCtx, parentInputId);

  // External value sync: subscribes to the node's variable-store slot and returns
  // controlled React props. Active for all controlled types including those inside
  // FormContainer so that workflow writes (changeVariableValue) update every type.
  const { value: externalValue, isChecked: externalIsChecked } = useExternalNodeValueSync(node, formCtx, parentInputId);
  // Sync external writes back into FormContainer state (local.data.form.formData.*)
  // so form submission and formulas always read the latest value.
  useExternalFormSync(node, formCtx, parentInputId, externalValue, externalIsChecked);

  // Lifecycle triggers: collect actions with trigger "created" or "mounted" and run
  // them once on mount via useEffect. Fires in both preview and builder mode so that
  // initializer workflows (state seeding, grid computation, etc.) populate the canvas
  // the same way they populate preview. Shared/system component lifecycles already
  // behave this way.
  const lifecycleRefs = useMemo(() => {
    if (!node?.actions || !Array.isArray(node.actions)) return null;
    const out: unknown[] = [];
    for (const item of node.actions as Array<unknown>) {
      if (!item || typeof item !== 'object') continue;
      const actionRef = item as Record<string, unknown>;
      // New format: inline action with trigger directly on the ref
      const inlineTrigger = typeof actionRef.trigger === 'string' ? actionRef.trigger : null;
      // Legacy format: { action: uuid } → look up trigger in actionsConfig
      const wfName = typeof actionRef.action === 'string' ? actionRef.action : '';
      const wfDef = wfName ? actionsConfig?.[wfName] as Record<string, unknown> | undefined : undefined;
      const trigger = inlineTrigger ?? (typeof wfDef?.trigger === 'string' ? wfDef.trigger : null);
      if (trigger === 'created' || trigger === 'mounted') out.push(item);
    }
    return out.length ? out : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.actions, actionsConfig]);

  const lifecycleRanRef = useRef(false);
  useEffect(() => {
    if (!lifecycleRefs || lifecycleRanRef.current) return;
    lifecycleRanRef.current = true;
    for (const a of lifecycleRefs) {
      Promise.resolve(runAction(a as Parameters<typeof runAction>[0], undefined, effectiveScope)).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-once: lifecycle triggers fire exactly once when the node mounts

  // reachEnd scroll listener — fires once per reach, resets when scrolled back up.
  // Collects all node actions with trigger === 'reachEnd', groups by scrollTarget,
  // and attaches the appropriate window or element scroll listener.
  const _reachEndNodeRef = useRef<Element | null>(null);
  const _reachEndActions = useMemo(() => {
    if (!node?.actions || !Array.isArray(node.actions)) return null;
    const out: Array<{ action: unknown; threshold: number; scrollTarget: 'window' | 'element' }> = [];
    for (const item of node.actions as Array<unknown>) {
      if (!item || typeof item !== 'object') continue;
      const actionRef = item as Record<string, unknown>;
      const trigger = typeof actionRef.trigger === 'string' ? actionRef.trigger : null;
      if (trigger !== 'reachEnd') continue;
      const cfg = actionRef.config as Record<string, unknown> | undefined;
      out.push({
        action: item,
        threshold: typeof cfg?.threshold === 'number' ? cfg.threshold : 100,
        scrollTarget: cfg?.scrollTarget === 'element' ? 'element' : 'window',
      });
    }
    return out.length ? out : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.actions]);

  const _reachEndRunRef = useRef(runAction);
  _reachEndRunRef.current = runAction;
  const _reachEndScopeRef = useRef(effectiveScope);
  _reachEndScopeRef.current = effectiveScope;

  useEffect(() => {
    if (!_reachEndActions) return;
    const windowActions = _reachEndActions.filter(a => a.scrollTarget !== 'element');
    const elementActions = _reachEndActions.filter(a => a.scrollTarget === 'element');
    const cleanups: Array<() => void> = [];

    if (windowActions.length > 0) {
      const windowFired = { current: false };
      const minThreshold = Math.min(...windowActions.map(a => a.threshold));
      const handleWindowScroll = () => {
        const remaining = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
        if (remaining <= minThreshold) {
          if (!windowFired.current) {
            windowFired.current = true;
            for (const a of windowActions) {
              Promise.resolve(_reachEndRunRef.current(a.action as Parameters<typeof runAction>[0], undefined, _reachEndScopeRef.current)).catch(() => {});
            }
          }
        } else {
          windowFired.current = false;
        }
      };
      window.addEventListener('scroll', handleWindowScroll, { passive: true });
      cleanups.push(() => window.removeEventListener('scroll', handleWindowScroll));
    }

    if (elementActions.length > 0) {
      const el = _reachEndNodeRef.current;
      if (el) {
        const elementFired = { current: false };
        const minThreshold = Math.min(...elementActions.map(a => a.threshold));
        const handleElementScroll = () => {
          const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
          if (remaining <= minThreshold) {
            if (!elementFired.current) {
              elementFired.current = true;
              for (const a of elementActions) {
                Promise.resolve(_reachEndRunRef.current(a.action as Parameters<typeof runAction>[0], undefined, _reachEndScopeRef.current)).catch(() => {});
              }
            }
          } else {
            elementFired.current = false;
          }
        };
        el.addEventListener('scroll', handleElementScroll, { passive: true });
        cleanups.push(() => el.removeEventListener('scroll', handleElementScroll));
      }
    }

    return () => { for (const c of cleanups) c(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_reachEndActions]);

  // Seed the global variable store for non-SC controlled nodes that have _initialValue.
  // Unlike Input/Textarea (which inject value/defaultValue into cleanProps), these nodes
  // (e.g. a plain Box controlled by a page variable) rely on formulas that read
  // variables['globalId'] — so the store must be seeded for those formulas to resolve.
  const _nonScControlledGlobalId = !_linkedKind && (node as { _controlled?: unknown })._controlled
    ? `${(node as { id?: string }).id ?? ''}-value`
    : null;
  const _nodeInitVal = (node as { _initialValue?: unknown })._initialValue;
  const _nodeInitValKey = _nodeInitVal != null && typeof _nodeInitVal === 'object'
    ? JSON.stringify(_nodeInitVal)
    : (_nodeInitVal as string | boolean | undefined);
  useEffect(() => {
    if (!_nonScControlledGlobalId || _nodeInitVal === undefined) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vs = require('@/lib/sdui/global-variable-store') as { getGlobalVariableStore: () => { getState: () => { data: Record<string, unknown>; set: (k: string, v: unknown) => void } } };
    const gStore = vs.getGlobalVariableStore().getState();
    let resolved: unknown;
    if (_nodeInitVal != null && typeof _nodeInitVal === 'object' && ('formula' in (_nodeInitVal as object) || 'js' in (_nodeInitVal as object))) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { evaluateFormula: ef } = require('@/lib/sdui/formula-evaluator') as { evaluateFormula: (f: object, ctx: Record<string, unknown>) => { value: unknown } };
        resolved = ef(_nodeInitVal as object, stateWithScope).value;
      } catch { resolved = undefined; }
    } else {
      resolved = _nodeInitVal;
    }
    if (resolved !== undefined && resolved !== gStore.data[_nonScControlledGlobalId]) {
      gStore.set(_nonScControlledGlobalId, resolved);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_nonScControlledGlobalId, _nodeInitValKey]); // re-seed when globalId or initVal changes

  // For controlled SC instances: the sync from internal variable → instanceId-value is driven
  // ONLY by _initialValue. If the user sets _initialValue to a formula that reads the SC's
  // internal variable (e.g. context.component.variables['sw-on']), that formula is evaluated
  // on every re-render and the result is written to instanceId-value.
  // useSyncExternalStore subscribes to the internal variable so this node re-renders when it
  // Subscribe to the raw per-instance slot (_componentInstances[instanceId][sw-on]).
  // This gives us the freshly-written internal value BEFORE any controlled-override
  // can inject the (stale) instanceId-value into liveVars — avoiding the circular dep.
  const _scInternalValue = useSyncExternalStore(
    (_instanceId && _scControlledVar)
      ? (cb) => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const gvs = require('@/lib/sdui/global-variable-store') as typeof import('@/lib/sdui/global-variable-store');
          return gvs.getGlobalVariableStore().subscribe(
            (state) => ((state.data as Record<string, unknown>)['_componentInstances'] as Record<string, Record<string, unknown>> | undefined)?.[_instanceId!]?.[_scControlledVar!],
            () => cb(),
          );
        }
      : NOOP_SUBSCRIBE_FN,
    () => {
      if (!_instanceId || !_scControlledVar) return undefined;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const gvs = require('@/lib/sdui/global-variable-store') as typeof import('@/lib/sdui/global-variable-store');
      return gvs.getComponentInstanceVar(_instanceId, _scControlledVar);
    },
    () => undefined,
  );
  // Write to instanceId-value ONLY when the user has set _initialValue on the instance.
  // _initialValue presence = user's explicit opt-in to sync. The raw per-instance value
  // is used (not the formula result) to avoid the controlled-override circular dependency.
  const _scHasInitVal = !!_nodeInitVal;
  useEffect(() => {
    if (!_scControlledPageKey || !_scHasInitVal || _scInternalValue === undefined) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vs = require('@/lib/sdui/global-variable-store') as { getGlobalVariableStore: () => { getState: () => { data: Record<string, unknown>; set: (k: string, v: unknown) => void } } };
    const gStore = vs.getGlobalVariableStore().getState();
    if (_scInternalValue !== gStore.data[_scControlledPageKey]) {
      gStore.set(_scControlledPageKey, _scInternalValue);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_scControlledPageKey, _scInternalValue, _scHasInitVal]);

  if (!node) return null;

  // In builder mode, _forceShowInEditor bypasses any condition so the node is
  // always visible on the canvas regardless of its runtime condition.
  const forceShow = builderMode && (node as { _forceShowInEditor?: boolean })._forceShowInEditor === true;

  if (!forceShow && !node.map) {
    // Cast to unknown first — condition can be false at runtime (builder sets it) even though
    // the ConditionValue type doesn't include boolean.
    if ((node.condition as unknown) === false) return null;
    if (node.condition != null && !evaluateCondition(node.condition, sduiContext)) {
      return null;
    }
  }

  if (node.map) {
    let arr: unknown[];
    if (typeof node.map === 'string') {
      const mapStr = node.map;
      arr = (get(mapStr) as unknown[]) ?? [];
    } else if (node.map && typeof node.map === 'object' && ('formula' in node.map || 'js' in node.map)) {
      const m = node.map as { formula?: string | object; js?: string; keyField?: string };
      const binding = 'js' in m ? { js: m.js! } : m.formula!;
      arr = (evaluateFormula(binding, stateWithScope).value as unknown[]) ?? [];
    } else {
      arr = [];
    }
    if (!Array.isArray(arr)) return null;

    // The outer repeat's context.item becomes the `parent` for nested repeats
    const outerItemCtx = (effectiveScope?.context as { item?: unknown } | undefined)?.item ?? null;

    return (
      <>
        {arr.map((item, index) => {
          // `data` = raw item fields + all repeat metadata under one key.
          // Canonical access: context.item?.['data']?.['productName'], context.item?.['data']?.['index'], etc.
          // Backward compat: raw item fields are also spread on context.item root so
          //   existing context.item?.['productName'] formulas still resolve.
          const dataCtx = {
            ...(typeof item === 'object' && item !== null ? (item as object) : {}),
            // For primitive items (string, number) expose the raw value under "value" so
            // {{context.item.data.value}} works for string-array repeats (e.g. feature lists).
            ...(typeof item !== 'object' || item === null ? { value: item } : {}),
            index,
            repeatIndex: index,
            isACopy: false,
            parent: outerItemCtx,
            repeatedItems: arr,
          };
          // For primitive items (string, number, boolean, null) set context.item.data to the
          // primitive itself so that text bindings (`context?.item?.data`) and strict-equality
          // checks (`context?.item?.data === '='`) both resolve correctly at runtime.
          // Index / parent are still reachable via context.item.index / context.item.parent.
          // For object items, data is the enriched dataCtx (fields + metadata).
          const itemData = typeof item !== 'object' || item === null ? item : dataCtx;
          const itemCtx = {
            ...(typeof item === 'object' && item !== null ? (item as object) : {}),
            data: itemData,
            // top-level aliases kept for backward compat
            parent: outerItemCtx,
            index,
            repeatIndex: index,
            isACopy: false,
            repeatedItems: arr,
          };
          const mapCfg = node.map ?? {};
          const mapKeyField = (typeof mapCfg === 'object' && 'keyField' in mapCfg)
            ? (mapCfg as { keyField?: string }).keyField
            : undefined;
          // map.as — the loop parameter name from <For each={...}>{(as) => ...}</For>
          const mapAs = (typeof mapCfg === 'object' && 'as' in mapCfg)
            ? (mapCfg as { as?: string }).as
            : undefined;
          const itemKey = mapKeyField && typeof item === 'object' && item !== null
            ? String((item as Record<string, unknown>)[mapKeyField] ?? index)
            : (node.key ? `${node.key}-${index}` : index);
          return (
            <SDURendererInner
              key={itemKey}
              node={{ ...node, map: undefined, key: String(itemKey) }}
              context={context}
              scope={{
                ...effectiveScope,
                $item: item,
                $index: index,
                $parent: effectiveScope?.$item,
                // Inject loop variable by the param name used in <For> render prop
                // so { js: "product.title" } resolves when as="product"
                ...(mapAs ? { [mapAs]: item } : {}),
                context: {
                  // Preserve outer context.component so {{context.component.props.*}} and
                  // context.component.variables['uuid'] subscriptions still resolve inside the map.
                  ...((effectiveScope?.context as Record<string, unknown> | undefined) ?? {}),
                  item: itemCtx,
                  index,
                  parent: outerItemCtx,
                },
              }}
              builderPath={`${builderPath}-m${index}`}
              builderMapIndex={index}
            />
          );
        })}
      </>
    );
  }

  const Component = getComponent(node.type);
  if (!Component) {
    if (!_warnedTypes.has(node.type)) {
      _warnedTypes.add(node.type);
      console.warn(`[SDUI] Unknown component type: ${node.type}`);
    }
    return null;
  }

  const className = node.className ?? node.props?.className;
  const resolvedProps = resolveProps(
    {
      ...node.props,
      ...(node.id && { id: node.id }),
      ...(className && { className }),
      ...(node.src && { src: node.src }),
      ...(node.alt && { alt: node.alt }),
    },
    sduiContext,
    runAction,
    effectiveScope
  );

  // If this node is a shared-component root, strip model properties from
  // cleanProps so they don't leak onto the DOM element (React warns about unknown
  // props like accentColor, minDate, etc.). The properties are still available to
  // children via `context.component.props.*`.
  const _scModelPropNames: Set<string> | null = (() => {
    if (!_linkedMeta || !_linkedKind) return null;
    const model = getLinkedComponentModel(_linkedKind, _linkedMeta.id) as
      | { properties?: Array<{ name: string }> }
      | undefined;
    return new Set((model?.properties ?? []).map(p => p.name));
  })();
  const cleanProps = Object.fromEntries(
    Object.entries(resolvedProps).filter(([k]) =>
      !k.startsWith('$')
      && k !== '_meta'
      && k !== 'animation'
      && k !== 'classFormulas'
      && !(_scModelPropNames && _scModelPropNames.has(k))
    )
  ) as Record<string, unknown>;

  for (const ck of _CONTROLLED_VALUE_KEYS) {
    if (ck in cleanProps && cleanProps[ck] === undefined) {
      const nodeProps = (node.props ?? {}) as Record<string, unknown>;
      if (ck in nodeProps && (ck === 'value' || ck === 'selectedValue')) {
        cleanProps[ck] = '';
      } else {
        delete cleanProps[ck];
      }
    }
  }

  // Apply each concern via named helpers — one function per responsibility.
  applyStateOverrides(node, cleanProps, previewState, builderMode);
  applyClassFormulas(node, cleanProps, sduiContext);
  applyAutofill(node, cleanProps, builderMode);

  // When this node is an SC root, merge the model's workflow definitions into a
  // local actionsConfig so that bindActionsToProps can resolve the correct trigger
  // type for SC-internal workflow IDs (e.g. "rg-wf-on-change" → trigger "valueChange").
  // Without this, any SC workflow not present in the screen-level actionsConfig would
  // fall back to the "click" default and bind to onClick instead of onValueChange etc.
  const _localActionsConfig: Record<string, unknown> = (_linkedKind && _linkedMeta)
    ? {
        ...actionsConfig,
        ...(getLinkedComponentModel(_linkedKind, _linkedMeta.id) as
          | { workflows?: Record<string, unknown> }
          | undefined)?.workflows,
      }
    : actionsConfig as Record<string, unknown>;
  Object.assign(cleanProps, bindActionsToProps(node.actions, scopedRunAction, _localActionsConfig, effectiveScope, node.type));
  applyFormContextBindings(node, cleanProps, formCtx, actionsConfig);
  trackFormFieldProps(node, cleanProps, formCtx, parentInputId);
  injectControlledProps(cleanProps, externalValue, externalIsChecked);

  // For Input/Textarea nodes with _initialValue: inject the resolved value so the
  // inner InputField starts with the correct text.
  // In builder mode: use controlled `value` directly — inputs are non-interactive on
  // the canvas so we can safely override with the freshly-evaluated init value on
  // every render. This makes formula init values and settings-panel changes reflect
  // immediately without any store reads/writes during render.
  // In preview mode: use uncontrolled `defaultValue` — the standard React pattern.
  const _initVal = (node as { _initialValue?: unknown })._initialValue;
  if (_initVal !== undefined && cleanProps.value == null && cleanProps.defaultValue == null) {
    // Evaluate formula bindings on _initialValue.
    const resolvedInitVal =
      _initVal != null && typeof _initVal === 'object' && ('formula' in (_initVal as object) || 'js' in (_initVal as object))
        ? evaluateFormula(_initVal as object, stateWithScope).value
        : _initVal;

    if (builderMode) {
      // In builder mode always inject as controlled `value` — including empty string —
      // so the canvas immediately reflects any change (set or clear) from the settings panel.
      cleanProps.value = resolvedInitVal ?? '';
    } else if (resolvedInitVal !== undefined && resolvedInitVal !== null && resolvedInitVal !== '') {
      cleanProps.defaultValue = resolvedInitVal;
    }
  }

  if ('onValueChange' in cleanProps && !_ACCEPTS_ON_VALUE_CHANGE.has(node.type as string)) {
    delete cleanProps.onValueChange;
  }

  // For Input/TextareaInput nodes: if node.text is a formula binding (set via set_text),
  // evaluate it and inject as cleanProps.value so the field is controlled and clears
  // correctly when the bound variable is reset (e.g. after send).
  if (CHANGE_TEXT_TYPES.has(node.type as string) && node.text != null && cleanProps.value == null) {
    const _nodeText = node.text;
    const resolvedInputText =
      typeof _nodeText === 'object' && _nodeText !== null &&
      ('formula' in (_nodeText as object) || 'js' in (_nodeText as object))
        ? evaluateFormula(_nodeText as object, stateWithScope).value
        : (typeof _nodeText === 'string' ? _nodeText : undefined);
    if (resolvedInputText != null) {
      cleanProps.value = resolvedInputText;
    }
  }

  // Input/TextareaInput: inject the {nodeId}-value tracker slot as the controlled value
  // when the slot has been written (undefined = never touched → leave uncontrolled so
  // the user can start typing; '' or any string = controlled for programmatic clearing).
  if (CHANGE_TEXT_TYPES.has(node.type as string) && node.id && cleanProps.value == null) {
    const _trackerVal = get(`${node.id}-value`);
    if (_trackerVal !== undefined) {
      cleanProps.value = _trackerVal as string;
    }
  }

  // Pass the SDUI node ID to FormContainer so it can sync to variables['{id}-form'].
  // When the node has no explicit id (e.g. screen JSON loaded from config), pass an empty
  // string so FormContainer falls back to its own stable internal ID (see FormContainer.tsx).
  if ((node.type as string) === 'FormContainer') {
    cleanProps._formNodeId = node.id ?? '';
  }

  if ((node.type as string) === 'CheckboxGroup' && !cleanProps['aria-label'] && !cleanProps['aria-labelledby']) {
    cleanProps['aria-label'] = 'checkbox group';
  }

  if ('pointerEvents' in cleanProps) {
    const pe = cleanProps.pointerEvents;
    delete cleanProps.pointerEvents;
    if (pe && typeof pe === 'string') {
      cleanProps.style = { ...(cleanProps.style as Record<string, unknown> ?? {}), pointerEvents: pe };
    }
  }

  // In builder mode every node must remain selectable regardless of its runtime
  // pointer-events value (e.g. disabled buttons get pointerEvents:'none' which
  // would prevent the builder's click-to-select from working).
  if (builderMode) {
    const _s = cleanProps.style as Record<string, unknown> | undefined;
    if (_s?.pointerEvents === 'none') {
      cleanProps.style = { ..._s, pointerEvents: 'auto' };
    }
  }

  // Detect animation config early so we can choose between:
  // - single-element animated path (no overlay siblings)
  // - wrapped AnimatedNode path (overlay/pseudo features need siblings)
  const animCfgForIdCheck = (node.props as Record<string, unknown>)?.animation
    ?? (node as unknown as Record<string, unknown>).animation;
  const animCfgObj = (animCfgForIdCheck && typeof animCfgForIdCheck === 'object')
    ? (animCfgForIdCheck as AnimationConfig)
    : undefined;
  const hasOverlayFeature = !!(animCfgObj && (
    animCfgObj.shimmer ||
    animCfgObj.particles ||
    animCfgObj.noise ||
    animCfgObj.pseudoElement?.enabled ||
    animCfgObj.splitText ||
    animCfgObj.flip ||
    animCfgObj.gradientAnimation?.enabled
  ));
  // Single-element path: animate the component directly via createAnimatedComponent
  // instead of wrapping in an extra Animated.View. This eliminates the outer wrapper
  // and the OUTER_PASSTHROUGH forwarding of width/height/position.
  // Web host components (Box, Text, etc.) flatten style arrays via flattenStyle()
  // so createAnimatedComponent can pass style arrays through without crashing the DOM.
  // Disabled in builder mode — the wrapped path is needed for selection/resize targeting.
  // Disabled for Image nodes: NextImage renders to <img> which cannot receive RN array
  // transforms (Reanimated's worklet tries element.style[0]=... → CSSStyleDeclaration
  // throws "indexed property setter is not supported"). Use the Animated.View wrapper
  // path instead — it properly converts transforms to CSS before the img ever sees them.
  // Disabled for Icon nodes: IconifyIcon also renders to <img>, same failure mode.
  // Disabled when the node has a static transform in node.props.style (translateX, translateY,
  // or a CSS transform string like "rotate(-8deg)"):
  // In the singleEl path, Reanimated applies the transform via useAnimatedStyle to an
  // AnimatedComponent(Box) which goes through NativeWind's cssInterop. The cssInterop
  // pipeline does not reliably compose Reanimated's animated transforms with static CSS
  // transform strings — centering shifts are dropped and static rotations may be overridden.
  // The outer Animated.View wrapper path bypasses NativeWind on the wrapper itself, so
  // static transforms (both pixel and percentage) apply correctly in all modes.
  const _rawNodeStyle = (node.props as Record<string, unknown> | undefined)?.style as Record<string, unknown> | undefined;
  const _nodeClassName = (node.props as Record<string, unknown> | undefined)?.className as string | undefined ?? '';
  const _hasStaticStyleTransform = !!(
    _rawNodeStyle?.translateX !== undefined ||
    _rawNodeStyle?.translateY !== undefined ||
    (typeof _rawNodeStyle?.transform === 'string' && (_rawNodeStyle.transform as string).trim().length > 0) ||
    /(?:^|(?<=\s))(?:translate-[xy]-\[|rotate-\[|-rotate-\[)/.test(_nodeClassName)
  );
  const useSingleElementPath = !!(animCfgObj && !hasOverlayFeature && !builderMode && node.type !== 'Image' && node.type !== 'Icon' && !_hasStaticStyleTransform && !(animCfgObj as { gesture?: { dragFeedback?: boolean } }).gesture?.dragFeedback);
  // In builder mode, wrapped animated nodes own their own data-builder-id (set on the
  // outer Animated.View in AnimatedNode). Single-element nodes keep normal annotation.
  const animNodeOwnsId = !!(builderMode && node.id && animCfgObj && !useSingleElementPath);
  if (!animNodeOwnsId) {
    applyBuilderAnnotation(node, cleanProps, builderMode, builderMapIndex);
  }

  const textContent = node.text != null ? resolveText(node.text, sduiContext, effectiveScope) : undefined;

  // When the node has a popover config, separate PopoverContent children from
  // regular children. PopoverContent is rendered by PopoverHost, not inline.
  // When an SC node has no inline children, use the model's content so that
  // JSON-authored _shared references (e.g. navbar/footer in page ui) render
  // without needing the content pre-expanded into node.children.
  const _scInlineChildren: SDUINode[] | undefined = (() => {
    if (_linkedMeta && _linkedKind && !node.children?.length) {
      const _scM = getLinkedComponentModel(_linkedKind, _linkedMeta.id) as
        | { content?: SDUINode }
        | undefined;
      if (_scM?.content) return [_scM.content];
    }
    return undefined;
  })();
  const _effectiveChildren = (_scInlineChildren ?? node.children) as SDUINode[] | undefined;

  let _popoverContentNode: SDUINode | undefined;
  const renderableNodeChildren = node.popover && _effectiveChildren?.length
    ? (_effectiveChildren).filter(c => {
        if ((c as SDUINode)._popoverContent) { _popoverContentNode = c; return false; }
        return true;
      })
    : _effectiveChildren;

  let children: React.ReactNode = null;
  if (renderableNodeChildren?.length) {
    const _seenKeys = new Set<string>();
    const childElements = renderableNodeChildren.map((child, i) => {
      if (child == null) return null;
      const childKey = child.key;
      const isScopeVar = childKey === '$index' || childKey === '$item';
      let key = child.id ?? (childKey && !isScopeVar ? childKey : `child-${i}`);
      if (_seenKeys.has(key)) key = `${key}-${i}`;
      _seenKeys.add(key);
      return <SDURendererInner key={key} node={child} context={context} scope={effectiveScope} builderPath={`${builderPath}-${i}`} builderMapIndex={builderMapIndex} />;
    });
    // Provide parent Input ID to descendant InputField nodes so they can write to
    // variables['{inputId}-value'] on change (formula live-binding).
    // Uses PARENT_CONTEXT_PROVIDER_TYPES from registry — no hardcoded 'Input' string.
    children = PARENT_CONTEXT_PROVIDER_TYPES.has(node.type as string) && node.id
      ? <InputParentContext.Provider value={node.id}>{childElements}</InputParentContext.Provider>
      : childElements;
  } else if (textContent !== undefined && !CHANGE_TEXT_TYPES.has(node.type as string)) {
    // Input/TextareaInput: node.text is injected as cleanProps.value above, not as children.
    children = textContent;
  }

  // Inject ref for element-scroll reachEnd so the scroll listener can attach to the DOM node.
  if (_reachEndActions?.some(a => a.scrollTarget === 'element')) {
    cleanProps.ref = _reachEndNodeRef;
  }

  // Guard: strip onPress from any component that is NOT a press-type.
  // This prevents React from logging "Unknown event handler property `onPress`" when
  // onPress accidentally ends up in cleanProps (e.g. from node.props JSON or any other path).
  if (!PRESS_ONLY_TYPES.has(node.type as string)) {
    delete cleanProps.onPress;
  }

  // Guard: strip onChangeText from non-input components.
  // action-binding sets onChangeText for every "change" trigger regardless of component type.
  // Box/div (and other layout components) don't support it, causing React's
  // "Unknown event handler property `onChangeText`" warning on every render.
  if (!CHANGE_TEXT_TYPES.has(node.type as string)) {
    delete cleanProps.onChangeText;
  }

  // If style.icon is a resolved string (from a formula binding on the icon name),
  // promote it to props.icon so the IconifyIcon component receives the dynamic name.
  // resolveProps evaluates { formula: "..." } objects recursively, so style.icon will
  // already be a plain string by the time we reach here.
  const resolvedStyleIcon = (cleanProps.style as Record<string, unknown> | undefined)?.icon;
  if (typeof resolvedStyleIcon === 'string' && resolvedStyleIcon) {
    cleanProps.icon = resolvedStyleIcon;
    // Remove icon from the style object — it is not a valid CSS property.
    const styleObj = { ...(cleanProps.style as Record<string, unknown>) };
    delete styleObj.icon;
    cleanProps.style = styleObj;
  }

  // If style.color is a resolved hex/rgb string (from a formula or direct style binding),
  // also inject it as !text-[color] into className so NativeWind's cssInterop on Heading/Text
  // components honours it — Gluestack's headingStyle base includes text-typography-900 which
  // can win over a plain inline style when cssInterop converts className to style internally.
  // The !important prefix ensures the injected class beats the typography token.
  // classToInlineStyle below then converts it back to inline style as a fallback for
  // arbitrary values that NativeWind JIT doesn't compile from JSON config.
  const resolvedStyleColor = (cleanProps.style as Record<string, unknown> | undefined)?.color;
  if (typeof resolvedStyleColor === 'string' && resolvedStyleColor) {
    const existing = (cleanProps.className as string | undefined) ?? '';
    // Strip only existing text-COLOR arbitrary classes (hex / CSS color functions) to avoid
    // duplicates. Must NOT strip text-SIZE classes like text-[20px] or text-[1.5rem].
    // Colors start with # or a CSS function name (rgb, rgba, hsl, hsla, var).
    const stripped = existing.replace(/\s*!?text-\[(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|var\([^)]+\))\]/g, '').trim();
    cleanProps.className = `${stripped} !text-[${resolvedStyleColor}]`.trim();
  }

  // Capture resolved node.props.style BEFORE arbStyles merge — used later for the outer
  // Animated.View wrapper. node.props.style may contain raw formula objects ({ formula: "..." })
  // that resolveProps has already evaluated into cleanProps.style. Reading node.props.style
  // directly would leak unresolved formula objects into the DOM as [object Object] strings.
  const resolvedNodeStyle = (cleanProps.style as Record<string, unknown> | undefined)
    ? { ...(cleanProps.style as Record<string, unknown>) }
    : {};

  // Apply inline style fallback for arbitrary-value classes (e.g. w-[1228px], pt-[120px]).
  // Tailwind JIT only compiles classes from scanned source files, not from JSON config —
  // so arbitrary values from the SDUI config need an inline style equivalent to render correctly.
  // props.style wins over the extracted values (e.g. transform stays intact).
  const arbStylesRaw = classToInlineStyle(cleanProps.className as string | undefined);
  const consumedTokens = arbStylesRaw._consumed;
  delete arbStylesRaw._consumed;
  const arbStyles = arbStylesRaw as Record<string, string>;

  // Derive React Native shadow fields from box-shadow class token so RN renderers
  // work without storing redundant fields in props.style.
  if (arbStyles.boxShadow) {
    const _bs = arbStyles.boxShadow;
    const _bsm = _bs.match(/^(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(-?[\d.]+)px\s+(.+)$/);
    if (_bsm) {
      const _blur = parseFloat(_bsm[3]);
      const _arbS = arbStyles as Record<string, unknown>;
      _arbS.shadowColor   = _bsm[5].trim();
      _arbS.shadowOffset  = { width: parseFloat(_bsm[1]), height: parseFloat(_bsm[2]) };
      _arbS.shadowRadius  = _blur;
      _arbS.shadowOpacity = 1;
      _arbS.elevation     = Math.max(0, Math.round(_blur / 2));
    }
  }
  if (consumedTokens && consumedTokens.size > 0 && typeof cleanProps.className === 'string') {
    cleanProps.className = tokenizeClassName(cleanProps.className).filter(t => !consumedTokens.has(t)).join(' ');
  }
  // Detect animation config early. When the node is animated AND absolutely/fixed positioned,
  // the outer Animated.View wrapper owns position/insets — stripping them from the inner
  // element prevents doubled offsets (inner positioned relative to outer which is itself
  // already positioned at the same coordinates).
  const _hasAnim = !!animCfgObj;
  if (Object.keys(arbStyles).length > 0) {
    if (useSingleElementPath) {
      // Single-element path: keep all resolved arbStyles on the same element.
      cleanProps.style = { ...arbStyles, ...(cleanProps.style as Record<string, unknown> ?? {}) };
    } else {
      const isOffflow = _hasAnim && (arbStyles.position === 'absolute' || arbStyles.position === 'fixed');
      if (isOffflow) {
        // Outer Animated.View owns position/insets — inner element stays in normal flow.
        const { position: _p, top: _t, right: _r, bottom: _b, left: _l, zIndex: _z, ...contentStyles } = arbStyles;
        // In builder mode with animNodeOwnsId, the outer Animated.View also owns the pixel
        // size (outerStyle carries width/height). Replace fixed dimensions on the inner
        // element with 100% so it fills the wrapper during live resize drag.
        // In isOffflow, the outer Animated.View wrapper owns all sizing/positioning.
        // The inner element must fill the wrapper with 100% width/height so percentage
        // or pixel sizes on the inner don't compound (e.g. w-[45%] inside a 45%-wide
        // outer wrapper would make the image only 20% of the grandparent).
        // Preserve only intrinsic sizing keywords ('fit-content', 'auto', etc.) because
        // those must stay on the inner element to control the outer wrapper's size via
        // content feedback.
        const INTRINSIC_KW = ['fit-content', 'max-content', 'min-content', 'auto'];
        if (animNodeOwnsId) {
          const _cs = contentStyles as Record<string, unknown>;
          if ('width'  in _cs && !INTRINSIC_KW.includes(String(_cs.width)))  _cs.width  = '100%';
          if ('height' in _cs && !INTRINSIC_KW.includes(String(_cs.height))) _cs.height = '100%';
        }
        cleanProps.style = { ...contentStyles, ...(cleanProps.style as Record<string, unknown> ?? {}) };
        // Strip position-keyword and inset/z arbitrary-value classes from className so
        // NativeWind does not re-apply them on the inner element. The outer Animated.View
        // already owns position/insets via outerStyle — leaving them on className causes
        // the inner element to be double-offset relative to the outer wrapper, pushing
        // absolutely-positioned content completely outside its clipping boundary (blank box).
        if (cleanProps.className) {
          cleanProps.className = (cleanProps.className as string)
            .split(/\s+/)
            .filter(tok => !['absolute', 'fixed', 'sticky', 'relative', 'static', 'inset-0', 'inset-x-0', 'inset-y-0'].includes(tok))
            .filter(tok => !/^!?(?:top|right|bottom|left|z|inset(?:-[xy])?)-\[/.test(tok))
            .join(' ')
            .trim();
        }
        // Remove transform/translateX/translateY from the inner element — the outer wrapper
        // already receives them via staticTransform (Reanimated worklet) and _nodePropsStyleForOuter.
        // Keeping them on the inner element causes double-offset in builder mode where
        // NativeWind's cssInterop compiles translateX/Y into a CSS transform on the inner div.
        if (cleanProps.style) {
          const _s = cleanProps.style as Record<string, unknown>;
          delete _s.transform;
          delete _s.translateX;
          delete _s.translateY;
        }
        // The inner element lost its absolute positioning (stripped above), so it's now in normal
        // flow inside the outer Animated.View wrapper. Force it to fill the outer wrapper.
        // Same intrinsic-keyword preservation as above — don't override 'fit-content' etc.
        {
          const _s = cleanProps.style as Record<string, unknown> ?? {};
          if (!INTRINSIC_KW.includes(String(_s.width  ?? ''))) _s.width  = '100%';
          if (!INTRINSIC_KW.includes(String(_s.height ?? ''))) _s.height = '100%';
          cleanProps.style = _s;
        }
      } else {
        // Same logic for non-offflow animated nodes that have explicit width/height.
        const innerStyles: Record<string, unknown> = { ...(arbStyles as Record<string, unknown>) };
        if (animNodeOwnsId) {
          // Replace width/height with '100%' so the inner element fills the outer Animated.View
          // wrapper during live resize drag and in normal rendering.
          // The outer wrapper already carries the correct size (from OUTER_PASSTHROUGH / sizeOverride).
          // Covers both:
          //   - Pixel values stored as numbers (e.g. 480 from w-[480px] via set_size)
          //   - String percentages (e.g. '45%' from w-[45%]) — typeof check excluded these before,
          //     causing the inner to be 45% of the outer (which is already 45% of grandparent = ~20%)
          // Only intrinsic-sizing keywords ('fit-content', 'auto', 'max-content', 'min-content')
          // are preserved because they describe content-driven sizing that must stay on the inner.
          const INTRINSIC_KW_INNER = ['fit-content', 'max-content', 'min-content', 'auto'];
          if ('width'  in innerStyles && !INTRINSIC_KW_INNER.includes(String(innerStyles.width  ?? ''))) innerStyles.width  = '100%';
          if ('height' in innerStyles && !INTRINSIC_KW_INNER.includes(String(innerStyles.height ?? ''))) innerStyles.height = '100%';
          // Strip position/inset/zIndex — these belong on the outer Animated.View wrapper
          // (forwarded via sizeOverride/OUTER_PASSTHROUGH). Keeping them on the inner
          // repositions it INSIDE the outer, e.g. top:50% of a 500px outer = 250px from the
          // top, combined with right:60px the inner is shifted outside the outer's bounds —
          // exactly the "image outside the card" bug for absolute+float animated containers.
          for (const k of ['position', 'top', 'right', 'bottom', 'left', 'zIndex'] as const) {
            delete innerStyles[k];
          }
          // Strip size constraints (maxWidth, minWidth, maxHeight, minHeight) — the outer wrapper
          // already owns them (forwarded via sizeOverride). Keeping them on the inner creates a
          // double constraint: the percentage resolves against the outer wrapper (the containing
          // block), not the page — e.g. outer max-width:70% of parent + inner max-width:70% of
          // outer = 49% of parent. Also breaks width:fit-content on the outer wrapper.
          delete innerStyles.maxWidth;
          delete innerStyles.minWidth;
          delete innerStyles.maxHeight;
          delete innerStyles.minHeight;
        }
        cleanProps.style = { ...innerStyles, ...(cleanProps.style as Record<string, unknown> ?? {}) };
      }
    }
  }

  // Compose translateX / translateY / transform (rotation-only) into a single CSS transform.
  // translateX and translateY are stored as separate style keys (either as plain strings like
  // "20px" or formula-evaluated values). This keeps rotation and translate independent so
  // editing one never overwrites the other.
  {
    const sStyle = cleanProps.style as Record<string, unknown> | undefined;
    if (sStyle) {
      const txRaw = sStyle.translateX;
      const tyRaw = sStyle.translateY;
      if (txRaw !== undefined || tyRaw !== undefined) {
        // Normalise a translate value to a CSS px string: 20 → "20px", "20px" → "20px", "" → ""
        // Also handles FormulaValue objects { formula: "-50%" } written by older set_transform calls.
        const toPx = (v: unknown): string => {
          if (v === undefined || v === null || v === '') return '';
          if (typeof v === 'object' && v !== null && 'formula' in v) {
            return toPx((v as { formula: unknown }).formula);
          }
          if (typeof v === 'number') return `${v}px`;
          const s = String(v).trim();
          if (!s) return '';
          if (/^-?[\d.]+$/.test(s)) return `${s}px`;
          return s;
        };
        const txStr = toPx(txRaw);
        const tyStr = toPx(tyRaw);
        const rotStr = (sStyle.transform as string | undefined) ?? '';
        const parts = [
          txStr ? `translateX(${txStr})` : '',
          tyStr ? `translateY(${tyStr})` : '',
          rotStr,
        ].filter(Boolean);
        sStyle.transform = parts.join(' ') || undefined;
        delete sStyle.translateX;
        delete sStyle.translateY;
      }
    }
  }

  // Pre-apply animated-node inner-element fixes BEFORE createElement so changes make it
  // into the React element. React.createElement produces an immutable element — any
  // mutation to cleanProps after this line is too late.
  {
    const _rawAnimCfg = (node.props as Record<string, unknown> | undefined)?.animation
      ?? (node as unknown as Record<string, unknown>).animation;
    // _willOwn is true in two cases:
    // 1. Builder mode — outer Animated.View owns the selection/resize target.
    // 2. Percentage static transform in any mode — forced wrapper path so the outer
    //    Animated.View (no NativeWind cssInterop) applies translateX/Y(-50%) reliably.
    //    In both cases the inner element must have its position/inset classes stripped so
    //    they don't double-position relative to the wrapper (position is forwarded to outerStyle).
    const _willOwn = !!((builderMode && node.id && _rawAnimCfg && !useSingleElementPath) ||
                        (_hasStaticStyleTransform && _rawAnimCfg));

    if (_rawAnimCfg && !useSingleElementPath) {
      // Strip margin-* from the inner element when any animation is present.
      // Margins on the inner element create a transparent gap between it and the outer
      // Animated.View wrapper (the margin space is inside the outer wrapper but has no
      // background). The margins are forwarded to the outer wrapper's outerStyle via the
      // sizeOverride block below so spacing in the parent layout is unchanged.
      // Also strip the corresponding arbitrary-value Tailwind tokens from className so
      // NativeWind's compiled CSS doesn't re-apply them on the inner element.
      const MARGIN_KEYS = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft',
        'margin', 'marginHorizontal', 'marginVertical'] as const;
      if (cleanProps.style) {
        const s = cleanProps.style as Record<string, unknown>;
        for (const k of MARGIN_KEYS) delete s[k];
      }
      if (cleanProps.className) {
        cleanProps.className = (cleanProps.className as string)
          .split(/\s+/)
          .filter(tok => !/^!?m[trblxy]?-\[/.test(tok))
          .join(' ')
          .trim();
      }
    }
    if (_willOwn) {
      // Strip position/inset/zIndex Tailwind tokens from the inner className so
      // NativeWind's compiled CSS doesn't re-apply them after they were removed from
      // innerStyles above. These belong on the outer Animated.View wrapper only.
      if (cleanProps.className) {
        cleanProps.className = (cleanProps.className as string)
          .split(/\s+/)
          .filter(tok =>
            !/^!?(?:absolute|relative|fixed|sticky|static)$/.test(tok) &&
            !/^!?(?:top|right|bottom|left|inset)(?:-[xy])?-\[/.test(tok) &&
            !/^!?z-\[/.test(tok)
          )
          .join(' ')
          .trim();
      }
      // Strip transform/translateX/translateY from the inner element. These are forwarded
      // to the outer Animated.View via staticTransform (Reanimated worklet). Keeping any
      // of them on the inner element causes double-offset — in builder mode NativeWind's
      // cssInterop compiles translateX/Y into CSS transform on the inner div, causing
      // content to shift (e.g. -50% of 900px = -450px) relative to the outer wrapper.
      if (cleanProps.style) {
        const _innerTransStyle = cleanProps.style as Record<string, unknown>;
        delete _innerTransStyle.transform;
        delete _innerTransStyle.translateX;
        delete _innerTransStyle.translateY;
      }
      // Strip paint-only visual properties from the inner element.
      // These are already forwarded to the outer Animated.View via outerStyle (from
      // _outerBase/animNodeOwnsId). Keeping them on both elements doubles the visual effect:
      // e.g. boxShadow renders twice (inner shadow bleeds through overflow:visible outer),
      // and backgroundColor stacks to a higher opacity than intended.
      // In preview mode (single-element path), there is only ONE element so no doubling occurs.
      if (cleanProps.style) {
        const _innerS = cleanProps.style as Record<string, unknown>;
        for (const _pk of [
          'backgroundColor', 'background', 'backgroundImage',
          'boxShadow',
          'shadowColor', 'shadowOffset', 'shadowRadius', 'shadowOpacity', 'elevation',
          'borderColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
          'borderWidth', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
          'borderStyle',
          'outline', 'outlineColor', 'outlineWidth', 'outlineOffset', 'outlineStyle',
        ]) {
          delete _innerS[_pk];
        }
      }
    }

    // flexGrow:1 on the inner element fills the outer wrapper when it is stretched by its
    // flex parent (align-items:stretch in a flex-row). Without it, the inner stays at
    // natural content-height while the outer grows, showing a transparent gap in builder.
    // Use flexGrow:1 (NOT flex:1) — flex:1 sets flex-basis:0% which collapses the item's
    // intrinsic size to 0 before growing, making buttons appear much taller. flexGrow:1
    // with flex-basis:auto only grows when the outer wrapper has extra space to fill.
    // Only needed in builder mode (animNodeOwnsId=true) since Reanimated's Animated.View
    // on web lacks RNW's default align-self:flex-start and can stretch unexpectedly.
    //
    // Skip when maxWidth is present: the outer wrapper gets width:fit-content so it shrinks
    // to content, but flexGrow:1 on the inner element would grow to fill the parent anyway,
    // making maxWidth act as a fixed width rather than an upper bound.
    const _outerHasMaxW = arbStyles.maxWidth !== undefined;
    if (_willOwn && !(cleanProps.style as Record<string, unknown>)?.height && !_outerHasMaxW) {
      cleanProps.style = {
        flexGrow: 1,
        ...((cleanProps.style as Record<string, unknown>) ?? {}),
      };
    }
  }

  const element = useSingleElementPath
    ? null
    : React.createElement(Component, { ...cleanProps, key: node.key }, children);

  // Wrap with AnimatedNode when the node has an animation config.
  // Support both node.props.animation (canonical) and node.animation (top-level alias).
  const animCfg = (node.props as Record<string, unknown> | undefined)?.animation
    ?? (node as unknown as Record<string, unknown>).animation;
  if (animCfg && typeof animCfg === 'object') {
    // $index is the top-level map iteration index set on effectiveScope (effectiveScope.$index = index).
    // repeatIndex lives inside effectiveScope.context.item, not at effectiveScope root — use $index.
    const staggerIndex =
      typeof (effectiveScope as { $index?: number } | undefined)?.$index === 'number'
        ? (effectiveScope as { $index: number }).$index
        : typeof (effectiveScope as { repeatIndex?: number } | undefined)?.repeatIndex === 'number'
          ? (effectiveScope as { repeatIndex: number }).repeatIndex
          : 0;
    // Resolve any formula-value objects in animation config numeric fields.
    // The builder stores { formula: "variables['UUID']" } when a field is bound.
    // Evaluate them here so AnimatedNode always receives plain numbers.
    const resolveAnimNum = (v: unknown, fallback: number): number => {
      if (v == null) return fallback;
      if (typeof v === 'object' && v !== null && 'formula' in v) {
        const r = evaluateFormula((v as { formula: string }).formula, stateWithScope);
        return Number(r.value ?? fallback);
      }
      return typeof v === 'number' ? v : fallback;
    };

    // Resolve imperativeTrigger.watchVar — it's a formula expression like "variables['UUID']"
    // that must be evaluated (not just path-looked-up) against the current state so
    // AnimatedNode can watch its resolved value and re-play the animation when it changes.
    let resolvedAnimCfg = animCfg as AnimationConfig;

    // Resolve formula-bound numeric fields in each animation sub-config.
    const _rawCfg = animCfg as AnimationConfig;
    if (_rawCfg.enter) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        enter: {
          ...(_rawCfg.enter),
          duration:  resolveAnimNum(_rawCfg.enter.duration,  400),
          delay:     resolveAnimNum(_rawCfg.enter.delay,     0),
          stagger:   resolveAnimNum(_rawCfg.enter.stagger,   0),
        },
      };
    }
    if (_rawCfg.exit) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        exit: {
          ...(_rawCfg.exit),
          duration: resolveAnimNum(_rawCfg.exit.duration, 300),
        },
      };
    }
    if (_rawCfg.loop) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        loop: {
          ...(_rawCfg.loop),
          duration:    resolveAnimNum(_rawCfg.loop.duration,    1000),
          delay:       resolveAnimNum(_rawCfg.loop.delay,       0),
          repeatCount: resolveAnimNum(_rawCfg.loop.repeatCount, -1),
        },
      };
    }
    if (_rawCfg.hover) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        hover: {
          ...(_rawCfg.hover),
          scale:    resolveAnimNum(_rawCfg.hover.scale,    1.05),
          opacity:  resolveAnimNum(_rawCfg.hover.opacity,  1),
          y:        resolveAnimNum(_rawCfg.hover.y,        -4),
          duration: resolveAnimNum(_rawCfg.hover.duration, 200),
        },
      };
    }
    if (_rawCfg.press) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        press: {
          ...(_rawCfg.press),
          scale:    resolveAnimNum(_rawCfg.press.scale,    0.95),
          opacity:  resolveAnimNum(_rawCfg.press.opacity,  1),
          duration: resolveAnimNum(_rawCfg.press.duration, 120),
        },
      };
    }
    if (_rawCfg.parallax) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        parallax: {
          ...(_rawCfg.parallax),
          speed: resolveAnimNum(_rawCfg.parallax.speed, 0.4),
          clamp: resolveAnimNum(_rawCfg.parallax.clamp, 120),
        },
      };
    }
    if (_rawCfg.scroll) {
      // Auto-enable scroll when type is set but enabled is not explicitly specified.
      // Avoids requiring the user to always add enabled:true when type already implies intent.
      const scrollEnabled = _rawCfg.scroll.enabled ?? (!!_rawCfg.scroll.type && _rawCfg.scroll.type !== 'none');
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        scroll: {
          ...(_rawCfg.scroll),
          enabled: scrollEnabled,
          duration: resolveAnimNum(_rawCfg.scroll.duration, 500),
        },
      };
    }
    if (_rawCfg.tilt) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        tilt: {
          ...(_rawCfg.tilt),
          maxX:        resolveAnimNum(_rawCfg.tilt.maxX,        15),
          maxY:        resolveAnimNum(_rawCfg.tilt.maxY,        15),
          perspective: resolveAnimNum(_rawCfg.tilt.perspective, 800),
          scale:       resolveAnimNum(_rawCfg.tilt.scale,       1.03),
          duration:    resolveAnimNum(_rawCfg.tilt.duration,    200),
        },
      };
    }
    if (_rawCfg.imperativeTrigger) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        imperativeTrigger: {
          ...(_rawCfg.imperativeTrigger),
          duration: resolveAnimNum(_rawCfg.imperativeTrigger.duration, 400),
        },
      };
    }
    if (_rawCfg.filter) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        filter: {
          ...(_rawCfg.filter),
          blur:         resolveAnimNum(_rawCfg.filter.blur,         0) || undefined,
          backdropBlur: resolveAnimNum(_rawCfg.filter.backdropBlur, 0) || undefined,
        },
      };
    }
    // Resolve formula objects inside outerStyle (e.g. backgroundImage: { formula: "..." })
    if (_rawCfg.outerStyle) {
      const outerSt = _rawCfg.outerStyle as Record<string, unknown>;
      const bgImg = outerSt.backgroundImage;
      if (bgImg != null && typeof bgImg === 'object' && 'formula' in bgImg) {
        const resolved = evaluateFormula((bgImg as { formula: string }).formula, stateWithScope);
        resolvedAnimCfg = {
          ...resolvedAnimCfg,
          outerStyle: {
            ...outerSt,
            backgroundImage: typeof resolved.value === 'string' ? resolved.value : '',
          },
        };
      }
    }

    const itCfg = resolvedAnimCfg.imperativeTrigger;
    if (itCfg && typeof itCfg.watchVar === 'string') {
      const resolvedVal = evaluateFormula(itCfg.watchVar, stateWithScope).value;
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        imperativeTrigger: { ...itCfg, watchVar: resolvedVal },
      };
    }
    // Resolve states.watchVar so AnimatedNode receives the current state name
    const smCfg = resolvedAnimCfg.states;
    if (smCfg && typeof smCfg.watchVar === 'string') {
      const resolvedState = evaluateFormula(smCfg.watchVar, stateWithScope).value;
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        states: { ...smCfg, watchVar: String(resolvedState ?? '') },
      };
    }
    // Auto-inject node.text into splitText.text and node className into splitText.className
    // when the node uses animation.splitText but has no explicit values set.
    // This lets the Text/Heading node own the content and styling in the builder while
    // AnimatedNode uses those values when rendering the split spans in live mode.
    const stCfg = resolvedAnimCfg.splitText;
    const nodeClassName = resolvedProps?.className as string | undefined;
    if (stCfg && textContent != null) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        splitText: {
          ...stCfg,
          ...(!stCfg.text ? { text: String(textContent) } : {}),
          ...(!stCfg.className && nodeClassName ? { className: nodeClassName } : {}),
        },
      };
    }
    if (useSingleElementPath) {
      return (
        <AnimatedNode
          key={node.key}
          animation={resolvedAnimCfg}
          staggerIndex={staggerIndex}
          nodeId={node.id}
          nodeType={node.type as string | undefined}
          builderMode={builderMode}
          nodeMapIndex={builderMapIndex}
          componentType={Component as React.ComponentType<Record<string, unknown>>}
          componentProps={{ ...cleanProps }}
          componentChildren={children}
          children={null}
          actionScope={effectiveScope as Record<string, unknown>}
        />
      );
    }

    // In builder mode the Animated.View is the selectable/resizable target:
    // (1) Always clear data-builder-id from inner element — AnimatedNode sets it on the
    //     Animated.View directly so patchStyle and canvas resize hit the right element.
    // (2) Forward any inline style to outerStyle so patchProp changes survive re-renders.
    // (3) Keep outerClassName forwarding only for paint-replacing animations (gradient/shimmer)
    //     so regular enter-animation boxes don't have their className moved off the inner Box.
    if (!resolvedAnimCfg.outerClassName && nodeClassName &&
        (resolvedAnimCfg.gradientAnimation?.enabled || resolvedAnimCfg.color || resolvedAnimCfg.shimmer)) {
      resolvedAnimCfg = { ...resolvedAnimCfg, outerClassName: nodeClassName };
    }
    // animNodeOwnsId is already true here (same condition) — data-builder-id was never
    // added to cleanProps as a prop (applyBuilderAnnotation was skipped), so nothing to
    // delete. Forward any inline style to outerStyle so patchProp commits survive re-renders.
    if (animNodeOwnsId) {
      // Only forward size/positioning/radius/zIndex to the outer selection wrapper.
      // Padding, margin, color, fontSize, borderWidth/Color must stay on the inner element —
      // moving them to outerStyle doubles the spacing (inner has padding from CSS classes,
      // outer would add padding again), causing builder to show elements taller/wider than preview.
      const OUTER_PASSTHROUGH = new Set([
        'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
        'top', 'right', 'bottom', 'left',
        'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
        'borderBottomRightRadius', 'borderBottomLeftRadius',
        'zIndex',
        // Paint-only visual properties: must be on the outer Animated.View (the selection
        // target in builder mode) so they're visible. They're stripped from the inner element
        // below (lines 924-937) to avoid double-rendering. OUTER_PASSTHROUGH ensures they
        // arrive on the outer before being removed from the inner.
        'backgroundColor', 'background', 'backgroundImage',
        'boxShadow',
      ]);
      // Only OUTER_PASSTHROUGH keys from arbStyles go to the outer wrapper.
      const outerFromArb: Record<string, unknown> = {};
      for (const key of OUTER_PASSTHROUGH) {
        if (key in arbStyles) outerFromArb[key] = (arbStyles as Record<string, unknown>)[key];
      }
      // resolvedNodeStyle contains the evaluated version of node.props.style (formulas resolved).
      // Using this instead of raw node.props.style prevents formula objects from leaking into
      // the DOM as [object Object] strings on the outer Animated.View wrapper.
      const nodePropsStyle = resolvedNodeStyle;
      const styleForOuter: Record<string, unknown> = { ...outerFromArb, ...nodePropsStyle };
      // `transform`, `translateX`, `translateY` must NOT go into outerStyle — Reanimated's worklet
      // overrides element.style.transform after every animation frame. All three are forwarded via
      // resolvedAnimCfg.staticTransform and composed inside the worklet so they persist.
      // This handles both rotation ("rotate(3deg)") and percentage centering ("translateX(-50%)").
      delete styleForOuter.transform;
      delete styleForOuter.translateX;
      delete styleForOuter.translateY;
      // Position forwarding is handled universally by the sizeOverride block below (all modes).
      // This block only needs OUTER_PASSTHROUGH keys + nodePropsStyle for builder selection.
      // MERGE into the existing outerStyle (don't overwrite) so animation.outerStyle values
      // like backgroundImage (used by gradientDrift) are preserved alongside the builder's
      // size/position overrides from arbStyles.
      if (Object.keys(styleForOuter).length > 0) {
        const existingOuterStyle = (resolvedAnimCfg.outerStyle as Record<string, unknown>) ?? {};
        resolvedAnimCfg = { ...resolvedAnimCfg, outerStyle: { ...existingOuterStyle, ...styleForOuter } };
      }
      // Do NOT delete cleanProps.style — the inner element needs its arbStyles inline styles
      // so non-JIT-compiled arbitrary classes (from JSON nodes) still render correctly.
      // Note: width/height are replaced with 100% earlier (before createElement) so the
      // inner fills the outer Animated.View during live resize drag in builder mode.
      // flexGrow:1 is pre-applied to cleanProps.style BEFORE createElement (see above) so
      // the inner element fills the outer wrapper when it is stretched by a flex parent.
    }
    // Forward size-critical classes from the inner node to the outer wrapper.
    // React Native Web's base View style includes align-self: flex-start, which causes
    // the outer Animated.View/View wrapper to collapse to content-width/height when it
    // is a flex item. The inner node's w-full/flex-1 are percentages of the wrapper,
    // not the grandparent — so the wrapper itself must also carry the sizing.
    // Note: explicit outerStyle properties take precedence (spread after sizeOverride).
    if (nodeClassName) {
      const sizeOverride: Record<string, unknown> = {};
      if (/\bw-full\b/.test(nodeClassName)) {
        sizeOverride.width = '100%';
        sizeOverride.flexShrink = 1; // RNW Animated.View defaults flex-shrink:0; restore CSS default
      }
      if (/\bflex-1\b/.test(nodeClassName)) sizeOverride.flex = 1;
      if (/\bmin-w-0\b/.test(nodeClassName)) sizeOverride.minWidth = 0;
      // Override RNW's align-self:flex-start base style on Animated.View/View wrappers.
      // Without this, every animated wrapper ignores its flex parent's align-items (center,
      // stretch, etc.) — e.g. items-center on the parent has no effect on animated children
      // because each child's outer Animated.View is anchored to the flex-start (left) edge.
      // Setting alignSelf:'auto' restores the CSS default: "inherit from parent align-items".
      //
      // Also restore CSS's default flex-shrink:1. RNW Animated.View hard-codes flex-shrink:0,
      // but NativeWind's Box (via cssInterop on web) inherits the CSS default flex-shrink:1.
      // Without this, animated wrappers in a flex-row never shrink — cards sit at their
      // max-content width (full unbroken quote text) while preview cards correctly shrink
      // to fit the container (down to min-width). Setting flexShrink:1 restores CSS default.
      //
      // Only applies to in-flow elements — absolutely/fixed positioned wrappers are out of
      // flow and don't participate in flex main-axis sizing.
      // sizeOverride is spread UNDER resolvedAnimCfg.outerStyle, so any explicit values
      // in animation.outerStyle in the JSON config override these defaults.
      if (!arbStyles.position || (arbStyles.position !== 'absolute' && arbStyles.position !== 'fixed')) {
        sizeOverride.alignSelf = 'auto';
        // Don't override flexShrink already set (e.g. from the w-full branch above, which
        // also sets flexShrink:1). Also respect shrink-0 in className if forwarded.
        if (!sizeOverride.flexShrink && !(/\bshrink-0\b/.test(nodeClassName))) {
          sizeOverride.flexShrink = 1;
        }
      }
      // Mirror border-radius onto the outer wrapper (Animated.View / plain View).
      // Two reasons: (1) In builder mode (animNodeOwnsId=true) this ensures patchStyle({
      // borderRadius }) on the outer wrapper has visible effect for the selection ring.
      // (2) In all modes, React Native Web's View/Animated.View applies overflow:hidden by
      // default. Without a matching borderRadius on the outer wrapper, it clips the inner
      // element's rounded background to a square — making the border-radius look like 0 in
      // preview even though the inner className has rounded-[Npx].
      const globalRounded = nodeClassName.match(/\brounded-\[(\d+(?:\.\d+)?)px\]/);
      if (globalRounded) {
        sizeOverride.borderRadius = `${globalRounded[1]}px`;
      } else {
        const cornerAbbrs = [
          ['tl', 'borderTopLeftRadius'],
          ['tr', 'borderTopRightRadius'],
          ['br', 'borderBottomRightRadius'],
          ['bl', 'borderBottomLeftRadius'],
        ] as const;
        for (const [abbr, cssKey] of cornerAbbrs) {
          const m = nodeClassName.match(new RegExp(`\\brounded-${abbr}-\\[(\\d+(?:\\.\\d+)?)px\\]`));
          if (m) sizeOverride[cssKey] = `${m[1]}px`;
        }
      }
      // Forward position keyword + insets to the outer wrapper in ALL modes.
      // classToInlineStyle only handles arbitrary [N] classes — bare keywords like
      // `absolute`, `fixed`, `sticky` are never extracted. Without forwarding them
      // to outerStyle, the outer Animated.View is left in normal flow while the
      // inner element's position applies relative to the wrong ancestor. This caused
      // absolutely-positioned animated cards to stack in normal flow in preview mode
      // even though the builder showed them correctly (builder had a separate code path).
      const POSITION_KEYWORDS: Record<string, string> = {
        absolute: 'absolute', relative: 'relative',
        fixed: 'fixed', sticky: 'sticky', static: 'static',
      };
      for (const tok of nodeClassName.split(/\s+/)) {
        if (POSITION_KEYWORDS[tok]) {
          sizeOverride.position = POSITION_KEYWORDS[tok];
          // For abs/fixed: also forward width/height so the outer Animated.View is correctly
          // sized. Without explicit dimensions a 0×0 wrapper makes glowPulse box-shadow render
          // as a tiny dot and collapses hover/click areas.
          if (POSITION_KEYWORDS[tok] === 'absolute' || POSITION_KEYWORDS[tok] === 'fixed') {
            const aw = (arbStyles as Record<string, unknown>).width;
            const ah = (arbStyles as Record<string, unknown>).height;
            if (aw !== undefined) sizeOverride.width = aw;
            if (ah !== undefined) sizeOverride.height = ah;
          }
          break;
        }
      }
      // Forward insets, zIndex, explicit size constraints, AND margins from arbitrary classes to
      // the outer Animated.View wrapper. Without this, the outer wrapper has neither compiled CSS
      // nor inline style for these properties, so sizing collapses and margins are lost.
      // Margins must be forwarded here because the pre-check block above stripped them from the
      // inner element's style/className — the spacing in the parent layout is only preserved if
      // the outer wrapper carries the margin instead.
      // Also forward borderRadius variants so box-shadow on the outer wrapper follows the node's
      // rounded corners. Without this the shadow is rectangular while the inner content is rounded,
      // creating a visible corner artifact in both preview and builder modes.
      for (const key of ['top', 'right', 'bottom', 'left', 'zIndex', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'margin', 'marginHorizontal', 'marginVertical', 'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius', 'borderStyle', 'borderColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'gridColumn', 'gridRow'] as const) {
        if ((arbStyles as Record<string, unknown>)[key] !== undefined) {
          sizeOverride[key] = (arbStyles as Record<string, unknown>)[key];
        }
      }
      // Forward resolved node.props.style (e.g. opacity from set_opacity) to the outer wrapper
      // for ALL modes so visual properties apply to the Animated.View and its box-shadow effects.
      // Example: glowPulse on an opacity:0.15 blob should pulse at 15% opacity, not 100%.
      // In builder mode, resolvedAnimCfg.outerStyle (from animNodeOwnsId) already contains
      // nodePropsStyle and spreads LAST, so builder values always take precedence.
      // Uses resolvedNodeStyle (formulas already evaluated) instead of raw node.props.style to
      // prevent formula objects leaking as [object Object] into the outer Animated.View DOM.
      const _nodePropsStyleForOuter = resolvedNodeStyle;
      const _outerBase = { ...sizeOverride, ..._nodePropsStyleForOuter };
      // `transform`, `translateX`, `translateY` must not be in outerStyle — Reanimated's worklet
      // overrides element.style.transform after every animation frame. All three are forwarded
      // via staticTransform and composed inside the worklet so they persist after animation.
      delete _outerBase.transform;
      delete _outerBase.translateX;
      delete _outerBase.translateY;
      // Build staticTransform from node.props.style transforms so the Reanimated worklet can
      // compose them with animated transforms (enter, hover, press, loop).
      // Handles:
      //   - translateX/Y percentage centering: translateX("-50%") translateY("-50%")
      //     → allows centering an absolute element while keeping enter animation correct.
      //   - CSS transform strings: "rotate(3deg)" "scale(1.1)" etc.
      // All are forwarded as a single CSS string. parseCssTransform() in animated-node.tsx
      // converts each function to an RN transform object, keeping percentages as strings
      // (web-only: Reanimated converts the array to CSS, preserving the % unit).
      const _nodeStyleRaw = resolvedNodeStyle as Record<string, unknown>;
      const _staticTx = _nodeStyleRaw.transform;
      const _staticTxX = _nodeStyleRaw.translateX;
      const _staticTxY = _nodeStyleRaw.translateY;
      const _staticParts: string[] = [];
      if (_staticTxX !== undefined) _staticParts.push(`translateX(${String(_staticTxX)})`);
      if (_staticTxY !== undefined) _staticParts.push(`translateY(${String(_staticTxY)})`);
      if (_staticTx && typeof _staticTx === 'string' && _staticTx.trim()) _staticParts.push(_staticTx.trim());
      const _allStatic = _staticParts.length > 0 ? _staticParts.join(' ') : undefined;
      if (_allStatic) {
        resolvedAnimCfg = { ...resolvedAnimCfg, staticTransform: _allStatic };
      }
      if (Object.keys(_outerBase).length > 0) {
        resolvedAnimCfg = {
          ...resolvedAnimCfg,
          outerStyle: { ..._outerBase, ...(resolvedAnimCfg.outerStyle as object ?? {}) },
        };
      }
    }
    return (
      <AnimatedNode
        key={node.key}
        animation={resolvedAnimCfg}
        staggerIndex={staggerIndex}
        nodeId={node.id}
        nodeType={node.type as string | undefined}
        builderMode={builderMode}
        nodeMapIndex={builderMapIndex}
        actionScope={effectiveScope as Record<string, unknown>}
      >
        {element}
      </AnimatedNode>
    );
  }

  // Wrap non-interactive elements that have click handlers in a transparent div.
  const wrapped = wrapWithClickHandler(element, cleanProps, node.type as string, builderMode);
  if (wrapped !== element) return wrapped;

  if (node.dataSource) {
    return (
      <DataSourceWrapper dataSource={node.dataSource} fetchData={fetchData}>
        {element}
      </DataSourceWrapper>
    );
  }

  // Disabled overlay — when props.disabled is truthy wrap with a relative container
  // and an absolutely positioned tinted/blurred overlay div.
  const disabledElement = renderWithDisabledOverlay(element, node, resolvedProps, builderMode);
  if (disabledElement) return disabledElement;

  // ── Popover host ────────────────────────────────────────────────────────────
  const popCfg = node.popover;
  if (popCfg && _popoverContentNode) {
    const pcNode = _popoverContentNode;
    // Use effectiveScope (which carries context.component.* when inside a
    // shared-component instance) so the popover content also resolves
    // context.component.props / variables correctly.
    const renderOverlayContent = () =>
      <SDURendererInner key={(pcNode as { id?: string }).id || 'popover-content'} node={pcNode} context={context} scope={effectiveScope} />;

    // Determine whether the popover's openVariable is a scoped component
    // variable. When yes AND we have an enclosing instanceId, the popover
    // open state must be stored per-instance so sibling instances don't
    // all open together when only one trigger is clicked.
    let popInstanceId: string | undefined;
    let popOpenVarIsScoped = false;
    if (popCfg.openVariable && effectiveScope?.context) {
      const compCtx = (effectiveScope.context as Record<string, unknown>).component as Record<string, unknown> | undefined;
      const instanceId = compCtx?.instanceId as string | undefined;
      const modelRef = compCtx?.model as { variables?: Record<string, unknown> } | null | undefined;
      if (instanceId && modelRef?.variables && popCfg.openVariable in modelRef.variables) {
        popInstanceId = instanceId;
        popOpenVarIsScoped = true;
      }
    }

    return (
      <PopoverHostLazy
        popoverConfig={popCfg}
        nodeId={node.id}
        trigger={element}
        renderPopoverContent={renderOverlayContent}
        builderMode={builderMode}
        instanceId={popInstanceId}
        openVariableIsComponentScoped={popOpenVarIsScoped}
      />
    );
  }

  return element;
});

export function SDURenderer({ node, context }: Omit<RendererProps, 'scope'>) {
  return <SDURendererInner node={node} context={context} />;
}

/** Scoped renderer — like SDURenderer but accepts an initial scope (e.g. shared component props). */
export function SDURendererScoped({ node, context, scope }: RendererProps) {
  return <SDURendererInner node={node} context={context} scope={scope} />;
}

export type { RendererContext };
