'use client';

/**
 * Builder Right Panel — Design | Props | JSON tabs
 *
 * Design tab sections (in render order):
 *   1.  Position & Size     — X/Y (DOM read-only), W/H (inline style.width/height + minWidth/minHeight:0)
 *   2.  Dimensions          — W/H mode: Hug (w-fit/h-fit) | Fill (w-full/h-full) | Fixed (removes fit/full)
 *   3.  Self Alignment      — self-auto/start/center/end/stretch/baseline (positioning within parent flex)
 *   4.  Transform           — Rotation (inline style.transform), Flip H/V (-scale-x/y-100 class)
 *   5.  Alignment           — 9-cell grid → items-* + justify-* (containers only)
 *   6.  Auto Layout         — flex dir, wrap, gap (inline style.gap), space-between (containers only)
 *   7.  Padding             — Exact px via inline style.paddingLeft/Right/Top/Bottom (not Tailwind scale)
 *   8.  Margin              — Exact px via inline style.marginLeft/Right/Top/Bottom (not Tailwind scale)
 *   9.  Display & Interaction — display class + cursor-* class
 *   10. Clip content        — overflow-hidden toggle
 *   11. Fill                — inline style.backgroundColor + bg-opacity slider
 *   12. Stroke              — inline style.borderColor, border-* width/style classes
 *   13. Effects             — shadow-* class
 *   14. Typography          — size/weight/leading/tracking selects, text-align icons, decoration/transform,
 *                             inline style.color (text/heading/ButtonText nodes only)
 *   15. Border Radius       — 4-corner selects; equal → global token, mixed → per-corner tokens
 *   16. Opacity             — inline style.opacity (0–1); never opacity-N class (NativeWind can't compile dynamic)
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

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  PANEL_STYLE, SECTION_STYLE, LABEL_STYLE,
  SectionHeader, NumberInput, SelectInput, ColorInput, ToggleBtn,
} from './_panel-primitives';
import { SettingsTab, AlignDistributePanel } from './_panel-right-settings';
import { PreviewDataEditor, ElementWorkflowsTab } from './_panel-right-workflows';
import { useBuilderStore, findParentNode } from './_store';
import { WorkflowBindButton, toHumanName } from './_workflow-canvas'; // used only for unbound slot picker
import { ThemePanel } from './_theme-panel';
import { PathPicker } from './_path-picker';
import { ExprBuilder } from './_expr-builder';
import { FieldWithBinding, BindingIcon, isBoundValue, type FormulaValue, closeAllEditors, registerEditorClose } from './_formula-panel';
import { FormulaEditor } from './_formula-editor';
import { evaluateFormula } from '@/lib/sdui/formula-evaluator';
import { useSduiStore } from '@/store/sdui-store';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';
import type { SDUINode } from '@/lib/sdui/types/node';
import { FigmaColorPicker } from './_color-picker';
import {
  parseTwToken,
  parseTwArbitrary,
  replaceTwToken,
  removeTwToken,
  styleToClassName,
  TEXT_SIZE_TOKENS,
  FONT_WEIGHT_TOKENS,
  LEADING_TOKENS,
  TRACKING_TOKENS,
  ROUNDED_TOKENS,
  SHADOW_TOKENS,
  BORDER_WIDTH_TOKENS,
  BORDER_STYLE_TOKENS,
  ROTATE_TOKENS,
  TEXT_ALIGN_TOKENS,
  TEXT_DECORATION_TOKENS,
  TEXT_TRANSFORM_TOKENS,
  POSITION_TOKENS,
  Z_INDEX_TOKENS,
  CURSOR_TOKENS,
  DISPLAY_TOKENS,
  GRID_COLS_TOKENS,
  GRID_ROWS_TOKENS,
  expandPadding,
  applyPadding,
  expandMargin,
  applyMargin,
  applyBorderRadius,
  expandBorderRadius,
  applyAlignment,
  getAlignCellIndex,
  pxToTw,
  extractColors,
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

// ─── Design Tab ───────────────────────────────────────────────────────────────

function DesignTab({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const { zoom } = store;
  const nodeId = (node as { id?: string }).id ?? '';
  const cls: string = (node.props as { className?: string })?.className ?? '';
  // Sidecar map that stores formula bindings for class-based fields (selfAlignment, textAlign, etc.)
  const classFormulas = (node.props as { classFormulas?: Record<string, FormulaValue> })?.classFormulas;

  const histTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitHistory = useCallback(() => {
    clearTimeout(histTimer.current);
    histTimer.current = setTimeout(() => store._pushHistory(), 400);
  }, [store]);

  const nodeStyle = useMemo(
    () => (node.props as { style?: Record<string, string> })?.style ?? {},
    [node]
  );
  const pendingStyleRef   = useRef<Record<string, string>>({});
  const pendingNodeIdRef  = useRef<string>(nodeId);
  const rafSyncRef        = useRef<number | null>(null);
  const styleFlushTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      const rafFrame = document.querySelector('[data-builder-page-frame]');
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
        // Ring-only update: reuse already-computed BCR (r, fr) — no second BCR read,
        // no getComputedStyle() fills — eliminates 3 layout flushes per RAF frame.
        useBuilderStore.getState()._requestRingUpdate(r, fr);
      } else {
        // El or frame not found — fall back to full overlay update
        useBuilderStore.getState()._requestOverlayUpdate();
      }
    });

    // 3. Accumulate and debounce the Zustand commit (one re-render after gesture settles).
    pendingStyleRef.current = { ...pendingStyleRef.current, ...patch };
    if (styleFlushTimer.current) clearTimeout(styleFlushTimer.current);
    styleFlushTimer.current = setTimeout(() => {
      const id = pendingNodeIdRef.current;
      // Read the current className + style from the store (live, not from the render closure)
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
      const nodeData = readNodeData(useBuilderStore.getState().pageNodes) ?? { className: '', style: {} };
      // Also write className for export portability (arbitrary value classes as Tailwind tokens)
      const newCls = styleToClassName(pendingStyleRef.current, nodeData.className);
      store.patchProp(id, 'props.className', newCls);
      // Keep props.style for reliable rendering — Tailwind's safelist can't pre-compile
      // runtime-only arbitrary values (e.g. w-[317px], rotate-[23deg]). Inline style
      // guarantees correct display in both the canvas and the preview page.
      const mergedStyle = Object.fromEntries(
        Object.entries({ ...nodeData.style, ...pendingStyleRef.current }).filter(([, v]) => v !== ''),
      );
      store.patchProp(id, 'props.style', mergedStyle);
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
        const { value } = evaluateFormula(formulaStr, { ...zustandData, ...vs });
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
        const { value } = evaluateFormula(formulaStr, { ...zustandData, ...vs });
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
    const { value, error } = evaluateFormula(formulaStr, { ...zustandData, ...vs });
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
      const { value } = evaluateFormula(formulaStr, { ...zustandData, ...vs });
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
          const nodeData = readNodeDataFlush(useBuilderStore.getState().pageNodes) ?? { className: '', style: {} };
          const newCls = styleToClassName(pendingStyleRef.current, nodeData.className);
          store.patchProp(id, 'props.className', newCls);
          const mergedStyle = Object.fromEntries(
            Object.entries({ ...nodeData.style, ...pendingStyleRef.current }).filter(([, v]) => v !== ''),
          );
          store.patchProp(id, 'props.style', mergedStyle);
          pendingStyleRef.current = {};
        }
        styleFlushTimer.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  const patchCls = useCallback((newCls: string) => {
    store.patchProp(nodeId, 'props.className', newCls);
    commitHistory();
  }, [nodeId, store, commitHistory]);

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
    // CSS vars in this project are stored as R G B triplets (e.g. --destructive: 239 68 68),
    // so they must be wrapped with rgb() to produce a valid color value.
    const cssVarValue = `rgb(var(--${cssVar}))`;
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
    // Atomic Zustand update: clear inline style so the class wins, update className
    store.patchProp(nodeId, stylePropPath, '');
    store.patchProp(nodeId, 'props.className', newCls);
    commitHistory();
  }, [nodeId, cls, store, commitHistory]);

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
      const hex = rgbToHex(s.backgroundColor);
      // rgba(0,0,0,0) = transparent — keep the default so we don't show black
      if (hex && s.backgroundColor !== 'rgba(0, 0, 0, 0)') setComputedBgColor(hex);
      else setComputedBgColor('#ffffff');
    } else {
      setComputedBgColor(bgVal as string);
    }
    const colorVal = nodeStyle.color as unknown;
    if (!colorVal || isColorBound(colorVal)) {
      const hex = rgbToHex(s.color);
      if (hex) setComputedTextColor(hex);
    } else {
      setComputedTextColor(colorVal as string);
    }
    const borderVal = nodeStyle.borderColor as unknown;
    if (!borderVal || isColorBound(borderVal)) {
      const hex = rgbToHex(s.borderTopColor);
      if (hex) setComputedBorderColor(hex);
    } else {
      setComputedBorderColor(borderVal as string);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, nodeStyle.backgroundColor, nodeStyle.color, nodeStyle.borderColor, store.pageNodes]);

  // ── Component type classification ────────────────────────────────────────────
  // Controls which panel sections are shown. Only show relevant controls
  // per node type to avoid corrupting Gluestack's internal layout.
  // Containers: show Auto Layout + Alignment sections so children can be rearranged.
  // Includes Gluestack compounds whose children ARE real SDUI nodes (Checkbox, Radio, Badge, Avatar, Fab).
  const isContainer  = ['Box', 'VStack', 'HStack', 'Center', 'Grid', 'GridItem', 'Card', 'Pressable', 'Checkbox', 'CheckboxGroup', 'Radio', 'RadioGroup', 'Badge', 'Avatar', 'Fab', 'Skeleton', 'Alert', 'Link', 'Modal', 'ModalContent', 'ModalHeader', 'ModalBody', 'ModalFooter', 'Tooltip', 'AlertDialog', 'AlertDialogContent', 'AlertDialogHeader', 'AlertDialogBody', 'AlertDialogFooter', 'FormContainer'].includes(node.type);
  // CheckboxLabel / RadioLabel etc. are text nodes — show Typography section when selected
  const isTextNode   = ['Text', 'Heading', 'ButtonText', 'CheckboxLabel', 'RadioLabel', 'BadgeText', 'FabLabel', 'AvatarFallbackText', 'SkeletonText', 'AlertText', 'LinkText', 'TooltipText', 'ModalCloseButton'].includes(node.type);
  // Leaf widgets: Gluestack components with no SDUI children — no Auto Layout / Alignment.
  const isLeafWidget = ['Input', 'NavIcon', 'Image', 'NextImage', 'Textarea', 'Select', 'Slider', 'Progress', 'Spinner', 'DatePicker', 'TimePicker', 'DateTimePicker', 'ColorPicker', 'FileUpload', 'Iframe', 'SvgViewer', 'JsonViewer', 'Chart', 'QRCodeWidget', 'MarkdownViewer', 'GoogleMap', 'GoogleMapPlaces'].includes(node.type);
  // Padding/border-radius make sense for containers + button-like widgets, not raw text
  const showPadding  = !isTextNode;
  // Auto Layout (flex dir, gap) and Alignment only make sense for flex containers
  const showLayout   = isContainer;

  // ── Parsed tokens ─────────────────────────────────────────────────────────────

  const padding     = expandPadding(cls);
  const corners     = expandBorderRadius(cls);
  const flexDir     = parseTwToken(cls, 'flex-') ?? 'flex-col';
  const isRow       = flexDir === 'flex-row';
  const activeCell  = getAlignCellIndex(cls, isRow);
  const gapToken    = parseTwToken(cls, 'gap-') ?? 'gap-0';
  // parseTwArbitrary handles gap-[12px]; scale tokens fall back to the 4px grid
  const gapPx       = parseTwArbitrary(cls, 'gap-') ?? (parseInt(gapToken.replace('gap-', '') || '0') * 4);
  const textSize    = parseTwToken(cls, 'text-') ?? 'text-base';
  const fontWeight  = parseTwToken(cls, 'font-') ?? 'font-normal';
  const leading     = parseTwToken(cls, 'leading-') ?? 'leading-normal';
  const tracking    = parseTwToken(cls, 'tracking-') ?? 'tracking-normal';
  // Opacity is stored as opacity-[0.5] arbitrary class (or legacy style.opacity for old nodes).
  const opacityVal = (() => {
    // Legacy: still in props.style (old nodes before migration)
    // Guard against formula objects (isBoundValue) to prevent NaN
    if (nodeStyle.opacity !== undefined && typeof nodeStyle.opacity !== 'object') return Math.round(parseFloat(String(nodeStyle.opacity)) * 100);
    const token = parseTwToken(cls, 'opacity-');
    if (!token) return 100;
    // Arbitrary value: opacity-[0.5]
    const arb = token.match(/^opacity-\[([0-9.]+)\]$/);
    if (arb) return Math.round(parseFloat(arb[1]) * 100);
    // Scale token: opacity-50
    return parseInt(token.replace('opacity-', '') || '100');
  })();
  const shadowToken = parseTwToken(cls, 'shadow') ?? 'shadow-none';
  const borderWidth = parseTwToken(cls, 'border') ?? 'border-0';
  const borderStyle = BORDER_STYLE_TOKENS.find(t => cls.includes(t)) ?? 'border-solid';
  // Rotation is stored as inline style.transform for reliable visual rendering
  const styleTransform = (node.props as { style?: Record<string, string> })?.style?.transform ?? '';
  const rotateDeg = (() => {
    // Try inline style first: "rotate(16deg)" → 16
    const styleMatch = styleTransform.match(/rotate\(([-\d.]+)deg\)/);
    if (styleMatch) return parseFloat(styleMatch[1]);
    // Fall back to className token for backwards compat: rotate-[16deg] → 16
    const clsToken = parseTwToken(cls, 'rotate-') ?? parseTwToken(cls, '-rotate-') ?? '';
    return parseInt(clsToken.replace(/-?rotate-\[?/, '').replace('deg]', '') || '0');
  })();
  const isFlipH     = cls.includes('-scale-x-100');
  const isFlipV     = cls.includes('-scale-y-100');
  const isClipped   = cls.includes('overflow-hidden');
  const isFlexWrap  = cls.includes('flex-wrap');
  const isGrid      = cls.includes('grid');
  const isSpaceBetween = cls.includes('justify-between');
  // Self-alignment: how this node aligns itself within its parent flex container
  const selfToken   = parseTwToken(cls, 'self-') ?? 'self-auto';

  // Margin (outer spacing)
  const margin      = expandMargin(cls);
  const [marginMode, setMarginMode] = useState<'combined' | 'individual'>('combined');

  // Position & layer
  const positionToken = POSITION_TOKENS.find(t => cls.includes(t)) ?? 'static';
  const zIndexToken   = parseTwToken(cls, 'z-') ?? 'z-0';
  const cursorToken   = parseTwToken(cls, 'cursor-') ?? 'cursor-default';
  const displayToken  = DISPLAY_TOKENS.find(t => {
    // Avoid matching 'hidden' as part of another class; check for exact token
    const re = new RegExp(`(?:^|\\s)${t}(?:\\s|$)`);
    return re.test(cls);
  }) ?? '';

  // Typography extras
  const textAlign  = TEXT_ALIGN_TOKENS.find(t => cls.includes(t)) ?? 'text-left';
  const textDecor  = TEXT_DECORATION_TOKENS.find(t => cls.includes(t)) ?? 'no-underline';
  const textTransform = TEXT_TRANSFORM_TOKENS.find(t => cls.includes(t)) ?? 'normal-case';

  const [padMode, setPadMode] = useState<'combined' | 'individual'>('individual');

  // ── Selection colors ─────────────────────────────────────────────────────────

  const selectionColors = useMemo(() => extractColors(node), [node]);

  // ── Text content helpers ─────────────────────────────────────────────────────
  // For Text / Heading / ButtonText nodes we expose their `text` prop directly.
  // For Button find the first ButtonText child; for other containers (e.g. Pressable)
  // find the first Text/Heading child so primitive buttons get a Content section too.
  const hasDirectText = isTextNode && (node as { text?: string }).text !== undefined;
  const buttonTextChild =
    node.type === 'Button'
      ? (node.children as SDUINode[] | undefined)?.find(c => c.type === 'ButtonText')
      : isContainer
        ? (node.children as SDUINode[] | undefined)?.find(c => c.type === 'Text' || c.type === 'Heading')
        : null;
  const hasContent = hasDirectText || !!buttonTextChild;

  // Convert a stored text string → FormulaValue for FieldWithBinding.
  // A whole-string template expression like "{{variables['UUID']}}" or "{{collections['X'].data.y}}"
  // is treated as a formula binding so it shows "ƒ Edit formula" instead of a raw UUID textarea.
  // Mixed/partial templates like "Hello {{name}}" stay as plain strings.
  function textToFormulaValue(text: string): FormulaValue {
    if (!text) return text;
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
              const rawText = buttonTextChild
                ? ((buttonTextChild as { text?: string }).text ?? '')
                : ((node as { text?: string }).text ?? '');
              const targetId = buttonTextChild
                ? (buttonTextChild as { id?: string }).id ?? ''
                : nodeId;
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
        <SectionHeader title="Position & Size" />
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <FieldWithBinding label="position" displayLabel="Position" hint="e.g. relative, absolute, fixed" value={(classFormulas?.['position'] as FormulaValue) ?? positionToken} onChange={v => bindOrPatchCls('position', evaluated => {
            let next = cls;
            POSITION_TOKENS.forEach(t => { next = removeTwToken(next, t); });
            patchCls(evaluated === 'static' ? next : `${next} ${evaluated}`.trim());
          }, v)} expectedType="string">
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
          <FieldWithBinding label="zIndex" displayLabel="Z-Index" hint="e.g. z-10, z-50, z-auto" value={(classFormulas?.['zIndex'] as FormulaValue) ?? zIndexToken} onChange={v => bindOrPatchCls('zIndex', evaluated => patchCls(replaceTwToken(cls, 'z-', evaluated)), v)} expectedType="string">
            <SelectInput
              label="Z-Index"
              value={zIndexToken}
              options={Z_INDEX_TOKENS}
              onChange={v => patchCls(replaceTwToken(cls, 'z-', v))}
            />
          </FieldWithBinding>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <NumberInput label="X" testId="input-pos-x" value={domMetrics.x} onChange={() => {}} />
          <NumberInput label="Y" testId="input-pos-y" value={domMetrics.y} onChange={() => {}} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <FieldWithBinding label="width" displayLabel="W" hint="e.g. 200px, 50%, auto" value={(nodeStyle.width ?? '') as FormulaValue} onChange={v => bindOrPatch('width', v, { minWidth: '0' })}>
            <NumberInput label="W" testId="input-pos-w" value={(() => {
              const clsW = parseTwArbitrary(cls, 'w-');
              if (clsW !== null) return clsW;
              const styleW = nodeStyle.width;
              if (styleW) return parseInt(styleW) || domMetrics.w;
              return domMetrics.w;
            })()} onChange={px => {
              patchStyle({ width: `${px}px`, minWidth: '0' });
              patchCls(removeTwToken(removeTwToken(cls, 'w-fit'), 'w-full'));
            }} />
          </FieldWithBinding>
          <FieldWithBinding label="height" displayLabel="H" hint="e.g. 100px, 50vh, auto" value={(nodeStyle.height ?? '') as FormulaValue} onChange={v => bindOrPatch('height', v, { minHeight: '0' })}>
            <NumberInput label="H" testId="input-pos-h" value={(() => {
              const clsH = parseTwArbitrary(cls, 'h-');
              if (clsH !== null) return clsH;
              const styleH = nodeStyle.height;
              if (styleH) return parseInt(styleH) || domMetrics.h;
              return domMetrics.h;
            })()} onChange={px => {
              patchStyle({ height: `${px}px`, minHeight: '0' });
              patchCls(removeTwToken(removeTwToken(cls, 'h-fit'), 'h-full'));
            }} />
          </FieldWithBinding>
        </div>

        {/* ── Inset controls (shown when position is absolute / fixed / sticky) ── */}
        {(positionToken === 'absolute' || positionToken === 'fixed' || positionToken === 'sticky') && (
          <>
            <div style={{ marginTop: 6, marginBottom: 2, fontSize: 10, color: '#6b7280' }}>Inset</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {(['top','right','bottom','left'] as const).map(side => (
                <FieldWithBinding key={side} label={side} displayLabel={side.charAt(0).toUpperCase() + side.slice(1)} hint="e.g. 0, 16px, auto" value={(nodeStyle[side] ?? '') as FormulaValue} onChange={v => bindOrPatch(side, v)}>
                  <NumberInput
                    label={side.charAt(0).toUpperCase() + side.slice(1)}
                    testId={`input-inset-${side}`}
                    value={(parseTwArbitrary(cls, `${side}-`) ?? parseInt(nodeStyle[side] ?? '')) || 0}
                    onChange={px => {
                      patchStyle({ [side]: `${px}px` });
                    }}
                  />
                </FieldWithBinding>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── W/H Resize modes ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Dimensions" />
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {/* W mode — headerTitle puts bind icon beside "W" label */}
          <FieldWithBinding label="wMode" hint="hug=w-fit, fill=w-full, fixed=''" headerTitle="W" value={(classFormulas?.['wMode'] as FormulaValue) ?? (cls.includes('w-fit') ? 'w-fit' : cls.includes('w-full') ? 'w-full' : '')} onChange={v => bindOrPatchCls('wMode', evaluated => {
            if (evaluated === 'w-fit') { patchCls(replaceTwToken(removeTwToken(cls, 'w-'), 'w-', 'w-fit')); patchStyle({ width: '', minWidth: '' }); }
            else if (evaluated === 'w-full') { patchCls(replaceTwToken(removeTwToken(cls, 'w-'), 'w-', 'w-full')); patchStyle({ width: '', minWidth: '' }); }
            else { patchCls(removeTwToken(removeTwToken(cls, 'w-fit'), 'w-full')); }
          }, v)} expectedType="string">
            <div style={{ display: 'flex', gap: 2 }}>
              {([['Hug', 'w-fit'], ['Fill', 'w-full'], ['Fixed', '']] as const).map(([label, token]) => {
                const active = token ? cls.includes(token) : (!cls.includes('w-fit') && !cls.includes('w-full'));
                return (
                  <ToggleBtn key={label} data-testid={`dim-w-${label.toLowerCase()}`} active={active} onClick={() => {
                    if (token) {
                      patchCls(replaceTwToken(removeTwToken(cls, 'w-'), 'w-', token));
                      patchStyle({ width: '', minWidth: '' });
                    } else {
                      patchCls(removeTwToken(removeTwToken(cls, 'w-fit'), 'w-full'));
                    }
                  }}>
                    {label}
                  </ToggleBtn>
                );
              })}
            </div>
          </FieldWithBinding>
          {/* H mode — headerTitle puts bind icon beside "H" label */}
          <FieldWithBinding label="hMode" hint="hug=h-fit, fill=h-full, fixed=''" headerTitle="H" value={(classFormulas?.['hMode'] as FormulaValue) ?? (cls.includes('h-fit') ? 'h-fit' : cls.includes('h-full') ? 'h-full' : '')} onChange={v => bindOrPatchCls('hMode', evaluated => {
            if (evaluated === 'h-fit') { patchCls(replaceTwToken(removeTwToken(cls, 'h-'), 'h-', 'h-fit')); patchStyle({ height: '', minHeight: '' }); }
            else if (evaluated === 'h-full') { patchCls(replaceTwToken(removeTwToken(cls, 'h-'), 'h-', 'h-full')); patchStyle({ height: '', minHeight: '' }); }
            else { patchCls(removeTwToken(removeTwToken(cls, 'h-fit'), 'h-full')); }
          }, v)} expectedType="string">
            <div style={{ display: 'flex', gap: 2 }}>
              {([['Hug', 'h-fit'], ['Fill', 'h-full'], ['Fixed', '']] as const).map(([label, token]) => {
                const active = token ? cls.includes(token) : (!cls.includes('h-fit') && !cls.includes('h-full'));
                return (
                  <ToggleBtn key={label} data-testid={`dim-h-${label.toLowerCase()}`} active={active} onClick={() => {
                    if (token) {
                      patchCls(replaceTwToken(removeTwToken(cls, 'h-'), 'h-', token));
                      patchStyle({ height: '', minHeight: '' });
                    } else {
                      patchCls(removeTwToken(removeTwToken(cls, 'h-fit'), 'h-full'));
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
          <FieldWithBinding label="minWidth" displayLabel="Min W" hint="e.g. 0, 100px, 50%" value={(nodeStyle.minWidth ?? '') as FormulaValue} onChange={v => bindOrPatch('minWidth', v)}>
            <NumberInput
              label="Min W"
              testId="input-min-w"
              value={(parseTwArbitrary(cls, 'min-w-') ?? parseInt(nodeStyle.minWidth ?? '0')) || 0}
              onChange={px => patchStyle({ minWidth: px > 0 ? `${px}px` : '' })}
            />
          </FieldWithBinding>
          <FieldWithBinding label="maxWidth" displayLabel="Max W" hint="e.g. 100%, 800px, none" value={(nodeStyle.maxWidth ?? '') as FormulaValue} onChange={v => bindOrPatch('maxWidth', v)}>
            <NumberInput
              label="Max W"
              testId="input-max-w"
              value={parseTwArbitrary(cls, 'max-w-') ?? (nodeStyle.maxWidth ? parseInt(nodeStyle.maxWidth) || 0 : 0)}
              onChange={px => patchStyle({ maxWidth: px > 0 ? `${px}px` : '' })}
            />
          </FieldWithBinding>
          <FieldWithBinding label="minHeight" displayLabel="Min H" hint="e.g. 0, 100px, 50%" value={(nodeStyle.minHeight ?? '') as FormulaValue} onChange={v => bindOrPatch('minHeight', v)}>
            <NumberInput
              label="Min H"
              testId="input-min-h"
              value={(parseTwArbitrary(cls, 'min-h-') ?? parseInt(nodeStyle.minHeight ?? '0')) || 0}
              onChange={px => patchStyle({ minHeight: px > 0 ? `${px}px` : '' })}
            />
          </FieldWithBinding>
          <FieldWithBinding label="maxHeight" displayLabel="Max H" hint="e.g. 100px, 50vh, none" value={(nodeStyle.maxHeight ?? '') as FormulaValue} onChange={v => bindOrPatch('maxHeight', v)}>
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
        }, v)} expectedType="string" headerTitle="Self Alignment">
          <>
            <div style={{ display: 'flex', gap: 4 }}>
              {([
                ['self-start',   '⇤',  'Start (left)'],
                ['self-center',  '↔',  'Center'],
                ['self-end',     '⇥',  'End (right)'],
                ['self-stretch', '⇔',  'Stretch (fill width)'],
                ['self-auto',    '∅',  'Auto (inherit from parent)'],
              ] as const).map(([token, icon, label]) => (
                <ToggleBtn
                  key={token}
                  active={selfToken === token}
                  title={label}
                  data-testid={`self-align-${token}`}
                  onClick={() => patchCls(replaceTwToken(removeTwToken(cls, 'self-'), 'self-', token === 'self-auto' ? '' : token).trim())}
                >
                  {icon}
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
          <FieldWithBinding label="rotate" displayLabel="Rotate °" hint="degrees: e.g. 45, -90, 180" value={(styleTransform ?? '') as FormulaValue} onChange={v => bindOrPatch('transform', v)}>
            <NumberInput
              label="Rotate °"
              testId="input-rotate"
              value={rotateDeg}
              min={-180} max={180}
              onChange={deg => {
                const newTransform = deg !== 0 ? `rotate(${deg}deg)` : '';
                patchStyle({ transform: newTransform });
              }}
            />
          </FieldWithBinding>
          <div style={{ display: 'flex', gap: 4 }}>
            <ToggleBtn active={isFlipH} title="Flip horizontal" onClick={() => {
              patchCls(isFlipH ? removeTwToken(cls, '-scale-x-') : `${cls} -scale-x-100`.trim());
            }}>⇔</ToggleBtn>
            <ToggleBtn active={isFlipV} title="Flip vertical" onClick={() => {
              patchCls(isFlipV ? removeTwToken(cls, '-scale-y-') : `${cls} -scale-y-100`.trim());
            }}>⇕</ToggleBtn>
          </div>
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
          <SectionHeader title="Auto Layout" />
          <FieldWithBinding label="layoutDir" hint="e.g. flex-row, flex-col, grid" value={(classFormulas?.['layoutDir'] as FormulaValue) ?? (isGrid ? 'grid' : isFlexWrap ? 'flex-row flex-wrap' : flexDir)} onChange={v => bindOrPatchCls('layoutDir', evaluated => {
            let next = removeTwToken(removeTwToken(removeTwToken(cls, 'flex-'), 'grid'), 'flex-wrap');
            if (evaluated === 'flex-row flex-wrap') next = `${next} flex flex-row flex-wrap`.trim();
            else if (evaluated === 'grid')          next = `${next} grid`.trim();
            else if (evaluated)                     next = `${next} flex ${evaluated}`.trim();
            patchCls(next);
          }, v)} expectedType="string" stackLayout>
            {/* Flow direction — 4 icons */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {([
                ['flex-row',         '→', 'Row'],
                ['flex-col',         '↓', 'Column'],
                ['flex-row flex-wrap','↩', 'Row wrap'],
                ['grid',             '⊞', 'Grid'],
              ] as const).map(([token, icon, label]) => {
                const active = token === 'flex-row flex-wrap'
                  ? (flexDir === 'flex-row' && isFlexWrap)
                  : token === 'grid'
                  ? isGrid
                  : flexDir === token && !isFlexWrap && !isGrid;
                return (
                  <ToggleBtn key={token} active={active} title={label} onClick={() => {
                    let next = removeTwToken(removeTwToken(removeTwToken(cls, 'flex-'), 'grid'), 'flex-wrap');
                    if (token === 'flex-row flex-wrap') next = `${next} flex flex-row flex-wrap`.trim();
                    else if (token === 'grid')          next = `${next} grid`.trim();
                    else                                next = `${next} flex ${token}`.trim();
                    patchCls(next);
                  }}>
                    {icon}
                  </ToggleBtn>
                );
              })}
            </div>
          </FieldWithBinding>

          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <FieldWithBinding label="gap" displayLabel="Gap" hint="e.g. 8px, 1rem, 16px" value={(nodeStyle.gap ?? '') as FormulaValue} onChange={v => bindOrPatch('gap', v)}>
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
                <ToggleBtn data-testid="gap-mode-space-between" active={isSpaceBetween} onClick={() => patchCls(replaceTwToken(cls, 'justify-', 'justify-between'))}>⇔</ToggleBtn>
              </div>
            </div>
          </div>

          {/* Grid columns / rows (only visible when 'grid' layout is selected) */}
          {isGrid && (
            <div style={{ display: 'flex', gap: 6 }}>
              <FieldWithBinding label="gridCols" displayLabel="Columns" hint="e.g. grid-cols-2, grid-cols-4" value={(classFormulas?.['gridCols'] as FormulaValue) ?? (GRID_COLS_TOKENS.find(t => cls.includes(t)) ?? 'grid-cols-1')} onChange={v => bindOrPatchCls('gridCols', evaluated => {
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
            </div>
          )}
        </div>
      )}

      {/* ── Padding (hidden for raw text nodes) ── */}
      {showPadding && (
        <div data-testid="section-padding" style={SECTION_STYLE}>
          <SectionHeader title="Padding">
            <button
              data-testid="padding-mode-toggle"
              data-pad-mode={padMode}
              style={{ fontSize: 9, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px' }}
              onClick={() => setPadMode(m => m === 'combined' ? 'individual' : 'combined')}
            >
              {padMode === 'combined' ? '⊞' : '□'}
            </button>
          </SectionHeader>
          {padMode === 'combined' ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <FieldWithBinding label="paddingInline" displayLabel="H (px/py)" hint="e.g. 8px, 1rem (sets left + right)" value={(nodeStyle.paddingLeft ?? '') as FormulaValue} onChange={v => bindOrPatchBoth('paddingLeft', 'paddingRight', v)}>
                <NumberInput label="H (px/py)" testId="input-pad-h"
                  value={padding.left}
                  onChange={px => {
                    patchStyle({ paddingLeft: `${px}px`, paddingRight: `${px}px`, paddingInline: undefined as unknown as string });
                  }} />
              </FieldWithBinding>
              <FieldWithBinding label="paddingBlock" displayLabel="V (pt/pb)" hint="e.g. 8px, 1rem (sets top + bottom)" value={(nodeStyle.paddingTop ?? '') as FormulaValue} onChange={v => bindOrPatchBoth('paddingTop', 'paddingBottom', v)}>
                <NumberInput label="V (pt/pb)" testId="input-pad-v"
                  value={padding.top}
                  onChange={px => {
                    patchStyle({ paddingTop: `${px}px`, paddingBottom: `${px}px`, paddingBlock: undefined as unknown as string });
                  }} />
              </FieldWithBinding>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <FieldWithBinding label="paddingTop" displayLabel="Top" hint="e.g. 8px, 1rem" value={(nodeStyle.paddingTop ?? '') as FormulaValue} onChange={v => bindOrPatch('paddingTop', v)}>
                <NumberInput label="Top" testId="input-pad-top" value={padding.top} onChange={px => patchStyle({ paddingTop: `${px}px` })} />
              </FieldWithBinding>
              <FieldWithBinding label="paddingRight" displayLabel="Right" hint="e.g. 8px, 1rem" value={(nodeStyle.paddingRight ?? '') as FormulaValue} onChange={v => bindOrPatch('paddingRight', v)}>
                <NumberInput label="Right" testId="input-pad-right" value={padding.right} onChange={px => patchStyle({ paddingRight: `${px}px` })} />
              </FieldWithBinding>
              <FieldWithBinding label="paddingBottom" displayLabel="Bottom" hint="e.g. 8px, 1rem" value={(nodeStyle.paddingBottom ?? '') as FormulaValue} onChange={v => bindOrPatch('paddingBottom', v)}>
                <NumberInput label="Bottom" testId="input-pad-bottom" value={padding.bottom} onChange={px => patchStyle({ paddingBottom: `${px}px` })} />
              </FieldWithBinding>
              <FieldWithBinding label="paddingLeft" displayLabel="Left" hint="e.g. 8px, 1rem" value={(nodeStyle.paddingLeft ?? '') as FormulaValue} onChange={v => bindOrPatch('paddingLeft', v)}>
                <NumberInput label="Left" testId="input-pad-left" value={padding.left} onChange={px => patchStyle({ paddingLeft: `${px}px` })} />
              </FieldWithBinding>
            </div>
          )}
        </div>
      )}

      {/* ── Margin ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Margin">
          <button
            style={{ fontSize: 9, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px' }}
            onClick={() => setMarginMode(m => m === 'combined' ? 'individual' : 'combined')}
          >
            {marginMode === 'combined' ? '⊞' : '□'}
          </button>
        </SectionHeader>
        {marginMode === 'combined' ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <FieldWithBinding label="marginInline" displayLabel="H (mx)" hint="e.g. 8px, auto (sets left + right)" value={(nodeStyle.marginLeft ?? '') as FormulaValue} onChange={v => bindOrPatchBoth('marginLeft', 'marginRight', v)}>
              <NumberInput label="H (mx)"
                value={margin.left}
                onChange={px => {
                  patchStyle({ marginLeft: `${px}px`, marginRight: `${px}px`, marginInline: undefined as unknown as string });
                }} />
            </FieldWithBinding>
            <FieldWithBinding label="marginBlock" displayLabel="V (my)" hint="e.g. 8px, auto (sets top + bottom)" value={(nodeStyle.marginTop ?? '') as FormulaValue} onChange={v => bindOrPatchBoth('marginTop', 'marginBottom', v)}>
              <NumberInput label="V (my)"
                value={margin.top}
                onChange={px => {
                  patchStyle({ marginTop: `${px}px`, marginBottom: `${px}px`, marginBlock: undefined as unknown as string });
                }} />
            </FieldWithBinding>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <FieldWithBinding label="marginTop" displayLabel="Top" hint="e.g. 8px, auto" value={(nodeStyle.marginTop ?? '') as FormulaValue} onChange={v => bindOrPatch('marginTop', v)}>
              <NumberInput label="Top" value={margin.top} onChange={px => patchStyle({ marginTop: `${px}px` })} />
            </FieldWithBinding>
            <FieldWithBinding label="marginRight" displayLabel="Right" hint="e.g. 8px, auto" value={(nodeStyle.marginRight ?? '') as FormulaValue} onChange={v => bindOrPatch('marginRight', v)}>
              <NumberInput label="Right" value={margin.right} onChange={px => patchStyle({ marginRight: `${px}px` })} />
            </FieldWithBinding>
            <FieldWithBinding label="marginBottom" displayLabel="Bottom" hint="e.g. 8px, auto" value={(nodeStyle.marginBottom ?? '') as FormulaValue} onChange={v => bindOrPatch('marginBottom', v)}>
              <NumberInput label="Bottom" value={margin.bottom} onChange={px => patchStyle({ marginBottom: `${px}px` })} />
            </FieldWithBinding>
            <FieldWithBinding label="marginLeft" displayLabel="Left" hint="e.g. 8px, auto" value={(nodeStyle.marginLeft ?? '') as FormulaValue} onChange={v => bindOrPatch('marginLeft', v)}>
              <NumberInput label="Left" value={margin.left} onChange={px => patchStyle({ marginLeft: `${px}px` })} />
            </FieldWithBinding>
          </div>
        )}
      </div>

      {/* ── Display & Cursor ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Display & Interaction" />
        <div style={{ display: 'flex', gap: 6 }}>
          <FieldWithBinding label="display" displayLabel="Display" hint="e.g. flex, block, grid, none" value={(classFormulas?.['display'] as FormulaValue) ?? displayToken} onChange={v => bindOrPatchCls('display', evaluated => {
            let next = cls;
            DISPLAY_TOKENS.forEach(t => {
              next = next.replace(new RegExp(`(?:^|\\s)${t}(?=\\s|$)`, 'g'), ' ').replace(/\s+/g, ' ').trim();
            });
            patchCls(evaluated ? `${next} ${evaluated}`.trim() : next);
          }, v)} expectedType="string">
            <SelectInput
              label="Display"
              value={displayToken}
              options={['', ...DISPLAY_TOKENS]}
              onChange={v => {
                let next = cls;
                DISPLAY_TOKENS.forEach(t => {
                  next = next.replace(new RegExp(`(?:^|\\s)${t}(?=\\s|$)`, 'g'), ' ').replace(/\s+/g, ' ').trim();
                });
                patchCls(v ? `${next} ${v}`.trim() : next);
              }}
            />
          </FieldWithBinding>
          <FieldWithBinding label="cursor" displayLabel="Cursor" hint="e.g. cursor-pointer, cursor-default" value={(classFormulas?.['cursor'] as FormulaValue) ?? cursorToken} onChange={v => bindOrPatchCls('cursor', evaluated => patchCls(replaceTwToken(cls, 'cursor-', evaluated)), v)} expectedType="string">
            <SelectInput
              label="Cursor"
              value={cursorToken}
              options={CURSOR_TOKENS}
              onChange={v => patchCls(replaceTwToken(cls, 'cursor-', v))}
            />
          </FieldWithBinding>
        </div>
      </div>

      {/* ── Clip content ── */}
      <ToggleBind
        rowLabel="Clip content"
        fieldId="clipContent"
        hint='"overflow-hidden" or "" (empty to unclip)'
        expectedType="string"
        isOn={isClipped}
        value={(classFormulas?.['clipContent'] as FormulaValue) ?? (isClipped ? 'overflow-hidden' : '')}
        onToggle={() => patchCls(isClipped ? removeTwToken(cls, 'overflow-hidden') : `${cls} overflow-hidden`.trim())}
        onChange={v => bindOrPatchCls('clipContent', evaluated => {
          if (evaluated === 'overflow-hidden' || evaluated === 'true') {
            patchCls(`${cls} overflow-hidden`.trim());
          } else {
            patchCls(removeTwToken(cls, 'overflow-hidden'));
          }
        }, v)}
      />

      {/* ── Fill ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Fill" />
        <div style={{ marginTop: 4 }}>
          <FieldWithBinding label="backgroundColor" displayLabel="Background" hint="CSS color: e.g. red, #ff0000, rgba(0,0,0,0.5)" value={(nodeStyle.backgroundColor as unknown as FormulaValue) ?? ''} onChange={v => bindOrPatch('backgroundColor', v)}>
            <div>
              <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>Background</span>
              <FigmaColorPicker
                testId="input-bg-color"
                value={computedBgColor}
                onChange={(hex, cssVar) => cssVar
                  ? patchColorAsThemeVar('backgroundColor', 'props.style.backgroundColor', 'bg', cssVar)
                  : patchStyle({ backgroundColor: hex || '' })
                }
              />
            </div>
          </FieldWithBinding>
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, color: '#6b7280' }}>Opacity</span>
          <input
            type="range" min={0} max={100} step={5}
            data-testid="bg-opacity-slider"
            value={parseInt(parseTwToken(cls, 'bg-opacity-')?.replace('bg-opacity-', '') || '100')}
            onChange={e => patchCls(replaceTwToken(cls, 'bg-opacity-', `bg-opacity-${e.target.value}`))}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 10, color: '#d1d5db', minWidth: 28 }}>
            {parseTwToken(cls, 'bg-opacity-')?.replace('bg-opacity-', '') ?? '100'}%
          </span>
        </div>
      </div>

      {/* ── Stroke ── */}
      <div style={SECTION_STYLE}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <SectionHeader title="Stroke" />
          <FieldWithBinding label="borderWidth" displayLabel="Border W" hint="e.g. 1px, 2px, 0" value={(nodeStyle.borderWidth ?? '') as FormulaValue} onChange={v => bindOrPatch('borderWidth', v)} expectedType="string">
            <span />
          </FieldWithBinding>
        </div>
        <div style={{ marginBottom: 6 }}>
          <FieldWithBinding label="borderColor" displayLabel="Border Color" hint="CSS color: e.g. #374151, rgba(0,0,0,0.5)" value={(nodeStyle.borderColor as unknown as FormulaValue) ?? ''} onChange={v => bindOrPatch('borderColor', v)}>
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
          <FieldWithBinding label="borderWidthClass" displayLabel="Width" hint="e.g. border, border-2, border-0" value={(classFormulas?.['borderWidthClass'] as FormulaValue) ?? borderWidth} onChange={v => bindOrPatchCls('borderWidthClass', evaluated => patchCls(replaceTwToken(cls, 'border', evaluated)), v)} expectedType="string">
            <SelectInput
              label="Width"
              testId="select-border-width"
              value={borderWidth}
              options={BORDER_WIDTH_TOKENS}
              onChange={v => patchCls(replaceTwToken(cls, 'border', v))}
            />
          </FieldWithBinding>
          <FieldWithBinding label="borderStyle" displayLabel="Style" hint="e.g. border-solid, border-dashed, border-dotted" value={(classFormulas?.['borderStyle'] as FormulaValue) ?? borderStyle} onChange={v => bindOrPatchCls('borderStyle', evaluated => {
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

      {/* ── Effects (Shadow) ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Effects" />
        <div style={{ marginTop: 4 }}>
          <FieldWithBinding label="shadow" displayLabel="Drop shadow" hint="e.g. shadow, shadow-md, shadow-lg, shadow-none" value={(classFormulas?.['shadow'] as FormulaValue) ?? shadowToken} onChange={v => bindOrPatchCls('shadow', evaluated => patchCls(replaceTwToken(removeTwToken(cls, 'shadow'), 'shadow', evaluated)), v)} expectedType="string">
            <SelectInput
              label="Drop shadow"
              testId="select-shadow"
              value={shadowToken}
              options={SHADOW_TOKENS}
              onChange={v => patchCls(replaceTwToken(removeTwToken(cls, 'shadow'), 'shadow', v))}
            />
          </FieldWithBinding>
        </div>
      </div>

      {/* ── Typography (text nodes only) ── */}
      {isTextNode && (
        <div style={SECTION_STYLE}>
          <SectionHeader title="Typography" />
          <div style={{ display: 'flex', gap: 6, marginBottom: 6, marginTop: 4 }}>
            <FieldWithBinding label="textSize" displayLabel="Size" hint="e.g. text-sm, text-xl, text-base" value={(classFormulas?.['textSize'] as FormulaValue) ?? textSize} onChange={v => bindOrPatchCls('textSize', evaluated => patchCls(replaceTwToken(cls, 'text-', evaluated)), v)} expectedType="string">
              <SelectInput label="Size" testId="select-text-size" value={textSize} options={TEXT_SIZE_TOKENS} onChange={v => patchCls(replaceTwToken(cls, 'text-', v))} />
            </FieldWithBinding>
            <FieldWithBinding label="fontWeightClass" displayLabel="Weight" hint="e.g. font-bold, font-semibold, font-normal" value={(classFormulas?.['fontWeightClass'] as FormulaValue) ?? fontWeight} onChange={v => bindOrPatchCls('fontWeightClass', evaluated => patchCls(replaceTwToken(cls, 'font-', evaluated)), v)} expectedType="string">
              <SelectInput label="Weight" testId="select-font-weight" value={fontWeight} options={FONT_WEIGHT_TOKENS} onChange={v => patchCls(replaceTwToken(cls, 'font-', v))} />
            </FieldWithBinding>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <FieldWithBinding label="leading" displayLabel="Leading" hint="e.g. leading-tight, leading-relaxed, leading-6" value={(classFormulas?.['leading'] as FormulaValue) ?? leading} onChange={v => bindOrPatchCls('leading', evaluated => patchCls(replaceTwToken(cls, 'leading-', evaluated)), v)} expectedType="string">
              <SelectInput label="Leading" testId="select-leading" value={leading} options={LEADING_TOKENS} onChange={v => patchCls(replaceTwToken(cls, 'leading-', v))} />
            </FieldWithBinding>
            <FieldWithBinding label="tracking" displayLabel="Tracking" hint="e.g. tracking-wide, tracking-tight, tracking-normal" value={(classFormulas?.['tracking'] as FormulaValue) ?? tracking} onChange={v => bindOrPatchCls('tracking', evaluated => patchCls(replaceTwToken(cls, 'tracking-', evaluated)), v)} expectedType="string">
              <SelectInput label="Tracking" testId="select-tracking" value={tracking} options={TRACKING_TOKENS} onChange={v => patchCls(replaceTwToken(cls, 'tracking-', v))} />
            </FieldWithBinding>
          </div>
          {/* Text alignment — 4 icon buttons with formula binding */}
          <FieldWithBinding label="textAlign" displayLabel="Align" hint='e.g. "text-left", "text-center", "text-right", "text-justify"' value={(classFormulas?.['textAlign'] as FormulaValue) ?? textAlign} onChange={v => bindOrPatchCls('textAlign', evaluated => {
            let next = cls;
            TEXT_ALIGN_TOKENS.forEach(t => { next = removeTwToken(next, t); });
            patchCls(evaluated === 'text-left' || !evaluated ? next : `${next} ${evaluated}`.trim());
          }, v)} expectedType="string" stackLayout>
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              {([['text-left','⬅'],['text-center','⬌'],['text-right','➡'],['text-justify','☰']] as const).map(([token, icon]) => (
                <ToggleBtn key={token} active={textAlign === token} onClick={() => {
                  let next = cls;
                  TEXT_ALIGN_TOKENS.forEach(t => { next = removeTwToken(next, t); });
                  patchCls(token === 'text-left' ? next : `${next} ${token}`.trim());
                }}>{icon}</ToggleBtn>
              ))}
            </div>
          </FieldWithBinding>
          {/* Text decoration & transform */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <FieldWithBinding label="textDecoration" displayLabel="Decoration" hint="e.g. underline, line-through, no-underline" value={(classFormulas?.['textDecoration'] as FormulaValue) ?? textDecor} onChange={v => bindOrPatchCls('textDecoration', evaluated => {
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
            <FieldWithBinding label="textTransform" displayLabel="Transform" hint="e.g. uppercase, lowercase, capitalize, normal-case" value={(classFormulas?.['textTransform'] as FormulaValue) ?? textTransform} onChange={v => bindOrPatchCls('textTransform', evaluated => {
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
            <FieldWithBinding label="color" displayLabel="Color" hint="CSS color: e.g. red, #333333, rgba(0,0,0,0.8)" value={(nodeStyle.color as unknown as FormulaValue) ?? ''} onChange={v => bindOrPatch('color', v)}>
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
        </div>
      )}

      {/* ── Border Radius ── */}
      <div style={SECTION_STYLE}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <SectionHeader title="Border Radius" />
          <FieldWithBinding label="borderRadius" displayLabel="Radius" hint="e.g. 4px, 8px, 50%, 9999px" value={(nodeStyle.borderRadius ?? '') as FormulaValue} onChange={v => bindOrPatch('borderRadius', v)} expectedType="string">
            <span />
          </FieldWithBinding>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {(['tl', 'tr', 'br', 'bl'] as const).map(corner => (
            <FieldWithBinding key={corner} label={`corner-${corner}`} displayLabel={corner.toUpperCase()} hint="e.g. rounded, rounded-lg, rounded-full, rounded-none" value={(classFormulas?.[`corner-${corner}`] as FormulaValue) ?? (corners[corner] ?? '')} onChange={v => bindOrPatchCls(`corner-${corner}`, evaluated => patchCls(applyBorderRadius(cls, { ...corners, [corner]: evaluated })), v)} expectedType="string">
              <SelectInput
                label={corner.toUpperCase()}
                testId={`select-corner-${corner}`}
                value={corners[corner]} options={ROUNDED_TOKENS}
                onChange={v => patchCls(applyBorderRadius(cls, { ...corners, [corner]: v }))}
              />
            </FieldWithBinding>
          ))}
        </div>
      </div>

      {/* ── Opacity ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Opacity" />
        <div style={{ marginTop: 6 }}>
          <FieldWithBinding label="opacity" displayLabel="Opacity" hint="number 0–1 e.g. 0.5, 0.8, 1 (no quotes)" value={(nodeStyle.opacity ?? '') as FormulaValue} onChange={v => bindOrPatch('opacity', v)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range" min={5} max={100} step={5}
                key={nodeId}
                defaultValue={opacityVal < 5 ? 5 : opacityVal}
                data-testid="input-opacity-slider"
                onChange={e => {
                  // Update canvas DOM immediately — no React re-render / Zustand commit during drag.
                  // Using defaultValue (uncontrolled) lets the browser move the thumb natively.
                  const val = parseInt(e.target.value);
                  const el = document.querySelector(`[data-builder-id="${nodeId}"]`) as HTMLElement | null;
                  if (el) el.style.opacity = val >= 100 ? '' : String(val / 100);
                  // Update the display label imperatively
                  const label = e.target.closest('[data-field="opacity"]')?.querySelector('[data-opacity-label]') as HTMLElement | null;
                  if (label) label.textContent = `${val}%`;
                }}
                onMouseUp={e => {
                  // Commit to Zustand + history only when drag ends
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
              <span data-opacity-label style={{ fontSize: 11, color: '#d1d5db', minWidth: 30, textAlign: 'right' }}>{opacityVal}%</span>
            </div>
          </FieldWithBinding>
        </div>
      </div>

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


// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function PanelRight() {
  const [tab, setTab] = useState<'design' | 'settings' | 'theme' | 'workflows'>('design');
  const { selectedIds, pageNodes, activePreviewStates } = useBuilderStore();
  const activePreviewState = activePreviewStates?.[0] ?? 'normal';

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
    return findNode(pageNodes as SDUINode[], selectedIds[0]);
  }, [selectedIds, pageNodes]);

  const TABS: Array<{ id: 'design' | 'settings' | 'theme' | 'workflows'; label: string; icon: React.ReactNode }> = [
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
      id: 'settings',
      label: 'Settings',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
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
  ];

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
        <>
          {/* Multi-select: show align/distribute panel instead of single-node design panel */}
          {selectedIds.length > 1 && (
            <AlignDistributePanel ids={selectedIds} />
          )}

          {!selectedNode && selectedIds.length <= 1 && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 12, textAlign: 'center', padding: 16 }}>
              Select a node to edit its properties
            </div>
          )}

          {selectedNode && <DesignTab node={selectedNode} />}
        </>
      )}

      {tab === 'settings' && (
        <>
          {!selectedNode && selectedIds.length <= 1 && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 12, textAlign: 'center', padding: 16 }}>
              Select a node to edit its settings
            </div>
          )}
          {selectedNode && <SettingsTab node={selectedNode} pageNodes={pageNodes as SDUINode[]} />}
        </>
      )}
    </div>
  );
}

