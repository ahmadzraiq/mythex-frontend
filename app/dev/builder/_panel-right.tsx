'use client';

/**
 * Module-level registry so the canvas resize handler can flush any pending
 * patchStyle dimension update before committing the drag result. Without this,
 * a patchStyle debounce timer (e.g. from a unit-toggle) can fire after onUp
 * and overwrite the resized className.
 */
let _cancelPendingDimensionFlush: (() => void) | null = null;
/** Called by the canvas resize handler before capturing existingCls. */
export function cancelPendingDimensionFlush() {
  if (_cancelPendingDimensionFlush) _cancelPendingDimensionFlush();
}

/**
 * Builder Right Panel — Design | Props | JSON tabs
 *
 * Design tab sections (in render order):
 *   1.  Position & Size     — X/Y (DOM read-only), W/H (inline style.width/height + minWidth/minHeight:0)
 *   2.  Dimensions          — W/H mode: Hug (w-fit/h-fit) | Fill (w-full/flex-1) | Screen (w-screen/h-screen) | Fixed (px/vh/vw)
 *   3.  Self Alignment      — self-auto/start/center/end/stretch/baseline (positioning within parent flex)
 *   4.  Transform           — Rotation (inline style.transform), Flip H/V (-scale-x/y-100 class)
 *   5.  Alignment           — 9-cell grid → items-* + justify-* (containers only)
 *   6.  Auto Layout         — flex dir, wrap, gap (inline style.gap), space-between (containers only)
 *   7.  Padding             — Exact px via inline style.paddingLeft/Right/Top/Bottom (not Tailwind scale)
 *   8.  Margin              — Exact px via inline style.marginLeft/Right/Top/Bottom (not Tailwind scale)
 *   9.  Typography          — size/weight/leading/tracking selects, text-align icons, decoration/transform,
 *                             inline style.color (text/heading/ButtonText nodes only)
 *   10. Display & Interaction — display class + cursor-* class
 *   11. Clip content        — overflow-hidden toggle
 *   12. Fill & Opacity      — inline style.backgroundColor + bg-opacity + style.opacity (merged)
 *   13. Stroke              — inline style.borderColor, border-* width/style classes
 *   14. Border Radius       — 4-corner selects; equal → global token, mixed → per-corner tokens
 *   15. Effects             — shadow-* class
 *   16. Animation           — AnimationInDesign component (collapsible category groups)
 *   17. Selection colors    — extracted hex swatches from className
 *   18. Layout Guide        — grid overlay toggle
 *
 * Props tab:  raw key-value editor for node.props
 * JSON tab:   read-only JSON of the selected node
 *
 * IMPORTANT PATTERNS:
 *   - Colors, rotation, opacity, padding, margin, gap → always patchStyle() not patchCls()
 *   - Button bg: only set action='custom' when className contains bg-* (hasBg check in button/index.tsx)
 *   - Auto Layout / Alignment hidden for non-containers (Button/Input/etc) to prevent layout corruption
 */

import React, { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { json as cmJson } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
const CodeMirror = lazy(() => import('@uiw/react-codemirror'));
import {
  PANEL_STYLE, SECTION_STYLE, LABEL_STYLE,
  SectionHeader, NumberInput, SelectInput, ColorInput, ToggleBtn, MiniPreview,
} from './_panel-primitives';
import { SettingsTab, AlignDistributePanel } from './_panel-right-settings';
import { PreviewDataEditor, ElementWorkflowsTab } from './_panel-right-workflows';
import { AnimationInDesign } from './_animation-panel';
import { SpacingDiagram, CornerRadiusDiagram, InsetDiagram, PanelInput } from './_spatial-controls';
import { useBuilderStore, findParentNode } from './_store';
import { useShallow } from 'zustand/react/shallow';
import type { BuilderStore } from './_store-types';
import { findNode } from './_store-node-helpers';
import { updatePopup as updatePopupData } from '@/lib/builder/popup-data';
import { usePopupStore } from '@/lib/sdui/popup-store';
import { getSharedComponents, updateSharedComponent as updateSCData } from '@/lib/builder/shared-component-data';
import type { SharedComponentModel } from '@/lib/builder/shared-component-data';
import { WorkflowBindButton, toHumanName } from './_workflow-canvas'; // used only for unbound slot picker
import { ThemePanel } from './_theme-panel';
import { AiChatPanel } from './_ai-chat-panel';
import { PathPicker } from './_path-picker';
import { ExprBuilder } from './_expr-builder';
import { FieldWithBinding, BindingIcon, isBoundValue, type FormulaValue, closeAllEditors, registerEditorClose } from './_formula-panel';
import { FormulaEditor } from './_formula-editor';
import { evaluateFormula } from '@/lib/sdui/formula-evaluator';
import { useSduiStore } from '@/store/sdui-store';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';
import { THEME_OBJ } from '@/lib/sdui/engine-static-data';
import type { SDUINode, BreakpointKey } from '@/lib/sdui/types/node';
import { FigmaColorPicker } from './_color-picker';
import {
  STYLE_TO_CLASS_KEYS,
  parseTwToken,
  parseTwArbitrary,
  parseTwArbitraryPx,
  parseTwArbitraryNum,
  parseTwArbitraryWithUnit,
  replaceTwToken,
  removeTwToken,
  styleToClassName,
  FONT_WEIGHT_TOKENS,
  LEADING_TOKENS,
  TRACKING_TOKENS,
  BORDER_STYLE_TOKENS,
  ROTATE_TOKENS,
  TEXT_ALIGN_TOKENS,
  TEXT_DECORATION_TOKENS,
  TEXT_TRANSFORM_TOKENS,
  POSITION_TOKENS,
  CURSOR_TOKENS,
  GRID_COLS_TOKENS,
  GRID_ROWS_TOKENS,
  expandPadding,
  applyPadding,
  expandMargin,
  applyMargin,
  applyAlignment,
  getAlignCellIndex,
  pxToTw,
  extractColors,
  parseRoundedNamedTokenPx,
} from './_tw-utils';

// ─── Module-level constants ───────────────────────────────────────────────────

/**
 * CSS dimension keys: when a formula evaluates to a bare number (e.g. 200),
 * auto-append "px" so the value is valid CSS.
 * opacity, zIndex, flex-grow etc. are intentionally excluded.
 */
const DIMENSION_CSS_KEYS = new Set([
  'width','height','minWidth','maxWidth','minHeight','maxHeight',
  'top','right','bottom','left',
  'paddingTop','paddingRight','paddingBottom','paddingLeft',
  'marginTop','marginRight','marginBottom','marginLeft',
  'gap','rowGap','columnGap',
  'borderRadius',
  'borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius',
  'borderWidth','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
  'fontSize','lineHeight','letterSpacing','wordSpacing','outlineWidth',
]);

// ─── Tailwind token → CSS property mapping (for responsive class-diff routing) ──

const TW_TOKEN_MAP: Record<string, { prop: string; value: string }> = {
  'flex-row':       { prop: 'flexDirection', value: 'row' },
  'flex-col':       { prop: 'flexDirection', value: 'column' },
  'flex-wrap':      { prop: 'flexWrap', value: 'wrap' },
  'flex-nowrap':    { prop: 'flexWrap', value: 'nowrap' },
  'flex-1':         { prop: 'flex', value: '1 1 0%' },
  'justify-start':  { prop: 'justifyContent', value: 'flex-start' },
  'justify-end':    { prop: 'justifyContent', value: 'flex-end' },
  'justify-center': { prop: 'justifyContent', value: 'center' },
  'justify-between':{ prop: 'justifyContent', value: 'space-between' },
  'justify-around': { prop: 'justifyContent', value: 'space-around' },
  'justify-evenly': { prop: 'justifyContent', value: 'space-evenly' },
  'items-start':    { prop: 'alignItems', value: 'flex-start' },
  'items-end':      { prop: 'alignItems', value: 'flex-end' },
  'items-center':   { prop: 'alignItems', value: 'center' },
  'items-stretch':  { prop: 'alignItems', value: 'stretch' },
  'items-baseline': { prop: 'alignItems', value: 'baseline' },
  'self-auto':      { prop: 'alignSelf', value: 'auto' },
  'self-start':     { prop: 'alignSelf', value: 'flex-start' },
  'self-end':       { prop: 'alignSelf', value: 'flex-end' },
  'self-center':    { prop: 'alignSelf', value: 'center' },
  'self-stretch':   { prop: 'alignSelf', value: 'stretch' },
  'self-baseline':  { prop: 'alignSelf', value: 'baseline' },
  'text-left':      { prop: 'textAlign', value: 'left' },
  'text-center':    { prop: 'textAlign', value: 'center' },
  'text-right':     { prop: 'textAlign', value: 'right' },
  'text-justify':   { prop: 'textAlign', value: 'justify' },
  'underline':      { prop: 'textDecoration', value: 'underline' },
  'line-through':   { prop: 'textDecoration', value: 'line-through' },
  'no-underline':   { prop: 'textDecoration', value: 'none' },
  'uppercase':      { prop: 'textTransform', value: 'uppercase' },
  'lowercase':      { prop: 'textTransform', value: 'lowercase' },
  'capitalize':     { prop: 'textTransform', value: 'capitalize' },
  'normal-case':    { prop: 'textTransform', value: 'none' },
  'truncate':       { prop: 'textOverflow', value: 'ellipsis' },
  'overflow-hidden':{ prop: 'overflow', value: 'hidden' },
  'overflow-auto':  { prop: 'overflow', value: 'auto' },
  'overflow-scroll':{ prop: 'overflow', value: 'scroll' },
  'overflow-visible':{ prop: 'overflow', value: 'visible' },
  'overflow-x-auto':{ prop: 'overflowX', value: 'auto' },
  'overflow-y-auto':{ prop: 'overflowY', value: 'auto' },
  'hidden':         { prop: 'display', value: 'none' },
  'block':          { prop: 'display', value: 'block' },
  'inline':         { prop: 'display', value: 'inline' },
  'inline-block':   { prop: 'display', value: 'inline-block' },
  'relative':       { prop: 'position', value: 'relative' },
  'absolute':       { prop: 'position', value: 'absolute' },
  'fixed':          { prop: 'position', value: 'fixed' },
  'sticky':         { prop: 'position', value: 'sticky' },
  'static':         { prop: 'position', value: 'static' },
  'w-full':         { prop: 'width', value: '100%' },
  'w-fit':          { prop: 'width', value: 'fit-content' },
  'w-screen':       { prop: 'width', value: '100vw' },
  'h-full':         { prop: 'height', value: '100%' },
  'h-fit':          { prop: 'height', value: 'fit-content' },
  'h-screen':       { prop: 'height', value: '100vh' },
  'cursor-pointer': { prop: 'cursor', value: 'pointer' },
  'cursor-default': { prop: 'cursor', value: 'default' },
  'cursor-not-allowed': { prop: 'cursor', value: 'not-allowed' },
  'border-solid':   { prop: 'borderStyle', value: 'solid' },
  'border-dashed':  { prop: 'borderStyle', value: 'dashed' },
  'border-dotted':  { prop: 'borderStyle', value: 'dotted' },
  'border-none':    { prop: 'borderStyle', value: 'none' },
};

const TW_FONT_WEIGHT_MAP: Record<string, string> = {
  'font-thin': '100', 'font-extralight': '200', 'font-light': '300',
  'font-normal': '400', 'font-medium': '500', 'font-semibold': '600',
  'font-bold': '700', 'font-extrabold': '800', 'font-black': '900',
};

const TW_LEADING_MAP: Record<string, string> = {
  'leading-none': '1', 'leading-tight': '1.25', 'leading-snug': '1.375',
  'leading-normal': '1.5', 'leading-relaxed': '1.625', 'leading-loose': '2',
};

const TW_TRACKING_MAP: Record<string, string> = {
  'tracking-tighter': '-0.05em', 'tracking-tight': '-0.025em', 'tracking-normal': '0em',
  'tracking-wide': '0.025em', 'tracking-wider': '0.05em', 'tracking-widest': '0.1em',
};

function twTokenToCss(token: string): { prop: string; value: string } | null {
  if (TW_TOKEN_MAP[token]) return TW_TOKEN_MAP[token];
  if (TW_FONT_WEIGHT_MAP[token]) return { prop: 'fontWeight', value: TW_FONT_WEIGHT_MAP[token] };
  if (TW_LEADING_MAP[token]) return { prop: 'lineHeight', value: TW_LEADING_MAP[token] };
  if (TW_TRACKING_MAP[token]) return { prop: 'letterSpacing', value: TW_TRACKING_MAP[token] };
  const leadingN = token.match(/^leading-(\d+)$/);
  if (leadingN) return { prop: 'lineHeight', value: `${parseInt(leadingN[1]) * 0.25}rem` };
  const gridColsM = token.match(/^grid-cols-(\d+)$/);
  if (gridColsM) return { prop: 'gridTemplateColumns', value: `repeat(${gridColsM[1]}, minmax(0, 1fr))` };
  const gridRowsM = token.match(/^grid-rows-(\d+)$/);
  if (gridRowsM) return { prop: 'gridTemplateRows', value: `repeat(${gridRowsM[1]}, minmax(0, 1fr))` };
  return null;
}

// ─── Responsive Override Detection ────────────────────────────────────────────

type ActiveBreakpoint = 'desktop' | BreakpointKey;
const BP_ORDER = ['laptop', 'tablet', 'mobile'] as const;

const SECTION_CSS_PROPS: Record<string, readonly string[]> = {
  'dimensions':       ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'flex'],
  'position-size':    ['top', 'right', 'bottom', 'left', 'position', 'zIndex'],
  'auto-layout':      ['flexDirection', 'flexWrap', 'gap', 'columnGap', 'rowGap',
                       'justifyContent', 'alignItems', 'gridTemplateColumns', 'gridTemplateRows'],
  'spacing':          ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
                       'marginTop', 'marginRight', 'marginBottom', 'marginLeft'],
  'typography':       ['fontSize', 'fontWeight', 'textAlign', 'textDecoration', 'textTransform',
                       'textOverflow', 'color'],
  'fill-opacity':     ['backgroundColor', 'opacity'],
  'stroke':           ['borderColor', 'borderWidth', 'borderStyle'],
  'border-radius':    ['borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
                       'borderBottomRightRadius', 'borderBottomLeftRadius'],
  'display':          ['display', 'overflow', 'cursor'],
  'self-alignment':   ['alignSelf'],
};


// ─── Effects Section (Shadow, Blur, Backdrop Blur) ────────────────────────────

/** Parse "Xpx Ypx Bpx Spx #color" → components, returns null when no shadow. */
function parseBoxShadow(s: string): { x: number; y: number; blur: number; spread: number; color: string } | null {
  if (!s) return null;
  const m = s.match(/^(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(-?[\d.]+)px\s+(.+)$/);
  if (!m) return null;
  return { x: parseFloat(m[1]), y: parseFloat(m[2]), blur: parseFloat(m[3]), spread: parseFloat(m[4]), color: m[5].trim() };
}

// ─── Gradient direction options ──────────────────────────────────────────────
const GRADIENT_DIRS = [
  { value: 'to right',        label: '→' },
  { value: 'to bottom',       label: '↓' },
  { value: 'to bottom right', label: '↘' },
  { value: 'to top right',    label: '↗' },
  { value: 'to left',         label: '←' },
  { value: 'to top',          label: '↑' },
] as const;

function parseGradientDir(bg: string): string {
  const m = bg.match(/linear-gradient\(([^,]+),/);
  return m ? m[1].trim() : 'to right';
}

// ─── FillBackgroundSection — Solid / Gradient / Image ─────────────────────────

function FillBackgroundSection({ nodeId, node, store, commitHistory, computedBgColor, patchColorAsThemeVar, patchStyle }: {
  nodeId: string;
  node: SDUINode;
  store: BuilderStore;
  commitHistory: () => void;
  computedBgColor: string;
  patchColorAsThemeVar: (styleKey: string, propPath: string, twPrefix: string, cssVar: string) => void;
  patchStyle: (patch: Record<string, string>) => void;
}) {
  const animCfg     = ((node as unknown as Record<string, unknown>).animation ?? {}) as Record<string, unknown>;
  const outerSt     = (animCfg.outerStyle ?? {}) as Record<string, unknown>;
  const loopCfg     = (animCfg.loop ?? {}) as Record<string, unknown>;
  const bgImageRaw  = outerSt.backgroundImage;
  const isGradientFormula = isBoundValue(bgImageRaw as FormulaValue);
  const nodeStyleAny = (node.props as { style?: Record<string, string> })?.style ?? {};
  const propsBgImage = nodeStyleAny.backgroundImage ?? '';

  const existingGradientColors = React.useMemo(() => {
    const bg = typeof bgImageRaw === 'string' ? bgImageRaw : '';
    if (!bg) return [] as string[];
    const inner = bg.replace(/^(?:linear|radial)-gradient\([^,]+,\s*/, '').replace(/\)$/, '');
    const parts = inner.split(',').map((s: string) => s.trim()).filter(Boolean);
    if (parts.length > 1 && parts[parts.length - 1] === parts[0]) parts.pop();
    return parts;
  }, [bgImageRaw]);

  const existingDir = React.useMemo(() => {
    const bg = typeof bgImageRaw === 'string' ? bgImageRaw : '';
    return bg ? parseGradientDir(bg) : 'to right';
  }, [bgImageRaw]);

  const isRadialGradient = typeof bgImageRaw === 'string' && bgImageRaw.startsWith('radial-gradient');
  const hasGradient       = existingGradientColors.length >= 2 || isGradientFormula;
  const isGradientAnimated = loopCfg.type === 'gradientDrift';
  const hasImageBg        = 'backgroundImage' in nodeStyleAny && !hasGradient;
  // Derive mode from data; keep as React state so clearing URL doesn't flip back to 'solid'
  const derivedMode = hasGradient ? 'gradient' : hasImageBg ? 'image' : 'solid';
  const [mode, setMode] = React.useState<'solid' | 'gradient' | 'image'>(derivedMode);

  const [gradientColors, setGradientColors] = React.useState<string[]>(
    existingGradientColors.length >= 2 ? existingGradientColors : ['#667eea', '#764ba2'],
  );
  const [gradientDir, setGradientDir] = React.useState(existingDir);
  const [isRadial, setIsRadial] = React.useState(isRadialGradient);
  const [gradientEditorOpen, setGradientEditorOpen] = React.useState(false);
  // Saved solid bg: store whichever is set — inline style OR className bg token
  const savedSolidBgRef  = React.useRef<string>('');
  const savedSolidClsRef = React.useRef<string>(''); // stores the full bg-[...] class token if any

  // Local state for image URL input — avoids Zustand debounce lag while typing
  const stripUrl = (v: string) => v.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
  const wrapUrl  = (v: string) => {
    const trimmed = v.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('url(')) return trimmed;
    return `url(${trimmed})`;
  };
  const [localImageUrl, setLocalImageUrl] = React.useState(() => stripUrl(propsBgImage));

  React.useEffect(() => {
    if (existingGradientColors.length >= 2) setGradientColors(existingGradientColors);
    if (existingDir) setGradientDir(existingDir);
    setIsRadial(isRadialGradient);
    savedSolidBgRef.current  = '';
    savedSolidClsRef.current = '';
    // Sync mode from data on node change; also reset local URL
    setMode(hasGradient ? 'gradient' : hasImageBg ? 'image' : 'solid');
    setLocalImageUrl(stripUrl(propsBgImage));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  React.useEffect(() => {
    if (!gradientEditorOpen) return;
    const closeSelf = () => setGradientEditorOpen(false);
    return registerEditorClose(closeSelf);
  }, [gradientEditorOpen]);

  const applyGradient = React.useCallback((colors: string[], animate: boolean, dir?: string, radial?: boolean) => {
    if (colors.length < 2) return;
    const d = dir ?? gradientDir;
    const r = radial ?? isRadial;
    const colorList = animate ? [...colors, colors[0]].join(', ') : colors.join(', ');
    const gradient = r
      ? `radial-gradient(circle at center, ${colorList})`
      : `linear-gradient(${d}, ${colorList})`;
    const bgSize = animate ? '300% 100%' : undefined;
    const existing = ((node as unknown as Record<string, unknown>).animation ?? {}) as Record<string, unknown>;
    const outerPatch: Record<string, unknown> = {
      ...(existing.outerStyle as Record<string, unknown> ?? {}),
      backgroundImage: gradient,
      backgroundRepeat: 'no-repeat',
    };
    if (bgSize) outerPatch.backgroundSize = bgSize;
    else delete outerPatch.backgroundSize;
    const nextAnim: Record<string, unknown> = { ...existing, outerStyle: outerPatch };
    if (animate) nextAnim.loop = { type: 'gradientDrift', duration: 3000, repeatCount: -1, direction: 'alternate' };
    else if ((existing.loop as Record<string, unknown>)?.type === 'gradientDrift') delete nextAnim.loop;
    store.patchNodeField(nodeId, 'animation', nextAnim);
    commitHistory();
  }, [nodeId, node, store, commitHistory, gradientDir, isRadial]);

  const removeGradient = React.useCallback(() => {
    const existing = ((node as unknown as Record<string, unknown>).animation ?? {}) as Record<string, unknown>;
    const nextOuter = { ...(existing.outerStyle as Record<string, unknown> ?? {}) };
    delete nextOuter.backgroundImage; delete nextOuter.backgroundSize; delete nextOuter.backgroundRepeat;
    const nextAnim: Record<string, unknown> = { ...existing, outerStyle: Object.keys(nextOuter).length ? nextOuter : undefined };
    if ((existing.loop as Record<string, unknown>)?.type === 'gradientDrift') delete nextAnim.loop;
    store.patchNodeField(nodeId, 'animation', nextAnim);
    commitHistory();
  }, [nodeId, node, store, commitHistory]);

  const onGradientBinding = React.useCallback((v: FormulaValue) => {
    const existing = ((node as unknown as Record<string, unknown>).animation ?? {}) as Record<string, unknown>;
    if (typeof v === 'object' && v !== null) {
      const nextOuter = { ...(existing.outerStyle as Record<string, unknown> ?? {}), backgroundImage: v, backgroundSize: '300% 100%', backgroundRepeat: 'no-repeat' };
      store.patchNodeField(nodeId, 'animation', { ...existing, outerStyle: nextOuter });
      commitHistory();
    } else {
      removeGradient();
    }
  }, [nodeId, node, store, commitHistory, removeGradient]);

  // Helper: extract the current bg class token from className (e.g. 'bg-[#ff0]' or 'bg-[var(--theme-primary)]')
  const extractBgClassToken = () => {
    const cls = ((node.props as { className?: string })?.className ?? '');
    return [...cls.matchAll(/\bbg-\[[^\]]+\]/g)].pop()?.[0] ?? '';
  };

  const switchToSolid = () => {
    const style = (node.props as { style?: Record<string, string> })?.style ?? {};
    const { backgroundColor: _t, backgroundImage: _i, backgroundSize: _s, backgroundPosition: _p, backgroundRepeat: _r, ...restStyle } = style;
    // Restore saved solid color — could be a className token or an inline style value
    if (savedSolidClsRef.current) {
      // Restore className bg token
      const cls = (node.props as { className?: string })?.className ?? '';
      const cleanCls = cls.replace(/\bbg-\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
      store.patchProp(nodeId, 'props.className', [cleanCls, savedSolidClsRef.current].filter(Boolean).join(' '));
      store.patchProp(nodeId, 'props.style', restStyle);
    } else if (savedSolidBgRef.current) {
      store.patchProp(nodeId, 'props.style', { ...restStyle, backgroundColor: savedSolidBgRef.current });
    } else {
      store.patchProp(nodeId, 'props.style', restStyle);
    }
    savedSolidBgRef.current  = '';
    savedSolidClsRef.current = '';
    setMode('solid');
    removeGradient();
  };

  const switchToGradient = () => {
    const style = (node.props as { style?: Record<string, string> })?.style ?? {};
    // Save solid color from both inline style and className
    savedSolidBgRef.current  = style.backgroundColor ?? '';
    savedSolidClsRef.current = extractBgClassToken();
    // Remove any existing bg class token
    const cls = (node.props as { className?: string })?.className ?? '';
    const cleanCls = cls.replace(/\bbg-\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
    if (cleanCls !== cls) store.patchProp(nodeId, 'props.className', cleanCls);
    const { backgroundImage: _i, backgroundSize: _s, backgroundPosition: _p, backgroundRepeat: _r, ...restStyle } = style;
    store.patchProp(nodeId, 'props.style', { ...restStyle, backgroundColor: 'transparent' });
    setMode('gradient');
    applyGradient(gradientColors, false);
  };

  const switchToImage = () => {
    const style = (node.props as { style?: Record<string, string> })?.style ?? {};
    // Save solid color from both inline style and className
    savedSolidBgRef.current  = style.backgroundColor ?? '';
    savedSolidClsRef.current = extractBgClassToken();
    // Remove any existing bg class token
    const cls = (node.props as { className?: string })?.className ?? '';
    const cleanCls = cls.replace(/\bbg-\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
    if (cleanCls !== cls) store.patchProp(nodeId, 'props.className', cleanCls);
    removeGradient();
    setLocalImageUrl('');
    setMode('image');
    store.patchProp(nodeId, 'props.style', {
      ...style,
      backgroundColor: 'transparent',
      backgroundImage: style.backgroundImage ?? '',
      backgroundSize: style.backgroundSize ?? 'cover',
      backgroundPosition: style.backgroundPosition ?? 'center',
      backgroundRepeat: style.backgroundRepeat ?? 'no-repeat',
    });
    commitHistory();
  };

  const TAB_BASE: React.CSSProperties = { fontSize: 9, fontWeight: 600, padding: '3px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', transition: 'background 0.1s, color 0.1s' };
  const TAB_ACTIVE:   React.CSSProperties = { ...TAB_BASE, background: '#374151', color: '#f3f4f6' };
  const TAB_INACTIVE: React.CSSProperties = { ...TAB_BASE, background: 'none', color: '#6b7280' };
  const BTN_REMOVE = { fontSize: 9, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' } as const;
  const BTN_ADD    = { fontSize: 9, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' } as const;

  const bgSizeVal = nodeStyleAny.backgroundSize ?? 'cover';
  const bgPosVal  = nodeStyleAny.backgroundPosition ?? 'center';
  const bgRepeatVal = nodeStyleAny.backgroundRepeat ?? 'no-repeat';

  return (
    <div>
      {/* Solid | Gradient | Image tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 8 }}>
        <span style={{ fontSize: 9, color: '#6b7280', marginRight: 4, minWidth: 36 }}>Background</span>
        <div style={{ display: 'flex', background: '#111827', borderRadius: 5, padding: 2, gap: 1 }}>
          <button style={mode === 'solid'    ? TAB_ACTIVE : TAB_INACTIVE} onClick={() => { if (mode !== 'solid')    switchToSolid(); }}>Solid</button>
          <button style={mode === 'gradient' ? TAB_ACTIVE : TAB_INACTIVE} onClick={() => { if (mode !== 'gradient') switchToGradient(); }}>Gradient</button>
          <button style={mode === 'image'    ? TAB_ACTIVE : TAB_INACTIVE} onClick={() => { if (mode !== 'image')    switchToImage(); }}>Image</button>
        </div>
      </div>

      {/* ── Solid mode ── */}
      {mode === 'solid' && (
        <FieldWithBinding label="backgroundColor" displayLabel="" hint="CSS color: e.g. #ff0000, rgba(0,0,0,0.5)" value={(((node.props as { style?: Record<string, unknown> })?.style ?? {}).backgroundColor as unknown as FormulaValue) ?? ''} onChange={v => {
          if (typeof v === 'object' && v !== null) {
            store.patchProp(nodeId, 'props.style.backgroundColor', v);
            commitHistory();
          } else {
            patchStyle({ backgroundColor: (v as string) || '' });
          }
        }}>
          <FigmaColorPicker
            testId="input-bg-color"
            value={computedBgColor}
            onChange={(color, cssVar) => cssVar
              ? patchColorAsThemeVar('backgroundColor', 'props.style.backgroundColor', 'bg', cssVar)
              : patchStyle({ backgroundColor: color || '' })
            }
          />
        </FieldWithBinding>
      )}

      {/* ── Gradient mode ── */}
      {mode === 'gradient' && (
        <div style={{ position: 'relative' }}>
          {gradientEditorOpen && (
            <FormulaEditor
              label="backgroundImage"
              value={(isGradientFormula ? bgImageRaw : '') as FormulaValue}
              expectedType="string"
              hint="CSS gradient or formula"
              anchor="right"
              onChange={v => { onGradientBinding(v); setGradientEditorOpen(false); }}
              onClose={() => setGradientEditorOpen(false)}
            />
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            <span style={{ flex: 1, fontSize: 9, color: '#6b7280' }}>
              {isGradientFormula ? 'Formula bound' : `${gradientColors.length} stops`}
            </span>
            <BindingIcon isBound={isGradientFormula} onClick={() => { closeAllEditors(); setGradientEditorOpen(true); }} />
            <button onClick={switchToSolid} style={BTN_REMOVE}>Remove</button>
          </div>

          {isGradientFormula ? (
            <button data-testid="edit-gradient-formula-btn"
              onClick={() => { closeAllEditors(); setGradientEditorOpen(true); }}
              style={{ width: '100%', padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed', borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500, textAlign: 'left' }}>
              ƒ Edit formula
            </button>
          ) : (
            <>
              {/* Direction chips (only for linear) */}
              {!isRadial && (
                <div style={{ display: 'flex', gap: 3, marginBottom: 8, flexWrap: 'wrap' }}>
                  {GRADIENT_DIRS.map(({ value, label }) => (
                    <ToggleBtn key={value} active={gradientDir === value} style={{ padding: '3px 7px', fontSize: 12 }}
                      onClick={() => { setGradientDir(value); applyGradient(gradientColors, isGradientAnimated, value, false); }}>
                      {label}
                    </ToggleBtn>
                  ))}
                </div>
              )}

              {/* Radial toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 9, color: '#6b7280', flex: 1 }}>Radial</span>
                <ToggleBtn active={isRadial} onClick={() => { const next = !isRadial; setIsRadial(next); applyGradient(gradientColors, isGradientAnimated, gradientDir, next); }}>
                  {isRadial ? 'On' : 'Off'}
                </ToggleBtn>
              </div>

              {/* Preview bar */}
              <div style={{ height: 20, borderRadius: 4, marginBottom: 8, background: isRadial ? `radial-gradient(circle at center, ${gradientColors.join(', ')})` : `linear-gradient(${gradientDir}, ${gradientColors.join(', ')})`, border: '1px solid #374151' }} />

              {/* Color stops */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {gradientColors.map((color, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FigmaColorPicker
                      testId={`input-gradient-color-${i}`}
                      value={color}
                      onChange={c => {
                        const next = [...gradientColors]; next[i] = c || '#000000';
                        setGradientColors(next); applyGradient(next, isGradientAnimated);
                      }}
                    />
                    <span style={{ fontSize: 9, color: '#6b7280', fontFamily: 'monospace', flex: 1 }}>{color}</span>
                    {gradientColors.length > 2 && (
                      <button style={{ fontSize: 9, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                        onClick={() => { const next = gradientColors.filter((_, j) => j !== i); setGradientColors(next); applyGradient(next, isGradientAnimated); }}>✕</button>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                <button onClick={() => { const next = [...gradientColors, '#f64f59']; setGradientColors(next); applyGradient(next, isGradientAnimated); }}
                  style={BTN_ADD}>+ Add color</button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <input type="checkbox" id={`gd-anim-${nodeId}`} checked={isGradientAnimated}
                    onChange={e => applyGradient(gradientColors, e.target.checked)} style={{ cursor: 'pointer' }} />
                  <label htmlFor={`gd-anim-${nodeId}`} style={{ fontSize: 9, color: '#9ca3af', cursor: 'pointer' }}>Animate</label>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Image mode ── */}
      {mode === 'image' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            <span style={{ flex: 1, fontSize: 9, color: '#6b7280' }}>Image URL</span>
            <button onClick={switchToSolid} style={BTN_REMOVE}>Remove</button>
          </div>
          <FieldWithBinding
            label="backgroundImage" displayLabel="" hint="URL or formula returning a URL string"
            value={(nodeStyleAny.backgroundImage as unknown as FormulaValue) ?? ''}
            onChange={v => {
              if (typeof v === 'object' && v !== null) {
                store.patchProp(nodeId, 'props.style.backgroundImage', v); commitHistory();
              } else {
                const url = wrapUrl((v as string) || '');
                setLocalImageUrl(stripUrl((v as string) || ''));
                patchStyle({ backgroundImage: url });
              }
            }}
          >
            <input
              value={localImageUrl}
              placeholder="https://example.com/image.jpg"
              onChange={e => {
                const raw = e.target.value;
                setLocalImageUrl(raw);
                patchStyle({ backgroundImage: wrapUrl(raw) });
              }}
              style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '4px 8px', width: '100%', boxSizing: 'border-box' } as React.CSSProperties}
            />
          </FieldWithBinding>

          <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 3 }}>Size</span>
              <div style={{ display: 'flex', gap: 2 }}>
                {(['cover', 'contain', 'auto'] as const).map(v => (
                  <ToggleBtn key={v} active={bgSizeVal === v} style={{ fontSize: 9, padding: '2px 5px' }}
                    onClick={() => patchStyle({ backgroundSize: v })}>{v}</ToggleBtn>
                ))}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 3 }}>Position</span>
              <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                {(['center', 'top', 'bottom', 'left', 'right'] as const).map(v => (
                  <ToggleBtn key={v} active={bgPosVal === v} style={{ fontSize: 9, padding: '2px 5px' }}
                    onClick={() => patchStyle({ backgroundPosition: v })}>{v}</ToggleBtn>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <span style={{ fontSize: 9, color: '#6b7280', flex: 1 }}>Repeat</span>
            <ToggleBtn active={bgRepeatVal === 'repeat'} onClick={() => patchStyle({ backgroundRepeat: bgRepeatVal === 'repeat' ? 'no-repeat' : 'repeat' })}>
              {bgRepeatVal === 'repeat' ? 'On' : 'Off'}
            </ToggleBtn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── EffectsSection ───────────────────────────────────────────────────────────

function EffectsSection({ nodeId, node, store, commitHistory }: {
  nodeId: string;
  node: SDUINode;
  store: BuilderStore;
  commitHistory: () => void;
}) {
  const nodeStyle = (node.props as { style?: Record<string, unknown> })?.style ?? {};
  const animCfg = ((node as unknown as Record<string, unknown>).animation ?? {}) as Record<string, unknown>;
  const filterCfg = (animCfg.filter ?? {}) as Record<string, unknown>;

  // ── Shadow state ─────────────────────────────────────────────────────────────
  const boxShadowRaw = nodeStyle.boxShadow;
  const isShadowFormula = isBoundValue(boxShadowRaw as FormulaValue);
  const rawBoxShadow = typeof boxShadowRaw === 'string' ? boxShadowRaw : '';
  const parsed = parseBoxShadow(rawBoxShadow);
  const hasShadow = !!parsed || isShadowFormula;

  const [shadowColor,  setShadowColor]  = React.useState(parsed?.color  ?? '#000000');
  const [shadowBlur,   setShadowBlur]   = React.useState(parsed?.blur   ?? 20);
  const [shadowSpread, setShadowSpread] = React.useState(parsed?.spread ?? 0);
  const [shadowX,      setShadowX]      = React.useState(parsed?.x      ?? 0);
  const [shadowY,      setShadowY]      = React.useState(parsed?.y      ?? 4);

  // Formula editor open state
  const [shadowEditorOpen, setShadowEditorOpen] = React.useState(false);

  React.useEffect(() => {
    const p = parseBoxShadow(rawBoxShadow);
    setShadowColor(p?.color  ?? '#000000');
    setShadowBlur(p?.blur    ?? 20);
    setShadowSpread(p?.spread ?? 0);
    setShadowX(p?.x          ?? 0);
    setShadowY(p?.y          ?? 4);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  React.useEffect(() => {
    if (!shadowEditorOpen) return;
    const closeSelf = () => setShadowEditorOpen(false);
    const cleanup = registerEditorClose(closeSelf);
    return cleanup;
  }, [shadowEditorOpen]);

  const applyShadow = React.useCallback((color: string, blur: number, spread: number, x: number, y: number) => {
    const boxShadow = `${x}px ${y}px ${blur}px ${spread}px ${color}`;
    store.patchProp(nodeId, 'props.style', {
      ...(node.props as { style?: Record<string, unknown> })?.style,
      boxShadow,
      shadowColor: color,
      shadowOffset: { width: x, height: y },
      shadowRadius: blur,
      shadowOpacity: 1,
      elevation: Math.max(0, Math.round(blur / 2)),
    });
    commitHistory();
  }, [nodeId, node, store, commitHistory]);

  const removeShadow = React.useCallback(() => {
    const s = { ...(node.props as { style?: Record<string, unknown> })?.style };
    delete s.boxShadow; delete s.shadowColor; delete s.shadowOffset;
    delete s.shadowRadius; delete s.shadowOpacity; delete s.elevation;
    store.patchProp(nodeId, 'props.style', s);
    commitHistory();
  }, [nodeId, node, store, commitHistory]);

  const onShadowBinding = React.useCallback((v: FormulaValue) => {
    if (typeof v === 'object' && v !== null) {
      store.patchProp(nodeId, 'props.style.boxShadow', v);
      commitHistory();
    } else {
      const existing = (node.props as { style?: Record<string, unknown> })?.style ?? {};
      const { boxShadow: _old, ...rest } = existing;
      store.patchProp(nodeId, 'props.style', rest);
      commitHistory();
    }
  }, [nodeId, node, store, commitHistory]);

  // ── Element blur state ────────────────────────────────────────────────────────
  const filterBlurRaw = filterCfg.blur;
  const isBlurFormula = isBoundValue(filterBlurRaw as FormulaValue);
  const filterBlurVal = typeof filterBlurRaw === 'number' ? filterBlurRaw : 0;

  const patchFilterField = React.useCallback((field: string, v: FormulaValue) => {
    const existingAnim = ((node as unknown as Record<string, unknown>).animation ?? {}) as Record<string, unknown>;
    const existingFilter = (existingAnim.filter ?? {}) as Record<string, unknown>;
    let nextFilter: Record<string, unknown>;
    if (typeof v === 'object' && v !== null) {
      nextFilter = { ...existingFilter, enabled: true, [field]: v };
    } else {
      const numVal = Number(v);
      nextFilter = { ...existingFilter, enabled: true, [field]: numVal || undefined };
      const hasValues = Object.entries(nextFilter).some(([k, val]) => k !== 'enabled' && val != null && val !== 0);
      if (!hasValues) { nextFilter = {}; }
    }
    store.patchNodeField(nodeId, 'animation', { ...existingAnim, filter: Object.keys(nextFilter).length ? nextFilter : undefined });
    commitHistory();
  }, [nodeId, node, store, commitHistory]);

  const patchFilter = React.useCallback((patch: Record<string, unknown>) => {
    const existingAnim = ((node as unknown as Record<string, unknown>).animation ?? {}) as Record<string, unknown>;
    const existingFilter = (existingAnim.filter ?? {}) as Record<string, unknown>;
    const nextFilter = { ...existingFilter, ...patch, enabled: true };
    const hasValues = Object.entries(nextFilter).some(([k, v]) => k !== 'enabled' && v != null && (typeof v !== 'number' || v !== 0));
    store.patchNodeField(nodeId, 'animation', { ...existingAnim, filter: hasValues ? nextFilter : undefined });
    commitHistory();
  }, [nodeId, node, store, commitHistory]);

  const BTN_REMOVE = { fontSize: 9, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' } as const;
  const BTN_ADD    = { fontSize: 9, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' } as const;
  const SUB_HEADER = { fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', flex: 1 };

  return (
    <div style={SECTION_STYLE}>

      {/* ── Drop Shadow ── */}
      <div style={{ position: 'relative' }}>
        {/* Section header row: DROP SHADOW | [preview] | [bind] | [+ Add / Remove] */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: hasShadow ? 8 : 0 }}>
          <span style={SUB_HEADER}>Drop shadow</span>
          <BindingIcon isBound={isShadowFormula} onClick={() => { closeAllEditors(); setShadowEditorOpen(true); }} />
          {!isShadowFormula && (parsed ? (
            <button onClick={removeShadow} style={BTN_REMOVE}>Remove</button>
          ) : (
            <button onClick={() => applyShadow(shadowColor, shadowBlur, shadowSpread, shadowX, shadowY)} style={BTN_ADD}>+ Add</button>
          ))}
        </div>

        {/* Formula editor popover */}
        {shadowEditorOpen && (
          <FormulaEditor
            label="boxShadow"
            value={(isShadowFormula ? boxShadowRaw : rawBoxShadow) as FormulaValue}
            expectedType="string"
            hint="CSS boxShadow string or formula, e.g. '0px 0px 20px 6px #a855f7' or ternary"
            anchor="right"
            onChange={v => { onShadowBinding(v); setShadowEditorOpen(false); }}
            onClose={() => setShadowEditorOpen(false)}
          />
        )}

        {/* Formula bound — show edit button */}
        {isShadowFormula && (
          <button data-testid="edit-formula-btn" onClick={() => { closeAllEditors(); setShadowEditorOpen(true); }}
            style={{ width: '100%', padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed', borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500, textAlign: 'left' }}>
            ƒ Edit formula
          </button>
        )}

        {/* Shadow controls (not formula) */}
        {!isShadowFormula && hasShadow && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 9, color: '#6b7280', minWidth: 36 }}>Color</span>
              <FigmaColorPicker
                testId="input-shadow-color"
                value={shadowColor}
                onChange={hex => { const c = hex || '#000000'; setShadowColor(c); if (parsed) applyShadow(c, shadowBlur, shadowSpread, shadowX, shadowY); }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <NumberInput label="Blur"   testId="input-shadow-blur"   value={shadowBlur}   onChange={v => { setShadowBlur(v);   if (parsed) applyShadow(shadowColor, v, shadowSpread, shadowX, shadowY); }} />
              <NumberInput label="Spread" testId="input-shadow-spread" value={shadowSpread} onChange={v => { setShadowSpread(v); if (parsed) applyShadow(shadowColor, shadowBlur, v, shadowX, shadowY); }} />
              <NumberInput label="X"      testId="input-shadow-x"      value={shadowX}      onChange={v => { setShadowX(v);      if (parsed) applyShadow(shadowColor, shadowBlur, shadowSpread, v, shadowY); }} />
              <NumberInput label="Y"      testId="input-shadow-y"      value={shadowY}      onChange={v => { setShadowY(v);      if (parsed) applyShadow(shadowColor, shadowBlur, shadowSpread, shadowX, v); }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Element Blur ── */}
      <div style={{ marginTop: 10, borderTop: '1px solid #1f2937', paddingTop: 10 }}>
        <FieldWithBinding
          label="filterBlur"
          displayLabel="Element blur"
          hint="Blur amount in px, e.g. 8. Formula: e.g. variables['UUID'] ? 8 : 0"
          value={(isBlurFormula ? filterBlurRaw : filterBlurVal) as FormulaValue}
          onChange={v => patchFilterField('blur', v)}
          expectedType="number"
          stackLayout
        >
          <NumberInput
              label=""
              testId="input-filter-blur"
              value={filterBlurVal}
              onChange={v => patchFilter({ blur: v || undefined })}
            />
        </FieldWithBinding>
      </div>

    </div>
  );
}

// ─── Design Tab ───────────────────────────────────────────────────────────────

function DesignTab({ node }: { node: SDUINode }) {
  const { zoom, pageNodes, activeBreakpoint } = useBuilderStore(useShallow(s => ({
    zoom: s.zoom, pageNodes: s.pageNodes, activeBreakpoint: s.activeBreakpoint,
  })));
  const store = useBuilderStore.getState() as BuilderStore;
  const nodeId = (node as { id?: string }).id ?? '';
  const abp = activeBreakpoint as ActiveBreakpoint;
  const cls: string = (node.props as { className?: string })?.className ?? '';
  // Sidecar map that stores formula bindings for class-based fields (selfAlignment, textAlign, etc.)
  const classFormulas = (node.props as { classFormulas?: Record<string, FormulaValue> })?.classFormulas;
  // Parent flex-direction — used for axis-aware Fill tokens (W/H mode buttons)
  const canvasNodes = useBuilderStore(s => s.canvasNodes) as SDUINode[];
  const parentNode = findParentNode(pageNodes, nodeId) ?? findParentNode(canvasNodes, nodeId);
  const parentIsRow = !!(parentNode?.props?.className as string | undefined)?.includes('flex-row');

  const histTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitHistory = useCallback(() => {
    clearTimeout(histTimer.current);
    histTimer.current = setTimeout(() => store._pushHistory(), 400);
  }, [store]);

  const baseNodeStyle = useMemo(
    () => (node.props as { style?: Record<string, string> })?.style ?? {},
    [node]
  );

  // Compute effective style by merging responsive overrides on top of base.
  // At desktop this is just the base style. At other breakpoints, responsive
  // overrides cascade on top so the panel inputs show the correct value.
  const responsiveStyles = useMemo(() => {
    if (abp === 'desktop' || !node.responsive) return {};
    const merged: Record<string, string> = {};
    for (const bp of BP_ORDER) {
      const o = node.responsive[bp];
      if (o?.styles) {
        for (const [k, v] of Object.entries(o.styles)) {
          if (v !== null && v !== undefined) merged[k] = String(v);
        }
      }
      if (bp === abp) break;
    }
    return merged;
  }, [node, abp]);

  const nodeStyle = useMemo(
    () => ({ ...baseNodeStyle, ...responsiveStyles }),
    [baseNodeStyle, responsiveStyles]
  );

  // Look up a responsive override for a CSS property.
  // Returns the override value if present, otherwise undefined so callers fall back to base.
  const rOvr = useCallback(
    (cssProp: string): string | undefined => responsiveStyles[cssProp],
    [responsiveStyles]
  );

  // Derive current unit from inline style (px / % / vh / vw) or arbitrary class.
  const wUnit: 'px' | '%' | 'vh' | 'vw' = (() => {
    const styleW = String(nodeStyle.width ?? '');
    if (styleW.endsWith('%')) return '%';
    if (styleW.endsWith('vh')) return 'vh';
    if (styleW.endsWith('vw')) return 'vw';
    const clsUnit = parseTwArbitraryWithUnit(cls, 'w-');
    if (clsUnit?.unit === '%') return '%';
    if (clsUnit?.unit === 'vh') return 'vh';
    if (clsUnit?.unit === 'vw') return 'vw';
    return 'px';
  })();
  const hUnit: 'px' | '%' | 'vh' | 'vw' = (() => {
    const styleH = String(nodeStyle.height ?? '');
    if (styleH.endsWith('%')) return '%';
    if (styleH.endsWith('vh')) return 'vh';
    if (styleH.endsWith('vw')) return 'vw';
    const clsUnit = parseTwArbitraryWithUnit(cls, 'h-');
    if (clsUnit?.unit === '%') return '%';
    if (clsUnit?.unit === 'vh') return 'vh';
    if (clsUnit?.unit === 'vw') return 'vw';
    return 'px';
  })();

  // Remove height-mode tokens (h-fit, h-screen, any h-* class) AND flex-1 from a className.
  // Used when switching between H modes so old mode tokens don't linger.
  // H clear: only strip flex-1 when parent is flex-col (flex-1 = height fill there).
  // In a flex-row parent flex-1 means WIDTH fill — never strip it from H clear.
  const clearHMode = (c: string) => {
    let r = removeTwToken(removeTwToken(c, 'h-'), 'self-stretch');
    if (!parentIsRow) r = removeTwToken(r, 'flex-1');
    return r;
  };
  // Remove only the discrete H-mode tokens (not arbitrary h-[N] classes) — used when
  // setting a fixed pixel/vh/vw size via the number input so h-16 etc. are preserved.
  const clearHModeTokens = (c: string) => {
    let r = removeTwToken(removeTwToken(c, 'h-fit'), 'h-screen');
    r = removeTwToken(r, 'self-stretch');
    if (!parentIsRow) r = removeTwToken(r, 'flex-1');
    return r;
  };
  // W clear: only strip flex-1 when parent is flex-row (flex-1 = width fill there).
  // In a flex-col parent flex-1 means HEIGHT fill — never strip it from W clear.
  const clearWMode = (c: string) => {
    let r = removeTwToken(c, 'w-');
    if (parentIsRow) r = removeTwToken(r, 'flex-1');
    return r;
  };
  const clearWModeTokens = (c: string) => {
    let r = removeTwToken(removeTwToken(removeTwToken(c, 'w-fit'), 'w-full'), 'w-screen');
    if (parentIsRow) r = removeTwToken(r, 'flex-1');
    return r;
  };
  const pendingStyleRef   = useRef<Record<string, string>>({});
  const pendingNodeIdRef  = useRef<string>(nodeId);
  const rafSyncRef        = useRef<number | null>(null);
  const styleFlushTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Register a cancellation function so the canvas can flush dimension-related
  // pending styles before a resize begins (prevents timer revert after drag).
  useEffect(() => {
    _cancelPendingDimensionFlush = () => {
      const RESIZE_KEYS: readonly string[] = ['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight'];
      let hadDimension = false;
      for (const k of RESIZE_KEYS) {
        if (k in pendingStyleRef.current) { delete pendingStyleRef.current[k]; hadDimension = true; }
      }
      // If pending is now empty, cancel the timer entirely
      if (hadDimension && Object.keys(pendingStyleRef.current).length === 0 && styleFlushTimer.current) {
        clearTimeout(styleFlushTimer.current);
        styleFlushTimer.current = null;
      }
    };
    return () => { _cancelPendingDimensionFlush = null; };
  }, []); // refs are stable — no deps needed
  // When user blurs an input by clicking another element, React may re-render with the NEW
  // selection before blur fires. We capture the node on focus; delay the nodeId-sync so
  // blur-triggered commits use the correct (pre-focus) node.
  const editingNodeIdRef  = useRef<string>(nodeId);
  useEffect(() => {
    const t = setTimeout(() => { editingNodeIdRef.current = nodeId; }, 0);
    return () => clearTimeout(t);
  }, [nodeId]);

  const patchStyle = useCallback((patch: Record<string, string>, overrideNodeId?: string) => {
    const targetId = overrideNodeId ?? editingNodeIdRef.current ?? nodeId;
    pendingNodeIdRef.current = targetId;

    // 1. Apply directly to DOM — zero React re-renders, zero layout reads in the event handler.
    //    Writing style properties is a paint-only invalidation; no layout is forced here.
    const el = document.querySelector(`[data-builder-id="${targetId}"]`) as HTMLElement | null;
    if (el) {
      // Always clear any transition so every patchStyle call snaps instantly.
      el.style.transition = '';
      for (const [k, v] of Object.entries(patch)) {
        (el.style as unknown as Record<string, string>)[k] = v ?? '';
      }
    }

    // 2. RAF: batch ALL layout reads into one animation frame so they never block the
    //    event handler. getBoundingClientRect() forces a synchronous layout — calling it
    //    inside the event handler at 30-40 Hz causes layout thrashing and cursor flicker.
    //    Moving it to RAF lets the browser settle the style mutation first, then measure
    //    once per frame: no forced intermediate layouts, no cursor flicker.
    if (rafSyncRef.current !== null) cancelAnimationFrame(rafSyncRef.current);
    rafSyncRef.current = requestAnimationFrame(() => {
      rafSyncRef.current = null;
      const rafEl    = document.querySelector(`[data-builder-id="${targetId}"]`) as HTMLElement | null;
      const fpId = useBuilderStore.getState().focusedPageId || useBuilderStore.getState().currentPageId;
      const rafFrame = rafEl?.closest('[data-builder-canvas-node]') as HTMLElement
        ?? document.querySelector(`[data-builder-page-id="${fpId}"][data-builder-page-frame="0"]`) as HTMLElement
        ?? document.querySelector('[data-builder-page-frame]') as HTMLElement;
      if (rafEl && rafFrame) {
        const r  = rafEl.getBoundingClientRect();
        const fr = rafFrame.getBoundingClientRect();
        const z  = zoom;
        const setV = (tid: string, val: number) => {
          const inp = document.querySelector<HTMLInputElement>(`[data-testid="${tid}"]`);
          if (inp && inp !== document.activeElement) inp.value = String(val);
        };
        setV('input-pos-x', Math.round((r.left - fr.left) / z));
        setV('input-pos-y', Math.round((r.top  - fr.top)  / z));
        setV('input-pos-w', Math.round(r.width  / z));
        setV('input-pos-h', Math.round(r.height / z));
        useBuilderStore.getState()._requestRingUpdate(r, fr);
      } else {
        useBuilderStore.getState()._requestOverlayUpdate();
      }
    });

    // 3. Accumulate and debounce the Zustand commit (one re-render after gesture settles).
    pendingStyleRef.current = { ...pendingStyleRef.current, ...patch };
    if (styleFlushTimer.current) clearTimeout(styleFlushTimer.current);
    styleFlushTimer.current = setTimeout(() => {
      const id = pendingNodeIdRef.current;
      const currentBp = useBuilderStore.getState().activeBreakpoint as ActiveBreakpoint;

      // ── Responsive route: write to node.responsive[bp].styles ──────────
      if (currentBp !== 'desktop') {
        for (const [cssProp, val] of Object.entries(pendingStyleRef.current)) {
          if (!STYLE_TO_CLASS_KEYS.has(cssProp)) continue;
          const v = val === '' ? null : val;
          store.patchResponsive(id, currentBp as 'laptop' | 'tablet' | 'mobile', `styles.${cssProp}`, v);
        }
        pendingStyleRef.current = {};
        styleFlushTimer.current = null;
        commitHistory();
        return;
      }

      // ── Base (desktop) route: normal className + style merge ────────────
      function readNodeData(nodes: unknown[]): { className: string; style: Record<string, string> } | null {
        for (const n of nodes as Array<{ id?: string; props?: { className?: string; style?: Record<string, string> }; children?: unknown[] }>) {
          if (n.id === id) return { className: n.props?.className ?? '', style: n.props?.style ?? {} };
          if (n.children?.length) {
            const f = readNodeData(n.children);
            if (f !== null) return f;
          }
        }
        return null;
      }
      const nodeData = readNodeData(useBuilderStore.getState().pageNodes)
        ?? readNodeData(useBuilderStore.getState().canvasNodes as unknown[])
        ?? { className: '', style: {} };
      const allStyle = Object.fromEntries(
        Object.entries({ ...nodeData.style, ...pendingStyleRef.current })
          .filter(([, v]) => v !== '' && typeof v === 'string'),
      );
      const newCls = styleToClassName(allStyle, nodeData.className);
      store.patchProp(id, 'props.className', newCls);
      const cleanStyle = Object.fromEntries(
        Object.entries(allStyle).filter(([k]) => !STYLE_TO_CLASS_KEYS.has(k)),
      );
      store.patchProp(id, 'props.style', Object.keys(cleanStyle).length ? cleanStyle : {});
      pendingStyleRef.current = {};
      styleFlushTimer.current = null;
      commitHistory();
    }, 80);
  // nodeStyle intentionally excluded from deps — we read live from store in the timer
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, zoom, store, commitHistory]);

  /** Convert an evaluated formula result to a CSS string, appending "px" for dimension keys. */
  const toCssValue = useCallback((cssKey: string, value: unknown): string => {
    if (typeof value === 'number' && DIMENSION_CSS_KEYS.has(cssKey)) return `${value}px`;
    return String(value);
  }, []);

  /**
   * For FieldWithBinding onChange: route formula objects through patchProp (so isBoundValue works),
   * route literal strings through patchStyle (so DOM + Zustand stay in sync).
   * In both cases, evaluates the formula immediately and applies the result to the canvas DOM
   * so the user can see the preview without leaving the builder.
   * Numbers are auto-converted to "Npx" for dimension CSS properties.
   */
  const bindOrPatch = useCallback((cssKey: string, v: FormulaValue, extraOnLiteral?: Record<string, string>) => {
    if (typeof v === 'object' && v !== null) {
      // Store formula object in Zustand (keeps isBoundValue happy)
      store.patchProp(nodeId, `props.style.${cssKey}`, v);

      // Evaluate formula immediately → apply result to DOM for canvas preview
      const formulaStr = (v as { formula?: string }).formula;
      if (formulaStr) {
        const zustandData = useSduiStore.getState().data;
        const vs = getGlobalVariableStore().getState().getFullState() as Record<string, unknown>;
        const { value } = evaluateFormula(formulaStr, { ...zustandData, ...vs, theme: THEME_OBJ });
        if (value != null && typeof value !== 'object') {
          const el = document.querySelector(`[data-builder-id="${nodeId}"]`) as HTMLElement | null;
          if (el) (el.style as unknown as Record<string, string>)[cssKey] = toCssValue(cssKey, value);
        }
      }
      commitHistory();
    } else {
      patchStyle({ [cssKey]: (v as string) || '', ...(extraOnLiteral ?? {}) });
    }
  }, [nodeId, store, patchStyle, commitHistory, toCssValue]);

  /**
   * Like bindOrPatch but applies the formula result to TWO CSS keys simultaneously
   * (e.g. paddingLeft + paddingRight for combined H padding).
   * Stores using cssKey1 as the canonical Zustand path.
   */
  const bindOrPatchBoth = useCallback((cssKey1: string, cssKey2: string, v: FormulaValue) => {
    if (typeof v === 'object' && v !== null) {
      store.patchProp(nodeId, `props.style.${cssKey1}`, v);
      store.patchProp(nodeId, `props.style.${cssKey2}`, v);
      const formulaStr = (v as { formula?: string }).formula;
      if (formulaStr) {
        const zustandData = useSduiStore.getState().data;
        const vs = getGlobalVariableStore().getState().getFullState() as Record<string, unknown>;
        const { value } = evaluateFormula(formulaStr, { ...zustandData, ...vs, theme: THEME_OBJ });
        if (value != null && typeof value !== 'object') {
          const el = document.querySelector(`[data-builder-id="${nodeId}"]`) as HTMLElement | null;
          if (el) {
            (el.style as unknown as Record<string, string>)[cssKey1] = toCssValue(cssKey1, value);
            (el.style as unknown as Record<string, string>)[cssKey2] = toCssValue(cssKey2, value);
          }
        }
      }
      commitHistory();
    } else {
      patchStyle({ [cssKey1]: (v as string) || '', [cssKey2]: (v as string) || '' });
    }
  }, [nodeId, store, patchStyle, commitHistory, toCssValue]);

  /**
   * Evaluates a FormulaValue to a plain string for use in patchCls handlers.
   * - Literal string: returned as-is.
   * - Formula object: evaluated with current store context; on error falls back to the raw
   *   formula string so Tailwind tokens like "border-0" (invalid JS but valid class) still work.
   */
  const evalToStr = useCallback((v: FormulaValue): string => {
    if (typeof v !== 'object' || v === null) return (v as string) ?? '';
    const formulaStr = (v as { formula?: string }).formula ?? '';
    const zustandData = useSduiStore.getState().data;
    const vs = getGlobalVariableStore().getState().getFullState() as Record<string, unknown>;
    const { value, error } = evaluateFormula(formulaStr, { ...zustandData, ...vs, theme: THEME_OBJ });
    if (error) return formulaStr; // fallback: raw string works as a Tailwind token
    return value != null && typeof value !== 'object' ? String(value) : formulaStr;
  }, []);

  /**
   * Formula-aware class patcher for class-based fields (selfAlignment, textAlign, shadow, etc.).
   *
   * - Formula object: stored in `props.classFormulas[fieldKey]`, evaluated immediately so
   *   the canvas className is updated. After a full re-render the renderer merges classFormulas
   *   back into className, so FieldWithBinding sees `isBoundValue === true` and shows "ƒ Edit formula".
   * - Literal / cleared: clears any stored classFormulas entry and calls applyFn with the plain string.
   */
  const bindOrPatchCls = useCallback((
    fieldKey: string,
    applyFn: (evaluated: string) => void,
    v: FormulaValue
  ) => {
    if (typeof v === 'object' && v !== null) {
      // Store the formula binding so it survives re-renders
      store.patchProp(nodeId, `props.classFormulas.${fieldKey}`, v);
      const formulaStr = (v as { formula?: string }).formula ?? '';
      const zustandData = useSduiStore.getState().data;
      const vs = getGlobalVariableStore().getState().getFullState() as Record<string, unknown>;
      const { value } = evaluateFormula(formulaStr, { ...zustandData, ...vs, theme: THEME_OBJ });
      if (typeof value === 'string' && value) applyFn(value);
      commitHistory();
    } else {
      // Clear any formula binding, apply the literal class string
      store.patchProp(nodeId, `props.classFormulas.${fieldKey}`, null);
      applyFn((v as string) ?? '');
    }
  }, [nodeId, store, commitHistory]);

  // Flush any pending style patch immediately when the selected node changes.
  useEffect(() => {
    return () => {
      // Cancel any pending RAF sync so stale metric reads don't fire after unmount.
      if (rafSyncRef.current !== null) { cancelAnimationFrame(rafSyncRef.current); rafSyncRef.current = null; }
      if (styleFlushTimer.current) {
        clearTimeout(styleFlushTimer.current);
        if (Object.keys(pendingStyleRef.current).length > 0) {
          const id = pendingNodeIdRef.current;
          function readNodeDataFlush(nodes: unknown[]): { className: string; style: Record<string, string> } | null {
            for (const n of nodes as Array<{ id?: string; props?: { className?: string; style?: Record<string, string> }; children?: unknown[] }>) {
              if (n.id === id) return { className: n.props?.className ?? '', style: n.props?.style ?? {} };
              if (n.children?.length) { const f = readNodeDataFlush(n.children); if (f !== null) return f; }
            }
            return null;
          }
          const nodeData = readNodeDataFlush(useBuilderStore.getState().pageNodes)
            ?? readNodeDataFlush(useBuilderStore.getState().canvasNodes as unknown[])
            ?? { className: '', style: {} };
          const allStyleFlush = Object.fromEntries(
            Object.entries({ ...nodeData.style, ...pendingStyleRef.current })
              .filter(([, v]) => v !== '' && typeof v === 'string'),
          );
          const newCls = styleToClassName(allStyleFlush, nodeData.className);
          store.patchProp(id, 'props.className', newCls);
          const cleanStyleFlush = Object.fromEntries(
            Object.entries(allStyleFlush).filter(([k]) => !STYLE_TO_CLASS_KEYS.has(k)),
          );
          store.patchProp(id, 'props.style', Object.keys(cleanStyleFlush).length ? cleanStyleFlush : {});
          pendingStyleRef.current = {};
        }
        styleFlushTimer.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  const patchCls = useCallback((newCls: string) => {
    const bp = useBuilderStore.getState().activeBreakpoint as ActiveBreakpoint;
    if (bp !== 'desktop') {
      const oldTokens = new Set(cls.split(/\s+/).filter(Boolean));
      const newTokens = new Set(newCls.split(/\s+/).filter(Boolean));
      const added   = [...newTokens].filter(t => !oldTokens.has(t));
      const removed = [...oldTokens].filter(t => !newTokens.has(t));
      const cssOverrides: Record<string, string | null> = {};
      for (const t of [...added, ...removed]) {
        const mapping = twTokenToCss(t);
        if (mapping) {
          const isAdded = added.includes(t);
          cssOverrides[mapping.prop] = isAdded ? mapping.value : null;
        }
      }
      if (Object.keys(cssOverrides).length > 0) {
        for (const [prop, val] of Object.entries(cssOverrides)) {
          store.patchResponsive(nodeId, bp as 'laptop' | 'tablet' | 'mobile', `styles.${prop}`, val);
        }
        commitHistory();
        return;
      }
    }
    store.patchProp(nodeId, 'props.className', newCls);
    commitHistory();
  }, [nodeId, cls, store, commitHistory]);

  // ── Responsive-aware helpers ──────────────────────────────────────────────────

  /** Get breakpoints that have a specific CSS property override for this node */
  const getOverriddenBps = useCallback((cssProp: string): string[] => {
    if (!node.responsive) return [];
    const bps: string[] = [];
    for (const bp of BP_ORDER) {
      const o = node.responsive[bp];
      if (o?.styles && cssProp in o.styles) bps.push(bp);
    }
    return bps;
  }, [node]);

  /** Get breakpoints that have ANY override for a set of CSS properties */
  const getSectionOverriddenBps = useCallback((cssProps: readonly string[]): string[] => {
    if (!node.responsive) return [];
    const bps = new Set<string>();
    for (const bp of BP_ORDER) {
      const o = node.responsive[bp];
      if (!o?.styles) continue;
      for (const p of cssProps) {
        if (p in o.styles) { bps.add(bp); break; }
      }
    }
    return Array.from(bps);
  }, [node]);

  /** Remove a responsive override for a specific CSS property at a breakpoint */
  const removeResponsive = useCallback((bp: string, cssProp: string) => {
    store.removeResponsiveOverride(nodeId, bp as 'laptop' | 'tablet' | 'mobile', `styles.${cssProp}`);
    commitHistory();
  }, [nodeId, store, commitHistory]);

  /** Remove ALL responsive overrides for a CSS property across all breakpoints */
  const resetResponsive = useCallback((cssProp: string) => {
    for (const bp of BP_ORDER) {
      if (node.responsive?.[bp]?.styles && cssProp in node.responsive[bp]!.styles!) {
        store.removeResponsiveOverride(nodeId, bp, `styles.${cssProp}`);
      }
    }
    commitHistory();
  }, [nodeId, node, store, commitHistory]);

  /** Remove all responsive overrides for a set of section CSS properties */
  const resetSectionResponsive = useCallback((cssProps: readonly string[]) => {
    for (const bp of BP_ORDER) {
      const o = node.responsive?.[bp];
      if (!o?.styles) continue;
      for (const p of cssProps) {
        if (p in o.styles) store.removeResponsiveOverride(nodeId, bp, `styles.${p}`);
      }
    }
    commitHistory();
  }, [nodeId, node, store, commitHistory]);

  /** Remove all section overrides for a specific breakpoint */
  const removeSectionBp = useCallback((bp: string, cssProps: readonly string[]) => {
    const o = node.responsive?.[bp as 'laptop' | 'tablet' | 'mobile'];
    if (!o?.styles) return;
    for (const p of cssProps) {
      if (p in o.styles) store.removeResponsiveOverride(nodeId, bp as 'laptop' | 'tablet' | 'mobile', `styles.${p}`);
    }
    commitHistory();
  }, [nodeId, node, store, commitHistory]);

  /**
   * Apply a theme CSS variable as a color class (bg/text/border).
   *
   * CSS variables cannot be set reliably via el.style.property = 'var(--x)' in RN Web, so:
   *  1. Use el.style.setProperty (CSS-variable-aware) for immediate DOM update.
   *  2. Clear the inline style prop in Zustand so the class wins on re-render.
   *  3. Add the Tailwind arbitrary-value class (e.g. bg-[var(--destructive)]).
   *  4. Flush any pending patchStyle for that prop so the 80ms timer doesn't overwrite.
   */
  const patchColorAsThemeVar = useCallback((
    cssProp: 'backgroundColor' | 'color' | 'borderColor',
    stylePropPath: string,
    clsPrefix: 'bg' | 'text' | 'border',
    cssVar: string,
  ) => {
    // Use var(--theme-X) which always holds the full color value (hex or rgba).
    // This handles both opaque hex colors AND semi-transparent rgba values correctly.
    // --theme-X is kept in sync by _applyLightOverrides / _applyDarkOverrides.
    const cssVarValue = `var(--theme-${cssVar})`;
    // 1. Immediate DOM update (setProperty handles CSS functions correctly)
    const el = document.querySelector(`[data-builder-id="${nodeId}"]`) as HTMLElement | null;
    if (el) {
      const kebab = cssProp === 'backgroundColor' ? 'background-color'
        : cssProp === 'borderColor' ? 'border-color' : 'color';
      el.style.removeProperty(kebab);
      el.style.setProperty(kebab, cssVarValue);
    }
    // 2. Cancel any pending patchStyle for this prop so the 80ms timer doesn't overwrite
    delete (pendingStyleRef.current as Record<string, string>)[cssProp];
    // 3. Remove old arbitrary color class + add CSS var class; clear inline style in Zustand
    const regex = new RegExp(`\\b${clsPrefix}-\\[[^\\]]+\\]`, 'g');
    const next = cls.replace(regex, '').replace(/\s+/g, ' ').trim();
    // Use rgb(var(--X)) so Tailwind generates: background-color: rgb(var(--X))
    // which correctly resolves the R G B triplet CSS variable format used by ThemeStyles.
    const newCls = `${next} ${clsPrefix}-[${cssVarValue}]`.trim();
    // Atomic Zustand update: remove the inline style prop (don't write '' — empty strings linger),
    // then update className so the CSS-var class wins.
    const existingNode = findNode(useBuilderStore.getState().pageNodes, nodeId)
      ?? findNode(useBuilderStore.getState().canvasNodes as SDUINode[], nodeId);
    const currentStyle = (existingNode?.props as { style?: Record<string, string> })?.style ?? {};
    const { [cssProp]: _removed, ...cleanedStyle } = currentStyle as Record<string, string>;
    store.patchProp(nodeId, 'props.style', cleanedStyle);
    store.patchProp(nodeId, 'props.className', newCls);
    commitHistory();
  }, [nodeId, cls, store, commitHistory]);

  /**
   * Responsive-aware color patch: routes theme color changes to responsive overrides
   * when breakpoint is non-desktop.
   */
  const patchColorResponsive = useCallback((
    cssProp: 'backgroundColor' | 'color' | 'borderColor',
    stylePropPath: string,
    clsPrefix: 'bg' | 'text' | 'border',
    cssVar: string,
  ) => {
    const bp = useBuilderStore.getState().activeBreakpoint as ActiveBreakpoint;
    if (bp !== 'desktop') {
      const cssVarValue = `var(--theme-${cssVar})`;
      store.patchResponsive(nodeId, bp as 'laptop' | 'tablet' | 'mobile', `styles.${cssProp}`, cssVarValue);
      commitHistory();
      return;
    }
    patchColorAsThemeVar(cssProp, stylePropPath, clsPrefix, cssVar);
  }, [nodeId, store, commitHistory, patchColorAsThemeVar]);

  // ── Live DOM metrics ─────────────────────────────────────────────────────────
  // Used for the initial render and when selection/zoom changes.
  // During active patchStyle editing, the RAF in patchStyle imperatively updates
  // the input DOM values directly — no React re-renders needed.

  const domMetrics = useMemo(() => {
    const el    = document.querySelector(`[data-builder-id="${nodeId}"]`);
    const frame = document.querySelector('[data-builder-page-frame]');
    if (!el || !frame) return { x: 0, y: 0, w: 0, h: 0 };
    const r  = el.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    return {
      x: Math.round((r.left - fr.left) / zoom),
      y: Math.round((r.top  - fr.top ) / zoom),
      w: Math.round(r.width  / zoom),
      h: Math.round(r.height / zoom),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, zoom, store.pageNodes]);

  // ── Computed DOM colors (fallback when no inline style set) ──────────────────
  // Gluestack applies colors via internal class tokens (e.g. bg-primary-500) that
  // we can't decode without a full token map. Reading getComputedStyle() from the
  // rendered DOM element always gives the real on-screen value.

  const [computedBgColor,     setComputedBgColor]     = useState<string>('#ffffff');
  const [computedTextColor,   setComputedTextColor]   = useState<string>('#000000');
  const [computedBorderColor, setComputedBorderColor] = useState<string>('#000000');

  useEffect(() => {
    const rgbToHex = (rgb: string): string | null => {
      const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return null;
      const [r, g, b] = m.slice(1).map(Number);
      return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
    };

    const el = document.querySelector(`[data-builder-id="${nodeId}"]`) as HTMLElement | null;
    if (!el) return;
    const s = window.getComputedStyle(el);
    // A stored value is "formula-bound" if it contains {{, is an object, or was
    // previously broken by String(object) → "[object Object]". In all these cases
    // we read the live DOM color instead of showing the raw formula expression.
    const isColorBound = (v: unknown): boolean => {
      if (!v) return false;
      if (typeof v === 'object') return true;
      if (typeof v === 'string') {
        return v.startsWith('var(') || v.includes('{{') || v.startsWith('[object');
      }
      return false;
    };

    const bgVal = nodeStyle.backgroundColor as unknown;
    if (!bgVal || isColorBound(bgVal)) {
      // Check className first — bg-[rgba(...)] or bg-[#hex] preserves original format
      // Use last match in case of duplicates (most recently written wins)
      const bgToken = [...cls.matchAll(/\bbg-\[([^\]]+)\]/g)].pop()?.[1];
      if (bgToken && bgToken !== 'transparent') {
        setComputedBgColor(bgToken);
      } else {
        // Fall back to getComputedStyle — preserve alpha if present
        const cssBg = s.backgroundColor;
        if (cssBg && cssBg !== 'rgba(0, 0, 0, 0)') {
          const rgbaM = cssBg.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)/);
          if (rgbaM && parseFloat(rgbaM[4]) < 1) {
            // Preserve semi-transparent rgba as-is
            setComputedBgColor(cssBg);
          } else {
            const hex = rgbToHex(cssBg);
            if (hex) setComputedBgColor(hex);
            else setComputedBgColor('#ffffff');
          }
        } else {
          setComputedBgColor('#ffffff');
        }
      }
    } else {
      setComputedBgColor(bgVal as string);
    }
    // Helper: preserve rgba if alpha < 1, otherwise convert to hex
    const resolveComputedColor = (cssProp: string, fallback: string): string => {
      if (cssProp && cssProp !== 'rgba(0, 0, 0, 0)') {
        const rgbaM = cssProp.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)/);
        if (rgbaM && parseFloat(rgbaM[4]) < 1) return cssProp;
        const hex = rgbToHex(cssProp);
        if (hex) return hex;
      }
      return fallback;
    };

    const colorVal = nodeStyle.color as unknown;
    if (!colorVal || isColorBound(colorVal)) {
      // Check className for text-[#...] or text-[rgba(...)] — distinguish from font-size text-[14px]
      // Use last match in case of duplicates (most recently written wins)
      const textToken = [...cls.matchAll(/\btext-\[([^\]]+)\]/g)].pop()?.[1];
      if (textToken && (textToken.startsWith('#') || textToken.startsWith('rgb'))) {
        setComputedTextColor(textToken);
      } else {
        setComputedTextColor(resolveComputedColor(s.color, '#000000'));
      }
    } else {
      setComputedTextColor(colorVal as string);
    }

    const borderVal = nodeStyle.borderColor as unknown;
    if (!borderVal || isColorBound(borderVal)) {
      // Check className for border-[#...] or border-[rgba(...)] — distinguish from border-width border-[2px]
      const borderToken = [...cls.matchAll(/\bborder-\[([^\]]+)\]/g)].pop()?.[1];
      if (borderToken && (borderToken.startsWith('#') || borderToken.startsWith('rgb'))) {
        setComputedBorderColor(borderToken);
      } else {
        setComputedBorderColor(resolveComputedColor(s.borderTopColor, '#000000'));
      }
    } else {
      setComputedBorderColor(borderVal as string);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, cls, nodeStyle.backgroundColor, nodeStyle.color, nodeStyle.borderColor, store.pageNodes]);

  // ── Component type classification ────────────────────────────────────────────
  // Controls which panel sections are shown. Only show relevant controls
  // per node type to avoid corrupting Gluestack's internal layout.
  // Containers: show Auto Layout + Alignment sections so children can be rearranged.
  // Includes Gluestack compounds whose children ARE real SDUI nodes (Checkbox, Radio, Badge, Avatar, Fab).
  const isContainer  = ['Box', 'VStack', 'HStack', 'Center', 'Grid', 'GridItem', 'Checkbox', 'CheckboxGroup', 'Radio', 'RadioGroup', 'Skeleton', 'Tooltip', 'FormContainer'].includes(node.type);
  // CheckboxLabel / RadioLabel etc. are text nodes — show Typography section when selected
  const isTextNode   = ['Text', 'Heading', 'CheckboxLabel', 'RadioLabel', 'SkeletonText', 'TooltipText'].includes(node.type);
  // Padding/border-radius make sense for containers + button-like widgets, not raw text
  const showPadding  = !isTextNode;
  // Auto Layout (flex dir, gap) and Alignment only make sense for flex containers
  const showLayout   = isContainer;

  // ── Parsed tokens ─────────────────────────────────────────────────────────────
  // All values check responsiveStyles first. If a responsive override exists for
  // the CSS property, it wins over the base className-derived value.

  const basePadding = expandPadding(cls);
  const padding = {
    top:    rOvr('paddingTop')    ? parseFloat(rOvr('paddingTop')!)    : basePadding.top,
    right:  rOvr('paddingRight')  ? parseFloat(rOvr('paddingRight')!)  : basePadding.right,
    bottom: rOvr('paddingBottom') ? parseFloat(rOvr('paddingBottom')!) : basePadding.bottom,
    left:   rOvr('paddingLeft')   ? parseFloat(rOvr('paddingLeft')!)   : basePadding.left,
  };
  const baseFlexDir = parseTwToken(cls, 'flex-') ?? 'flex-col';
  const CSS_TO_TW_FLEX: Record<string, string> = { row: 'flex-row', column: 'flex-col', 'row-reverse': 'flex-row-reverse', 'column-reverse': 'flex-col-reverse' };
  const flexDir     = rOvr('flexDirection') ? (CSS_TO_TW_FLEX[rOvr('flexDirection')!] ?? baseFlexDir) : baseFlexDir;
  const isRow       = flexDir === 'flex-row';
  const activeCell  = getAlignCellIndex(cls, isRow);
  const gapToken    = parseTwToken(cls, 'gap-') ?? 'gap-0';
  const baseGapPx   = parseTwArbitrary(cls, 'gap-') ?? (parseInt(gapToken.replace('gap-', '') || '0') * 4);
  const gapPx       = rOvr('gap') ? parseFloat(rOvr('gap')!) : baseGapPx;
  const baseFontSizePx = parseTwArbitraryPx(cls, 'text-') ?? 0;
  const fontSizePx  = rOvr('fontSize') ? parseFloat(rOvr('fontSize')!) : baseFontSizePx;
  const CSS_TO_TW_WEIGHT: Record<string, string> = {
    '100': 'font-thin', '200': 'font-extralight', '300': 'font-light', '400': 'font-normal',
    '500': 'font-medium', '600': 'font-semibold', '700': 'font-bold', '800': 'font-extrabold', '900': 'font-black',
  };
  const baseFontWeight = parseTwToken(cls, 'font-') ?? 'font-normal';
  const fontWeight  = rOvr('fontWeight') ? (CSS_TO_TW_WEIGHT[rOvr('fontWeight')!] ?? baseFontWeight) : baseFontWeight;
  const leading     = parseTwToken(cls, 'leading-') ?? 'leading-normal';
  const tracking    = parseTwToken(cls, 'tracking-') ?? 'tracking-normal';
  // Opacity is stored as opacity-[0.5] arbitrary class (or legacy style.opacity for old nodes).
  const opacityVal = (() => {
    if (rOvr('opacity') !== undefined) return Math.round(parseFloat(rOvr('opacity')!) * 100);
    if (nodeStyle.opacity !== undefined && typeof nodeStyle.opacity !== 'object') return Math.round(parseFloat(String(nodeStyle.opacity)) * 100);
    const token = parseTwToken(cls, 'opacity-');
    if (!token) return 100;
    const arb = token.match(/^opacity-\[([0-9.]+)\]$/);
    if (arb) return Math.round(parseFloat(arb[1]) * 100);
    return parseInt(token.replace('opacity-', '') || '100');
  })();
  const baseBorderWidthPx = parseTwArbitraryPx(cls, 'border-') ?? 0;
  const borderWidthPx = rOvr('borderWidth') ? parseFloat(rOvr('borderWidth')!) : baseBorderWidthPx;
  const CSS_TO_TW_BORDER_STYLE: Record<string, string> = { solid: 'border-solid', dashed: 'border-dashed', dotted: 'border-dotted', double: 'border-double', none: 'border-none' };
  const baseBorderStyle = BORDER_STYLE_TOKENS.find(t => cls.includes(t)) ?? 'border-solid';
  const borderStyle   = rOvr('borderStyle') ? (CSS_TO_TW_BORDER_STYLE[rOvr('borderStyle')!] ?? baseBorderStyle) : baseBorderStyle;
  // Rotation stays in props.style.transform (rotation only — no translate mixed in).
  // Guard against formula objects: only treat it as a string for parsing.
  const styleTransform = (() => {
    const t = (node.props as { style?: Record<string, unknown> })?.style?.transform;
    return typeof t === 'string' ? t : '';
  })();
  const rotateDeg = (() => {
    // Try inline style first: "rotate(16deg)" → 16
    const styleMatch = styleTransform.match(/rotate\(([-\d.]+)deg\)/);
    if (styleMatch) return parseFloat(styleMatch[1]);
    // Fall back to className token for backwards compat: rotate-[16deg] → 16
    const clsToken = parseTwToken(cls, 'rotate-') ?? parseTwToken(cls, '-rotate-') ?? '';
    return parseInt(clsToken.replace(/-?rotate-\[?/, '').replace('deg]', '') || '0');
  })();
  // Translate X/Y live in separate props.style.translateX / .translateY keys (not mixed into transform).
  const translateXPx = (() => {
    const t = nodeStyle.translateX;
    if (typeof t !== 'string' || !t) return 0;
    const m = t.match(/^([-\d.]+)/);
    return m ? parseFloat(m[1]) : 0;
  })();
  const translateYPx = (() => {
    const t = nodeStyle.translateY;
    if (typeof t !== 'string' || !t) return 0;
    const m = t.match(/^([-\d.]+)/);
    return m ? parseFloat(m[1]) : 0;
  })();
  const isFlipH     = cls.includes('-scale-x-100');
  const isFlipV     = cls.includes('-scale-y-100');
  // Overflow — detect which token is active (x/y variants must come before generic ones)
  const OVERFLOW_TOKENS_LIST = [
    'overflow-x-auto', 'overflow-y-auto',
    'overflow-x-scroll', 'overflow-y-scroll',
    'overflow-x-hidden', 'overflow-y-hidden',
    'overflow-auto', 'overflow-scroll', 'overflow-hidden',
  ] as const;
  type OverflowTokenType = typeof OVERFLOW_TOKENS_LIST[number] | 'none';
  const currentOverflow: OverflowTokenType = OVERFLOW_TOKENS_LIST.find(t => cls.split(/\s+/).includes(t)) ?? 'none';
  const isClipped   = currentOverflow === 'overflow-hidden';
  const isFlexWrap  = cls.includes('flex-wrap');
  const isGrid      = cls.includes('grid');
  const isSpaceBetween = cls.includes('justify-between');
  // Self-alignment: how this node aligns itself within its parent flex container
  const CSS_TO_TW_SELF: Record<string, string> = { auto: 'self-auto', 'flex-start': 'self-start', 'flex-end': 'self-end', center: 'self-center', stretch: 'self-stretch', baseline: 'self-baseline' };
  const baseSelfToken = parseTwToken(cls, 'self-') ?? 'self-auto';
  const selfToken   = rOvr('alignSelf') ? (CSS_TO_TW_SELF[rOvr('alignSelf')!] ?? baseSelfToken) : baseSelfToken;

  // Margin (outer spacing)
  const baseMargin  = expandMargin(cls);
  const margin = {
    top:    rOvr('marginTop')    ? parseFloat(rOvr('marginTop')!)    : baseMargin.top,
    right:  rOvr('marginRight')  ? parseFloat(rOvr('marginRight')!)  : baseMargin.right,
    bottom: rOvr('marginBottom') ? parseFloat(rOvr('marginBottom')!) : baseMargin.bottom,
    left:   rOvr('marginLeft')   ? parseFloat(rOvr('marginLeft')!)   : baseMargin.left,
  };

  // Position & layer
  const basePositionToken = POSITION_TOKENS.find(t => cls.includes(t)) ?? 'static';
  const positionToken = rOvr('position') ? rOvr('position')! : basePositionToken;
  const baseZIndexPx = parseTwArbitraryNum(cls, 'z-') ?? 0;
  const zIndexPx      = rOvr('zIndex') ? parseFloat(rOvr('zIndex')!) : baseZIndexPx;
  const baseCursorToken = parseTwToken(cls, 'cursor-') ?? 'cursor-default';
  const CSS_TO_TW_CURSOR: Record<string, string> = { pointer: 'cursor-pointer', default: 'cursor-default', wait: 'cursor-wait', text: 'cursor-text', move: 'cursor-move', 'not-allowed': 'cursor-not-allowed', grab: 'cursor-grab', 'zoom-in': 'cursor-zoom-in' };
  const cursorToken   = rOvr('cursor') ? (CSS_TO_TW_CURSOR[rOvr('cursor')!] ?? baseCursorToken) : baseCursorToken;
  // Typography extras
  const CSS_TO_TW_TEXT_ALIGN: Record<string, string> = { left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify' };
  const baseTextAlign = TEXT_ALIGN_TOKENS.find(t => cls.includes(t)) ?? 'text-left';
  const textAlign  = rOvr('textAlign') ? (CSS_TO_TW_TEXT_ALIGN[rOvr('textAlign')!] ?? baseTextAlign) : baseTextAlign;
  const CSS_TO_TW_TEXT_DECOR: Record<string, string> = { underline: 'underline', 'line-through': 'line-through', none: 'no-underline' };
  const baseTextDecor = TEXT_DECORATION_TOKENS.find(t => cls.includes(t)) ?? 'no-underline';
  const textDecor  = rOvr('textDecoration') ? (CSS_TO_TW_TEXT_DECOR[rOvr('textDecoration')!] ?? baseTextDecor) : baseTextDecor;
  const CSS_TO_TW_TEXT_TRANSFORM: Record<string, string> = { uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize', none: 'normal-case' };
  const baseTextTransform = TEXT_TRANSFORM_TOKENS.find(t => cls.includes(t)) ?? 'normal-case';
  const textTransform = rOvr('textTransform') ? (CSS_TO_TW_TEXT_TRANSFORM[rOvr('textTransform')!] ?? baseTextTransform) : baseTextTransform;

  // padMode/marginMode no longer used — replaced by SpacingDiagram

  // ── Selection colors ─────────────────────────────────────────────────────────

  const selectionColors = useMemo(() => extractColors(node), [node]);

  // ── Text content helpers ─────────────────────────────────────────────────────
  // For Text / Heading / ButtonText nodes we expose their `text` prop directly.
  // For Button find the first ButtonText child; for other containers (Box-based buttons)
  // find the first Text/Heading child so primitive buttons get a Content section too.
  const hasDirectText = isTextNode && (node as { text?: string }).text !== undefined;
  const hasContent = hasDirectText;

  // Convert a stored text string → FormulaValue for FieldWithBinding.
  // A whole-string template expression like "{{variables['UUID']}}" or "{{collections['X'].data.y}}"
  // is treated as a formula binding so it shows "ƒ Edit formula" instead of a raw UUID textarea.
  // Mixed/partial templates like "Hello {{name}}" stay as plain strings.
  function textToFormulaValue(text: string | { formula?: string } | unknown): FormulaValue {
    if (!text) return text as FormulaValue;
    // Already a formula object (e.g. { formula: "..." }) — pass through directly
    if (typeof text === 'object' && text !== null && 'formula' in (text as object)) {
      return text as unknown as FormulaValue;
    }
    if (typeof text !== 'string') return String(text) as unknown as FormulaValue;
    const m = text.match(/^\{\{(.+)\}\}$/);
    if (m) return { formula: m[1] } as unknown as FormulaValue;
    return text;
  }

  // Convert FormulaValue back → stored text template string.
  // Formula objects are wrapped in {{}} for the SDUI renderer's template engine.
  function formulaValueToText(v: FormulaValue): string {
    if (v && typeof v === 'object' && 'formula' in (v as object)) {
      return `{{${(v as { formula: string }).formula}}}`;
    }
    return (v as string) ?? '';
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }} onFocus={() => { editingNodeIdRef.current = nodeId; }}>

      {/* ── Content (text value) — shown for text nodes and buttons ── */}
      {hasContent && (
        <div style={SECTION_STYLE}>
          <SectionHeader title="Content" />
          <div style={{ marginTop: 6 }}>
            {(() => {
              const rawText = (node as { text?: string }).text ?? '';
              const targetId = nodeId;
              const displayValue = textToFormulaValue(rawText);
              return (
                <FieldWithBinding
                  label="text"
                  displayLabel="Text"
                  hint='any text or {{variable}} template'
                  topAlign
                  expectedType="string"
                  value={displayValue}
                  onChange={v => {
                    store.patchProp(targetId, 'text', formulaValueToText(v));
                    commitHistory();
                  }}
                >
                  <textarea
                    data-testid="input-text-content"
                    value={rawText}
                    rows={2}
                    onChange={e => {
                      store.patchProp(targetId, 'text', e.target.value);
                      commitHistory();
                    }}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
                      color: '#f3f4f6', fontSize: 12, padding: '5px 8px', resize: 'vertical',
                      fontFamily: 'inherit',
                    }}
                  />
                </FieldWithBinding>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Position & Size ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Position & Size" overriddenBreakpoints={getSectionOverriddenBps(SECTION_CSS_PROPS['position-size']!)} onRemoveBreakpoint={bp => removeSectionBp(bp, SECTION_CSS_PROPS['position-size']!)} onResetAll={() => resetSectionResponsive(SECTION_CSS_PROPS['position-size']!)} />
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <FieldWithBinding label="position" displayLabel="Position" hint="e.g. relative, absolute, fixed" value={(classFormulas?.['position'] as FormulaValue) ?? positionToken} onChange={v => bindOrPatchCls('position', evaluated => {
            let next = cls;
            POSITION_TOKENS.forEach(t => { next = removeTwToken(next, t); });
            patchCls(evaluated === 'static' ? next : `${next} ${evaluated}`.trim());
          }, v)} expectedType="string" responsiveOverrides={getOverriddenBps('position')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="position">
            <SelectInput
              label="Position"
              testId="select-position"
              value={positionToken}
              options={POSITION_TOKENS}
              onChange={v => {
                let next = cls;
                POSITION_TOKENS.forEach(t => { next = removeTwToken(next, t); });
                patchCls(v === 'static' ? next : `${next} ${v}`.trim());
              }}
            />
          </FieldWithBinding>
          <FieldWithBinding label="zIndex" displayLabel="Z-Index" hint="integer e.g. 10, 50, 100" value={(nodeStyle.zIndex ?? '') as FormulaValue} onChange={v => bindOrPatch('zIndex', v)} responsiveOverrides={getOverriddenBps('zIndex')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="zIndex">
            <NumberInput
              label="Z-Index"
              testId="input-zindex"
              value={zIndexPx}
              onChange={v => patchStyle({ zIndex: String(v) })}
            />
          </FieldWithBinding>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <NumberInput label="X" testId="input-pos-x" value={domMetrics.x} onChange={() => {}} />
          <NumberInput label="Y" testId="input-pos-y" value={domMetrics.y} onChange={() => {}} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <FieldWithBinding label="width" displayLabel="W" hint="e.g. 200px, 50vh, auto" value={(nodeStyle.width ?? '') as FormulaValue} onChange={v => bindOrPatch('width', v, { minWidth: '0' })} responsiveOverrides={getOverriddenBps('width')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="width">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <NumberInput label="W" testId="input-pos-w" value={(() => {
                if (rOvr('width')) return parseFloat(rOvr('width')!) || domMetrics.w;
                const clsW = parseTwArbitrary(cls, 'w-');
                if (clsW !== null) return clsW;
                const styleW = baseNodeStyle.width;
                if (styleW) return parseInt(styleW) || domMetrics.w;
                return domMetrics.w;
              })()} onChange={px => {
                patchStyle({ width: `${px}${wUnit}`, minWidth: '0' });
                patchCls(clearWModeTokens(cls));
              }} />
              <div style={{ display: 'flex', gap: 2 }}>
                {(['px', '%', 'vh', 'vw'] as const).map(u => (
                  <ToggleBtn key={u} active={wUnit === u} onClick={() => {
                    if (u === wUnit) return;
                    // Convert the current rendered width (always px) to the target unit
                    const pxVal = domMetrics.w || 0;
                    const frame = document.querySelector('[data-builder-page-frame]');
                    const frameW = (frame as HTMLElement | null)?.clientWidth ?? window.innerWidth;
                    const frameH = (frame as HTMLElement | null)?.clientHeight ?? window.innerHeight;
                    const parentW = (document.querySelector(`[data-builder-id="${nodeId}"]`) as HTMLElement | null)?.parentElement?.clientWidth ?? frameW;
                    let converted: number;
                    if (u === 'px') converted = Math.round(pxVal);
                    else if (u === 'vw') converted = Math.round(pxVal / frameW * 100 * 10) / 10;
                    else if (u === 'vh') converted = Math.round(pxVal / frameH * 100 * 10) / 10;
                    else /* % */ converted = Math.round(pxVal / parentW * 100 * 10) / 10;
                    patchStyle({ width: `${converted}${u}`, minWidth: '0' });
                    patchCls(clearWModeTokens(cls));
                  }} style={{ fontSize: 9, padding: '1px 5px', minWidth: 0 }}>{u}</ToggleBtn>
                ))}
              </div>
            </div>
          </FieldWithBinding>
          <FieldWithBinding label="height" displayLabel="H" hint="e.g. 100px, 50vh, auto" value={(nodeStyle.height ?? '') as FormulaValue} onChange={v => bindOrPatch('height', v, { minHeight: '0' })} responsiveOverrides={getOverriddenBps('height')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="height">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <NumberInput label="H" testId="input-pos-h" value={(() => {
                if (rOvr('height')) return parseFloat(rOvr('height')!) || domMetrics.h;
                const clsH = parseTwArbitrary(cls, 'h-');
                if (clsH !== null) return clsH;
                const styleH = baseNodeStyle.height;
                if (styleH) return parseInt(styleH) || domMetrics.h;
                return domMetrics.h;
              })()} onChange={px => {
                patchStyle({ height: `${px}${hUnit}`, minHeight: '0' });
                patchCls(clearHModeTokens(cls));
              }} />
              <div style={{ display: 'flex', gap: 2 }}>
                {(['px', '%', 'vh', 'vw'] as const).map(u => (
                  <ToggleBtn key={u} active={hUnit === u} onClick={() => {
                    if (u === hUnit) return;
                    // Convert the current rendered height (always px) to the target unit
                    const pxVal = domMetrics.h || 0;
                    const frame = document.querySelector('[data-builder-page-frame]');
                    const frameW = (frame as HTMLElement | null)?.clientWidth ?? window.innerWidth;
                    const frameH = (frame as HTMLElement | null)?.clientHeight ?? window.innerHeight;
                    const parentH = (document.querySelector(`[data-builder-id="${nodeId}"]`) as HTMLElement | null)?.parentElement?.clientHeight ?? frameH;
                    let converted: number;
                    if (u === 'px') converted = Math.round(pxVal);
                    else if (u === 'vh') converted = Math.round(pxVal / frameH * 100 * 10) / 10;
                    else if (u === 'vw') converted = Math.round(pxVal / frameW * 100 * 10) / 10;
                    else /* % */ converted = Math.round(pxVal / parentH * 100 * 10) / 10;
                    patchStyle({ height: `${converted}${u}`, minHeight: '0' });
                    patchCls(clearHModeTokens(cls));
                  }} style={{ fontSize: 9, padding: '1px 5px', minWidth: 0 }}>{u}</ToggleBtn>
                ))}
              </div>
            </div>
          </FieldWithBinding>
        </div>

        {/* ── Inset controls (shown when position is relative / absolute / fixed / sticky) ── */}
        {(positionToken === 'relative' || positionToken === 'absolute' || positionToken === 'fixed' || positionToken === 'sticky') && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1 }}>Inset</div>
              {(positionToken === 'absolute' || positionToken === 'fixed') && (
                <button
                  type="button"
                  title="Fill parent (inset-0)"
                  onClick={() => {
                    patchCls(`${cls} inset-0`.trim());
                    patchStyle({ top: '', right: '', bottom: '', left: '' });
                  }}
                  style={{ fontSize: 9, color: '#60a5fa', background: 'none', border: '1px solid #1e3a5f', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}
                >
                  Fill parent
                </button>
              )}
            </div>
            <InsetDiagram
              values={{
                top:    parseTwArbitrary(cls, 'top-')    ?? (nodeStyle.top    ? (parseInt(nodeStyle.top)    || 0) : null),
                right:  parseTwArbitrary(cls, 'right-')  ?? (nodeStyle.right  ? (parseInt(nodeStyle.right)  || 0) : null),
                bottom: parseTwArbitrary(cls, 'bottom-') ?? (nodeStyle.bottom ? (parseInt(nodeStyle.bottom) || 0) : null),
                left:   parseTwArbitrary(cls, 'left-')   ?? (nodeStyle.left   ? (parseInt(nodeStyle.left)   || 0) : null),
              }}
              onChange={(side, px) => patchStyle({ [side]: `${px}px` })}
            />
          </div>
        )}
      </div>

      {/* ── W/H Resize modes ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Dimensions" overriddenBreakpoints={getSectionOverriddenBps(SECTION_CSS_PROPS['dimensions']!)} onRemoveBreakpoint={bp => removeSectionBp(bp, SECTION_CSS_PROPS['dimensions']!)} onResetAll={() => resetSectionResponsive(SECTION_CSS_PROPS['dimensions']!)} />
        <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
          {/* W mode — headerTitle puts bind icon beside "W" label */}
          <FieldWithBinding label="wMode" hint="hug=w-fit, fill=w-full/flex-1, screen=w-screen, fixed=''" headerTitle="W" responsiveOverrides={getOverriddenBps('width')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="width" value={(classFormulas?.['wMode'] as FormulaValue) ?? (cls.includes('w-fit') ? 'w-fit' : cls.includes('w-screen') ? 'w-screen' : (cls.includes('w-full') || (parentIsRow && cls.includes('flex-1'))) ? 'w-full' : '')} onChange={v => bindOrPatchCls('wMode', evaluated => {
            if (evaluated === 'w-fit')    { patchCls(replaceTwToken(clearWMode(cls), 'w-', 'w-fit'));    patchStyle({ width: '', minWidth: '' }); }
            else if (evaluated === 'w-full') {
              patchCls(parentIsRow ? `${clearWMode(cls)} flex-1`.trim() : replaceTwToken(clearWMode(cls), 'w-', 'w-full'));
              patchStyle({ width: '', minWidth: '' });
            }
            else if (evaluated === 'w-screen') { patchCls(replaceTwToken(clearWMode(cls), 'w-', 'w-screen')); patchStyle({ width: '', minWidth: '' }); }
            else { patchCls(clearWModeTokens(cls)); }
          }, v)} expectedType="string">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {([['Hug', 'w-fit', 'Shrink to content (w-fit)'], ['Fill', 'w-full', 'Fill parent flex space (flex-1 in flex-row parent, w-full in flex-col parent)'], ['Screen', 'w-screen', 'Full viewport width (w-screen / 100vw)'], ['Fixed', '', 'Exact pixel / vh / vw size']] as const).map(([label, token, tooltip]) => {
                const rW = rOvr('width');
                const active = rW !== undefined
                  ? (token === 'w-fit' ? rW === 'fit-content' : token === 'w-full' ? rW === '100%' : token === 'w-screen' ? rW === '100vw' : !['fit-content','100%','100vw'].includes(rW))
                  : token
                    ? (token === 'w-full' ? (cls.includes('w-full') || (parentIsRow && cls.includes('flex-1'))) : cls.includes(token))
                    : (!cls.includes('w-fit') && !cls.includes('w-full') && !cls.includes('w-screen') && !(parentIsRow && cls.includes('flex-1')));
                return (
                  <ToggleBtn key={label} data-testid={`dim-w-${label.toLowerCase()}`} active={active} title={tooltip} style={{ textAlign: 'center' }} onClick={() => {
                    if (token === 'w-full') {
                      patchCls(parentIsRow ? `${clearWMode(cls)} flex-1`.trim() : replaceTwToken(clearWMode(cls), 'w-', 'w-full'));
                      patchStyle({ width: '', minWidth: '' });
                    } else if (token) {
                      patchCls(replaceTwToken(clearWMode(cls), 'w-', token));
                      patchStyle({ width: '', minWidth: '' });
                    } else {
                      patchCls(clearWModeTokens(cls));
                    }
                  }}>
                    {label}
                  </ToggleBtn>
                );
              })}
            </div>
          </FieldWithBinding>
          {/* H mode — headerTitle puts bind icon beside "H" label */}
          {/* Fill = flex-1 (grow in flex parent, matches Figma behaviour)       */}
          {/* Screen = h-screen (100vh, always resolves regardless of parent)    */}
          <FieldWithBinding label="hMode" hint="hug=h-fit, fill=flex-1/self-stretch, screen=h-screen, fixed=''" headerTitle="H" responsiveOverrides={getOverriddenBps('height')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="height" value={(classFormulas?.['hMode'] as FormulaValue) ?? (cls.includes('h-fit') ? 'h-fit' : cls.includes('h-screen') ? 'h-screen' : (parentIsRow ? cls.includes('self-stretch') : (cls.includes('flex-1') || cls.includes('self-stretch'))) ? 'flex-1' : '')} onChange={v => bindOrPatchCls('hMode', evaluated => {
            if (evaluated === 'h-fit')    { patchCls(replaceTwToken(clearHMode(cls), 'h-', 'h-fit'));    patchStyle({ height: '', minHeight: '' }); }
            else if (evaluated === 'flex-1') {
              const fillToken = parentIsRow ? 'self-stretch' : 'flex-1';
              patchCls(`${clearHMode(cls)} ${fillToken}`.trim());
              patchStyle({ height: '', minHeight: '' });
            }
            else if (evaluated === 'h-screen') { patchCls(replaceTwToken(clearHMode(cls), 'h-', 'h-screen')); patchStyle({ height: '', minHeight: '' }); }
            else { patchCls(clearHModeTokens(cls)); }
          }, v)} expectedType="string">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {([['Hug', 'h-fit', 'Shrink to content (h-fit)'], ['Fill', 'flex-1', 'Fill parent flex space (flex-1 in flex-col parent, self-stretch in flex-row parent)'], ['Screen', 'h-screen', 'Full viewport height (h-screen / 100vh)'], ['Fixed', '', 'Exact pixel / vh / vw size']] as const).map(([label, token, tooltip]) => {
                const rH = rOvr('height');
                const active = rH !== undefined
                  ? (token === 'h-fit' ? rH === 'fit-content' : token === 'flex-1' ? rH === '100%' : token === 'h-screen' ? rH === '100vh' : !['fit-content','100%','100vh'].includes(rH))
                  : token
                    ? (token === 'flex-1' ? (parentIsRow ? cls.includes('self-stretch') : (cls.includes('flex-1') || cls.includes('self-stretch'))) : cls.includes(token))
                    : (!cls.includes('h-fit') && !cls.includes('h-screen') && !cls.includes('self-stretch') && (parentIsRow || !cls.includes('flex-1')));
                return (
                  <ToggleBtn key={label} data-testid={`dim-h-${label.toLowerCase()}`} active={active} title={tooltip} style={{ textAlign: 'center' }} onClick={() => {
                    if (token === 'flex-1') {
                      const fillToken = parentIsRow ? 'self-stretch' : 'flex-1';
                      patchCls(`${clearHMode(cls)} ${fillToken}`.trim());
                      patchStyle({ height: '', minHeight: '' });
                    } else if (token) {
                      patchCls(replaceTwToken(clearHMode(cls), 'h-', token));
                      patchStyle({ height: '', minHeight: '' });
                    } else {
                      patchCls(clearHModeTokens(cls));
                    }
                  }}>
                    {label}
                  </ToggleBtn>
                );
              })}
            </div>
          </FieldWithBinding>
        </div>
        {/* Min / Max constraints */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <FieldWithBinding label="minWidth" displayLabel="Min W" hint="e.g. 0, 100px, 50%" value={(nodeStyle.minWidth ?? '') as FormulaValue} onChange={v => bindOrPatch('minWidth', v)} responsiveOverrides={getOverriddenBps('minWidth')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="minWidth">
            <NumberInput
              label="Min W"
              testId="input-min-w"
              value={(parseTwArbitrary(cls, 'min-w-') ?? parseInt(nodeStyle.minWidth ?? '0')) || 0}
              onChange={px => patchStyle({ minWidth: px > 0 ? `${px}px` : '' })}
            />
          </FieldWithBinding>
          <FieldWithBinding label="maxWidth" displayLabel="Max W" hint="e.g. 100%, 800px, none" value={(nodeStyle.maxWidth ?? '') as FormulaValue} onChange={v => bindOrPatch('maxWidth', v)} responsiveOverrides={getOverriddenBps('maxWidth')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="maxWidth">
            <NumberInput
              label="Max W"
              testId="input-max-w"
              value={parseTwArbitrary(cls, 'max-w-') ?? (nodeStyle.maxWidth ? parseInt(nodeStyle.maxWidth) || 0 : 0)}
              onChange={px => patchStyle({ maxWidth: px > 0 ? `${px}px` : '' })}
            />
          </FieldWithBinding>
          <FieldWithBinding label="minHeight" displayLabel="Min H" hint="e.g. 0, 100px, 50%" value={(nodeStyle.minHeight ?? '') as FormulaValue} onChange={v => bindOrPatch('minHeight', v)} responsiveOverrides={getOverriddenBps('minHeight')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="minHeight">
            <NumberInput
              label="Min H"
              testId="input-min-h"
              value={(parseTwArbitrary(cls, 'min-h-') ?? parseInt(nodeStyle.minHeight ?? '0')) || 0}
              onChange={px => patchStyle({ minHeight: px > 0 ? `${px}px` : '' })}
            />
          </FieldWithBinding>
          <FieldWithBinding label="maxHeight" displayLabel="Max H" hint="e.g. 100px, 50vh, none" value={(nodeStyle.maxHeight ?? '') as FormulaValue} onChange={v => bindOrPatch('maxHeight', v)} responsiveOverrides={getOverriddenBps('maxHeight')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="maxHeight">
            <NumberInput
              label="Max H"
              testId="input-max-h"
              value={parseTwArbitrary(cls, 'max-h-') ?? (nodeStyle.maxHeight ? parseInt(nodeStyle.maxHeight) || 0 : 0)}
              onChange={px => patchStyle({ maxHeight: px > 0 ? `${px}px` : '' })}
            />
          </FieldWithBinding>
        </div>
      </div>

      {/* ── Self Alignment — how this node positions itself in its parent ── */}
      <div style={SECTION_STYLE}>
        <FieldWithBinding label="selfAlignment" hint="e.g. self-center, self-start, self-stretch, self-auto" value={(classFormulas?.['selfAlignment'] as FormulaValue) ?? selfToken} onChange={v => bindOrPatchCls('selfAlignment', evaluated => {
          patchCls(replaceTwToken(removeTwToken(cls, 'self-'), 'self-', evaluated === 'self-auto' ? '' : evaluated).trim());
        }, v)} expectedType="string" headerTitle="Self Alignment" responsiveOverrides={getOverriddenBps('alignSelf')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="alignSelf">
          <>
            <div style={{ display: 'flex', gap: 4 }}>
              {([
                ['self-start',   'Start (left)'],
                ['self-center',  'Center'],
                ['self-end',     'End (right)'],
                ['self-stretch', 'Stretch (fill width)'],
                ['self-auto',    'Auto (inherit from parent)'],
              ] as const).map(([token, label]) => (
                <ToggleBtn
                  key={token}
                  active={selfToken === token}
                  title={label}
                  data-testid={`self-align-${token}`}
                  onClick={() => patchCls(replaceTwToken(removeTwToken(cls, 'self-'), 'self-', token === 'self-auto' ? '' : token).trim())}
                  style={{ padding: '4px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {token === 'self-start' && <svg width="12" height="10" viewBox="0 0 12 10" fill="none"><rect x="1" y="0" width="1.2" height="10" fill="currentColor" rx="0.5"/><path d="M3.5 5h7M8 2.5l2.5 2.5L8 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  {token === 'self-center' && <svg width="12" height="10" viewBox="0 0 12 10" fill="none"><rect x="5.4" y="0" width="1.2" height="10" fill="currentColor" rx="0.5"/><path d="M2 5h8M9 2.5l2.5 2.5L9 7.5M3 2.5L.5 5 3 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  {token === 'self-end' && <svg width="12" height="10" viewBox="0 0 12 10" fill="none"><rect x="9.8" y="0" width="1.2" height="10" fill="currentColor" rx="0.5"/><path d="M8.5 5H1.5M4 2.5L1.5 5 4 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  {token === 'self-stretch' && <svg width="12" height="10" viewBox="0 0 12 10" fill="none"><rect x="0" y="0" width="1.2" height="10" fill="currentColor" rx="0.5"/><rect x="10.8" y="0" width="1.2" height="10" fill="currentColor" rx="0.5"/><path d="M2.5 5h7M8 2.5l2.5 2.5L8 7.5M4 2.5L1.5 5 4 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  {token === 'self-auto' && <svg width="12" height="10" viewBox="0 0 12 10" fill="none"><circle cx="6" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2"/><line x1="6" y1="2" x2="6" y2="8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5"/><line x1="3" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5"/></svg>}
                </ToggleBtn>
              ))}
            </div>
            <div style={{ marginTop: 4, fontSize: 9, color: '#4b5563' }}>
              Positions this element within its parent container
            </div>
          </>
        </FieldWithBinding>
      </div>

      {/* ── Rotation + Flip ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Transform" />
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <FieldWithBinding label="rotate" displayLabel="Rotate °" hint="degrees: e.g. 45, -90, 180" value={(styleTransform ?? '') as FormulaValue} onChange={v => bindOrPatch('transform', v)} responsiveOverrides={getOverriddenBps('transform')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="transform">
            <NumberInput
              label="Rotate °"
              testId="input-rotate"
              value={rotateDeg}
              min={-180} max={180}
              onChange={deg => {
                patchStyle({ transform: deg !== 0 ? `rotate(${deg}deg)` : '' });
              }}
            />
          </FieldWithBinding>
          <div style={{ display: 'flex', gap: 4 }}>
            <ToggleBtn active={isFlipH} title="Flip horizontal" style={{ padding: '4px 7px', display: 'flex', alignItems: 'center' }} onClick={() => {
              patchCls(isFlipH ? removeTwToken(cls, '-scale-x-') : `${cls} -scale-x-100`.trim());
            }}>
              <svg width="14" height="12" viewBox="0 0 14 12" fill="none"><path d="M6 1v10M2.5 4L1 6l1.5 2M11.5 4L13 6l-1.5 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><line x1="1" y1="6" x2="5.5" y2="6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="8.5" y1="6" x2="13" y2="6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            </ToggleBtn>
            <ToggleBtn active={isFlipV} title="Flip vertical" style={{ padding: '4px 7px', display: 'flex', alignItems: 'center' }} onClick={() => {
              patchCls(isFlipV ? removeTwToken(cls, '-scale-y-') : `${cls} -scale-y-100`.trim());
            }}>
              <svg width="12" height="14" viewBox="0 0 12 14" fill="none"><path d="M1 6h10M4 2.5L6 1l2 1.5M4 11.5L6 13l2-1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><line x1="6" y1="1" x2="6" y2="5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="6" y1="8.5" x2="6" y2="13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            </ToggleBtn>
          </div>
        </div>
        {/* Translate X / Y — stored as separate props.style.translateX / .translateY keys.
            The renderer combines them with props.style.transform (rotation) at render time.
            translateX/Y are NOT valid CSS property names, so we use the CSS `translate` property
            for immediate DOM preview (Chrome 104+ / builder always targets modern browsers). */}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <FieldWithBinding
            label="translateX"
            displayLabel="Translate X"
            hint="px offset, e.g. 20, -50. Formula should return a number or px string, e.g. variables['uuid']"
            value={(nodeStyle.translateX ?? '') as FormulaValue}
            responsiveOverrides={getOverriddenBps('translateX')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="translateX"
            onChange={v => {
              if (typeof v === 'object' && v !== null) {
                store.patchProp(nodeId, 'props.style.translateX', v);
                const formulaStr = (v as { formula?: string }).formula;
                if (formulaStr) {
                  const zustandData = useSduiStore.getState().data;
                  const vs = getGlobalVariableStore().getState().getFullState() as Record<string, unknown>;
                  const { value: fval } = evaluateFormula(formulaStr, { ...zustandData, ...vs, theme: THEME_OBJ });
                  if (fval != null && typeof fval !== 'object') {
                    const px = parseFloat(String(fval)) || 0;
                    const el = document.querySelector(`[data-builder-id="${nodeId}"]`) as HTMLElement | null;
                    if (el) (el.style as unknown as Record<string, string>).translate = `${px}px ${translateYPx}px`;
                  }
                }
                commitHistory();
              } else {
                const px = parseFloat((v as string) || '0') || 0;
                store.patchProp(nodeId, 'props.style.translateX', px !== 0 ? `${px}px` : '');
                const el = document.querySelector(`[data-builder-id="${nodeId}"]`) as HTMLElement | null;
                if (el) (el.style as unknown as Record<string, string>).translate = `${px}px ${translateYPx}px`;
                commitHistory();
              }
            }}
          >
            <NumberInput
              label="Translate X"
              testId="input-translate-x"
              value={translateXPx}
              min={-1000} max={1000}
              onChange={tx => {
                store.patchProp(nodeId, 'props.style.translateX', tx !== 0 ? `${tx}px` : '');
                const el = document.querySelector(`[data-builder-id="${nodeId}"]`) as HTMLElement | null;
                if (el) (el.style as unknown as Record<string, string>).translate = `${tx}px ${translateYPx}px`;
                commitHistory();
              }}
            />
          </FieldWithBinding>
          <FieldWithBinding
            label="translateY"
            displayLabel="Translate Y"
            hint="px offset, e.g. 20, -50. Formula should return a number or px string, e.g. variables['uuid']"
            value={(nodeStyle.translateY ?? '') as FormulaValue}
            responsiveOverrides={getOverriddenBps('translateY')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="translateY"
            onChange={v => {
              if (typeof v === 'object' && v !== null) {
                store.patchProp(nodeId, 'props.style.translateY', v);
                const formulaStr = (v as { formula?: string }).formula;
                if (formulaStr) {
                  const zustandData = useSduiStore.getState().data;
                  const vs = getGlobalVariableStore().getState().getFullState() as Record<string, unknown>;
                  const { value: fval } = evaluateFormula(formulaStr, { ...zustandData, ...vs, theme: THEME_OBJ });
                  if (fval != null && typeof fval !== 'object') {
                    const py = parseFloat(String(fval)) || 0;
                    const el = document.querySelector(`[data-builder-id="${nodeId}"]`) as HTMLElement | null;
                    if (el) (el.style as unknown as Record<string, string>).translate = `${translateXPx}px ${py}px`;
                  }
                }
                commitHistory();
              } else {
                const py = parseFloat((v as string) || '0') || 0;
                store.patchProp(nodeId, 'props.style.translateY', py !== 0 ? `${py}px` : '');
                const el = document.querySelector(`[data-builder-id="${nodeId}"]`) as HTMLElement | null;
                if (el) (el.style as unknown as Record<string, string>).translate = `${translateXPx}px ${py}px`;
                commitHistory();
              }
            }}
          >
            <NumberInput
              label="Translate Y"
              testId="input-translate-y"
              value={translateYPx}
              min={-1000} max={1000}
              onChange={ty => {
                store.patchProp(nodeId, 'props.style.translateY', ty !== 0 ? `${ty}px` : '');
                const el = document.querySelector(`[data-builder-id="${nodeId}"]`) as HTMLElement | null;
                if (el) (el.style as unknown as Record<string, string>).translate = `${translateXPx}px ${ty}px`;
                commitHistory();
              }}
            />
          </FieldWithBinding>
        </div>
      </div>

      {/* ── Alignment (only for flex containers) ── */}
      {showLayout && (
        <div style={SECTION_STYLE}>
          <SectionHeader title="Alignment" />
          <FieldWithBinding label="alignment" hint='e.g. "items-center justify-start"' value={(classFormulas?.['alignment'] as FormulaValue) ?? (() => {
            const items = (parseTwToken(cls, 'items-') ?? '');
            const justify = (parseTwToken(cls, 'justify-') ?? '');
            return [items, justify].filter(Boolean).join(' ');
          })()} onChange={v => bindOrPatchCls('alignment', evaluated => {
            let next = removeTwToken(removeTwToken(cls, 'items-'), 'justify-');
            evaluated.split(' ').forEach(token => {
              if (token.startsWith('items-') || token.startsWith('justify-')) {
                next = `${next} ${token}`.trim();
              }
            });
            patchCls(next);
          }, v)} expectedType="string" stackLayout>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, width: 72 }}>
              {Array.from({ length: 9 }, (_, i) => {
                const isActive = activeCell === i;
                const FLEX_POS = ['flex-start', 'center', 'flex-end'] as const;
                const dotV = FLEX_POS[Math.floor(i / 3)];
                const dotH = FLEX_POS[i % 3];
                return (
                  <div
                    key={i}
                    data-testid="alignment-cell"
                    data-cell-index={i}
                    onClick={() => patchCls(applyAlignment(cls, i, isRow))}
                    style={{
                      width: 20, height: 20,
                      background: isActive ? '#3b82f6' : '#1f2937',
                      border: `1px solid ${isActive ? '#3b82f6' : '#374151'}`,
                      borderRadius: 3, cursor: 'pointer',
                      display: 'flex', alignItems: dotV, justifyContent: dotH,
                      padding: 3,
                    }}
                  >
                    <div style={{
                      width: 4, height: 4, borderRadius: '50%', flexShrink: 0,
                      background: isActive ? 'rgba(255,255,255,0.9)' : '#4b5563',
                    }} />
                  </div>
                );
              })}
            </div>
          </FieldWithBinding>
        </div>
      )}

      {/* ── Auto Layout (only for flex containers) ── */}
      {showLayout && (
        <div style={SECTION_STYLE}>
          <SectionHeader title="Auto Layout" overriddenBreakpoints={getSectionOverriddenBps(SECTION_CSS_PROPS['auto-layout']!)} onRemoveBreakpoint={bp => removeSectionBp(bp, SECTION_CSS_PROPS['auto-layout']!)} onResetAll={() => resetSectionResponsive(SECTION_CSS_PROPS['auto-layout']!)} />
          <FieldWithBinding label="layoutDir" hint="e.g. flex-row, flex-col, grid" value={(classFormulas?.['layoutDir'] as FormulaValue) ?? (isGrid ? 'grid' : isFlexWrap ? 'flex-row flex-wrap' : flexDir)} responsiveOverrides={getOverriddenBps('flexDirection')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="flexDirection" onChange={v => bindOrPatchCls('layoutDir', evaluated => {
            let next = removeTwToken(removeTwToken(removeTwToken(cls, 'flex-'), 'grid'), 'flex-wrap');
            if (evaluated === 'flex-row flex-wrap') next = `${next} flex flex-row flex-wrap`.trim();
            else if (evaluated === 'grid')          next = `${next} grid`.trim();
            else if (evaluated)                     next = `${next} flex ${evaluated}`.trim();
            patchCls(next);
          }, v)} expectedType="string" stackLayout>
            {/* Flow direction — 4 icons */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {([
                ['flex-row',          'row', 'Row'],
                ['flex-col',          'col', 'Column'],
                ['flex-row flex-wrap','wrap', 'Row wrap'],
                ['grid',              'grid', 'Grid'],
              ] as const).map(([token, icon, label]) => {
                const active = token === 'flex-row flex-wrap'
                  ? (flexDir === 'flex-row' && isFlexWrap)
                  : token === 'grid'
                  ? isGrid
                  : flexDir === token && !isFlexWrap && !isGrid;
                return (
                  <ToggleBtn key={token} active={active} title={label} style={{ padding: '4px 7px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => {
                    let next = removeTwToken(removeTwToken(removeTwToken(cls, 'flex-'), 'grid'), 'flex-wrap');
                    if (token === 'flex-row flex-wrap') next = `${next} flex flex-row flex-wrap`.trim();
                    else if (token === 'grid')          next = `${next} grid`.trim();
                    else                                next = `${next} flex ${token}`.trim();
                    patchCls(next);
                  }}>
                    {icon === 'row'  && <svg width="14" height="10" viewBox="0 0 14 10" fill="none"><rect x="1" y="2" width="3.5" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="5.5" y="2" width="3.5" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="10" y="2" width="3" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>}
                    {icon === 'col'  && <svg width="10" height="14" viewBox="0 0 10 14" fill="none"><rect x="2" y="1" width="6" height="3.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="2" y="5.5" width="6" height="3.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="2" y="10" width="6" height="3" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>}
                    {icon === 'wrap' && <svg width="14" height="12" viewBox="0 0 14 12" fill="none"><rect x="1" y="1" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/><rect x="6" y="1" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="7" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/><path d="M11 5l1.5-1.5L14 5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    {icon === 'grid' && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/><rect x="7" y="1" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="7" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/><rect x="7" y="7" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/></svg>}
                  </ToggleBtn>
                );
              })}
            </div>
          </FieldWithBinding>

          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <FieldWithBinding label="gap" displayLabel="Gap" hint="e.g. 8px, 1rem, 16px" value={(nodeStyle.gap ?? '') as FormulaValue} onChange={v => bindOrPatch('gap', v)} responsiveOverrides={getOverriddenBps('gap')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="gap">
              <NumberInput
                label="Gap"
                testId="input-gap"
                value={gapPx}
                onChange={px => {
                  patchStyle({ gap: px > 0 ? `${px}px` : undefined as unknown as string });
                }}
              />
            </FieldWithBinding>
            {/* Gap mode: Fixed vs Space-between */}
            <div>
              <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>Mode</span>
              <div style={{ display: 'flex', gap: 2 }}>
                <ToggleBtn active={!isSpaceBetween} onClick={() => patchCls(removeTwToken(cls, 'justify-between'))}>Fixed</ToggleBtn>
                <ToggleBtn data-testid="gap-mode-space-between" active={isSpaceBetween} style={{ padding: '4px 7px', display: 'flex', alignItems: 'center' }} onClick={() => patchCls(replaceTwToken(cls, 'justify-', 'justify-between'))}>
                  <svg width="14" height="10" viewBox="0 0 14 10" fill="none"><rect x="1" y="1" width="3" height="8" rx="0.8" stroke="currentColor" strokeWidth="1.2"/><rect x="10" y="1" width="3" height="8" rx="0.8" stroke="currentColor" strokeWidth="1.2"/><path d="M4.5 5h5M3 3l-1.5 2L3 7M11 3l1.5 2L11 7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </ToggleBtn>
              </div>
            </div>
          </div>

          {/* Grid controls — only when grid layout is active */}
          {isGrid && (
            <>
              {/* Divider + Grid label */}
              <div style={{ borderTop: '1px solid #1f2937', marginTop: 2, marginBottom: 6, paddingTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.5 }}><rect x="1" y="1" width="4" height="4" rx="0.8" stroke="#9ca3af" strokeWidth="1.2"/><rect x="7" y="1" width="4" height="4" rx="0.8" stroke="#9ca3af" strokeWidth="1.2"/><rect x="1" y="7" width="4" height="4" rx="0.8" stroke="#9ca3af" strokeWidth="1.2"/><rect x="7" y="7" width="4" height="4" rx="0.8" stroke="#9ca3af" strokeWidth="1.2"/></svg>
                <span style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Grid</span>
              </div>
              {/* Columns + Rows */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <FieldWithBinding label="gridCols" displayLabel="Columns" hint="e.g. grid-cols-2, grid-cols-4" value={(classFormulas?.['gridCols'] as FormulaValue) ?? (GRID_COLS_TOKENS.find(t => cls.includes(t)) ?? 'grid-cols-1')} responsiveOverrides={getOverriddenBps('gridTemplateColumns')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="gridTemplateColumns" onChange={v => bindOrPatchCls('gridCols', evaluated => {
                  let next = cls;
                  GRID_COLS_TOKENS.forEach(t => { next = removeTwToken(next, t); });
                  patchCls(`${next} ${evaluated}`.trim());
                }, v)} expectedType="string">
                  <SelectInput
                    label="Columns"
                    value={GRID_COLS_TOKENS.find(t => cls.includes(t)) ?? 'grid-cols-1'}
                    options={[...GRID_COLS_TOKENS]}
                    onChange={v => {
                      let next = cls;
                      GRID_COLS_TOKENS.forEach(t => { next = removeTwToken(next, t); });
                      patchCls(`${next} ${v}`.trim());
                    }}
                  />
                </FieldWithBinding>
                <FieldWithBinding label="gridRows" displayLabel="Rows" hint="e.g. grid-rows-2, grid-rows-4" value={(classFormulas?.['gridRows'] as FormulaValue) ?? (GRID_ROWS_TOKENS.find(t => cls.includes(t)) ?? 'grid-rows-1')} responsiveOverrides={getOverriddenBps('gridTemplateRows')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="gridTemplateRows" onChange={v => bindOrPatchCls('gridRows', evaluated => {
                  let next = cls;
                  GRID_ROWS_TOKENS.forEach(t => { next = removeTwToken(next, t); });
                  patchCls(`${next} ${evaluated}`.trim());
                }, v)} expectedType="string">
                  <SelectInput
                    label="Rows"
                    value={GRID_ROWS_TOKENS.find(t => cls.includes(t)) ?? 'grid-rows-1'}
                    options={[...GRID_ROWS_TOKENS]}
                    onChange={v => {
                      let next = cls;
                      GRID_ROWS_TOKENS.forEach(t => { next = removeTwToken(next, t); });
                      patchCls(`${next} ${v}`.trim());
                    }}
                  />
                </FieldWithBinding>
              </div>
              {/* Auto flow */}
              <FieldWithBinding label="gridFlow" displayLabel="Auto flow" hint="e.g. grid-flow-row, grid-flow-col, grid-flow-row-dense" value={(classFormulas?.['gridFlow'] as FormulaValue) ?? ((['grid-flow-col','grid-flow-row-dense','grid-flow-col-dense','grid-flow-dense'] as const).find(t => cls.includes(t)) ?? 'grid-flow-row')} onChange={v => bindOrPatchCls('gridFlow', evaluated => {
                const next = removeTwToken(removeTwToken(removeTwToken(removeTwToken(removeTwToken(cls, 'grid-flow-col-dense'), 'grid-flow-row-dense'), 'grid-flow-col'), 'grid-flow-dense'), 'grid-flow-row');
                patchCls(evaluated && evaluated !== 'grid-flow-row' ? `${next} ${evaluated}`.trim() : next);
              }, v)} expectedType="string">
                <SelectInput
                  label="Auto flow"
                  value={(['grid-flow-col','grid-flow-row-dense','grid-flow-col-dense','grid-flow-dense'] as const).find(t => cls.includes(t)) ?? 'grid-flow-row'}
                  options={['grid-flow-row','grid-flow-col','grid-flow-row-dense','grid-flow-col-dense','grid-flow-dense']}
                  onChange={v => {
                    const next = removeTwToken(removeTwToken(removeTwToken(removeTwToken(removeTwToken(cls, 'grid-flow-col-dense'), 'grid-flow-row-dense'), 'grid-flow-col'), 'grid-flow-dense'), 'grid-flow-row');
                    patchCls(v && v !== 'grid-flow-row' ? `${next} ${v}`.trim() : next);
                  }}
                />
              </FieldWithBinding>
            </>
          )}
        </div>
      )}

      {/* ── Padding (hidden for raw text nodes) ── */}
      {showPadding && (
        <div data-testid="section-padding" style={SECTION_STYLE}>
          <SpacingDiagram
            label="padding"
            values={{ top: padding.top, right: padding.right, bottom: padding.bottom, left: padding.left }}
            onChange={(side, px) => {
              const cap = side.charAt(0).toUpperCase() + side.slice(1);
              patchStyle({ [`padding${cap}`]: `${px}px` });
            }}
            onChangeAll={px => patchStyle({
              paddingTop: `${px}px`, paddingRight: `${px}px`,
              paddingBottom: `${px}px`, paddingLeft: `${px}px`,
            })}
            formulaValues={{
              top:    (nodeStyle.paddingTop    ?? '') as FormulaValue,
              right:  (nodeStyle.paddingRight  ?? '') as FormulaValue,
              bottom: (nodeStyle.paddingBottom ?? '') as FormulaValue,
              left:   (nodeStyle.paddingLeft   ?? '') as FormulaValue,
            }}
            onFormulaChange={(side, v) => {
              const cap = side.charAt(0).toUpperCase() + side.slice(1);
              bindOrPatch(`padding${cap}`, v);
            }}
            testIdPrefix="pad"
            responsiveOverrides={getSectionOverriddenBps(['paddingTop','paddingRight','paddingBottom','paddingLeft'])}
            onResponsiveRemove={(bp) => removeSectionBp(bp, ['paddingTop','paddingRight','paddingBottom','paddingLeft'])}
            onResponsiveReset={() => resetSectionResponsive(['paddingTop','paddingRight','paddingBottom','paddingLeft'])}
            perSideOverrides={{
              top: getOverriddenBps('paddingTop'),
              right: getOverriddenBps('paddingRight'),
              bottom: getOverriddenBps('paddingBottom'),
              left: getOverriddenBps('paddingLeft'),
            }}
            onPerSideRemove={removeResponsive}
            onPerSideReset={resetResponsive}
          />
        </div>
      )}

      {/* ── Margin ── */}
      <div data-testid="section-margin" style={SECTION_STYLE}>
        <SpacingDiagram
          label="margin"
          values={{ top: margin.top, right: margin.right, bottom: margin.bottom, left: margin.left }}
          onChange={(side, px) => {
            const cap = side.charAt(0).toUpperCase() + side.slice(1);
            patchStyle({ [`margin${cap}`]: `${px}px` });
          }}
          onChangeAll={px => patchStyle({
            marginTop: `${px}px`, marginRight: `${px}px`,
            marginBottom: `${px}px`, marginLeft: `${px}px`,
          })}
          formulaValues={{
            top:    (nodeStyle.marginTop    ?? '') as FormulaValue,
            right:  (nodeStyle.marginRight  ?? '') as FormulaValue,
            bottom: (nodeStyle.marginBottom ?? '') as FormulaValue,
            left:   (nodeStyle.marginLeft   ?? '') as FormulaValue,
          }}
          onFormulaChange={(side, v) => {
            const cap = side.charAt(0).toUpperCase() + side.slice(1);
            bindOrPatch(`margin${cap}`, v);
          }}
          testIdPrefix="margin"
          responsiveOverrides={getSectionOverriddenBps(['marginTop','marginRight','marginBottom','marginLeft'])}
          onResponsiveRemove={(bp) => removeSectionBp(bp, ['marginTop','marginRight','marginBottom','marginLeft'])}
          onResponsiveReset={() => resetSectionResponsive(['marginTop','marginRight','marginBottom','marginLeft'])}
          perSideOverrides={{
            top: getOverriddenBps('marginTop'),
            right: getOverriddenBps('marginRight'),
            bottom: getOverriddenBps('marginBottom'),
            left: getOverriddenBps('marginLeft'),
          }}
          onPerSideRemove={removeResponsive}
          onPerSideReset={resetResponsive}
        />
      </div>

      {/* ── Typography (text nodes only) ── */}
      {isTextNode && (
        <div data-testid="section-typography" style={SECTION_STYLE}>
          <SectionHeader title="Typography" overriddenBreakpoints={getSectionOverriddenBps(SECTION_CSS_PROPS['typography']!)} onRemoveBreakpoint={bp => removeSectionBp(bp, SECTION_CSS_PROPS['typography']!)} onResetAll={() => resetSectionResponsive(SECTION_CSS_PROPS['typography']!)}>
            <MiniPreview
              style={{ width: 36, background: 'transparent', border: '1px solid #374151', borderRadius: 3 }}
              title={`${fontSizePx}px · ${fontWeight}`}
            >
              <span style={{ fontSize: Math.max(8, Math.min(fontSizePx, 13)), color: computedTextColor || '#d1d5db', fontFamily: 'serif', lineHeight: 1, userSelect: 'none' }}>Aa</span>
            </MiniPreview>
          </SectionHeader>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6, marginTop: 4 }}>
            <FieldWithBinding label="fontSize" displayLabel="Size" hint="e.g. 14px, 16px, 24px" value={(nodeStyle.fontSize ?? '') as FormulaValue} onChange={v => bindOrPatch('fontSize', v)} responsiveOverrides={getOverriddenBps('fontSize')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="fontSize">
              <NumberInput
                label="Size"
                testId="input-text-size"
                value={fontSizePx}
                onChange={px => patchStyle({ fontSize: `${px}px` })}
              />
            </FieldWithBinding>
            <FieldWithBinding label="fontWeightClass" displayLabel="Weight" hint="e.g. font-bold, font-semibold, font-normal" value={(classFormulas?.['fontWeightClass'] as FormulaValue) ?? fontWeight} onChange={v => bindOrPatchCls('fontWeightClass', evaluated => patchCls(replaceTwToken(cls, 'font-', evaluated)), v)} expectedType="string" responsiveOverrides={getOverriddenBps('fontWeight')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="fontWeight">
              <SelectInput label="Weight" testId="select-font-weight" value={fontWeight} options={FONT_WEIGHT_TOKENS} onChange={v => patchCls(replaceTwToken(cls, 'font-', v))} />
            </FieldWithBinding>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <FieldWithBinding label="leading" displayLabel="Leading" hint="e.g. leading-tight, leading-relaxed, leading-6" value={(classFormulas?.['leading'] as FormulaValue) ?? leading} onChange={v => bindOrPatchCls('leading', evaluated => patchCls(replaceTwToken(cls, 'leading-', evaluated)), v)} expectedType="string" responsiveOverrides={getOverriddenBps('lineHeight')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="lineHeight">
              <SelectInput label="Leading" testId="select-leading" value={leading} options={LEADING_TOKENS} onChange={v => patchCls(replaceTwToken(cls, 'leading-', v))} />
            </FieldWithBinding>
            <FieldWithBinding label="tracking" displayLabel="Tracking" hint="e.g. tracking-wide, tracking-tight, tracking-normal" value={(classFormulas?.['tracking'] as FormulaValue) ?? tracking} onChange={v => bindOrPatchCls('tracking', evaluated => patchCls(replaceTwToken(cls, 'tracking-', evaluated)), v)} expectedType="string" responsiveOverrides={getOverriddenBps('letterSpacing')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="letterSpacing">
              <SelectInput label="Tracking" testId="select-tracking" value={tracking} options={TRACKING_TOKENS} onChange={v => patchCls(replaceTwToken(cls, 'tracking-', v))} />
            </FieldWithBinding>
          </div>
          {/* Text alignment — 4 icon buttons with formula binding */}
          <FieldWithBinding label="textAlign" displayLabel="Align" hint='e.g. "text-left", "text-center", "text-right", "text-justify"' value={(classFormulas?.['textAlign'] as FormulaValue) ?? textAlign} onChange={v => bindOrPatchCls('textAlign', evaluated => {
            let next = cls;
            TEXT_ALIGN_TOKENS.forEach(t => { next = removeTwToken(next, t); });
            patchCls(evaluated === 'text-left' || !evaluated ? next : `${next} ${evaluated}`.trim());
          }, v)} expectedType="string" stackLayout responsiveOverrides={getOverriddenBps('textAlign')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="textAlign">
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              {([['text-left','left'],['text-center','center'],['text-right','right'],['text-justify','justify']] as const).map(([token, icon]) => (
                <ToggleBtn key={token} active={textAlign === token} style={{ padding: '4px 6px', display: 'flex', alignItems: 'center' }} onClick={() => {
                  let next = cls;
                  TEXT_ALIGN_TOKENS.forEach(t => { next = removeTwToken(next, t); });
                  patchCls(token === 'text-left' ? next : `${next} ${token}`.trim());
                }}>
                  {icon === 'left'    && <svg width="12" height="10" viewBox="0 0 12 10" fill="none"><line x1="1" y1="2" x2="11" y2="2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="1" y1="5" x2="8" y2="5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="1" y1="8" x2="10" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>}
                  {icon === 'center'  && <svg width="12" height="10" viewBox="0 0 12 10" fill="none"><line x1="1" y1="2" x2="11" y2="2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="2.5" y1="5" x2="9.5" y2="5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="1" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>}
                  {icon === 'right'   && <svg width="12" height="10" viewBox="0 0 12 10" fill="none"><line x1="1" y1="2" x2="11" y2="2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="4" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="2" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>}
                  {icon === 'justify' && <svg width="12" height="10" viewBox="0 0 12 10" fill="none"><line x1="1" y1="2" x2="11" y2="2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="1" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="1" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>}
                </ToggleBtn>
              ))}
            </div>
          </FieldWithBinding>
          {/* Text decoration & transform */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <FieldWithBinding label="textDecoration" displayLabel="Decoration" hint="e.g. underline, line-through, no-underline" value={(classFormulas?.['textDecoration'] as FormulaValue) ?? textDecor} responsiveOverrides={getOverriddenBps('textDecoration')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="textDecoration" onChange={v => bindOrPatchCls('textDecoration', evaluated => {
              let next = cls;
              TEXT_DECORATION_TOKENS.forEach(t => { next = removeTwToken(next, t); });
              patchCls(evaluated === 'no-underline' ? next : `${next} ${evaluated}`.trim());
            }, v)} expectedType="string">
              <SelectInput label="Decoration" value={textDecor} options={TEXT_DECORATION_TOKENS} onChange={v => {
                let next = cls;
                TEXT_DECORATION_TOKENS.forEach(t => { next = removeTwToken(next, t); });
                patchCls(v === 'no-underline' ? next : `${next} ${v}`.trim());
              }} />
            </FieldWithBinding>
            <FieldWithBinding label="textTransform" displayLabel="Transform" hint="e.g. uppercase, lowercase, capitalize, normal-case" value={(classFormulas?.['textTransform'] as FormulaValue) ?? textTransform} responsiveOverrides={getOverriddenBps('textTransform')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="textTransform" onChange={v => bindOrPatchCls('textTransform', evaluated => {
              let next = cls;
              TEXT_TRANSFORM_TOKENS.forEach(t => { next = removeTwToken(next, t); });
              patchCls(evaluated === 'normal-case' ? next : `${next} ${evaluated}`.trim());
            }, v)} expectedType="string">
              <SelectInput label="Transform" value={textTransform} options={TEXT_TRANSFORM_TOKENS} onChange={v => {
                let next = cls;
                TEXT_TRANSFORM_TOKENS.forEach(t => { next = removeTwToken(next, t); });
                patchCls(v === 'normal-case' ? next : `${next} ${v}`.trim());
              }} />
            </FieldWithBinding>
          </div>
          <div>
            <FieldWithBinding label="color" displayLabel="Color" hint="CSS color: e.g. red, #333333, rgba(0,0,0,0.8)" value={(nodeStyle.color as unknown as FormulaValue) ?? ''} onChange={v => bindOrPatch('color', v)} responsiveOverrides={getOverriddenBps('color')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="color">
              <div>
                <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>Color</span>
                <FigmaColorPicker
                  testId="input-text-color"
                  value={computedTextColor}
                  onChange={(hex, cssVar) => cssVar
                    ? patchColorAsThemeVar('color', 'props.style.color', 'text', cssVar)
                    : patchStyle({ color: hex || '' })
                  }
                />
              </div>
            </FieldWithBinding>
          </div>

          {/* ── Text overflow / whitespace / word-break ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            {/* Overflow — ellipsis uses Tailwind truncate shorthand (overflow-hidden + whitespace-nowrap + text-ellipsis) */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: '#6b7280', width: 60, flexShrink: 0 }}>Overflow</span>
              {([
                { v: '' as const,        label: 'none',     title: 'No overflow handling' },
                { v: 'truncate' as const, label: 'ellipsis', title: 'Clip + nowrap + ellipsis (truncate)' },
                { v: 'clip' as const,    label: 'clip',     title: 'Clip text, no ellipsis' },
              ]).map(({ v, label, title }) => {
                const active = v === '' 
                  ? !cls.includes('truncate') && !cls.includes('text-clip')
                  : v === 'truncate' ? cls.includes('truncate')
                  : cls.includes('text-clip') && !cls.includes('truncate');
                return (
                  <ToggleBtn key={v || 'none'} active={active} title={title} onClick={() => {
                    let next = removeTwToken(removeTwToken(removeTwToken(cls, 'truncate'), 'text-clip'), 'overflow-hidden');
                    if (v === 'truncate') next = `${next} truncate`.trim();
                    else if (v === 'clip') next = `${next} overflow-hidden text-clip`.trim();
                    patchCls(next);
                  }} style={{ fontSize: 9, padding: '2px 5px' }}>{label}</ToggleBtn>
                );
              })}
            </div>
            {/* Whitespace */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: '#6b7280', width: 60, flexShrink: 0 }}>Whitespace</span>
              {(['', 'whitespace-nowrap', 'whitespace-pre', 'whitespace-normal'] as const).map(v => (
                <ToggleBtn
                  key={v || 'default'}
                  active={v === '' ? (!cls.includes('whitespace-nowrap') && !cls.includes('whitespace-pre') && !cls.includes('whitespace-normal')) : cls.includes(v)}
                  title={v === '' ? 'Default (wrap normally)' : v === 'whitespace-nowrap' ? 'No wrapping' : v === 'whitespace-pre' ? 'Preserve whitespace' : 'Normal wrapping'}
                  onClick={() => {
                    let next = removeTwToken(removeTwToken(removeTwToken(cls, 'whitespace-nowrap'), 'whitespace-pre'), 'whitespace-normal');
                    if (v) next = `${next} ${v}`.trim();
                    patchCls(next);
                  }} style={{ fontSize: 9, padding: '2px 5px' }}>{v ? v.replace('whitespace-', '') : 'def'}</ToggleBtn>
              ))}
            </div>
            {/* Word break */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: '#6b7280', width: 60, flexShrink: 0 }}>Word break</span>
              {(['', 'break-all', 'break-words', 'break-keep'] as const).map(v => (
                <ToggleBtn
                  key={v || 'none'}
                  active={v === '' ? (!cls.includes('break-all') && !cls.includes('break-words') && !cls.includes('break-keep')) : cls.includes(v)}
                  title={v === '' ? 'Default' : v === 'break-all' ? 'Break at any character' : v === 'break-words' ? 'Break long words only' : 'Keep CJK words together'}
                  onClick={() => {
                    let next = removeTwToken(removeTwToken(removeTwToken(cls, 'break-all'), 'break-words'), 'break-keep');
                    if (v) next = `${next} ${v}`.trim();
                    patchCls(next);
                  }} style={{ fontSize: 9, padding: '2px 5px' }}>{v ? v.replace('break-', '') : 'none'}</ToggleBtn>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Interaction ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Interaction" overriddenBreakpoints={getSectionOverriddenBps(SECTION_CSS_PROPS['display']!)} onRemoveBreakpoint={bp => removeSectionBp(bp, SECTION_CSS_PROPS['display']!)} onResetAll={() => resetSectionResponsive(SECTION_CSS_PROPS['display']!)} />
        <div style={{ display: 'flex', gap: 6 }}>
          <FieldWithBinding label="cursor" displayLabel="Cursor" hint="e.g. cursor-pointer, cursor-default" value={(classFormulas?.['cursor'] as FormulaValue) ?? cursorToken} onChange={v => bindOrPatchCls('cursor', evaluated => patchCls(replaceTwToken(cls, 'cursor-', evaluated)), v)} expectedType="string" responsiveOverrides={getOverriddenBps('cursor')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="cursor">
            <SelectInput
              label="Cursor"
              value={cursorToken}
              options={CURSOR_TOKENS}
              onChange={v => patchCls(replaceTwToken(cls, 'cursor-', v))}
            />
          </FieldWithBinding>
        </div>
      </div>

      {/* ── Overflow ── */}
      <div style={SECTION_STYLE}>
        <FieldWithBinding
          label="overflow"
          displayLabel="Overflow"
          hint='e.g. overflow-hidden, overflow-auto, overflow-x-auto, overflow-y-auto'
          value={(classFormulas?.['overflow'] as FormulaValue) ?? (currentOverflow === 'none' ? '' : currentOverflow)}
          responsiveOverrides={getOverriddenBps('overflow')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="overflow"
          onChange={v => bindOrPatchCls('overflow', evaluated => {
            let next = removeTwToken(cls, 'overflow-');
            if (evaluated && evaluated !== 'none') next = `${next} ${evaluated}`.trim();
            patchCls(next);
          }, v)}
          expectedType="string"
          stackLayout
        >
          <div style={{ display: 'flex', gap: 2 }}>
            {([
              ['none',             '—',     'Default (no overflow class)'],
              ['overflow-hidden',  'clip',  'overflow-hidden — clips content'],
              ['overflow-auto',    'auto',  'overflow-auto — scrolls when needed'],
              ['overflow-scroll',  'scroll','overflow-scroll — always shows scrollbar'],
              ['overflow-x-auto',  'x',     'overflow-x-auto — horizontal scroll'],
              ['overflow-y-auto',  'y',     'overflow-y-auto — vertical scroll'],
            ] as const).map(([token, label, title]) => (
              <ToggleBtn
                key={token}
                title={title}
                active={currentOverflow === token}
                style={{ padding: '3px 6px', fontSize: 10 }}
                onClick={() => {
                  let next = removeTwToken(cls, 'overflow-');
                  if (token !== 'none') next = `${next} ${token}`.trim();
                  patchCls(next);
                }}
              >
                {label}
              </ToggleBtn>
            ))}
          </div>
        </FieldWithBinding>
      </div>

      {/* ── Fill & Opacity ── */}
      <div data-testid="section-fill" style={SECTION_STYLE}>
        <SectionHeader title="Fill & Opacity" overriddenBreakpoints={getSectionOverriddenBps(SECTION_CSS_PROPS['fill-opacity']!)} onRemoveBreakpoint={bp => removeSectionBp(bp, SECTION_CSS_PROPS['fill-opacity']!)} onResetAll={() => resetSectionResponsive(SECTION_CSS_PROPS['fill-opacity']!)} />
        <div style={{ marginTop: 4 }}>
          <FillBackgroundSection
            nodeId={nodeId}
            node={node}
            store={store}
            commitHistory={commitHistory}
            computedBgColor={computedBgColor}
            patchColorAsThemeVar={patchColorAsThemeVar}
            patchStyle={patchStyle as (patch: Record<string, string>) => void}
          />
        </div>
        {/* Background alpha is now controlled via rgba() in the color picker above */}
        <div style={{ marginTop: 6 }}>
          <FieldWithBinding label="opacity" displayLabel="Opacity" hint="number 0–1 e.g. 0.5, 0.8, 1 (no quotes)" value={(nodeStyle.opacity ?? '') as FormulaValue} onChange={v => bindOrPatch('opacity', v)} responsiveOverrides={getOverriddenBps('opacity')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="opacity">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, color: '#6b7280', minWidth: 60 }}>Element opacity</span>
              <input
                type="range" min={5} max={100} step={5}
                key={nodeId}
                defaultValue={opacityVal < 5 ? 5 : opacityVal}
                data-testid="input-opacity-slider"
                onChange={e => {
                  const val = parseInt(e.target.value);
                  const el = document.querySelector(`[data-builder-id="${nodeId}"]`) as HTMLElement | null;
                  if (el) el.style.opacity = val >= 100 ? '' : String(val / 100);
                  const label = e.target.closest('[data-field="opacity"]')?.querySelector('[data-opacity-label]') as HTMLElement | null;
                  if (label) label.textContent = `${val}%`;
                }}
                onMouseUp={e => {
                  const val = parseInt((e.target as HTMLInputElement).value);
                  if (val >= 100) {
                    patchStyle({ opacity: undefined as unknown as string });
                    const cleaned = removeTwToken(cls, 'opacity-');
                    if (cleaned !== cls) patchCls(cleaned);
                  } else {
                    patchStyle({ opacity: String(val / 100) });
                  }
                }}
                style={{ flex: 1 }}
              />
              <span data-opacity-label style={{ fontSize: 10, color: '#d1d5db', minWidth: 28 }}>{opacityVal}%</span>
            </div>
          </FieldWithBinding>
        </div>
      </div>

      {/* ── Stroke ── */}
      <div data-testid="section-border" style={SECTION_STYLE}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <SectionHeader title="Stroke" overriddenBreakpoints={getSectionOverriddenBps(SECTION_CSS_PROPS['stroke']!)} onRemoveBreakpoint={bp => removeSectionBp(bp, SECTION_CSS_PROPS['stroke']!)} onResetAll={() => resetSectionResponsive(SECTION_CSS_PROPS['stroke']!)}>
            {borderWidthPx > 0 && (
              <MiniPreview
                style={{ background: 'transparent', border: `${Math.min(borderWidthPx, 4)}px solid ${computedBorderColor || '#6b7280'}` }}
                title={`${borderWidthPx}px ${borderStyle}`}
              />
            )}
          </SectionHeader>
        </div>
        <div style={{ marginBottom: 6 }}>
          <FieldWithBinding label="borderColor" displayLabel="Border Color" hint="CSS color: e.g. #374151, rgba(0,0,0,0.5)" value={(nodeStyle.borderColor as unknown as FormulaValue) ?? ''} onChange={v => bindOrPatch('borderColor', v)} responsiveOverrides={getOverriddenBps('borderColor')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="borderColor">
            <div>
              <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>Color</span>
              <FigmaColorPicker
                testId="input-stroke-color"
                value={computedBorderColor}
                onChange={(hex, cssVar) => cssVar
                  ? patchColorAsThemeVar('borderColor', 'props.style.borderColor', 'border', cssVar)
                  : patchStyle({ borderColor: hex || '' })
                }
              />
            </div>
          </FieldWithBinding>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <FieldWithBinding label="borderWidth" displayLabel="Width" hint="e.g. 1px, 2px, 0" value={(nodeStyle.borderWidth ?? '') as FormulaValue} onChange={v => bindOrPatch('borderWidth', v)} expectedType="string" responsiveOverrides={getOverriddenBps('borderWidth')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="borderWidth">
            <NumberInput
              label="Width"
              testId="input-border-width"
              value={borderWidthPx}
              onChange={px => patchStyle({ borderWidth: `${px}px` })}
            />
          </FieldWithBinding>
          <FieldWithBinding label="borderStyle" displayLabel="Style" hint="e.g. border-solid, border-dashed, border-dotted" value={(classFormulas?.['borderStyle'] as FormulaValue) ?? borderStyle} responsiveOverrides={getOverriddenBps('borderStyle')} onResponsiveRemove={removeResponsive} onResponsiveReset={resetResponsive} responsiveCssProp="borderStyle" onChange={v => bindOrPatchCls('borderStyle', evaluated => {
            let next = cls;
            BORDER_STYLE_TOKENS.forEach(t => { next = removeTwToken(next, t); });
            patchCls(`${next} ${evaluated}`.trim());
          }, v)} expectedType="string">
            <SelectInput
              label="Style"
              value={borderStyle}
              options={BORDER_STYLE_TOKENS}
              onChange={v => {
                let next = cls;
                BORDER_STYLE_TOKENS.forEach(t => { next = removeTwToken(next, t); });
                patchCls(`${next} ${v}`.trim());
              }}
            />
          </FieldWithBinding>
        </div>
      </div>

      {/* ── Border Radius ── */}
      {(() => {
        const baseTlPx = parseTwArbitraryPx(cls, 'rounded-tl-') ?? parseTwArbitraryPx(cls, 'rounded-') ?? parseRoundedNamedTokenPx(cls, 'rounded-tl-') ?? parseRoundedNamedTokenPx(cls, 'rounded-') ?? 0;
        const tlPx = rOvr('borderTopLeftRadius') ? parseFloat(rOvr('borderTopLeftRadius')!) : (rOvr('borderRadius') ? parseFloat(rOvr('borderRadius')!) : baseTlPx);
        const trPx = rOvr('borderTopRightRadius') ? parseFloat(rOvr('borderTopRightRadius')!) : (rOvr('borderRadius') ? parseFloat(rOvr('borderRadius')!) : (parseTwArbitraryPx(cls, 'rounded-tr-') ?? baseTlPx));
        const brPx = rOvr('borderBottomRightRadius') ? parseFloat(rOvr('borderBottomRightRadius')!) : (rOvr('borderRadius') ? parseFloat(rOvr('borderRadius')!) : (parseTwArbitraryPx(cls, 'rounded-br-') ?? baseTlPx));
        const blPx = rOvr('borderBottomLeftRadius') ? parseFloat(rOvr('borderBottomLeftRadius')!) : (rOvr('borderRadius') ? parseFloat(rOvr('borderRadius')!) : (parseTwArbitraryPx(cls, 'rounded-bl-') ?? baseTlPx));
        // Uniform bind: read from borderRadius (all-corners style prop) for the formula value
        const uniformRadiusFormula = (nodeStyle.borderRadius ?? nodeStyle.borderTopLeftRadius ?? '') as FormulaValue;
        const isBound = isBoundValue(uniformRadiusFormula);
        return (
          <div style={SECTION_STYLE}>
            <FieldWithBinding
              label="border-radius"
              headerTitle="Border Radius"
              hint="e.g. 8 (px number) or variables['UUID']"
              value={uniformRadiusFormula}
              onChange={v => {
                bindOrPatch('borderRadius', v);
              }}
              responsiveOverrides={getOverriddenBps('borderRadius')}
              onResponsiveRemove={removeResponsive}
              onResponsiveReset={resetResponsive}
              responsiveCssProp="borderRadius"
            >
              <CornerRadiusDiagram
                values={{ tl: tlPx, tr: trPx, br: brPx, bl: blPx }}
                onChange={(corner, px) => {
                  const styleMap = {
                    tl: 'borderTopLeftRadius',
                    tr: 'borderTopRightRadius',
                    br: 'borderBottomRightRadius',
                    bl: 'borderBottomLeftRadius',
                  } as const;
                  patchStyle({ [styleMap[corner]]: `${px}px` });
                }}
                onChangeAll={px => patchStyle({
                  borderTopLeftRadius:     `${px}px`,
                  borderTopRightRadius:    `${px}px`,
                  borderBottomRightRadius: `${px}px`,
                  borderBottomLeftRadius:  `${px}px`,
                })}
                perCornerOverrides={{
                  tl: getOverriddenBps('borderTopLeftRadius'),
                  tr: getOverriddenBps('borderTopRightRadius'),
                  br: getOverriddenBps('borderBottomRightRadius'),
                  bl: getOverriddenBps('borderBottomLeftRadius'),
                }}
                onPerCornerRemove={removeResponsive}
                onPerCornerReset={resetResponsive}
              />
            </FieldWithBinding>
          </div>
        );
      })()}

      {/* ── Per-side Border ── */}
      {(() => {
        const sides = [
          { key: 't', label: 'T', widthStyle: 'borderTopWidth',    colorStyle: 'borderTopColor',    title: 'Top' },
          { key: 'r', label: 'R', widthStyle: 'borderRightWidth',  colorStyle: 'borderRightColor',  title: 'Right' },
          { key: 'b', label: 'B', widthStyle: 'borderBottomWidth', colorStyle: 'borderBottomColor', title: 'Bottom' },
          { key: 'l', label: 'L', widthStyle: 'borderLeftWidth',   colorStyle: 'borderLeftColor',   title: 'Left' },
        ] as const;
        const hasPerSide = sides.some(s => (nodeStyle as Record<string, unknown>)[s.widthStyle] || (nodeStyle as Record<string, unknown>)[s.colorStyle]);
        const [open, setOpen] = React.useState(hasPerSide);
        return (
          <div style={SECTION_STYLE}>
            <button
              type="button"
              onClick={() => setOpen(o => !o)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, color: '#6b7280', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', padding: 0, width: '100%', textAlign: 'left' }}
            >
              <svg width={8} height={8} viewBox="0 0 8 8" fill="none" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                <path d="M2 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Per-side border
            </button>
            {open && (
              <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '14px 44px 1fr', gap: '5px 6px', alignItems: 'center' }}>
                {sides.map(({ key, label, widthStyle, colorStyle, title }) => {
                  const widthPx = parseTwArbitraryPx(cls, `border-${key}-`) ?? (parseInt(String((nodeStyle as Record<string, unknown>)[widthStyle] ?? '0')) || 0);
                  const colorVal = String((nodeStyle as Record<string, unknown>)[colorStyle] ?? '');
                  return (
                    <React.Fragment key={key}>
                      <span title={title} style={{ fontSize: 9, color: '#6b7280', fontWeight: 600, lineHeight: '26px' }}>{label}</span>
                      <PanelInput
                        value={widthPx}
                        onChange={px => patchStyle({ [widthStyle]: `${px}px` })}
                        min={0}
                        width={44}
                      />
                      <FigmaColorPicker
                        value={colorVal || computedBorderColor}
                        onChange={hex => patchStyle({ [colorStyle]: hex || '' })}
                      />
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Effects (Shadow, Blur, Backdrop) ── */}
      <EffectsSection nodeId={nodeId} node={node} store={store} commitHistory={commitHistory} />

      {/* ── Animation ── */}
      <AnimationInDesign
        nodeId={nodeId}
        node={node}
        store={store}
        commitHistory={commitHistory}
      />

      {/* ── Selection colors ── */}
      {selectionColors.length > 0 && (
        <div style={SECTION_STYLE}>
          <SectionHeader title="Selection colors" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {selectionColors.map(color => (
              <div key={color} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 16, height: 16, borderRadius: 3, background: color, border: '1px solid #374151' }} />
                <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>{color}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Grid overlay toggle ── */}
      <GridOverlayPanel />

      {/* ── Repeat / List ── */}
      <RepeatInDesign node={node} />

      {/* ── Visibility ── */}
      <VisibilityInDesign node={node} />

      {/* ── Disable (all nodes) ── */}
      <DisableInDesign node={node} />

    </div>
  );
}


// ─── Extracted design sections ───────────────────────────────────────────────
import {
  INTERACTIVE_TYPES, FORM_INPUT_TYPES, DESIGN_INLINE_STYLE,
  ToggleBind, VisibilityInDesign, DisableInDesign, RepeatInDesign,
  NodeNameInDesign, GridOverlayPanel, PropsTab, JsonTab,
} from './_panel-right-design-sections';


// ─── Property Flyout (create + edit) ─────────────────────────────────────────

interface PropertyFlyoutProps {
  /** When provided — edit mode; when null — create mode */
  initialProp?: { id: string; name: string; defaultValue?: unknown } | null;
  onClose: () => void;
  onSave: (prop: { id?: string; name: string; defaultValue: string }) => void;
}

function PropertyFlyout({ initialProp, onClose, onSave }: PropertyFlyoutProps) {
  const isEdit = !!initialProp;
  const [name, setName] = React.useState(initialProp?.name ?? '');
  const [defaultValue, setDefaultValue] = React.useState<string>(() => {
    const v = initialProp?.defaultValue;
    if (v === undefined || v === null || v === '') return '';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  });

  // Close on Escape
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ id: initialProp?.id, name: name.trim(), defaultValue });
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed', top: 40, right: 240, width: 300, zIndex: 10000,
        background: '#111827', border: '1px solid #374151', borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px 9px', borderBottom: '1px solid #374151' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#f3f4f6' }}>{isEdit ? 'Edit property' : 'Create property'}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 15, cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>✕</button>
      </div>

      <div style={{ padding: '12px 14px 14px' }}>
        {/* Name */}
        <label style={{ display: 'block', fontSize: 10, color: '#9ca3af', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Label <span style={{ color: '#ef4444' }}>*</span>
        </label>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. title"
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
          style={{
            width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 5,
            color: '#f3f4f6', fontSize: 12, padding: '6px 8px', boxSizing: 'border-box', marginBottom: 12, outline: 'none',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = '#3b82f6'; }}
          onBlur={e => { e.currentTarget.style.borderColor = '#374151'; }}
        />

        {/* Default value — CodeMirror */}
        <label style={{ display: 'block', fontSize: 10, color: '#9ca3af', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Default value</label>
        <div style={{ borderRadius: 5, overflow: 'hidden', border: '1px solid #374151', marginBottom: 14, fontSize: 12 }}>
          <Suspense fallback={
            <textarea
              value={defaultValue}
              onChange={e => setDefaultValue(e.target.value)}
              rows={4}
              style={{ width: '100%', background: '#1f2937', border: 'none', color: '#d1d5db', fontSize: 12, padding: '6px 8px', boxSizing: 'border-box', resize: 'vertical', outline: 'none', fontFamily: 'monospace' }}
            />
          }>
            <CodeMirror
              value={defaultValue}
              onChange={v => setDefaultValue(v)}
              extensions={[cmJson()]}
              theme={oneDark}
              height="100px"
              basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
              style={{ fontSize: 12 }}
            />
          </Suspense>
        </div>

        {/* Save / Create */}
        <button
          onClick={handleSave}
          disabled={!name.trim()}
          style={{
            width: '100%', padding: '7px', borderRadius: 5, fontSize: 12, fontWeight: 600,
            cursor: name.trim() ? 'pointer' : 'default', border: 'none',
            background: name.trim() ? '#2563eb' : '#374151',
            color: name.trim() ? '#fff' : '#6b7280',
          }}
        >
          {isEdit ? 'Save' : 'Create'}
        </button>
      </div>
    </div>
  );
}

// ─── Shared Component Properties Section ─────────────────────────────────────
// Shown in the right panel when a shared component is open for editing (in-canvas).

interface SharedComponentPropertiesSectionProps {
  model: SharedComponentModel;
  onUpdate: (updated: SharedComponentModel) => void;
}

function SharedComponentPropertiesSection({ model, onUpdate }: SharedComponentPropertiesSectionProps) {
  const [propertiesOpen, setPropertiesOpen] = React.useState(true);
  const [flyout, setFlyout] = React.useState<'create' | string | null>(null);
  const editingProp = flyout && flyout !== 'create'
    ? model.properties.find(p => p.id === flyout) ?? null
    : null;

  const syncContext = (props: typeof model.properties) => {
    const defaults: Record<string, unknown> = {};
    for (const p of props) defaults[p.name] = p.defaultValue ?? '';
    getGlobalVariableStore().getState().setState(prev => ({ ...prev, context: { component: { props: defaults } } }));
  };

  const handleAdd = ({ name, defaultValue }: { name: string; defaultValue: string }) => {
    const newProp = { id: crypto.randomUUID(), name, type: 'string' as const, defaultValue };
    const updated = { ...model, properties: [...model.properties, newProp] };
    onUpdate(updated);
    updateSCData(updated);
    syncContext(updated.properties);
  };

  const handleUpdate = ({ id, name, defaultValue }: { id: string; name: string; defaultValue: string }) => {
    const updated = { ...model, properties: model.properties.map(p => p.id === id ? { ...p, name, defaultValue } : p) };
    onUpdate(updated);
    updateSCData(updated);
    syncContext(updated.properties);
  };

  const handleDelete = (propId: string) => {
    const updated = { ...model, properties: model.properties.filter(p => p.id !== propId) };
    onUpdate(updated);
    updateSCData(updated);
    syncContext(updated.properties);
    if (flyout === propId) setFlyout(null);
  };

  return (
    <div style={{ borderBottom: '1px solid #1f2937' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px 6px', borderBottom: '1px solid #1f2937' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#d1d5db' }}>Shared Component</span>
        <span style={{ fontSize: 9, color: '#60a5fa', background: '#1e3a5f', borderRadius: 3, padding: '1px 5px', fontWeight: 700 }}>SC</span>
      </div>
      <div style={{ padding: '4px 12px 6px' }}>
        <span style={{ fontSize: 10, color: '#6b7280' }}>Name: </span>
        <span style={{ fontSize: 10, color: '#d1d5db' }}>{model.name}</span>
      </div>

      {/* Properties list */}
      <div style={{ borderTop: '1px solid #1f2937' }}>
        <button
          onClick={() => setPropertiesOpen(o => !o)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: '#6b7280' }}>⬡</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#d1d5db' }}>Properties</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={e => { e.stopPropagation(); setFlyout('create'); }}
              style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#9ca3af', fontSize: 10, padding: '2px 7px', cursor: 'pointer' }}
            >
              + New
            </button>
            <span style={{ fontSize: 10, color: '#6b7280' }}>{propertiesOpen ? '▾' : '▸'}</span>
          </div>
        </button>

        {propertiesOpen && (
          <div style={{ paddingBottom: 4 }}>
            {model.properties.length === 0 ? (
              <div style={{ padding: '4px 12px 8px', fontSize: 11, color: '#4b5563' }}>No properties yet.</div>
            ) : (
              model.properties.map(prop => (
                <div
                  key={prop.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setFlyout(flyout === prop.id ? null : prop.id)}
                  onKeyDown={e => { if (e.key === 'Enter') setFlyout(prop.id); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', cursor: 'pointer', borderLeft: flyout === prop.id ? '2px solid #3b82f6' : '2px solid transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1f2937')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <span style={{ fontSize: 10, color: '#60a5fa', flexShrink: 0 }}>ƒ</span>
                  <span style={{ flex: 1, fontSize: 11, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prop.name}</span>
                  <span style={{ fontSize: 9, color: '#4b5563' }}>{prop.type}</span>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(prop.id); }}
                    style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: 11, cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#4b5563')}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {flyout && (
        <PropertyFlyout
          initialProp={editingProp}
          onClose={() => setFlyout(null)}
          onSave={({ id, name, defaultValue }) => {
            if (id) { handleUpdate({ id, name, defaultValue }); }
            else { handleAdd({ name, defaultValue }); }
          }}
        />
      )}
    </div>
  );
}

// ─── SharedComponent Instance Props Panel ─────────────────────────────────────
// Shown in the right panel when a SharedComponent instance node is selected.

function SharedComponentInstancePanel({ node, onPatchProp }: { node: { props?: Record<string, unknown> }; onPatchProp: (key: string, value: unknown) => void }) {
  const componentId = (node.props?.componentId as string | undefined);
  const models = getSharedComponents();
  const model = componentId ? models[componentId] : undefined;

  if (!model) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 11, color: '#ef4444', borderBottom: '1px solid #1f2937' }}>
        SharedComponent: unknown componentId &quot;{componentId ?? '(none)'}&quot;
      </div>
    );
  }

  const instanceProps = node.props ?? {};

  return (
    <div style={{ borderBottom: '1px solid #1f2937' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px 6px', borderBottom: '1px solid #1f2937' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#d1d5db' }}>Instance of &ldquo;{model.name}&rdquo;</span>
        <span style={{ fontSize: 9, color: '#60a5fa', background: '#1e3a5f', borderRadius: 3, padding: '1px 5px', fontWeight: 700 }}>SC</span>
      </div>
      {model.properties.length === 0 ? (
        <div style={{ padding: '6px 12px 8px', fontSize: 11, color: '#4b5563' }}>This component has no declared properties.</div>
      ) : (
        <div style={{ padding: '6px 12px 8px' }}>
          {model.properties.map(prop => (
            <div key={prop.id} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2 }}>{prop.name} <span style={{ color: '#4b5563' }}>({prop.type})</span></div>
              <input
                value={String((instanceProps[prop.name] !== undefined ? instanceProps[prop.name] : prop.defaultValue) ?? '')}
                onChange={e => onPatchProp(prop.name, e.target.value)}
                placeholder={String(prop.defaultValue ?? '')}
                style={{ width: '100%', background: '#111827', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '4px 8px', boxSizing: 'border-box' }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Popup Properties Section ─────────────────────────────────────────────────

interface PopupPropertiesSectionProps {
  model: {
    id: string; name: string; type: string; allowStacking: boolean;
    properties: Array<{ id: string; name: string; type: string; defaultValue?: unknown }>;
  };
  allowStacking: boolean;
  onToggleStacking: () => void;
  onAddProperty: (prop: { name: string; defaultValue: string }) => void;
  onUpdateProperty: (prop: { id: string; name: string; defaultValue: string }) => void;
  onDeleteProperty: (propId: string) => void;
}

function PopupPropertiesSection({
  model, allowStacking, onToggleStacking, onAddProperty, onUpdateProperty, onDeleteProperty,
}: PopupPropertiesSectionProps) {
  const [flyout, setFlyout] = React.useState<'create' | string | null>(null);
  const [propertiesOpen, setPropertiesOpen] = React.useState(true);

  const editingProp = flyout && flyout !== 'create'
    ? model.properties.find(p => p.id === flyout) ?? null
    : null;

  return (
    <div style={{ borderBottom: '1px solid #1f2937' }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px 6px', borderBottom: '1px solid #1f2937' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#d1d5db' }}>Popup properties</span>
        <span style={{ fontSize: 9, color: '#6b7280', background: '#1f2937', borderRadius: 3, padding: '1px 5px' }}>{model.type}</span>
      </div>

      {/* Allow stacking */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px' }}>
        <span style={{ fontSize: 11, color: '#9ca3af' }}>Allow stacking</span>
        <button
          data-testid="popup-model-allow-stacking"
          onClick={onToggleStacking}
          style={{ width: 32, height: 18, borderRadius: 9, border: 'none', background: allowStacking ? '#3b82f6' : '#374151', cursor: 'pointer', position: 'relative', transition: 'background 150ms', flexShrink: 0 }}
        >
          <span style={{ position: 'absolute', top: 2, left: allowStacking ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 150ms' }} />
        </button>
      </div>

      {/* Properties list */}
      <div style={{ borderTop: '1px solid #1f2937' }}>
        <button
          onClick={() => setPropertiesOpen(o => !o)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: '#6b7280' }}>⬡</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#d1d5db' }}>Properties</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={e => { e.stopPropagation(); setFlyout('create'); }}
              style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#9ca3af', fontSize: 10, padding: '2px 7px', cursor: 'pointer' }}
              data-testid="popup-add-property-btn"
            >
              + New
            </button>
            <span style={{ fontSize: 10, color: '#6b7280' }}>{propertiesOpen ? '▾' : '▸'}</span>
          </div>
        </button>

        {propertiesOpen && (
          <div style={{ paddingBottom: 4 }}>
            {model.properties.length === 0 ? (
              <div style={{ padding: '4px 12px 8px', fontSize: 11, color: '#4b5563' }}>No properties yet.</div>
            ) : (
              model.properties.map(prop => (
                <div
                  key={prop.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setFlyout(flyout === prop.id ? null : prop.id)}
                  onKeyDown={e => { if (e.key === 'Enter') setFlyout(prop.id); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
                    cursor: 'pointer', borderLeft: flyout === prop.id ? '2px solid #3b82f6' : '2px solid transparent',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1f2937')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <span style={{ fontSize: 10, color: '#3b82f6', flexShrink: 0 }}>ƒ</span>
                  <span style={{ flex: 1, fontSize: 11, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prop.name}</span>
                  <button
                    onClick={e => { e.stopPropagation(); onDeleteProperty(prop.id); if (flyout === prop.id) setFlyout(null); }}
                    style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: 11, cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#4b5563')}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Property flyout (create or edit) */}
      {flyout && (
        <PropertyFlyout
          initialProp={editingProp}
          onClose={() => setFlyout(null)}
          onSave={({ id, name, defaultValue }) => {
            if (id) {
              onUpdateProperty({ id, name, defaultValue });
            } else {
              onAddProperty({ name, defaultValue });
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function PanelRight() {
  const [tab, setTab] = useState<'design' | 'theme' | 'workflows' | 'json'>('design');
  const {
    selectedIds, pageNodes, activePreviewStates,
    editingPopupId, editingPopupContent, editingPopupModel, exitPopupEdit,
    editingSharedComponentId, editingSharedComponentContent, editingSharedComponentModel,
    patchProp,
    aiMode, activeBreakpoint,
  } = useBuilderStore(useShallow(s => ({
    selectedIds: s.selectedIds, pageNodes: s.pageNodes, activePreviewStates: s.activePreviewStates,
    editingPopupId: s.editingPopupId, editingPopupContent: s.editingPopupContent,
    editingPopupModel: s.editingPopupModel, exitPopupEdit: s.exitPopupEdit,
    editingSharedComponentId: s.editingSharedComponentId,
    editingSharedComponentContent: s.editingSharedComponentContent,
    editingSharedComponentModel: s.editingSharedComponentModel,
    patchProp: s.patchProp, aiMode: s.aiMode, activeBreakpoint: s.activeBreakpoint,
  })));

  const activePreviewState = activePreviewStates?.[0] ?? 'normal';

  // pageNodes is always the source of truth — popup content is swapped into
  // pageNodes during popup-edit mode so no special-casing needed.
  const searchNodes = pageNodes as SDUINode[];

  // Listen for external tab-switch requests (design only now; logic/data moved to left panel)
  useEffect(() => {
    const handleDesign = () => setTab('design');
    const handleTheme  = () => setTab('theme');
    window.addEventListener('builder:open-design-tab', handleDesign);
    window.addEventListener('builder:open-theme-tab', handleTheme);
    return () => {
      window.removeEventListener('builder:open-design-tab', handleDesign);
      window.removeEventListener('builder:open-theme-tab', handleTheme);
    };
  }, []);

  const canvasNodes = useBuilderStore(s => s.canvasNodes) as SDUINode[];

  const selectedNode = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    function findNode(nodes: SDUINode[], id: string): SDUINode | null {
      for (const n of nodes) {
        if ((n as { id?: string }).id === id) return n;
        if (n.children?.length) {
          const found = findNode(n.children as SDUINode[], id);
          if (found) return found;
        }
      }
      return null;
    }
    // Search page nodes, then canvas nodes (freeform nodes outside pages)
    return findNode(searchNodes, selectedIds[0])
      ?? findNode(canvasNodes, selectedIds[0]);
  }, [selectedIds, searchNodes, canvasNodes]);

  const TABS: Array<{ id: 'design' | 'theme' | 'workflows' | 'json'; label: string; icon: React.ReactNode }> = [
    {
      id: 'design',
      label: 'Design',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
      ),
    },
    {
      id: 'theme',
      label: 'Theme',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M5.34 18.66l-1.41 1.41M22 12h-2M4 12H2M19.07 19.07l-1.41-1.41M5.34 5.34L3.93 3.93M12 22v-2M12 4V2"/>
        </svg>
      ),
    },
    {
      id: 'workflows',
      label: 'Workflows',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      ),
    },
    {
      id: 'json',
      label: 'JSON',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
        </svg>
      ),
    },
  ];

  // ── Shared component model properties panel ───────────────────────────────
  const [scModelState, setScModelState] = React.useState<SharedComponentModel | null>(null);
  React.useEffect(() => {
    if (!editingSharedComponentId || !editingSharedComponentModel) {
      setScModelState(null);
      return;
    }
    // Prefer live in-memory store for the latest model (properties may have changed)
    const live = getSharedComponents()[editingSharedComponentId];
    setScModelState(live ?? (editingSharedComponentModel as unknown as SharedComponentModel));
  }, [editingSharedComponentId, editingSharedComponentModel]);

  // ── Popup model properties panel ──────────────────────────────────────────
  const popupModel = editingPopupModel as {
    id: string; name: string; type: string; allowStacking: boolean;
    properties: Array<{ id: string; name: string; type: string; defaultValue?: unknown }>;
  } | null;

  const [popupAllowStacking, setPopupAllowStacking] = React.useState(popupModel?.allowStacking ?? false);
  const [popupProperties, setPopupProperties] = React.useState<Array<{ id: string; name: string; type: string; defaultValue?: unknown }>>(popupModel?.properties ?? []);

  React.useEffect(() => {
    setPopupAllowStacking(popupModel?.allowStacking ?? false);
    setPopupProperties(popupModel?.properties ?? []);
  }, [editingPopupId]); // eslint-disable-line react-hooks/exhaustive-deps

  // All hooks are above — safe to early-return here
  if (aiMode) {
    return <AiChatPanel />;
  }

  const patchPopupModel = (patch: Partial<typeof popupModel>) => {
    if (!popupModel) return;
    updatePopupData({ ...(popupModel as unknown as Parameters<typeof updatePopupData>[0]), ...patch } as Parameters<typeof updatePopupData>[0]);
  };

  const handleToggleStacking = () => {
    if (!popupModel) return;
    const next = !popupAllowStacking;
    setPopupAllowStacking(next);
    patchPopupModel({ allowStacking: next });
  };

  const refreshPopupInstanceProps = (props: Array<{ id: string; defaultValue?: unknown }>) => {
    if (!editingPopupId) return;
    const defaults: Record<string, unknown> = {};
    for (const p of props) defaults[p.id] = p.defaultValue ?? '';
    // Refresh the popup store instance so PopupRenderer has current props
    usePopupStore.getState().updateInstanceProps(editingPopupId, defaults);
    // Also sync context.component.props in the variable store so canvas rendering
    // (popup nodes in pageNodes without scope) resolves the formula correctly
    getGlobalVariableStore().getState().setState(prev => ({ ...prev, context: { component: { props: defaults } } }));
  };

  const handleAddProperty = ({ name, defaultValue }: { name: string; defaultValue: string }) => {
    const newProp = { id: crypto.randomUUID(), name, type: 'any', defaultValue };
    const next = [...popupProperties, newProp];
    setPopupProperties(next);
    patchPopupModel({ properties: next });
    refreshPopupInstanceProps(next);
  };

  const handleUpdateProperty = ({ id, name, defaultValue }: { id: string; name: string; defaultValue: string }) => {
    const next = popupProperties.map(p => p.id === id ? { ...p, name, defaultValue } : p);
    setPopupProperties(next);
    patchPopupModel({ properties: next });
    refreshPopupInstanceProps(next);
  };

  const handleDeleteProperty = (propId: string) => {
    const next = popupProperties.filter(p => p.id !== propId);
    setPopupProperties(next);
    patchPopupModel({ properties: next });
    refreshPopupInstanceProps(next);
  };

  // Build resolved model with live local state (allowStacking, properties)
  const resolvedPopupModel = popupModel ? { ...popupModel, allowStacking: popupAllowStacking, properties: popupProperties } : null;

  return (
    <div data-testid="panel-right" style={PANEL_STYLE}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            data-testid={`tab-right-${t.id}`}
            title={t.label}
            style={{ flex: 1, padding: '9px 0', background: 'none', border: 'none', borderBottom: tab === t.id ? '2px solid #3b82f6' : '2px solid transparent', color: tab === t.id ? '#f3f4f6' : '#6b7280', fontSize: 11, cursor: 'pointer', marginBottom: -1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
          </button>
        ))}
      </div>

      {tab === 'theme' && <ThemePanel />}

      {tab === 'workflows' && <ElementWorkflowsTab node={selectedNode} />}

      {tab === 'design' && (
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {/* Shared component properties — shown when editing a shared component in the canvas */}
          {editingSharedComponentId && scModelState && (
            <SharedComponentPropertiesSection
              model={scModelState}
              onUpdate={updated => setScModelState(updated)}
            />
          )}

          {/* SharedComponent instance props — shown when a SharedComponent instance node is selected */}
          {selectedNode && (selectedNode as unknown as { type?: string }).type === 'SharedComponent' && !editingSharedComponentId && (
            <SharedComponentInstancePanel
              node={selectedNode as unknown as { props?: Record<string, unknown> }}
              onPatchProp={(key, value) => {
                const id = (selectedNode as unknown as { id?: string }).id;
                if (!id) return;
                patchProp(id, `props.${key}`, value);
              }}
            />
          )}

          {/* Popup properties — scrolls with the rest of the panel */}
          {editingPopupId && resolvedPopupModel && (
            <PopupPropertiesSection
              model={resolvedPopupModel}
              allowStacking={popupAllowStacking}
              onToggleStacking={handleToggleStacking}
              onAddProperty={handleAddProperty}
              onUpdateProperty={handleUpdateProperty}
              onDeleteProperty={handleDeleteProperty}
            />
          )}

          {/* Multi-select align/distribute */}
          {selectedIds.length > 1 && <AlignDistributePanel ids={selectedIds} />}

          {/* No node selected (not in popup-edit mode) */}
          {!selectedNode && selectedIds.length <= 1 && !editingPopupId && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 12, textAlign: 'center', padding: 16 }}>
              Select a node to edit its properties
            </div>
          )}

          {/* Specific section — component-specific settings at the top of the Design tab */}
          {selectedNode && selectedIds.length === 1 && (
            <SettingsTab node={selectedNode} pageNodes={searchNodes} />
          )}

          {/* Design panel — selected node, OR popup root when nothing is explicitly selected */}
          {(() => {
            let designNode = selectedNode as SDUINode | null;
            if (!designNode && editingPopupId && editingPopupContent) {
              const rootId = (editingPopupContent as unknown as { id?: string }).id;
              designNode = rootId
                ? (pageNodes as SDUINode[]).find(n => (n as unknown as { id?: string }).id === rootId) ?? null
                : null;
            }
            if (!designNode || selectedIds.length > 1) return null;
            return <DesignTab node={designNode} />;
          })()}
        </div>
      )}

      {tab === 'json' && (
        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          {!selectedNode ? (
            <div style={{ color: '#4b5563', fontSize: 12, textAlign: 'center', padding: 16 }}>
              Select a node to view its JSON
            </div>
          ) : (
            <pre style={{ fontSize: 10, color: '#86efac', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
              {JSON.stringify(selectedNode, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

