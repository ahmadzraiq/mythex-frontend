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

// ─── Shared styles ────────────────────────────────────────────────────────────

const PANEL_STYLE: React.CSSProperties = {
  width: 260,
  display: 'flex',
  flexDirection: 'column',
  background: '#111827',
  borderLeft: '1px solid #1f2937',
  overflow: 'hidden',
};

const SECTION_STYLE: React.CSSProperties = {
  borderBottom: '1px solid #1f2937',
  padding: '10px 12px',
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: '#9ca3af',
  marginBottom: 6,
  display: 'block',
};

function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
      <span style={LABEL_STYLE}>{title}</span>
      {children}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// ─── Inputs ───────────────────────────────────────────────────────────────────

function NumberInput({
  label, value, onChange, min = 0, max = 9999, step = 1, testId, onFocus,
}: { label: string; value: number | string; onChange: (v: number) => void; min?: number; max?: number; step?: number; testId?: string; onFocus?: () => void }) {
  const [local, setLocal] = useState(String(value));
  const liveRef    = useRef(Number(value));
  const inputRef   = useRef<HTMLInputElement | null>(null);
  const delayRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    liveRef.current = Number(value);
    setLocal(String(value));
  }, [value]);

  // Clean up repeat timers on unmount
  useEffect(() => () => { clearRepeat(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clearRepeat = () => {
    if (delayRef.current)    { clearTimeout(delayRef.current);    delayRef.current    = null; }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  };

  const handleChange = (raw: string) => {
    setLocal(raw);
    const n = Number(raw);
    if (!Number.isNaN(n)) { liveRef.current = n; onChange(n); }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();

    // Ignore OS-generated auto-repeat entirely — we drive our own repeat loop
    // below so it starts faster (250ms) and fires faster (50ms) than the OS
    // defaults (~500ms delay, ~33ms interval), matching the feel of holding the
    // spinner arrow button.
    if (e.repeat) return;

    const direction = e.key === 'ArrowUp' ? 1 : -1;
    const inp = inputRef.current;

    const fire = () => {
      const newVal = Math.min(max, Math.max(min, liveRef.current + direction * step));
      liveRef.current = newVal;
      setLocal(String(newVal));
      if (inp) inp.value = String(newVal);
      onChange(newVal);
    };

    fire(); // immediate on first press
    clearRepeat();

    // After 250ms, start repeating at 50ms — same feel as the browser spinner hold
    delayRef.current = setTimeout(() => {
      intervalRef.current = setInterval(fire, 50);
    }, 250);
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') clearRepeat();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
      <span style={{ fontSize: 9, color: '#6b7280' }}>{label}</span>
      <input
        ref={inputRef}
        data-testid={testId}
        type="number" min={min} max={max} step={step} value={local}
        onChange={e => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onFocus={onFocus}
        onBlur={e => {
          clearRepeat();
          const domVal = Number(e.currentTarget.value);
          const live   = Number.isNaN(domVal) ? liveRef.current : domVal;
          liveRef.current = live;
          if (live !== Number(value)) onChange(live);
          setLocal(String(live));
        }}
        style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 6px', width: '100%', boxSizing: 'border-box' }}
      />
    </div>
  );
}

function SelectInput({
  label, value, options, onChange, testId,
}: { label: string; value: string; options: readonly string[] | string[]; onChange: (v: string) => void; testId?: string }) {
  return (
    <div style={{ flex: 1 }}>
      {label && <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>{label}</span>}
      <select
        data-testid={testId}
        value={value} onChange={e => onChange(e.target.value)}
        style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 5px', width: '100%' }}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function ColorInput({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId?: string }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        type="color" value={local.startsWith('#') ? local : '#000000'}
        onChange={e => { setLocal(e.target.value); onChange(e.target.value); }}
        style={{ width: 26, height: 26, padding: 0, border: '1px solid #374151', borderRadius: 4, background: 'none', cursor: 'pointer' }}
      />
      <div style={{ flex: 1 }}>
        {label && <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>{label}</span>}
        <input
          data-testid={testId}
          value={local} onChange={e => setLocal(e.target.value)} onBlur={() => onChange(local)}
          placeholder="#000000"
          style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 6px', width: '100%', boxSizing: 'border-box' }}
        />
      </div>
    </div>
  );
}

function ToggleBtn({ active, onClick, title, children, 'data-testid': testId }: { active?: boolean; onClick: () => void; title?: string; children: React.ReactNode; 'data-testid'?: string }) {
  return (
    <button
      onClick={onClick} title={title} data-testid={testId} data-active={String(!!active)}
      style={{ padding: '3px 7px', fontSize: 11, background: active ? '#3b82f6' : '#1f2937', border: `1px solid ${active ? '#3b82f6' : '#374151'}`, color: active ? '#fff' : '#9ca3af', borderRadius: 4, cursor: 'pointer', lineHeight: 1 }}
    >
      {children}
    </button>
  );
}

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

  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }} onFocus={() => { editingNodeIdRef.current = nodeId; }}>

      {/* ── Content (text value) — shown for text nodes and buttons ── */}
      {hasContent && (
        <div style={SECTION_STYLE}>
          <SectionHeader title="Content" />
          <div style={{ marginTop: 6 }}>
            <FieldWithBinding
              label="text"
              displayLabel="Text"
              hint='any text or {{variable}} template'
              topAlign
              value={(buttonTextChild
                ? ((buttonTextChild as { text?: string }).text ?? '')
                : ((node as { text?: string }).text ?? '')
              ) as FormulaValue}
              onChange={v => {
                const targetId = buttonTextChild ? (buttonTextChild as { id?: string }).id ?? '' : nodeId;
                store.patchProp(targetId, 'text', v as string);
                commitHistory();
              }}
            >
              <textarea
                data-testid="input-text-content"
                value={
                  buttonTextChild
                    ? ((buttonTextChild as { text?: string }).text ?? '')
                    : ((node as { text?: string }).text ?? '')
                }
                rows={2}
                onChange={e => {
                  if (buttonTextChild) {
                    store.patchProp((buttonTextChild as { id?: string }).id ?? '', 'text', e.target.value);
                  } else {
                    store.patchProp(nodeId, 'text', e.target.value);
                  }
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

// ─── Design-tab inline sections (moved from Logic) ────────────────────────────

const INTERACTIVE_TYPES = new Set(['Button', 'Input', 'InputField', 'Select', 'SelectTrigger', 'Pressable', 'Checkbox', 'Switch', 'Radio', 'TextArea']);
const FORM_INPUT_TYPES = new Set(['Input', 'InputField', 'Select', 'TextArea', 'Checkbox', 'Radio', 'Switch']);

const DESIGN_INLINE_STYLE: React.CSSProperties = {
  borderTop: '1px solid #1f2937',
  padding: '8px 12px',
};

const DESIGN_LABEL: React.CSSProperties = {
  fontSize: 10,
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  // marginBottom intentionally omitted here — set per usage
  display: 'block',
  marginBottom: 4,
};

// ─── ToggleBind ───────────────────────────────────────────────────────────────
// Compact row: LABEL | [toggle / ƒ Edit formula] [≈]
// Used for Visible, Disabled, and Repeat sections.
function ToggleBind({
  rowLabel, fieldId, hint, expectedType = 'boolean',
  isOn, value,
  onToggle, onChange, style,
}: {
  rowLabel: string;
  fieldId: string;
  hint?: string;
  expectedType?: 'string' | 'number' | 'boolean' | 'any';
  isOn: boolean;
  value: FormulaValue;
  onToggle: () => void;
  onChange: (v: FormulaValue) => void;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = React.useState(false);
  const bound = isBoundValue(value);

  const openEditor = () => {
    setOpen(true);
  };

  return (
    <div style={{ ...DESIGN_INLINE_STYLE, display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...style }}>
      {/* Bind icon before label on the left */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <BindingIcon isBound={bound} onClick={openEditor} />
        <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {rowLabel}
        </span>
      </div>

      {/* Toggle or formula button on the right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, position: 'relative', flexShrink: 0 }}>
        {bound ? (
          <button
            data-testid={`edit-formula-btn-${fieldId}`}
            onClick={openEditor}
            style={{
              padding: '3px 10px', background: '#2e1065', border: '1px solid #7c3aed',
              borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            ƒ Edit formula
          </button>
        ) : (
          <button
            data-testid={`toggle-${fieldId}`}
            onClick={onToggle}
            style={{
              width: 32, height: 18, borderRadius: 9,
              background: isOn ? '#3b82f6' : '#374151',
              border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0,
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: isOn ? 16 : 2,
              width: 14, height: 14, borderRadius: '50%', background: '#fff',
              transition: 'left 0.15s',
            }} />
          </button>
        )}
        {open && (
          <FormulaEditor
            label={fieldId}
            value={value}
            expectedType={expectedType}
            hint={hint}
            anchor="right"
            onChange={v => { onChange(v); setOpen(false); }}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

function VisibilityInDesign({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const nodeId = (node as { id?: string }).id ?? '';
  const condition = (node as { condition?: unknown }).condition;
  const isBound = isBoundValue(condition as FormulaValue);
  const isHidden = !isBound && condition === false;
  const hasCondition = condition != null;
  const forceShow = !!(node as { _forceShowInEditor?: boolean })._forceShowInEditor;

  return (
    <div style={DESIGN_INLINE_STYLE}>
      <ToggleBind
        rowLabel="Visible"
        fieldId="visibility-condition"
        hint="e.g. {{isLoggedIn}}, {{cart.items.length > 0}}"
        expectedType="boolean"
        isOn={!isHidden}
        value={(isBound ? condition : !isHidden) as FormulaValue}
        onToggle={() => store.patchCondition(nodeId, isHidden ? null : false as unknown as object)}
        onChange={v => {
          if (isBoundValue(v)) store.patchCondition(nodeId, v as object);
          else store.patchCondition(nodeId, null);
        }}
        style={{ borderTop: 'none', padding: 0 }}
      />
      {hasCondition && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 6, borderTop: '1px solid #1f2937' }}>
          <span style={{ fontSize: 10, color: '#4b5563' }}>Force show in editor</span>
          <button
            data-testid="force-show-toggle"
            onClick={() => store.patchNodeField(nodeId, '_forceShowInEditor', forceShow ? undefined : true)}
            title="Override condition — always render this node on the canvas"
            style={{ width: 32, height: 18, borderRadius: 9, background: forceShow ? '#f59e0b' : '#374151', border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0 }}
          >
            <span style={{ position: 'absolute', top: 2, left: forceShow ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
          </button>
        </div>
      )}
    </div>
  );
}

function DisableInDesign({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const nodeId = (node as { id?: string }).id ?? '';
  const disabled = (node.props as Record<string, unknown> | undefined)?.disabled;
  const isBound = isBoundValue(disabled as FormulaValue);
  const isDisabled = !isBound && !!disabled;
  const showOverlay = isDisabled || isBound;

  const overlay = ((node as Record<string, unknown>)._disabledOverlay ?? {}) as {
    color?: string; opacity?: number; blur?: number;
  };
  const forceShow = !!(node as Record<string, unknown>)._forceDisabledInEditor;

  const patchOverlay = (patch: Partial<typeof overlay>) =>
    store.patchNodeField(nodeId, '_disabledOverlay', { ...overlay, ...patch });

  // Local state keeps the slider/number inputs responsive while rAF batches
  // the store writes (live, no history) so the canvas gets a live update every
  // animation frame. A single history snapshot is pushed only when the gesture ends.
  const [localOpacity, setLocalOpacity] = useState(Math.round((overlay.opacity ?? 0.3) * 100));
  const [localBlur, setLocalBlur] = useState(overlay.blur ?? 0);
  const opacityRaf = useRef<number | null>(null);
  const blurRaf    = useRef<number | null>(null);
  const colorRaf   = useRef<number | null>(null);

  // Sync local state when the selected node changes.
  useEffect(() => {
    setLocalOpacity(Math.round((overlay.opacity ?? 0.3) * 100));
    setLocalBlur(overlay.blur ?? 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // Snapshot the overlay at the start of each gesture so the rAF spread is accurate.
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;

  const patchOpacityLive = (pct: number) => {
    setLocalOpacity(pct);
    if (opacityRaf.current !== null) cancelAnimationFrame(opacityRaf.current);
    opacityRaf.current = requestAnimationFrame(() => {
      store.patchNodeFieldLive(nodeId, '_disabledOverlay', { ...overlayRef.current, opacity: pct / 100 });
      opacityRaf.current = null;
    });
  };

  const patchBlurLive = (px: number) => {
    setLocalBlur(px);
    if (blurRaf.current !== null) cancelAnimationFrame(blurRaf.current);
    blurRaf.current = requestAnimationFrame(() => {
      store.patchNodeFieldLive(nodeId, '_disabledOverlay', { ...overlayRef.current, blur: px });
      blurRaf.current = null;
    });
  };

  // ColorPopover already rAF-throttles its onSelect call, so no second rAF needed here —
  // a double rAF doubles the latency and makes the picker feel laggy.
  const patchColorLive = (hex: string) => {
    store.patchNodeFieldLive(nodeId, '_disabledOverlay', { ...overlayRef.current, color: hex });
  };

  const commitHistory = () => store._pushHistory();

  return (
    <>
      <ToggleBind
        rowLabel="Disabled"
        fieldId="disabled-state"
        hint="e.g. {{!isLoggedIn}}, {{form.loading}}"
        expectedType="boolean"
        isOn={isDisabled}
        value={(isBound ? disabled : isDisabled) as FormulaValue}
        onToggle={() => store.patchProp(nodeId, 'props.disabled', isDisabled ? undefined : true)}
        onChange={v => {
          if (isBoundValue(v)) store.patchProp(nodeId, 'props.disabled', v);
          else store.patchProp(nodeId, 'props.disabled', undefined);
        }}
      />
      {showOverlay && (
        <div style={{ borderTop: '1px solid #1f2937', padding: '6px 12px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ ...DESIGN_LABEL, marginBottom: 0 }}>Overlay</span>

          {/* Color — full row */}
          <div>
            <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>Color</span>
            <FigmaColorPicker
              value={overlay.color?.startsWith('#') ? overlay.color : '#000000'}
              onChange={hex => patchColorLive(hex)}
              onCommit={commitHistory}
            />
          </div>

          {/* Opacity — own row so slider has full width and never overflows */}
          <div>
            <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>Opacity %</span>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type="number" min={0} max={100} step={5}
                value={localOpacity}
                onChange={e => patchOpacityLive(Math.min(100, Math.max(0, Number(e.target.value))))}
                onBlur={() => commitHistory()}
                style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '2px 5px', width: 44, textAlign: 'center' as const, flexShrink: 0 }}
              />
              <input
                type="range" min={0} max={100} step={1}
                value={localOpacity}
                onChange={e => patchOpacityLive(Number(e.target.value))}
                onMouseUp={() => commitHistory()}
                style={{ flex: 1, minWidth: 0, accentColor: '#3b82f6' }}
              />
            </div>
          </div>

          {/* Blur */}
          <div>
            <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>Blur px</span>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type="number" min={0} max={40} step={1}
                value={localBlur}
                onChange={e => patchBlurLive(Math.min(40, Math.max(0, Number(e.target.value))))}
                onBlur={() => commitHistory()}
                style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '2px 5px', width: 44, textAlign: 'center' as const }}
              />
              <input
                type="range" min={0} max={40} step={1}
                value={localBlur}
                onChange={e => patchBlurLive(Number(e.target.value))}
                onMouseUp={() => commitHistory()}
                style={{ flex: 1, accentColor: '#3b82f6' }}
              />
            </div>
          </div>

          {/* Force show in editor — only relevant when disabled is formula-bound */}
          {isBound && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#9ca3af', cursor: 'pointer', paddingTop: 2 }}>
              <input
                type="checkbox"
                checked={forceShow}
                onChange={e => store.patchNodeField(nodeId, '_forceDisabledInEditor', e.target.checked || undefined)}
              />
              Force show in editor
            </label>
          )}
        </div>
      )}
    </>
  );
}

function RepeatInDesign({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const nodeId = (node as { id?: string }).id ?? '';
  const mapValue = (node as { map?: unknown }).map;
  const hasMap = !!mapValue;
  // Normalise: plain string paths become { formula } so the editor can display/edit them
  const mapFormulaValue: FormulaValue = isBoundValue(mapValue as FormulaValue)
    ? (mapValue as FormulaValue)
    : typeof mapValue === 'string' && mapValue
      ? { formula: mapValue }
      : false;

  return (
    <ToggleBind
      rowLabel="Repeat / List"
      fieldId="repeat-map"
      hint="e.g. store.products, cart.items"
      expectedType="any"
      isOn={hasMap}
      value={mapFormulaValue}
      onToggle={() => store.patchMap(nodeId, hasMap ? null : 'store.items')}
      onChange={v => {
        if (isBoundValue(v)) {
          const f = (v as { formula: string }).formula.trim();
          const isSimplePath = /^[\w$.]+$/.test(f);
          store.patchNodeField(nodeId, 'map', isSimplePath ? f : v);
        } else {
          store.patchMap(nodeId, null);
        }
      }}
    />
  );
}

/** Name input for the node — display label shown in formula editor component picker */
function NodeNameInDesign({
  node,
  nodeId,
  commitHistory,
  store,
}: {
  node: SDUINode;
  nodeId: string;
  commitHistory: () => void;
  store: ReturnType<typeof useBuilderStore>;
}) {
  const currentName = (node as { name?: string }).name ?? '';
  const [draft, setDraft] = useState(currentName);
  useEffect(() => { setDraft(currentName); }, [currentName]);

  const commit = (value: string) => {
    const trimmed = value.trim() || undefined;
    if (trimmed === currentName) return;
    store.patchNodeField(nodeId, 'name', trimmed);
    commitHistory();
  };

  return (
    <div style={SECTION_STYLE}>
      <SectionHeader title="Name" />
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { commit(draft); (e.target as HTMLInputElement).blur(); } }}
        placeholder={`e.g. ${node.type}`}
        style={{
          width: '100%', boxSizing: 'border-box',
          background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
          color: '#f3f4f6', fontSize: 11, padding: '4px 7px', outline: 'none',
        }}
      />
    </div>
  );
}



// ─── Grid overlay mini-panel ──────────────────────────────────────────────────

function GridOverlayPanel() {
  const { gridOverlay, setGridOverlay } = useBuilderStore();
  return (
    <div style={SECTION_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={LABEL_STYLE}>Layout Guide</span>
        <button
          onClick={() => setGridOverlay({ enabled: !gridOverlay.enabled })}
          style={{ width: 32, height: 18, borderRadius: 9, background: gridOverlay.enabled ? '#3b82f6' : '#374151', border: 'none', cursor: 'pointer', position: 'relative' }}
        >
          <span style={{ position: 'absolute', top: 2, left: gridOverlay.enabled ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff' }} />
        </button>
      </div>
      {gridOverlay.enabled && (
        <div style={{ display: 'flex', gap: 6 }}>
          <SelectInput
            label="Type"
            value={gridOverlay.type}
            options={['columns', 'rows', 'grid']}
            onChange={v => setGridOverlay({ type: v as 'columns' | 'rows' | 'grid' })}
          />
          <NumberInput
            label="Count"
            value={gridOverlay.count}
            min={1} max={48}
            onChange={n => setGridOverlay({ count: n })}
          />
        </div>
      )}
    </div>
  );
}

// ─── Props Tab ────────────────────────────────────────────────────────────────

// Props managed by the Design tab — hide from raw Props tab to avoid confusion
const DESIGN_MANAGED_PROPS = new Set(['className', 'style']);
// Props managed by Design tab for specific node types
const IMAGE_MANAGED_PROPS = new Set(['width', 'height', 'src', 'alt', 'fill', 'objectFit']);

function PropsTab({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const nodeId = (node as { id?: string }).id ?? '';
  const props = (node.props ?? {}) as Record<string, unknown>;
  const [localProps, setLocalProps] = useState<Record<string, string>>({});
  const isImageNode = node.type === 'NextImage' || node.type === 'Image';

  useEffect(() => {
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(props)) {
      flat[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    setLocalProps(flat);
  }, [node]);

  const commitProp = (key: string, value: string) => {
    try { store.patchProp(nodeId, `props.${key}`, JSON.parse(value)); }
    catch { store.patchProp(nodeId, `props.${key}`, value); }
    store._pushHistory();
  };

  const filteredEntries = Object.entries(localProps).filter(([key]) => {
    if (DESIGN_MANAGED_PROPS.has(key)) return false;
    if (isImageNode && IMAGE_MANAGED_PROPS.has(key)) return false;
    return true;
  });

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
      <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 10, fontStyle: 'italic' }}>
        className and layout props are managed in the Design tab.
      </div>
      {filteredEntries.map(([key, val]) => (
        <div key={key} style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: '#6b7280', display: 'block', marginBottom: 2 }}>{key}</span>
          <input
            type="text"
            value={val}
            onChange={e => setLocalProps(prev => ({ ...prev, [key]: e.target.value }))}
            onBlur={() => commitProp(key, localProps[key])}
            onKeyDown={e => { if (e.key === 'Enter') commitProp(key, localProps[key]); }}
            style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '4px 6px', boxSizing: 'border-box' }}
          />
        </div>
      ))}
      {filteredEntries.length === 0 && (
        <div style={{ color: '#4b5563', fontSize: 12 }}>
          No additional props — use the Design tab to adjust layout and style.
        </div>
      )}
    </div>
  );
}

// ─── JSON Tab ─────────────────────────────────────────────────────────────────

function JsonTab({ node }: { node: SDUINode }) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
      <pre style={{ fontSize: 10, color: '#86efac', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {JSON.stringify(node, null, 2)}
      </pre>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

// ─── Preview Data Editor ──────────────────────────────────────────────────────

// Stable empty object — avoids creating a new {} reference on every render for pages without previewData
const EMPTY_PREVIEW_DATA: Record<string, unknown> = {};

function PreviewDataEditor() {
  // Use targeted selectors to avoid re-rendering on every store change
  const setCurrentPagePreviewData = useBuilderStore(s => s.setCurrentPagePreviewData);
  const appPreviewData = useBuilderStore(s => s.appPreviewData);
  const pageData = useBuilderStore(s => s.pages.find(p => p.id === s.currentPageId)?.previewData ?? EMPTY_PREVIEW_DATA);

  // Keep a ref for appPreviewData so the effect closure always has the latest without it being a dep
  const appPreviewDataRef = useRef(appPreviewData);
  appPreviewDataRef.current = appPreviewData;

  // Show merged data as starting point when page data is empty so user sees all applied data
  const initialDraft = Object.keys(pageData).length > 0
    ? pageData
    : { ...appPreviewData, ...pageData };

  const [draft, setDraft] = useState(() => JSON.stringify(initialDraft, null, 2));
  const [error, setError] = useState<string | null>(null);
  const prevPageDataRef = useRef<Record<string, unknown>>(pageData);

  // Sync external store changes into the draft only when pageData identity changes.
  // appPreviewData is intentionally not in deps — we read it via ref to avoid excess re-runs.
  useEffect(() => {
    if (prevPageDataRef.current !== pageData) {
      prevPageDataRef.current = pageData;
      const newDraft = Object.keys(pageData).length > 0
        ? pageData
        : { ...appPreviewDataRef.current, ...pageData };
      setDraft(JSON.stringify(newDraft, null, 2));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageData]);

  const handleSave = useCallback(() => {
    try {
      const parsed = JSON.parse(draft) as Record<string, unknown>;
      setError(null);
      setCurrentPagePreviewData(parsed);
    } catch {
      setError('Invalid JSON');
    }
  }, [draft, setCurrentPagePreviewData]);

  const appKeyCount = Object.keys(appPreviewData).length;
  const pageKeyCount = Object.keys(pageData).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: 12, gap: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa', letterSpacing: '0.05em' }}>PREVIEW DATA</span>
        <button
          data-testid="preview-data-save"
          onClick={handleSave}
          style={{ padding: '3px 10px', background: '#7c3aed', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, cursor: 'pointer' }}
        >
          Apply
        </button>
      </div>
      {/* Badge showing app vs page key counts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, background: '#1e1b4b', color: '#a78bfa', padding: '2px 6px', borderRadius: 4, border: '1px solid #4c1d95' }}>
          App: {appKeyCount} keys
        </span>
        <span style={{ fontSize: 10, background: '#1f2937', color: '#9ca3af', padding: '2px 6px', borderRadius: 4, border: '1px solid #374151' }}>
          Page override: {pageKeyCount} keys
        </span>
      </div>
      <div style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.5 }}>
        Editing saves page-level overrides. App-level data is set in <strong style={{ color: '#9ca3af' }}>App &rarr; Preview Data</strong>.
      </div>
      <textarea
        data-testid="preview-data-editor"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={handleSave}
        spellCheck={false}
        style={{
          flex: 1,
          minHeight: 200,
          background: '#111827',
          color: '#e5e7eb',
          border: `1px solid ${error ? '#f87171' : '#374151'}`,
          borderRadius: 6,
          padding: 10,
          fontSize: 11,
          fontFamily: 'monospace',
          resize: 'vertical',
          outline: 'none',
          lineHeight: 1.6,
        }}
      />
      {error && <span style={{ fontSize: 11, color: '#f87171' }}>{error}</span>}
    </div>
  );
}

// ─── Element Workflows Tab ────────────────────────────────────────────────────

function WorkflowRowMenu({ uuid, onOpen, onRemove }: { uuid: string; onOpen: () => void; onRemove: () => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px 4px', fontSize: 16, lineHeight: 1, borderRadius: 4 }}
        title="More options"
      >
        ⋮
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', right: 0, top: '100%', zIndex: 999,
            background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)', minWidth: 150, overflow: 'hidden',
          }}
          onClick={e => e.stopPropagation()}
        >
          {uuid && (
            <button
              onClick={() => { setOpen(false); onOpen(); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', color: '#e2e8f0', fontSize: 12, cursor: 'pointer' }}
            >
              ↗ Open in canvas
            </button>
          )}
          <button
            onClick={() => { setOpen(false); onRemove(); }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer' }}
          >
            × Remove
          </button>
        </div>
      )}
    </div>
  );
}

function ElementWorkflowsTab({ node }: { node: SDUINode | null }) {
  const { openWorkflowCanvas, pageWorkflowMeta, patchNodeField, setPageWorkflow, setPageWorkflowMeta } = useBuilderStore();
  const [hovered, setHovered] = useState<string | null>(null);

  if (!node) {
    return (
      <div
        data-testid="right-workflows-empty"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', gap: 10 }}
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#d1d5db' }}>Workflows</span>
        <span style={{ fontSize: 11, color: '#4b5563', lineHeight: 1.5 }}>Select an element to manage its workflows.</span>
      </div>
    );
  }

  const nodeId = (node as { id?: string }).id ?? '';

  // Normalise actions: new format is an array of ActionRefs, legacy is an event-keyed object
  const rawActions = node.actions;
  type WorkflowEntry = { uuid: string; trigger: string; idx: number };
  let workflowEntries: WorkflowEntry[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawActionsArr = Array.isArray(rawActions) ? (rawActions as any[]) : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawActionsObj = (!Array.isArray(rawActions) && rawActions && typeof rawActions === 'object') ? (rawActions as Record<string, any>) : null;

  if (rawActionsArr) {
    // New format: [{ action: "uuid" }, ...]
    workflowEntries = rawActionsArr
      .filter((a: unknown) => a && typeof (a as Record<string, unknown>).action === 'string')
      .map((a: Record<string, unknown>, idx: number) => {
        const uuid = a.action as string;
        const trigger = pageWorkflowMeta[uuid]?.trigger ?? 'click';
        return { uuid, trigger, idx };
      })
      // Hide system-managed workflows (auto-generated onChange setters)
      .filter(({ uuid }) => !pageWorkflowMeta[uuid]?.isSystem);
  } else if (rawActionsObj) {
    // Legacy event-keyed object format — skip inline system actions (e.g. setFormField)
    // only show pure ActionRef entries { action: "uuid" } which have no "type" property
    workflowEntries = Object.entries(rawActionsObj)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter(([, actionDef]) => !(actionDef as any)?.type)
      .map(([event, actionDef], idx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const uuid = (actionDef as any)?.action as string ?? event;
        return { uuid, trigger: event, idx };
      });
  }

  function handleBind(idx: number, newUuid: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current: any[] = rawActionsArr ? [...rawActionsArr] : [];
    if (!newUuid) {
      const updated = current.filter((_: unknown, i: number) => i !== idx);
      patchNodeField(nodeId, 'actions', updated.length > 0 ? updated : undefined);
    } else {
      current[idx] = { action: newUuid };
      patchNodeField(nodeId, 'actions', current);
    }
  }

  function handleAddNew() {
    // Create a new empty workflow, attach it to this element, and open the canvas immediately
    const uuid = crypto.randomUUID();
    setPageWorkflow(uuid, []);
    setPageWorkflowMeta(uuid, { id: uuid, name: 'New Workflow', trigger: 'click' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current: any[] = rawActionsArr ? [...rawActionsArr] : [];
    patchNodeField(nodeId, 'actions', [...current, { action: uuid }]);
    openWorkflowCanvas({ kind: 'pageWorkflow', name: uuid, nodeId });
  }

  return (
    <div data-testid="right-workflows-panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#e5e7eb', letterSpacing: '0.01em' }}>
          ⚡ Workflows
        </span>
        <button
          data-testid="right-workflows-new-btn"
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 12px', background: '#1d4ed8', border: 'none',
            borderRadius: 6, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}
          onClick={handleAddNew}
        >
          + New
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {workflowEntries.length === 0 ? (
          <div
            data-testid="right-workflows-create-cta"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24, gap: 8, textAlign: 'center' }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#d1d5db' }}>No workflows yet</span>
            <span style={{ fontSize: 11, color: '#4b5563', lineHeight: 1.5 }}>Click + New to attach a workflow to this element.</span>
          </div>
        ) : (
          workflowEntries.map(({ uuid, trigger, idx }) => {
            const meta = pageWorkflowMeta[uuid];
            const displayName = meta?.name ? toHumanName(meta.name) : 'Unnamed Workflow';
            const triggerDisplay = trigger ? `On ${trigger}` : 'On click';
            return (
              <div
                key={`${uuid}-${idx}`}
                data-testid={`right-workflow-row-${idx}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px',
                  borderBottom: '1px solid #1f2937',
                  background: hovered === `${idx}` ? 'rgba(255,255,255,0.04)' : 'transparent',
                  cursor: 'default',
                }}
                onMouseEnter={() => setHovered(`${idx}`)}
                onMouseLeave={() => setHovered(null)}
              >
                {/* Left: trigger icon */}
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: '#1e293b', border: '1px solid #334155',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, color: '#94a3b8',
                }}>
                  {/* cursor/pointer icon */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
                  </svg>
                </div>

                {/* Center: name + trigger */}
                {uuid ? (
                  <div
                    style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                    onClick={() => openWorkflowCanvas({ kind: 'pageWorkflow', name: uuid, nodeId })}
                    title="Open workflow canvas"
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {displayName}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                      {triggerDisplay}
                    </div>
                  </div>
                ) : (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <WorkflowBindButton value="" onChange={newUuid => handleBind(idx, newUuid)} />
                  </div>
                )}

                {/* Right: three-dot menu */}
                <WorkflowRowMenu
                  uuid={uuid}
                  onOpen={() => uuid && openWorkflowCanvas({ kind: 'pageWorkflow', name: uuid, nodeId })}
                  onRemove={() => handleBind(idx, '')}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

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

// ─── Settings Tab ─────────────────────────────────────────────────────────────

const SETTINGS_INPUT_TYPES = new Set(['Input', 'InputField', 'Select', 'TextArea', 'Checkbox', 'Radio', 'Switch', 'Button']);

const INPUT_TYPE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Email',    value: 'email' },
  { label: 'Password', value: 'password' },
  { label: 'Number',   value: 'number' },
  { label: 'Decimal',  value: 'decimal' },
  { label: 'Phone',    value: 'tel' },
  { label: 'Currency', value: 'currency' },
];

/** Row layout for settings: label on left, control on right */
function SettingsRow({
  label,
  children,
  indent = false,
}: {
  label: string;
  children: React.ReactNode;
  indent?: boolean;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      padding: `5px ${indent ? 12 : 12}px`,
      paddingLeft: indent ? 20 : 12,
    }}>
      <span style={{ fontSize: 11, color: '#d1d5db', flexShrink: 0, minWidth: 80 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
        {children}
      </div>
    </div>
  );
}

/** On/Off segmented toggle reused from design tab style */
function OnOffToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const btnBase: React.CSSProperties = {
    padding: '2px 10px',
    fontSize: 10,
    border: 'none',
    cursor: 'pointer',
    borderRadius: 3,
    fontWeight: 500,
  };
  return (
    <div style={{ display: 'flex', background: '#1f2937', borderRadius: 4, padding: 2, gap: 2 }}>
      <button
        style={{ ...btnBase, background: value ? '#374151' : 'transparent', color: value ? '#f3f4f6' : '#6b7280' }}
        onClick={() => onChange(true)}
      >On</button>
      <button
        style={{ ...btnBase, background: !value ? '#374151' : 'transparent', color: !value ? '#f3f4f6' : '#6b7280' }}
        onClick={() => onChange(false)}
      >Off</button>
    </div>
  );
}

/** Small text input for settings rows */
function SettingsTextInput({ value, onChange, placeholder, expandable = false }: { value: string; onChange: (v: string) => void; placeholder?: string; expandable?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'flex-end' }}>
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { onChange(draft); (e.target as HTMLInputElement).blur(); } }}
        placeholder={placeholder}
        style={{
          background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
          color: '#f3f4f6', fontSize: 11, padding: '3px 7px', outline: 'none',
          width: 130, boxSizing: 'border-box',
        }}
      />
      {expandable && (
        <button style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }} title="Expand">⤢</button>
      )}
    </div>
  );
}

type ValidationRuleType = 'required' | 'email' | 'minLength' | 'maxLength' | 'phone' | 'url' | 'pattern' | 'formula';
type ValidationRule = { type: ValidationRuleType; message: string; value?: string; formula?: FormulaValue };
type NodeValidation = { trigger?: 'submit' | 'change'; rules?: ValidationRule[] };

// Local-state text input: shows updates immediately, commits to store only on blur.
// Prevents a Zustand write + re-render on every keystroke.
function RuleMessageInput({ value, onChange, placeholder = 'Error message', style }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <input
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onChange(local); }}
      placeholder={placeholder}
      style={style}
    />
  );
}

function RuleValueInput({ value, onChange, placeholder = '', style }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <input
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onChange(local); }}
      placeholder={placeholder}
      style={style}
    />
  );
}
type NodeDebounce = { enabled?: boolean; delay?: number };

const RULE_TYPE_OPTIONS: { value: ValidationRuleType; label: string; hasValue?: boolean; valuePlaceholder?: string }[] = [
  { value: 'required',  label: 'Required' },
  { value: 'email',     label: 'Email' },
  { value: 'minLength', label: 'Min length', hasValue: true, valuePlaceholder: '2' },
  { value: 'maxLength', label: 'Max length', hasValue: true, valuePlaceholder: '100' },
  { value: 'phone',     label: 'Phone' },
  { value: 'url',       label: 'URL' },
  { value: 'pattern',   label: 'Pattern (regex)', hasValue: true, valuePlaceholder: '^[a-z]+$' },
  { value: 'formula',   label: 'Custom formula' },
];
const RULE_DEFAULTS: Record<ValidationRuleType, Partial<ValidationRule>> = {
  required:  { message: 'This field is required' },
  email:     { message: 'Please enter a valid email address' },
  minLength: { message: 'Must be at least N characters', value: '2' },
  maxLength: { message: 'Must be at most N characters', value: '100' },
  phone:     { message: 'Please enter a valid phone number' },
  url:       { message: 'Please enter a valid URL' },
  pattern:   { message: 'Invalid format', value: '' },
  formula:   { message: 'Invalid value' },
};

function findSubmitButtonInTree(nodes: SDUINode[]): SDUINode | null {
  for (const n of nodes) {
    const actions = (n.actions ?? {}) as Record<string, unknown>;
    if ((actions.click as Record<string, unknown> | undefined)?.type === 'submitForm') return n;
    const child = n.children as SDUINode[] | undefined;
    if (child?.length) { const found = findSubmitButtonInTree(child); if (found) return found; }
  }
  return null;
}

function SettingsTab({ node, pageNodes }: { node: SDUINode; pageNodes: SDUINode[] }) {
  const store = useBuilderStore();
  const nodeId = (node as { id?: string }).id ?? '';
  const nodeType = node.type as string;

  // ── Node name (shown for all types) ──────────────────────────────────────────
  const currentName = (node as { name?: string }).name ?? '';
  const [nameDraft, setNameDraft] = useState(currentName);
  useEffect(() => { setNameDraft(currentName); }, [currentName]);

  // Walk up tree to find FormContainer ancestor
  const formContainerAncestor = useMemo(() => {
    let current = findParentNode(pageNodes, nodeId);
    while (current) {
      if ((current.type as string) === 'FormContainer') return current;
      const parentId = (current as { id?: string }).id;
      if (!parentId) break;
      current = findParentNode(pageNodes, parentId);
    }
    return null;
  }, [pageNodes, nodeId]);

  const nodeActions = (node.actions ?? {}) as Record<string, unknown>;
  const nodeProps = (node.props ?? {}) as Record<string, unknown>;
  const nodeExtra = node as unknown as Record<string, unknown>;
  const validation = nodeExtra._validation as NodeValidation | undefined;
  const debounce = nodeExtra._debounce as NodeDebounce | undefined;

  // Extract field name from setFormField action
  const { formFieldSlot, fieldName } = useMemo(() => {
    for (const [slot, action] of Object.entries(nodeActions)) {
      if (action && typeof action === 'object') {
        const a = action as Record<string, unknown>;
        if (a.type === 'setFormField') {
          return { formFieldSlot: slot, fieldName: String(a.field ?? '') };
        }
        // nested in runMultiple
        if (a.type === 'runMultiple' && Array.isArray(a.actions)) {
          const sub = (a.actions as Array<Record<string, unknown>>).find(x => x.type === 'setFormField');
          if (sub) return { formFieldSlot: slot, fieldName: String(sub.field ?? '') };
        }
      }
    }
    return { formFieldSlot: null, fieldName: '' };
  }, [nodeActions]);

  const [fieldNameDraft, setFieldNameDraft] = useState(fieldName);
  useEffect(() => { setFieldNameDraft(fieldName); }, [fieldName]);

  // Index of the rule whose formula editor is open (-1 = none)
  const [formulaOpenRuleIdx, setFormulaOpenRuleIdx] = useState(-1);

  useEffect(() => {
    if (formulaOpenRuleIdx < 0) return;
    return registerEditorClose(() => setFormulaOpenRuleIdx(-1));
  }, [formulaOpenRuleIdx]);

  const openRuleFormula = (e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    if (formulaOpenRuleIdx === idx) { setFormulaOpenRuleIdx(-1); return; }
    closeAllEditors();
    setFormulaOpenRuleIdx(idx);
  };

  // ── helpers ──────────────────────────────────────────────────────────────────

  const commitName = (value: string) => {
    const trimmed = value.trim() || undefined;
    if (trimmed === currentName) return;
    store.patchNodeField(nodeId, 'name', trimmed);
  };

  const syncValidationToAction = (nextValidation: NodeValidation) => {
    const rules = nextValidation.rules ?? [];
    const reqRule = rules.find(r => r.type === 'required');

    // 1. Update the InputField's setFormField action (for on-change validation)
    if (formFieldSlot) {
      const action = nodeActions[formFieldSlot] as Record<string, unknown>;
      if (action) {
        const validationPatch = {
          validationTrigger: nextValidation.trigger ?? 'submit',
          required: !!reqRule,
          requiredMessage: reqRule?.message,
          validationRules: rules,
        };
        if (action.type === 'setFormField') {
          store.patchNodeField(nodeId, 'actions', {
            ...nodeActions,
            [formFieldSlot]: { ...action, ...validationPatch },
          });
        } else if (action.type === 'runMultiple' && Array.isArray(action.actions)) {
          const updated = (action.actions as Array<Record<string, unknown>>).map(x =>
            x.type === 'setFormField' ? { ...x, ...validationPatch } : x
          );
          store.patchNodeField(nodeId, 'actions', { ...nodeActions, [formFieldSlot]: { ...action, actions: updated } });
        }
      }
    }

    // 2. Also update the submit button's fieldValidations so submitForm knows about this field's rules
    if (formContainerAncestor && fieldName) {
      const submitBtn = findSubmitButtonInTree((formContainerAncestor.children ?? []) as SDUINode[]);
      if (submitBtn) {
        const sbId = (submitBtn as unknown as { id?: string }).id ?? '';
        if (!sbId) return;
        const sbActions = (submitBtn.actions ?? {}) as Record<string, unknown>;
        const clickAction = sbActions.click as Record<string, unknown> | undefined;
        if (clickAction?.type === 'submitForm') {
          const existingFV = (clickAction.fieldValidations ?? {}) as Record<string, unknown>;
          store.patchNodeField(sbId, 'actions', {
            ...sbActions,
            click: {
              ...clickAction,
              fieldValidations: {
                ...existingFV,
                [fieldName]: { required: !!reqRule, requiredMessage: reqRule?.message, validationRules: rules },
              },
            },
          });
        }
      }
    }
  };

  const patchValidation = (patch: Partial<NodeValidation>) => {
    const next = { ...(validation ?? {}), ...patch } as NodeValidation;
    store.patchNodeField(nodeId, '_validation', next);
    syncValidationToAction(next);
  };

  const validationRules = (validation?.rules ?? []) as ValidationRule[];
  const validationTrigger = (validation?.trigger ?? 'submit') as 'submit' | 'change';

  const addRule = () => {
    const type: ValidationRuleType = 'required';
    const newRule: ValidationRule = { type, ...RULE_DEFAULTS[type] } as ValidationRule;
    patchValidation({ rules: [...validationRules, newRule] });
  };
  const updateRule = (idx: number, patch: Partial<ValidationRule>) => {
    patchValidation({ rules: validationRules.map((r, i) => i === idx ? { ...r, ...patch } : r) });
  };
  const changeRuleType = (idx: number, newType: ValidationRuleType) => {
    patchValidation({ rules: validationRules.map((r, i) => i === idx ? { type: newType, message: r.message || (RULE_DEFAULTS[newType].message ?? ''), ...( RULE_DEFAULTS[newType].value !== undefined ? { value: RULE_DEFAULTS[newType].value } : {} ) } as ValidationRule : r) });
  };
  const removeRule = (idx: number) => {
    if (formulaOpenRuleIdx === idx) setFormulaOpenRuleIdx(-1);
    patchValidation({ rules: validationRules.filter((_, i) => i !== idx) });
  };

  const syncDebounceToAction = (next: NodeDebounce) => {
    if (!formFieldSlot) return;
    const action = nodeActions[formFieldSlot] as Record<string, unknown>;
    if (!action) return;
    if (action.type === 'setFormField') {
      store.patchNodeField(nodeId, 'actions', {
        ...nodeActions,
        [formFieldSlot]: { ...action, _debounce: next },
      });
    } else if (action.type === 'runMultiple' && Array.isArray(action.actions)) {
      const updated = (action.actions as Array<Record<string, unknown>>).map(x =>
        x.type === 'setFormField' ? { ...x, _debounce: next } : x
      );
      store.patchNodeField(nodeId, 'actions', { ...nodeActions, [formFieldSlot]: { ...action, actions: updated } });
    }
  };

  const patchDebounce = (patch: Partial<NodeDebounce>) => {
    const next = { ...(debounce ?? {}), ...patch };
    store.patchNodeField(nodeId, '_debounce', next);
    syncDebounceToAction(next);
  };

  const patchProp = (key: string, value: unknown) => {
    store.patchNodeField(nodeId, 'props', { ...nodeProps, [key]: value });
  };

  const patchInitialValue = (value: unknown) => {
    store.patchNodeField(nodeId, '_initialValue', value);
    // Sync to FormContainer's initialFormData so the field is pre-populated on mount
    if (formContainerAncestor && fieldName) {
      const fcId = (formContainerAncestor as { id?: string }).id ?? '';
      if (fcId) {
        const fcProps = (formContainerAncestor.props ?? {}) as Record<string, unknown>;
        const current = (fcProps.initialFormData ?? {}) as Record<string, unknown>;
        store.patchNodeField(fcId, 'props', { ...fcProps, initialFormData: { ...current, [fieldName]: value } });
      }
    }
  };

  const commitFieldName = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || !formFieldSlot) return;
    const oldName = fieldName;

    // 1. Update setFormField action's field property
    const action = nodeActions[formFieldSlot] as Record<string, unknown>;
    if (action.type === 'setFormField') {
      store.patchNodeField(nodeId, 'actions', { ...nodeActions, [formFieldSlot]: { ...action, field: trimmed } });
    } else if (action.type === 'runMultiple' && Array.isArray(action.actions)) {
      const updated = (action.actions as Array<Record<string, unknown>>).map(x =>
        x.type === 'setFormField' ? { ...x, field: trimmed } : x
      );
      store.patchNodeField(nodeId, 'actions', { ...nodeActions, [formFieldSlot]: { ...action, actions: updated } });
    }

    // 2. Update node.name to match the new field name (field name IS the display name)
    store.patchNodeField(nodeId, 'name', trimmed);

    // 3. Rename the key in FormContainer's initialFormData so the formula path stays in sync
    if (oldName && oldName !== trimmed && formContainerAncestor) {
      const fcId = (formContainerAncestor as { id?: string }).id ?? '';
      const fcProps = (formContainerAncestor.props ?? {}) as Record<string, unknown>;
      const oldData = (fcProps.initialFormData ?? {}) as Record<string, unknown>;
      if (oldName in oldData) {
        const { [oldName]: oldVal, ...rest } = oldData;
        store.patchNodeField(fcId, 'props', { ...fcProps, initialFormData: { ...rest, [trimmed]: oldVal } });
      }
    }
  };

  const isReadOnly = !!(nodeProps.readOnly ?? nodeProps.isReadOnly);
  const autocomplete = nodeProps.autoComplete as string | undefined;
  const placeholder = (nodeProps.placeholder as string | undefined) ?? '';
  const initValue = ((node as Record<string, unknown>)._initialValue as string | undefined) ?? '';
  const debounceEnabled = debounce?.enabled ?? false;
  const debounceDelay = debounce?.delay ?? 500;

  // Input type — map raw prop to option value
  const rawInputType = (nodeProps.type as string | undefined) ?? 'text';
  const currentInputType = rawInputType === 'number' && nodeProps.step === '0.01' ? 'decimal' : rawInputType;

  // Button submit detection
  const isSubmitButton = (nodeActions.click as Record<string, unknown> | undefined)?.type === 'submitForm';

  const selectInputType = (val: string) => {
    if (val === 'decimal' || val === 'currency') {
      store.patchNodeField(nodeId, 'props', { ...nodeProps, type: 'number', step: '0.01' });
    } else {
      const { step: _s, ...rest } = nodeProps as Record<string, unknown>;
      void _s;
      store.patchNodeField(nodeId, 'props', { ...rest, type: val });
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

      {/* ── Name (all types; hidden when inside FormContainer — field name serves as name) ── */}
      {!formContainerAncestor && (
        <div style={{ borderBottom: '1px solid #1f2937', padding: '8px 12px' }}>
          <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Name</div>
          <input
            data-testid="settings-name-input"
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={e => commitName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { commitName(nameDraft); (e.target as HTMLInputElement).blur(); } }}
            placeholder={`e.g. ${nodeType}`}
            style={{ width: '100%', boxSizing: 'border-box' as const, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '4px 7px', outline: 'none' }}
          />
        </div>
      )}

      {/* ── Button-specific: Submit toggle ───────────────────────────────────── */}
      {nodeType === 'Button' && (
        <div style={{ borderBottom: '1px solid #1f2937', padding: '8px 0 4px' }}>
          <div style={{ padding: '0 12px 4px', fontSize: 10, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Button</div>
          <SettingsRow label="Submit">
            <div data-testid="submit-toggle" style={{ display: 'flex', background: '#1f2937', borderRadius: 4, padding: 2, gap: 2 }}>
              {[true, false].map(val => (
                <button
                  key={String(val)}
                  data-testid={val ? 'submit-toggle-on' : 'submit-toggle-off'}
                  style={{
                    padding: '2px 10px', fontSize: 10, border: 'none', cursor: 'pointer',
                    borderRadius: 3, fontWeight: 500,
                    background: isSubmitButton === val ? '#374151' : 'transparent',
                    color: isSubmitButton === val ? '#f3f4f6' : '#6b7280',
                  }}
                  onClick={() => {
                    if (val) {
                      store.patchNodeField(nodeId, 'actions', { ...nodeActions, click: { type: 'submitForm' } });
                    } else {
                      const { click: _c, ...rest } = nodeActions as Record<string, unknown>;
                      void _c;
                      store.patchNodeField(nodeId, 'actions', Object.keys(rest).length ? rest : undefined);
                    }
                  }}
                >
                  {val ? 'On' : 'Off'}
                </button>
              ))}
            </div>
          </SettingsRow>
        </div>
      )}

      {/* ── For non-input, non-button types: show nothing more ───────────────── */}
      {!SETTINGS_INPUT_TYPES.has(nodeType) && nodeType !== 'Button' && (
        <div style={{ padding: 16, color: '#4b5563', fontSize: 11, textAlign: 'center' }}>
          No specific settings for this element
        </div>
      )}

      {/* ── Form Container Section (input types only) ────────────────────────── */}
      {SETTINGS_INPUT_TYPES.has(nodeType) && nodeType !== 'Button' && formContainerAncestor && (
        <div style={{ borderBottom: '1px solid #1f2937', padding: '8px 0 4px' }}>
          <div style={{ padding: '0 12px 4px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 12 11 14 15 10"/><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
            </svg>
            <span style={{ fontSize: 10, color: '#10b981', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Form container</span>
          </div>

          {/* Field name */}
          <SettingsRow label="Field name">
            <BindingIcon isBound={false} onClick={() => {}} />
            <input
              data-testid="settings-field-name-input"
              value={fieldNameDraft}
              onChange={e => setFieldNameDraft(e.target.value)}
              onBlur={e => commitFieldName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { commitFieldName(fieldNameDraft); (e.target as HTMLInputElement).blur(); } }}
              placeholder="e.g. email"
              style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 7px', outline: 'none', width: 110, boxSizing: 'border-box' as const }}
            />
          </SettingsRow>

          {/* Validation trigger */}
          <SettingsRow label="Validate">
            <select
              data-testid="settings-validation-trigger"
              value={validationTrigger}
              onChange={e => patchValidation({ trigger: e.target.value as 'submit' | 'change' })}
              style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 6px', outline: 'none', flex: 1, maxWidth: 160 }}
            >
              <option value="submit">On form submit</option>
              <option value="change">On input change</option>
            </select>
          </SettingsRow>

          {/* ── Validation rules list ──────────────────────────────────────────── */}
          <div style={{ padding: '4px 12px 2px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rules</span>
              <button
                onClick={addRule}
                style={{ fontSize: 10, color: '#a78bfa', background: 'none', border: '1px solid #4c1d95', borderRadius: 3, padding: '1px 7px', cursor: 'pointer' }}
              >
                + Add rule
              </button>
            </div>

            {validationRules.length === 0 && (
              <div style={{ fontSize: 10, color: '#4b5563', padding: '4px 0 6px', fontStyle: 'italic' }}>No rules — click + Add rule</div>
            )}

            {validationRules.map((rule, idx) => {
              const opt = RULE_TYPE_OPTIONS.find(o => o.value === rule.type);
              const isFormulaOpen = formulaOpenRuleIdx === idx;
              return (
                <div key={idx} style={{ marginBottom: 6, background: '#0f1929', borderRadius: 4, border: '1px solid #1f2937', padding: '5px 6px' }}>
                  {/* Row 1: type + message + remove */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <select
                      value={rule.type}
                      onChange={e => changeRuleType(idx, e.target.value as ValidationRuleType)}
                      style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 3, color: '#f3f4f6', fontSize: 10, padding: '2px 4px', outline: 'none', flexShrink: 0, width: 100 }}
                    >
                      {RULE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {rule.type !== 'formula' && !opt?.hasValue && (
                      <RuleMessageInput
                        value={rule.message}
                        onChange={v => updateRule(idx, { message: v })}
                        style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 3, color: '#d1d5db', fontSize: 10, padding: '2px 5px', outline: 'none', flex: 1, minWidth: 0 }}
                      />
                    )}
                    <button
                      onClick={() => removeRule(idx)}
                      style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                      title="Remove rule"
                    >×</button>
                  </div>

                  {/* Row 2: value input (minLength / maxLength / pattern) */}
                  {opt?.hasValue && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                      <span style={{ fontSize: 9, color: '#6b7280', flexShrink: 0 }}>Value</span>
                      <RuleValueInput
                        value={rule.value ?? ''}
                        onChange={v => updateRule(idx, { value: v })}
                        placeholder={opt.valuePlaceholder ?? ''}
                        style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 3, color: '#d1d5db', fontSize: 10, padding: '2px 5px', outline: 'none', width: 70 }}
                      />
                      <RuleMessageInput
                        value={rule.message}
                        onChange={v => updateRule(idx, { message: v })}
                        style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 3, color: '#d1d5db', fontSize: 10, padding: '2px 5px', outline: 'none', flex: 1, minWidth: 0 }}
                      />
                    </div>
                  )}

                  {/* Row 2: formula editor (formula type) */}
                  {rule.type === 'formula' && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                          <button
                            onClick={e => openRuleFormula(e, idx)}
                            style={{ padding: '2px 8px', background: isFormulaOpen ? '#3b0764' : '#2e1065', border: '1px solid #7c3aed', borderRadius: 4, color: '#a78bfa', fontSize: 10, cursor: 'pointer', fontWeight: 500, width: '100%', textAlign: 'left' }}
                          >
                            ƒ {rule.formula ? 'Edit formula' : 'Add formula'}
                          </button>
                          {isFormulaOpen && (
                            <FormulaEditor
                              label="Validation formula"
                              value={rule.formula ?? null}
                              expectedType="any"
                              hint='true = valid · false = invalid · "Error message" = invalid with message'
                              anchor="right"
                              hideUnbind
                              onChange={v => { updateRule(idx, { formula: v }); setFormulaOpenRuleIdx(-1); }}
                              onClose={() => setFormulaOpenRuleIdx(-1)}
                            />
                          )}
                        </div>
                      </div>
                      <RuleMessageInput
                        value={rule.message}
                        onChange={v => updateRule(idx, { message: v })}
                        placeholder="Error message (fallback)"
                        style={{ marginTop: 4, background: '#111827', border: '1px solid #1f2937', borderRadius: 3, color: '#d1d5db', fontSize: 10, padding: '2px 5px', outline: 'none', width: '100%', boxSizing: 'border-box' as const }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Specific section (input types only) ──────────────────────────────── */}
      {SETTINGS_INPUT_TYPES.has(nodeType) && nodeType !== 'Button' && (
        <div style={{ padding: '8px 0 4px' }}>
          <div style={{ padding: '0 12px 6px', fontSize: 11, fontWeight: 600, color: '#9ca3af' }}>Specific</div>

          {/* Input type (Input and InputField only) */}
          {(nodeType === 'Input' || nodeType === 'InputField') && (
            <SettingsRow label="Input type">
              <select
                data-testid="settings-input-type-select"
                value={currentInputType}
                onChange={e => selectInputType(e.target.value)}
                style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 6px', outline: 'none', flex: 1, maxWidth: 150 }}
              >
                {INPUT_TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </SettingsRow>
          )}

          {/* Init value */}
          <SettingsRow label="Init value">
            <FieldWithBinding
              label="Init value"
              value={initValue as import('./_formula-panel').FormulaValue}
              onChange={v => patchInitialValue(v)}
              expectedType="string"
            >
              <input
                value={initValue}
                onChange={e => patchInitialValue(e.target.value)}
                placeholder=""
                style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 7px', outline: 'none', width: 130, boxSizing: 'border-box' as const }}
              />
            </FieldWithBinding>
          </SettingsRow>

          {/* Placeholder */}
          <SettingsRow label="Placeholder">
            <FieldWithBinding
              label="Placeholder"
              value={placeholder as import('./_formula-panel').FormulaValue}
              onChange={v => patchProp('placeholder', v)}
              expectedType="string"
            >
              <input
                value={placeholder}
                onChange={e => patchProp('placeholder', e.target.value)}
                placeholder="Placeholder"
                style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 7px', outline: 'none', width: 130, boxSizing: 'border-box' as const }}
              />
            </FieldWithBinding>
          </SettingsRow>

          {/* Autocomplete */}
          <SettingsRow label="Autocomplete">
            <BindingIcon isBound={false} onClick={() => {}} />
            <OnOffToggle value={autocomplete !== 'new-password' && autocomplete !== 'off'} onChange={v => patchProp('autoComplete', v ? 'on' : 'new-password')} />
          </SettingsRow>

          {/* Debounce */}
          <SettingsRow label="Debounce">
            <OnOffToggle value={debounceEnabled} onChange={v => patchDebounce({ enabled: v })} />
          </SettingsRow>

          {/* Delay (only when debounce is on) */}
          {debounceEnabled && (
            <SettingsRow label="Delay">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number"
                  value={debounceDelay}
                  min={0}
                  max={5000}
                  step={50}
                  onChange={e => patchDebounce({ delay: Math.max(0, Number(e.target.value)) })}
                  style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 5px', outline: 'none', width: 52, textAlign: 'center' as const }}
                />
                <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0 }}>ms</span>
                <input
                  type="range"
                  min={0}
                  max={2000}
                  step={50}
                  value={debounceDelay}
                  onChange={e => patchDebounce({ delay: Number(e.target.value) })}
                  style={{ flex: 1, accentColor: '#3b82f6', width: 60 }}
                />
              </div>
            </SettingsRow>
          )}
        </div>
      )}
    </div>
  );
}


// ─── Align / Distribute Panel ─────────────────────────────────────────────────

function AlignDistributePanel({ ids }: { ids: string[] }) {
  const store = useBuilderStore();

  const ALIGN_BTNS: Array<{ label: string; icon: string; edge: Parameters<typeof store.alignNodes>[1]; testId: string }> = [
    { label: 'Align Left',    icon: '⊢', edge: 'left',   testId: 'align-left' },
    { label: 'Align Center H',icon: '↔', edge: 'center', testId: 'align-center-h' },
    { label: 'Align Right',   icon: '⊣', edge: 'right',  testId: 'align-right' },
    { label: 'Align Top',     icon: '⊤', edge: 'top',    testId: 'align-top' },
    { label: 'Align Middle V',icon: '↕', edge: 'middle', testId: 'align-middle-v' },
    { label: 'Align Bottom',  icon: '⊥', edge: 'bottom', testId: 'align-bottom' },
  ];

  const DIST_BTNS: Array<{ label: string; icon: string; axis: 'h' | 'v'; testId: string }> = [
    { label: 'Distribute Horizontal', icon: '⇔', axis: 'h', testId: 'distribute-h' },
    { label: 'Distribute Vertical',   icon: '⇕', axis: 'v', testId: 'distribute-v' },
  ];

  return (
    <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
      <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 8 }}>{ids.length} nodes selected</div>

      <SectionHeader title="Align" />
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12, marginTop: 6 }}>
        {ALIGN_BTNS.map(({ label, icon, edge, testId }) => (
          <button
            key={edge}
            title={label}
            data-testid={testId}
            onClick={() => store.alignNodes(ids, edge)}
            style={{ width: 32, height: 28, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', cursor: 'pointer', fontSize: 14 }}
          >
            {icon}
          </button>
        ))}
      </div>

      <SectionHeader title="Distribute" />
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        {DIST_BTNS.map(({ label, icon, axis, testId }) => (
          <button
            key={axis}
            title={label}
            data-testid={testId}
            onClick={() => store.distributeNodes(ids, axis)}
            style={{ width: 32, height: 28, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', cursor: 'pointer', fontSize: 14 }}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}
