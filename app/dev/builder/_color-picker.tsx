'use client';

/**
 * FigmaColorPicker — full-featured color picker with:
 *  - 2D HSV spectrum
 *  - Hue slider
 *  - Alpha slider (with checkerboard)
 *  - Format toggle: HEX | RGB | RGBA
 *  - Theme color swatches
 *
 * The `value` prop accepts hex (#rrggbb), rgb(...), or rgba(...) strings.
 * `onChange(color, cssVar?)` passes back the color in the selected format.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import themeConfig from '@/config/theme.json';
import { useBuilderStore } from './_store';

// ─── Color model helpers ─────────────────────────────────────────────────────

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  s /= 100; v /= 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r)      h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : Math.round((d / max) * 100);
  const v = Math.round(max * 100);
  return [h, s, v];
}

function hexToRgb(hex: string): [number, number, number] | null {
  if (!hex || !hex.startsWith('#')) return null;
  const clean = hex.replace('#', '');
  let r: number, g: number, b: number;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else if (clean.length >= 6) {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  } else {
    return null;
  }
  // Guard against NaN from non-hex characters
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return [r, g, b];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map(n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0'))
    .join('');
}

/** Parse any CSS color string → {r,g,b,a}. Returns null on failure. */
function parseColorToRgba(value: string): { r: number; g: number; b: number; a: number } | null {
  if (!value) return null;
  const rgba = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/);
  if (rgba) {
    return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: rgba[4] !== undefined ? parseFloat(rgba[4]) : 1 };
  }
  if (value.startsWith('#')) {
    const rgb = hexToRgb(value);
    if (rgb) return { r: rgb[0], g: rgb[1], b: rgb[2], a: 1 };
  }
  return null;
}

type ColorFormat = 'hex' | 'rgb' | 'rgba';

function formatToOutput(r: number, g: number, b: number, a: number, fmt: ColorFormat): string {
  r = Math.round(Math.max(0, Math.min(255, r)));
  g = Math.round(Math.max(0, Math.min(255, g)));
  b = Math.round(Math.max(0, Math.min(255, b)));
  a = Math.max(0, Math.min(1, a));
  if (fmt === 'hex') return rgbToHex(r, g, b);
  if (fmt === 'rgb') return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${parseFloat(a.toFixed(2))})`;
}

/** Infer the best format from a stored color string. */
function inferFormat(value: string): ColorFormat {
  if (value.startsWith('rgba(')) return 'rgba';
  if (value.startsWith('rgb(')) return 'rgb';
  return 'hex';
}

/**
 * Extract the design-system CSS variable name from color values like:
 *   'var(--theme-primary)', 'rgb(var(--primary))', 'var(--ring)'
 * Returns the short name without 'theme-' prefix (e.g. 'primary', 'ring').
 */
function parseCssVarName(value: string): string | null {
  // Stop at first comma (CSS-var fallback) or closing paren so values like
  // `var(--theme-brand-2, #d1d5db)` resolve to `brand-2`, not the whole tail.
  const m = value.match(/var\(--([^,)\s]+)/);
  if (!m) return null;
  // Strip 'theme-' prefix — element colors are stored as var(--theme-X)
  // but swatch identifiers use the short design-system name (e.g. 'primary')
  return m[1].startsWith('theme-') ? m[1].slice(6) : m[1];
}

/**
 * Resolve a color value that may contain a CSS variable reference.
 * Tries --theme-X first (full hex/rgba value), then --X (may be a triplet).
 */
function resolveColorValue(value: string): string {
  const shortName = parseCssVarName(value);
  if (!shortName) return value;
  // Prefer --theme-X which holds the full color (hex or rgba, not just a triplet)
  const resolved = resolveCssVar(`theme-${shortName}`) ?? resolveCssVar(shortName);
  return resolved ?? value;
}

function isValidHex(s: string) {
  return /^#[0-9a-fA-F]{3,8}$/.test(s);
}

// ─── Theme swatches ──────────────────────────────────────────────────────────

interface ThemeSwatch { label: string; cssVar: string; defaultHex: string; }

const LIGHT_DEFAULTS = themeConfig.cssVariables.root as Record<string, string>;

const GLOBAL_SWATCHES: ThemeSwatch[] = [
  { label: 'Background',    cssVar: 'background',              defaultHex: LIGHT_DEFAULTS['--background']              ?? '#ffffff' },
  { label: 'Foreground',    cssVar: 'foreground',              defaultHex: LIGHT_DEFAULTS['--foreground']              ?? '#171923' },
  { label: 'Primary',       cssVar: 'primary',                 defaultHex: LIGHT_DEFAULTS['--primary']                 ?? '#1e293b' },
  { label: 'Pri. Text',     cssVar: 'primary-foreground',      defaultHex: LIGHT_DEFAULTS['--primary-foreground']      ?? '#f8fafc' },
  { label: 'Secondary',     cssVar: 'secondary',               defaultHex: LIGHT_DEFAULTS['--secondary']               ?? '#f1f5f9' },
  { label: 'Sec. Text',     cssVar: 'secondary-foreground',    defaultHex: LIGHT_DEFAULTS['--secondary-foreground']    ?? '#1e293b' },
  { label: 'Muted',         cssVar: 'muted',                   defaultHex: LIGHT_DEFAULTS['--muted']                   ?? '#f1f5f9' },
  { label: 'Muted Text',    cssVar: 'muted-foreground',        defaultHex: LIGHT_DEFAULTS['--muted-foreground']        ?? '#64748b' },
  { label: 'Accent',        cssVar: 'accent',                  defaultHex: LIGHT_DEFAULTS['--accent']                  ?? '#f1f5f9' },
  { label: 'Acc. Text',     cssVar: 'accent-foreground',       defaultHex: LIGHT_DEFAULTS['--accent-foreground']       ?? '#1e293b' },
  { label: 'Destructive',   cssVar: 'destructive',             defaultHex: LIGHT_DEFAULTS['--destructive']             ?? '#ef4444' },
  { label: 'Dest. Text',    cssVar: 'destructive-foreground',  defaultHex: LIGHT_DEFAULTS['--destructive-foreground']  ?? '#ffffff' },
  { label: 'Card',          cssVar: 'card',                    defaultHex: LIGHT_DEFAULTS['--card']                    ?? '#ffffff' },
  { label: 'Card Text',     cssVar: 'card-foreground',         defaultHex: LIGHT_DEFAULTS['--card-foreground']         ?? '#171923' },
  { label: 'Border',        cssVar: 'border',                  defaultHex: LIGHT_DEFAULTS['--border']                  ?? '#e2e8f0' },
  { label: 'Ring',          cssVar: 'ring',                    defaultHex: LIGHT_DEFAULTS['--ring']                    ?? '#94a3b8' },
];

function resolveCssVar(cssVar: string): string | null {
  if (typeof document === 'undefined') return null;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${cssVar}`).trim();
  if (!raw) return null;
  if (raw.startsWith('#')) return raw;
  // Full rgba/rgb value — return as-is to preserve alpha channel
  if (raw.startsWith('rgba(') || raw.startsWith('rgb(')) return raw;
  const rgbM = raw.match(/rgb\(?\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (rgbM) {
    const h = (n: number) => n.toString(16).padStart(2, '0');
    return `#${h(+rgbM[1])}${h(+rgbM[2])}${h(+rgbM[3])}`;
  }
  // Space-separated triplet format (e.g. "124 58 237")
  const triplet = raw.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/);
  if (triplet) {
    const h = (n: number) => Number(n).toString(16).padStart(2, '0');
    return `#${h(+triplet[1])}${h(+triplet[2])}${h(+triplet[3])}`;
  }
  return null;
}

// ─── Checkerboard CSS (for alpha display) ────────────────────────────────────

const CHECKER = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='4' height='4' fill='%23aaa'/%3E%3Crect x='4' y='4' width='4' height='4' fill='%23aaa'/%3E%3Crect x='4' width='4' height='4' fill='%23666'/%3E%3Crect y='4' width='4' height='4' fill='%23666'/%3E%3C/svg%3E")`;

// ─── Spectrum Box ─────────────────────────────────────────────────────────────

function SpectrumBox({ hue, sat, val, onChange }: {
  hue: number; sat: number; val: number;
  onChange: (s: number, v: number) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const pick = useCallback((e: MouseEvent | React.MouseEvent) => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    onChange(Math.round(x * 100), Math.round((1 - y) * 100));
  }, [onChange]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (dragging.current) pick(e); };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [pick]);

  const hueHex = rgbToHex(...hsvToRgb(hue, 100, 100));
  const dotX = sat;
  const dotY = 100 - val;

  return (
    <div
      ref={boxRef}
      onMouseDown={e => { dragging.current = true; pick(e); }}
      style={{
        position: 'relative', width: '100%', height: 140,
        borderRadius: 6, cursor: 'crosshair', overflow: 'hidden', flexShrink: 0,
        background: hueHex,
      }}
    >
      {/* White L→R gradient */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, #fff, transparent)', borderRadius: 6 }} />
      {/* Black T→B gradient */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent, #000)', borderRadius: 6 }} />
      {/* Dot */}
      <div style={{
        position: 'absolute',
        left: `${dotX}%`, top: `${dotY}%`,
        transform: 'translate(-50%, -50%)',
        width: 12, height: 12,
        borderRadius: '50%',
        border: '2px solid #fff',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
        pointerEvents: 'none',
      }} />
    </div>
  );
}

// ─── HueSlider ───────────────────────────────────────────────────────────────

function HueSlider({ hue, onChange }: { hue: number; onChange: (h: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const pick = useCallback((e: MouseEvent | React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onChange(Math.round(x * 360));
  }, [onChange]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (dragging.current) pick(e); };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [pick]);

  return (
    <div style={{ position: 'relative', height: 12 }}>
      <div
        ref={ref}
        onMouseDown={e => { dragging.current = true; pick(e); }}
        style={{
          width: '100%', height: '100%', borderRadius: 6, cursor: 'pointer',
          background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
        }}
      />
      <div style={{
        position: 'absolute', top: '50%',
        left: `${(hue / 360) * 100}%`,
        transform: 'translate(-50%, -50%)',
        width: 14, height: 14, borderRadius: '50%',
        border: '2px solid #fff',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
        background: rgbToHex(...hsvToRgb(hue, 100, 100)),
        pointerEvents: 'none',
      }} />
    </div>
  );
}

// ─── AlphaSlider ─────────────────────────────────────────────────────────────

function AlphaSlider({ alpha, r, g, b, onChange }: {
  alpha: number; r: number; g: number; b: number;
  onChange: (a: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const pick = useCallback((e: MouseEvent | React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onChange(parseFloat(x.toFixed(2)));
  }, [onChange]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (dragging.current) pick(e); };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [pick]);

  const colorStr = `rgb(${r}, ${g}, ${b})`;

  return (
    <div style={{ position: 'relative', height: 12 }}>
      {/* Checkerboard */}
      <div style={{ position: 'absolute', inset: 0, borderRadius: 6, backgroundImage: CHECKER, backgroundSize: '8px 8px' }} />
      {/* Color gradient */}
      <div
        ref={ref}
        onMouseDown={e => { dragging.current = true; pick(e); }}
        style={{
          position: 'absolute', inset: 0, borderRadius: 6, cursor: 'pointer',
          background: `linear-gradient(to right, transparent, ${colorStr})`,
        }}
      />
      {/* Thumb */}
      <div style={{
        position: 'absolute', top: '50%',
        left: `${alpha * 100}%`,
        transform: 'translate(-50%, -50%)',
        width: 14, height: 14, borderRadius: '50%',
        border: '2px solid #fff',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
        background: `rgba(${r}, ${g}, ${b}, ${alpha})`,
        pointerEvents: 'none',
      }} />
    </div>
  );
}

// ─── Swatch ───────────────────────────────────────────────────────────────────

function Swatch({
  label, cssVar, defaultHex, currentValue, onSelect, overrides,
  selectedCssVar, editingCssVar, editingDefaultHex, singleMatchCssVar,
}: {
  label: string; cssVar: string; defaultHex: string;
  currentValue: string; onSelect: (hex: string, cssVar: string) => void;
  overrides: Record<string, string>; selectedCssVar: string | null;
  editingCssVar?: string | null; editingDefaultHex?: string | null;
  singleMatchCssVar?: string | null;
}) {
  const resolved = overrides[cssVar] ?? resolveCssVar(cssVar) ?? defaultHex;
  const isEditingThis = editingCssVar != null && editingCssVar === cssVar;
  const defaultForReset = (editingDefaultHex ?? defaultHex) || defaultHex;
  const displayColor = isEditingThis ? defaultForReset : resolved;
  const valueOnClick = isEditingThis ? defaultForReset : resolved;
  const isActive = selectedCssVar !== null
    ? selectedCssVar === cssVar
    : editingCssVar != null
      ? editingCssVar === cssVar
      : singleMatchCssVar != null && singleMatchCssVar === cssVar;

  return (
    <div
      data-testid={`swatch-${cssVar}`}
      title={`${label}\n${isEditingThis ? `${displayColor} (default)` : displayColor}`}
      onClick={() => onSelect(valueOnClick, cssVar)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        cursor: 'pointer', padding: '4px 2px', borderRadius: 4,
        background: isActive ? 'rgba(59,130,246,0.18)' : 'transparent',
      }}
    >
      <div style={{
        width: 24, height: 24, borderRadius: 5,
        background: displayColor,
        border: isActive ? '2px solid #3b82f6' : '1.5px solid rgba(255,255,255,0.18)',
        boxSizing: 'border-box', flexShrink: 0,
      }} />
      <span style={{
        fontSize: 8, color: '#9ca3af', whiteSpace: 'nowrap',
        maxWidth: 36, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center',
      }}>
        {label}
      </span>
    </div>
  );
}

// ─── ColorPopover ─────────────────────────────────────────────────────────────

interface PopoverProps {
  anchorRect: DOMRect;
  onClose: () => void;
  value: string;
  onSelect: (color: string, cssVar: string) => void;
  themeOverrides: Record<string, string>;
  selectedCssVar: string | null;
  editingCssVar?: string | null;
  editingDefaultHex?: string | null;
  /** Extra swatches appended after the system theme palette. */
  customSwatches?: ThemeSwatch[];
}

function ColorPopover({
  anchorRect, onClose, value, onSelect, themeOverrides, selectedCssVar,
  editingCssVar, editingDefaultHex, customSwatches,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  // ── Parse initial color ──
  const parsed = useMemo(() => parseColorToRgba(value), [value]);
  const initRgb = parsed ?? { r: 0, g: 0, b: 0, a: 1 };
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(initRgb.r, initRgb.g, initRgb.b));
  const [alpha, setAlpha] = useState(initRgb.a);
  const [format, setFormat] = useState<ColorFormat>(() => inferFormat(value));

  // Channel inputs (text)
  const [hexText, setHexText] = useState(() => rgbToHex(...hsvToRgb(hsv[0], hsv[1], hsv[2])));
  const [rText, setRText] = useState(() => String(hsvToRgb(hsv[0], hsv[1], hsv[2])[0]));
  const [gText, setGText] = useState(() => String(hsvToRgb(hsv[0], hsv[1], hsv[2])[1]));
  const [bText, setBText] = useState(() => String(hsvToRgb(hsv[0], hsv[1], hsv[2])[2]));
  const [aText, setAText] = useState(() => String(initRgb.a));

  const [hue, sat, val] = hsv;
  const [r, g, b] = hsvToRgb(hue, sat, val);

  // Sync text fields when HSV/alpha changes
  const syncTexts = useCallback((h: number, s: number, v: number, a: number) => {
    const [cr, cg, cb] = hsvToRgb(h, s, v);
    setHexText(rgbToHex(cr, cg, cb));
    setRText(String(cr)); setGText(String(cg)); setBText(String(cb));
    setAText(parseFloat(a.toFixed(2)).toString());
  }, []);

  const emitColor = useCallback((h: number, s: number, v: number, a: number, fmt: ColorFormat) => {
    const [cr, cg, cb] = hsvToRgb(h, s, v);
    onSelect(formatToOutput(cr, cg, cb, a, fmt), '');
  }, [onSelect]);

  const handleSpectrumChange = (s: number, v: number) => {
    const next: [number, number, number] = [hue, s, v];
    setHsv(next);
    syncTexts(hue, s, v, alpha);
    emitColor(hue, s, v, alpha, format);
  };

  const handleHueChange = (h: number) => {
    const next: [number, number, number] = [h, sat, val];
    setHsv(next);
    syncTexts(h, sat, val, alpha);
    emitColor(h, sat, val, alpha, format);
  };

  const handleAlphaChange = (a: number) => {
    setAlpha(a);
    setAText(parseFloat(a.toFixed(2)).toString());
    emitColor(hue, sat, val, a, format);
  };

  const handleFormatChange = (fmt: ColorFormat) => {
    setFormat(fmt);
    emitColor(hue, sat, val, alpha, fmt);
  };

  const commitHex = (raw: string) => {
    const clean = raw.startsWith('#') ? raw : `#${raw}`;
    if (!isValidHex(clean)) return;
    const rgb = hexToRgb(clean);
    if (!rgb) return;
    const newHsv = rgbToHsv(...rgb);
    setHsv(newHsv as [number, number, number]);
    syncTexts(newHsv[0], newHsv[1], newHsv[2], alpha);
    emitColor(newHsv[0], newHsv[1], newHsv[2], alpha, format);
  };

  const commitRgb = (rr: number, gg: number, bb: number) => {
    const newHsv = rgbToHsv(rr, gg, bb);
    setHsv(newHsv as [number, number, number]);
    setHexText(rgbToHex(rr, gg, bb));
    emitColor(newHsv[0], newHsv[1], newHsv[2], alpha, format);
  };

  const commitAlphaText = (raw: string) => {
    const a = parseFloat(raw);
    if (!isNaN(a)) handleAlphaChange(Math.max(0, Math.min(1, a)));
  };

  const handleSwatchSelect = (color: string, cv: string) => {
    // Theme colors can be hex OR rgba — use the universal parser
    const parsed = parseColorToRgba(color);
    if (!parsed) return;
    const newHsv = rgbToHsv(parsed.r, parsed.g, parsed.b);
    setHsv(newHsv as [number, number, number]);
    setAlpha(parsed.a);
    syncTexts(newHsv[0], newHsv[1], newHsv[2], parsed.a);
    onSelect(color, cv);
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setTimeout(() => onClose(), 0);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Position popover
  const POPOVER_HEIGHT = 500;
  const POPOVER_WIDTH = 256;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const top = spaceBelow >= POPOVER_HEIGHT ? anchorRect.bottom + 6 : anchorRect.top - POPOVER_HEIGHT - 6;
  const left = Math.min(anchorRect.left, window.innerWidth - POPOVER_WIDTH - 8);

  // Find singleMatchCssVar for swatches (system + custom, custom take precedence on tie)
  const allSwatches = useMemo(
    () => [...GLOBAL_SWATCHES, ...(customSwatches ?? [])],
    [customSwatches],
  );
  const singleMatchCssVar = (() => {
    if (editingCssVar != null) return null;
    const hexVal = rgbToHex(r, g, b).toLowerCase();
    const match = allSwatches.find(s => {
      const resolved = themeOverrides[s.cssVar] ?? resolveCssVar(s.cssVar) ?? s.defaultHex;
      return hexVal === resolved.toLowerCase();
    });
    return match?.cssVar ?? null;
  })();

  const previewColor = `rgba(${r}, ${g}, ${b}, ${alpha})`;

  return ReactDOM.createPortal(
    <div
      ref={ref}
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', top, left, zIndex: 99999,
        width: POPOVER_WIDTH,
        background: '#111827',
        border: '1px solid #374151',
        borderRadius: 10,
        padding: 12,
        boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      {/* Spectrum */}
      <SpectrumBox hue={hue} sat={sat} val={val} onChange={handleSpectrumChange} />

      {/* Hue + Alpha sliders */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {/* Preview swatch */}
        <div style={{
          width: 28, height: 28, borderRadius: 5, flexShrink: 0,
          backgroundImage: CHECKER, backgroundSize: '8px 8px',
          border: '1px solid #374151',
        }}>
          <div style={{ width: '100%', height: '100%', borderRadius: 5, background: previewColor }} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <HueSlider hue={hue} onChange={handleHueChange} />
          {format === 'rgba' && (
            <AlphaSlider alpha={alpha} r={r} g={g} b={b} onChange={handleAlphaChange} />
          )}
        </div>
      </div>

      {/* Format toggle */}
      <div style={{ display: 'flex', gap: 2 }}>
        {(['hex', 'rgb', 'rgba'] as ColorFormat[]).map(f => (
          <button
            key={f}
            onClick={() => handleFormatChange(f)}
            style={{
              flex: 1, padding: '3px 0', fontSize: 10, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.04em',
              background: format === f ? '#374151' : 'transparent',
              border: `1px solid ${format === f ? '#6b7280' : '#1f2937'}`,
              borderRadius: 4, color: format === f ? '#f3f4f6' : '#4b5563',
              cursor: 'pointer',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Channel inputs */}
      <div>
        {format === 'hex' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#6b7280', width: 24, flexShrink: 0 }}>Hex</span>
            <input
              value={hexText}
              onChange={e => setHexText(e.target.value)}
              onBlur={() => commitHex(hexText)}
              onKeyDown={e => { if (e.key === 'Enter') commitHex(hexText); }}
              placeholder="#000000"
              style={{ flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '4px 8px', fontFamily: 'monospace' }}
            />
          </div>
        )}
        {(format === 'rgb' || format === 'rgba') && (
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { label: 'R', text: rText, setText: setRText, onCommit: (v: string) => { const n = parseInt(v); if (!isNaN(n)) { setRText(v); commitRgb(n, parseInt(gText), parseInt(bText)); } } },
              { label: 'G', text: gText, setText: setGText, onCommit: (v: string) => { const n = parseInt(v); if (!isNaN(n)) { setGText(v); commitRgb(parseInt(rText), n, parseInt(bText)); } } },
              { label: 'B', text: bText, setText: setBText, onCommit: (v: string) => { const n = parseInt(v); if (!isNaN(n)) { setBText(v); commitRgb(parseInt(rText), parseInt(gText), n); } } },
              ...(format === 'rgba' ? [{ label: 'A', text: aText, setText: setAText, onCommit: (v: string) => commitAlphaText(v) }] : []),
            ].map(({ label, text, setText, onCommit }) => (
              <div key={label} style={{ flex: 1, textAlign: 'center' }}>
                <input
                  value={text}
                  onChange={e => setText(e.target.value)}
                  onBlur={() => onCommit(text)}
                  onKeyDown={e => { if (e.key === 'Enter') onCommit(text); }}
                  style={{
                    width: '100%', background: '#1f2937', border: '1px solid #374151',
                    borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '4px 4px',
                    textAlign: 'center', boxSizing: 'border-box',
                  }}
                />
                <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1px solid #1f2937' }} />

      {/* Theme swatches */}
      <div>
        <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Theme Colors</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1 }}>
          {GLOBAL_SWATCHES.map(s => (
            <Swatch
              key={s.cssVar} {...s}
              currentValue={value}
              onSelect={handleSwatchSelect}
              overrides={themeOverrides}
              selectedCssVar={selectedCssVar}
              editingCssVar={editingCssVar}
              editingDefaultHex={editingDefaultHex}
              singleMatchCssVar={singleMatchCssVar}
            />
          ))}
        </div>
      </div>

      {/* Custom swatches — user-defined theme colors, behave identically to system swatches */}
      {customSwatches && customSwatches.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Custom Colors</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1 }}>
            {customSwatches.map(s => (
              <Swatch
                key={`custom:${s.cssVar}`} {...s}
                currentValue={value}
                onSelect={handleSwatchSelect}
                overrides={themeOverrides}
                selectedCssVar={selectedCssVar}
                editingCssVar={editingCssVar}
                editingDefaultHex={editingDefaultHex}
                singleMatchCssVar={singleMatchCssVar}
              />
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

// ─── FigmaColorPicker ─────────────────────────────────────────────────────────

export interface FigmaColorPickerProps {
  /** CSS color string: hex (#rrggbb), rgb(...), or rgba(...) */
  value: string;
  onChange: (color: string, cssVar?: string) => void;
  onCommit?: () => void;
  label?: string;
  testId?: string;
  editingCssVar?: string | null;
  editingDefaultHex?: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function FigmaColorPicker({
  value, onChange, onCommit, label, testId,
  editingCssVar, editingDefaultHex, open: controlledOpen, onOpenChange,
}: FigmaColorPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  // Track selected CSS var name — initialise from value in case it was stored as rgb(var(--X))
  const [selectedCssVar, setSelectedCssVar] = useState<string | null>(() => parseCssVarName(value));
  const triggerRef = useRef<HTMLDivElement>(null);
  const themeOverrides = useBuilderStore(s => s.themeOverrides);
  const customColors = useBuilderStore(s => s.customColors);
  const customSwatches = useMemo<ThemeSwatch[]>(
    () => customColors.map(c => ({
      label: c.label?.trim() || c.name,
      cssVar: c.name,
      defaultHex: c.light,
    })),
    [customColors],
  );
  const isInternalChangeRef = useRef(false);
  const onCommitRef = useRef(onCommit);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);

  const isControlled = controlledOpen !== undefined && onOpenChange !== undefined;
  const open = isControlled ? controlledOpen! : internalOpen;
  const setOpen = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(open) : v;
    if (isControlled) onOpenChange!(next);
    else setInternalOpen(next);
    if (!next) onCommitRef.current?.();
  }, [isControlled, onOpenChange, open]);

  useEffect(() => {
    if (isInternalChangeRef.current) { isInternalChangeRef.current = false; return; }
    // Re-derive selected var from external value changes (e.g. undo/redo)
    setSelectedCssVar(parseCssVarName(value));
  }, [value]);

  const handleSelect = useCallback((color: string, cv: string) => {
    isInternalChangeRef.current = true;
    setSelectedCssVar(cv || null);
    onChange(color, cv || undefined);
  }, [onChange]);

  const handleTriggerClick = () => {
    if (triggerRef.current) setAnchorRect(triggerRef.current.getBoundingClientRect());
    setOpen(o => !o);
  };

  // Resolve CSS var references so the swatch/spectrum shows the real color
  const resolvedValue = useMemo(() => resolveColorValue(value), [value]);
  const parsed = useMemo(() => parseColorToRgba(resolvedValue), [resolvedValue]);
  const displayHex = parsed ? rgbToHex(parsed.r, parsed.g, parsed.b) : '#000000';
  const displayAlpha = parsed?.a ?? 1;
  const hasAlpha = displayAlpha < 1;

  // What to show in the read-only input: just the var name if it's a theme token
  const displayText = selectedCssVar ?? value;

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {/* Trigger swatch */}
      <div
        ref={triggerRef}
        onClick={handleTriggerClick}
        data-testid={testId ? `${testId}-swatch` : undefined}
        title={`${label ?? 'Color'}: ${value}`}
        style={{
          width: 26, height: 26, borderRadius: 4, flexShrink: 0,
          border: open ? '2px solid #3b82f6' : '1.5px solid #4b5563',
          cursor: 'pointer', boxSizing: 'border-box',
          backgroundImage: hasAlpha ? CHECKER : 'none',
          backgroundSize: '8px 8px',
          position: 'relative', overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, borderRadius: 2, background: `rgba(${parsed?.r ?? 0}, ${parsed?.g ?? 0}, ${parsed?.b ?? 0}, ${displayAlpha})` }} />
      </div>

      {/* Value text — read-only, shows var name or raw color */}
      <div style={{ flex: 1 }} onClick={handleTriggerClick}>
        {label && <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>{label}</span>}
        <input
          data-testid={testId}
          value={displayText}
          readOnly
          placeholder="#000000 or rgba(...)"
          style={{
            background: '#1f2937', border: `1px solid ${open ? '#3b82f6' : '#374151'}`, borderRadius: 4,
            color: selectedCssVar ? '#a78bfa' : '#f3f4f6', fontSize: 11, padding: '3px 6px', width: '100%', boxSizing: 'border-box',
            cursor: 'pointer', caretColor: 'transparent',
          }}
        />
      </div>

      {/* Portal popover — pass resolvedValue so the spectrum initialises with the actual color */}
      {open && anchorRect && (
        <ColorPopover
          anchorRect={anchorRect}
          onClose={() => setOpen(false)}
          value={resolvedValue}
          onSelect={handleSelect}
          themeOverrides={themeOverrides}
          selectedCssVar={selectedCssVar}
          editingCssVar={editingCssVar}
          editingDefaultHex={editingDefaultHex}
          customSwatches={customSwatches}
        />
      )}
    </div>
  );
}
