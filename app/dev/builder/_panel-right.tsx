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
import { useBuilderStore } from './_store';
import type { SDUINode } from '@/lib/sdui/types/node';
import {
  parseTwToken,
  replaceTwToken,
  removeTwToken,
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
  fontSize: 10,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
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

// ─── Inputs ───────────────────────────────────────────────────────────────────

function NumberInput({
  label, value, onChange, min = 0, max = 9999, step = 1, testId,
}: { label: string; value: number | string; onChange: (v: number) => void; min?: number; max?: number; step?: number; testId?: string }) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);

  const handleChange = (raw: string) => {
    setLocal(raw);
    // Apply immediately — no debounce so arrow keys, drag, and typing all feel instant.
    // commitHistory (undo batching) is already debounced separately in DesignTab.
    const n = Number(raw);
    if (!Number.isNaN(n)) onChange(n);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
      <span style={{ fontSize: 9, color: '#6b7280' }}>{label}</span>
      <input
        data-testid={testId}
        type="number" min={min} max={max} step={step} value={local}
        onChange={e => handleChange(e.target.value)}
        onBlur={() => {
          // Only fire if the user actually changed the value from what the store has.
          // This prevents spurious patchProp calls (e.g. gap → 'gap-0') when the
          // user merely clicks into an input and then clicks away without changing it.
          const n = Number(local);
          if (!Number.isNaN(n) && n !== Number(value)) onChange(n);
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
      onClick={onClick} title={title} data-testid={testId}
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

  const histTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitHistory = useCallback(() => {
    clearTimeout(histTimer.current);
    histTimer.current = setTimeout(() => store._pushHistory(), 400);
  }, [store]);

  const nodeStyle = useMemo(
    () => (node.props as { style?: Record<string, string> })?.style ?? {},
    [node]
  );
  const patchStyle = useCallback((patch: Record<string, string>) => {
    store.patchProp(nodeId, 'props.style', { ...nodeStyle, ...patch });
    commitHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, nodeStyle, store]);

  const patchCls = useCallback((newCls: string) => {
    store.patchProp(nodeId, 'props.className', newCls);
    commitHistory();
  }, [nodeId, store, commitHistory]);

  // ── Live DOM metrics ─────────────────────────────────────────────────────────

  const domMetrics = useMemo(() => {
    const el = document.querySelector(`[data-builder-id="${nodeId}"]`);
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
    if (!nodeStyle.backgroundColor) {
      const hex = rgbToHex(s.backgroundColor);
      // rgba(0,0,0,0) = transparent — keep the default so we don't show black
      if (hex && s.backgroundColor !== 'rgba(0, 0, 0, 0)') setComputedBgColor(hex);
      else setComputedBgColor('#ffffff');
    } else {
      setComputedBgColor(nodeStyle.backgroundColor);
    }
    if (!nodeStyle.color) {
      const hex = rgbToHex(s.color);
      if (hex) setComputedTextColor(hex);
    } else {
      setComputedTextColor(nodeStyle.color);
    }
    if (!nodeStyle.borderColor) {
      const hex = rgbToHex(s.borderTopColor);
      if (hex) setComputedBorderColor(hex);
    } else {
      setComputedBorderColor(nodeStyle.borderColor);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, nodeStyle.backgroundColor, nodeStyle.color, nodeStyle.borderColor, store.pageNodes]);

  // ── Component type classification ────────────────────────────────────────────
  // Controls which panel sections are shown. Only show relevant controls
  // per node type to avoid corrupting Gluestack's internal layout.
  const isContainer  = ['Box', 'VStack', 'HStack', 'Pressable'].includes(node.type);
  const isTextNode   = ['Text', 'Heading', 'ButtonText'].includes(node.type);
  const isLeafWidget = ['Button', 'Input', 'Switch', 'Checkbox', 'NavIcon', 'Image'].includes(node.type);
  // Padding/border-radius make sense for containers + button-like widgets, not raw text
  const showPadding  = !isTextNode;
  // Auto Layout (flex dir, gap) and Alignment only make sense for flex containers
  const showLayout   = isContainer;

  // ── Parsed tokens ─────────────────────────────────────────────────────────────

  const padding     = expandPadding(cls);
  const corners     = expandBorderRadius(cls);
  const activeCell  = getAlignCellIndex(cls);
  const flexDir     = parseTwToken(cls, 'flex-') ?? 'flex-col';
  const gapToken    = parseTwToken(cls, 'gap-') ?? 'gap-0';
  const gapPx       = parseInt(gapToken.replace('gap-', '') || '0') * 4;
  const textSize    = parseTwToken(cls, 'text-') ?? 'text-base';
  const fontWeight  = parseTwToken(cls, 'font-') ?? 'font-normal';
  const leading     = parseTwToken(cls, 'leading-') ?? 'leading-normal';
  const tracking    = parseTwToken(cls, 'tracking-') ?? 'tracking-normal';
  // Opacity is stored as inline style.opacity (0–1) for reliable cross-browser rendering.
  // NativeWind doesn't compile dynamic opacity-N classes, so we avoid them entirely.
  const opacityVal = nodeStyle.opacity !== undefined
    ? Math.round(parseFloat(String(nodeStyle.opacity)) * 100)
    : (() => {
        // Migrate legacy opacity-N className to style if present
        const token = parseTwToken(cls, 'opacity-');
        return token ? parseInt(token.replace('opacity-', '') || '100') : 100;
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
  // For Button we find the first ButtonText child and edit that instead.
  const hasDirectText = isTextNode && (node as { text?: string }).text !== undefined;
  const buttonTextChild = node.type === 'Button'
    ? (node.children as SDUINode[] | undefined)?.find(c => c.type === 'ButtonText')
    : null;
  const hasContent = hasDirectText || !!buttonTextChild;

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>

      {/* ── Content (text value) — shown for text nodes and buttons ── */}
      {hasContent && (
        <div style={SECTION_STYLE}>
          <SectionHeader title="Content" />
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
        </div>
      )}

      {/* ── Position & Size ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Position & Size" />
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
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
          <SelectInput
            label="Z-Index"
            value={zIndexToken}
            options={Z_INDEX_TOKENS}
            onChange={v => patchCls(replaceTwToken(cls, 'z-', v))}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <NumberInput label="X" value={domMetrics.x} onChange={() => {}} />
          <NumberInput label="Y" value={domMetrics.y} onChange={() => {}} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <NumberInput label="W" testId="input-pos-w" value={(() => {
            const styleW = (node.props as { style?: Record<string, string> })?.style?.width;
            if (styleW) return parseInt(styleW) || domMetrics.w;
            return domMetrics.w;
          })()} onChange={px => {
            const s = (node.props as { style?: Record<string, string> })?.style ?? {};
            store.patchProp(nodeId, 'props.style', { ...s, width: `${px}px`, minWidth: '0' });
            commitHistory();
          }} />
          <NumberInput label="H" testId="input-pos-h" value={(() => {
            const styleH = (node.props as { style?: Record<string, string> })?.style?.height;
            if (styleH) return parseInt(styleH) || domMetrics.h;
            return domMetrics.h;
          })()} onChange={px => {
            const s = (node.props as { style?: Record<string, string> })?.style ?? {};
            store.patchProp(nodeId, 'props.style', { ...s, height: `${px}px`, minHeight: '0' });
            commitHistory();
          }} />
        </div>

        {/* ── Inset controls (shown when position is absolute / fixed / sticky) ── */}
        {(positionToken === 'absolute' || positionToken === 'fixed' || positionToken === 'sticky') && (
          <>
            <div style={{ marginTop: 6, marginBottom: 2, fontSize: 10, color: '#6b7280' }}>Inset</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {(['top','right','bottom','left'] as const).map(side => (
                <NumberInput
                  key={side}
                  label={side.charAt(0).toUpperCase() + side.slice(1)}
                  testId={`input-inset-${side}`}
                  value={parseInt((node.props as { style?: Record<string, string> })?.style?.[side] ?? '') || 0}
                  onChange={px => {
                    const s = (node.props as { style?: Record<string, string> })?.style ?? {};
                    store.patchProp(nodeId, 'props.style', { ...s, [side]: `${px}px` });
                    commitHistory();
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── W/H Resize modes ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Dimensions" />
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {/* W mode */}
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>W</span>
            <div style={{ display: 'flex', gap: 2 }}>
              {([['Hug', 'w-fit'], ['Fill', 'w-full'], ['Fixed', '']] as const).map(([label, token]) => {
                const active = token ? cls.includes(token) : (!cls.includes('w-fit') && !cls.includes('w-full'));
                return (
                  <ToggleBtn key={label} data-testid={`dim-w-${label.toLowerCase()}`} active={active} onClick={() => {
                    // Hug/Fill: add the class AND clear any inline width so the class takes effect.
                    // Fixed: remove the class and keep inline width as-is (user controls it via W input).
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
          </div>
          {/* H mode */}
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>H</span>
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
          </div>
        </div>
        {/* Min / Max constraints */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <NumberInput
            label="Min W"
            testId="input-min-w"
            value={parseInt(nodeStyle.minWidth ?? '0') || 0}
            onChange={px => patchStyle({ minWidth: px > 0 ? `${px}px` : '' })}
          />
          <NumberInput
            label="Max W"
            testId="input-max-w"
            value={nodeStyle.maxWidth ? parseInt(nodeStyle.maxWidth) || 0 : 0}
            onChange={px => patchStyle({ maxWidth: px > 0 ? `${px}px` : '' })}
          />
          <NumberInput
            label="Min H"
            testId="input-min-h"
            value={parseInt(nodeStyle.minHeight ?? '0') || 0}
            onChange={px => patchStyle({ minHeight: px > 0 ? `${px}px` : '' })}
          />
          <NumberInput
            label="Max H"
            testId="input-max-h"
            value={nodeStyle.maxHeight ? parseInt(nodeStyle.maxHeight) || 0 : 0}
            onChange={px => patchStyle({ maxHeight: px > 0 ? `${px}px` : '' })}
          />
        </div>
      </div>

      {/* ── Self Alignment — how this node positions itself in its parent ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Self Alignment" />
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
      </div>

      {/* ── Rotation + Flip ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Transform" />
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <NumberInput
            label="Rotate °"
            testId="input-rotate"
            value={rotateDeg}
            min={-180} max={180}
            onChange={deg => {
              // Apply rotation as inline style.transform so it always renders visually
              const s = (node.props as { style?: Record<string, string> })?.style ?? {};
              const newTransform = deg !== 0 ? `rotate(${deg}deg)` : '';
              // Remove old rotate-* className tokens (backward compat cleanup)
              const newCls = removeTwToken(removeTwToken(cls, 'rotate-'), '-rotate-');
              if (newCls !== cls) patchCls(newCls);
              if (newTransform) {
                store.patchProp(nodeId, 'props.style', { ...s, transform: newTransform });
              } else {
                const { transform: _, ...rest } = s as Record<string, string>;
                store.patchProp(nodeId, 'props.style', rest);
              }
              commitHistory();
            }}
          />
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, width: 72 }}>
            {Array.from({ length: 9 }, (_, i) => (
              <div
                key={i}
                data-testid="alignment-cell"
                data-cell-index={i}
                onClick={() => patchCls(applyAlignment(cls, i))}
                style={{ width: 20, height: 20, background: activeCell === i ? '#3b82f6' : '#1f2937', border: `1px solid ${activeCell === i ? '#3b82f6' : '#374151'}`, borderRadius: 3, cursor: 'pointer' }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Auto Layout (only for flex containers) ── */}
      {showLayout && (
        <div style={SECTION_STYLE}>
          <SectionHeader title="Auto Layout" />
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

          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <NumberInput
              label="Gap"
              testId="input-gap"
              value={nodeStyle.gap ? parseInt(nodeStyle.gap) : gapPx}
              onChange={px => {
                patchStyle({ gap: px > 0 ? `${px}px` : undefined as unknown as string });
                // Also clean up any legacy gap-* className token
                const cleaned = removeTwToken(cls, 'gap-');
                if (cleaned !== cls) patchCls(cleaned);
              }}
            />
            {/* Gap mode: Fixed vs Space-between */}
            <div>
              <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>Mode</span>
              <div style={{ display: 'flex', gap: 2 }}>
                <ToggleBtn active={!isSpaceBetween} onClick={() => patchCls(removeTwToken(cls, 'justify-between'))}>Fixed</ToggleBtn>
                <ToggleBtn active={isSpaceBetween} onClick={() => patchCls(replaceTwToken(cls, 'justify-', 'justify-between'))}>⇔</ToggleBtn>
              </div>
            </div>
          </div>

          {/* Grid columns / rows (only visible when 'grid' layout is selected) */}
          {isGrid && (
            <div style={{ display: 'flex', gap: 6 }}>
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
              style={{ fontSize: 9, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px' }}
              onClick={() => setPadMode(m => m === 'combined' ? 'individual' : 'combined')}
            >
              {padMode === 'combined' ? '⊞' : '□'}
            </button>
          </SectionHeader>
          {padMode === 'combined' ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <NumberInput label="H (px/py)" testId="input-pad-h"
                value={parseInt(nodeStyle.paddingLeft ?? nodeStyle.paddingInline ?? String(padding.left))}
                onChange={px => {
                  patchStyle({ paddingLeft: `${px}px`, paddingRight: `${px}px`, paddingInline: undefined as unknown as string });
                  const cleaned = removeTwToken(removeTwToken(removeTwToken(cls, 'px-'), 'pl-'), 'pr-');
                  if (cleaned !== cls) patchCls(cleaned);
                }} />
              <NumberInput label="V (pt/pb)" testId="input-pad-v"
                value={parseInt(nodeStyle.paddingTop ?? nodeStyle.paddingBlock ?? String(padding.top))}
                onChange={px => {
                  patchStyle({ paddingTop: `${px}px`, paddingBottom: `${px}px`, paddingBlock: undefined as unknown as string });
                  const cleaned = removeTwToken(removeTwToken(removeTwToken(cls, 'py-'), 'pt-'), 'pb-');
                  if (cleaned !== cls) patchCls(cleaned);
                }} />
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <NumberInput label="Top"    testId="input-pad-top"
                value={parseInt(nodeStyle.paddingTop ?? String(padding.top))}
                onChange={px => patchStyle({ paddingTop: `${px}px` })} />
              <NumberInput label="Right"  testId="input-pad-right"
                value={parseInt(nodeStyle.paddingRight ?? String(padding.right))}
                onChange={px => patchStyle({ paddingRight: `${px}px` })} />
              <NumberInput label="Bottom" testId="input-pad-bottom"
                value={parseInt(nodeStyle.paddingBottom ?? String(padding.bottom))}
                onChange={px => patchStyle({ paddingBottom: `${px}px` })} />
              <NumberInput label="Left"   testId="input-pad-left"
                value={parseInt(nodeStyle.paddingLeft ?? String(padding.left))}
                onChange={px => patchStyle({ paddingLeft: `${px}px` })} />
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
            <NumberInput label="H (mx)"
              value={parseInt(nodeStyle.marginLeft ?? nodeStyle.marginInline ?? String(margin.left))}
              onChange={px => {
                patchStyle({ marginLeft: `${px}px`, marginRight: `${px}px`, marginInline: undefined as unknown as string });
                const cleaned = removeTwToken(removeTwToken(removeTwToken(cls, 'mx-'), 'ml-'), 'mr-');
                if (cleaned !== cls) patchCls(cleaned);
              }} />
            <NumberInput label="V (my)"
              value={parseInt(nodeStyle.marginTop ?? nodeStyle.marginBlock ?? String(margin.top))}
              onChange={px => {
                patchStyle({ marginTop: `${px}px`, marginBottom: `${px}px`, marginBlock: undefined as unknown as string });
                const cleaned = removeTwToken(removeTwToken(removeTwToken(cls, 'my-'), 'mt-'), 'mb-');
                if (cleaned !== cls) patchCls(cleaned);
              }} />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <NumberInput label="Top"    value={parseInt(nodeStyle.marginTop    ?? String(margin.top))}    onChange={px => patchStyle({ marginTop:    `${px}px` })} />
            <NumberInput label="Right"  value={parseInt(nodeStyle.marginRight  ?? String(margin.right))}  onChange={px => patchStyle({ marginRight:  `${px}px` })} />
            <NumberInput label="Bottom" value={parseInt(nodeStyle.marginBottom ?? String(margin.bottom))} onChange={px => patchStyle({ marginBottom: `${px}px` })} />
            <NumberInput label="Left"   value={parseInt(nodeStyle.marginLeft   ?? String(margin.left))}   onChange={px => patchStyle({ marginLeft:   `${px}px` })} />
          </div>
        )}
      </div>

      {/* ── Display & Cursor ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Display & Interaction" />
        <div style={{ display: 'flex', gap: 6 }}>
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
          <SelectInput
            label="Cursor"
            value={cursorToken}
            options={CURSOR_TOKENS}
            onChange={v => patchCls(replaceTwToken(cls, 'cursor-', v))}
          />
        </div>
      </div>

      {/* ── Clip content ── */}
      <div style={{ ...SECTION_STYLE, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: '#d1d5db' }}>Clip content</span>
        <button
          data-testid="clip-content-toggle"
          onClick={() => patchCls(isClipped ? removeTwToken(cls, 'overflow-hidden') : `${cls} overflow-hidden`.trim())}
          style={{ width: 32, height: 18, borderRadius: 9, background: isClipped ? '#3b82f6' : '#374151', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}
        >
          <span style={{ position: 'absolute', top: 2, left: isClipped ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
        </button>
      </div>

      {/* ── Fill ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Fill" />
        <ColorInput
          label="Background"
          testId="input-bg-color"
          value={computedBgColor}
          onChange={hex => patchStyle({ backgroundColor: hex })}
        />
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
        <SectionHeader title="Stroke" />
        <ColorInput
          label="Color"
          testId="input-stroke-color"
          value={computedBorderColor}
          onChange={hex => patchStyle({ borderColor: hex })}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <SelectInput
            label="Width"
            testId="select-border-width"
            value={borderWidth}
            options={BORDER_WIDTH_TOKENS}
            onChange={v => patchCls(replaceTwToken(cls, 'border', v))}
          />
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
        </div>
      </div>

      {/* ── Effects (Shadow) ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Effects" />
          <SelectInput
            label="Drop shadow"
            testId="select-shadow"
            value={shadowToken}
            options={SHADOW_TOKENS}
            onChange={v => patchCls(replaceTwToken(removeTwToken(cls, 'shadow'), 'shadow', v))}
          />
      </div>

      {/* ── Typography (text nodes only) ── */}
      {['Text', 'Heading', 'ButtonText'].includes(node.type) && (
        <div style={SECTION_STYLE}>
          <SectionHeader title="Typography" />
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <SelectInput label="Size"   testId="select-text-size"   value={textSize}   options={TEXT_SIZE_TOKENS}   onChange={v => patchCls(replaceTwToken(cls, 'text-', v))} />
            <SelectInput label="Weight" testId="select-font-weight" value={fontWeight} options={FONT_WEIGHT_TOKENS} onChange={v => patchCls(replaceTwToken(cls, 'font-', v))} />
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <SelectInput label="Leading"  testId="select-leading"  value={leading}  options={LEADING_TOKENS}  onChange={v => patchCls(replaceTwToken(cls, 'leading-', v))} />
            <SelectInput label="Tracking" testId="select-tracking" value={tracking} options={TRACKING_TOKENS} onChange={v => patchCls(replaceTwToken(cls, 'tracking-', v))} />
          </div>
          {/* Text alignment — 4 icon buttons */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {([['text-left','⬅'],['text-center','⬌'],['text-right','➡'],['text-justify','☰']] as const).map(([token, icon]) => (
              <ToggleBtn key={token} active={textAlign === token} onClick={() => {
                let next = cls;
                TEXT_ALIGN_TOKENS.forEach(t => { next = removeTwToken(next, t); });
                patchCls(token === 'text-left' ? next : `${next} ${token}`.trim());
              }}>{icon}</ToggleBtn>
            ))}
          </div>
          {/* Text decoration & transform */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <SelectInput label="Decoration" value={textDecor} options={TEXT_DECORATION_TOKENS} onChange={v => {
              let next = cls;
              TEXT_DECORATION_TOKENS.forEach(t => { next = removeTwToken(next, t); });
              patchCls(v === 'no-underline' ? next : `${next} ${v}`.trim());
            }} />
            <SelectInput label="Transform" value={textTransform} options={TEXT_TRANSFORM_TOKENS} onChange={v => {
              let next = cls;
              TEXT_TRANSFORM_TOKENS.forEach(t => { next = removeTwToken(next, t); });
              patchCls(v === 'normal-case' ? next : `${next} ${v}`.trim());
            }} />
          </div>
          <ColorInput
            label="Color"
            testId="input-text-color"
            value={computedTextColor}
            onChange={hex => patchStyle({ color: hex })}
          />
        </div>
      )}

      {/* ── Border Radius ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Border Radius" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {(['tl', 'tr', 'br', 'bl'] as const).map(corner => (
            <SelectInput
              key={corner} label={corner.toUpperCase()}
              testId={`select-corner-${corner}`}
              value={corners[corner]} options={ROUNDED_TOKENS}
              onChange={v => patchCls(applyBorderRadius(cls, { ...corners, [corner]: v }))}
            />
          ))}
        </div>
      </div>

      {/* ── Opacity ── */}
      <div style={SECTION_STYLE}>
        <SectionHeader title="Opacity" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range" min={5} max={100} step={5} value={opacityVal < 5 ? 5 : opacityVal}
            data-testid="input-opacity-slider"
            onChange={e => {
              const val = parseInt(e.target.value);
              if (val >= 100) {
                // Full opacity — remove style.opacity so the element is fully opaque
                patchStyle({ opacity: undefined as unknown as string });
                // Also clean up any legacy className opacity token
                const cleaned = removeTwToken(cls, 'opacity-');
                if (cleaned !== cls) patchCls(cleaned);
              } else {
                // Store as a fractional number (0–1) in inline style
                patchStyle({ opacity: String(val / 100) });
              }
            }}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 11, color: '#d1d5db', minWidth: 30, textAlign: 'right' }}>{opacityVal}%</span>
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

function PropsTab({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const nodeId = (node as { id?: string }).id ?? '';
  const props = (node.props ?? {}) as Record<string, unknown>;
  const [localProps, setLocalProps] = useState<Record<string, string>>({});

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

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
      {Object.entries(localProps).map(([key, val]) => (
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
      {Object.keys(localProps).length === 0 && <div style={{ color: '#4b5563', fontSize: 12 }}>No props</div>}
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

export default function PanelRight() {
  const [tab, setTab] = useState<'design' | 'props' | 'json'>('design');
  const { selectedIds, pageNodes } = useBuilderStore();

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

  return (
    <div data-testid="panel-right" style={PANEL_STYLE}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        {(['design', 'props', 'json'] as const).map(t => (
          <button
            key={t}
            data-testid={`tab-right-${t}`}
            style={{ flex: 1, padding: '9px 0', background: 'none', border: 'none', borderBottom: tab === t ? '2px solid #3b82f6' : '2px solid transparent', color: tab === t ? '#f3f4f6' : '#6b7280', fontSize: 11, cursor: 'pointer', textTransform: 'capitalize', marginBottom: -1 }}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Multi-select: show align/distribute panel instead of single-node design panel */}
      {selectedIds.length > 1 && (
        <AlignDistributePanel ids={selectedIds} />
      )}

      {!selectedNode && selectedIds.length <= 1 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 12, textAlign: 'center', padding: 16 }}>
          Select a node to edit its properties
        </div>
      )}

      {selectedNode && tab === 'design' && <DesignTab node={selectedNode} />}
      {selectedNode && tab === 'props'  && <PropsTab  node={selectedNode} />}
      {selectedNode && tab === 'json'   && <JsonTab   node={selectedNode} />}
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
