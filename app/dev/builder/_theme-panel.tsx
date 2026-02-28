'use client';

/**
 * ThemePanel — left-panel "Theme" tab.
 *
 * Lets the user edit app theme colors, fonts and border radius live in the
 * builder canvas. Changes are applied as CSS variable overrides on
 * document.documentElement and stored in the builder Zustand store.
 */

import React, { useState, useEffect } from 'react';
import themeConfig from '@/config/theme.json';
import { useBuilderStore } from './_store';
import { FigmaColorPicker } from './_color-picker';

// ─── Shared styles ─────────────────────────────────────────────────────────────

const SECTION: React.CSSProperties = {
  borderBottom: '1px solid #1f2937',
  padding: '12px 12px',
};

const LABEL: React.CSSProperties = {
  fontSize: 9,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 8,
};

// ─── Font options ──────────────────────────────────────────────────────────────

interface FontOption {
  label: string;
  value: string;
  /** Google Fonts URL to inject (optional) */
  googleUrl?: string;
}

const FONT_OPTIONS: FontOption[] = [
  { label: 'System UI',      value: 'system-ui, sans-serif' },
  { label: 'Geist',          value: "'Geist', sans-serif" },
  { label: 'Inter',          value: "'Inter', sans-serif",           googleUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' },
  { label: 'DM Sans',        value: "'DM Sans', sans-serif",         googleUrl: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap' },
  { label: 'Space Grotesk',  value: "'Space Grotesk', sans-serif",   googleUrl: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap' },
  { label: 'Nunito',         value: "'Nunito', sans-serif",          googleUrl: 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap' },
  { label: 'Poppins',        value: "'Poppins', sans-serif",         googleUrl: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap' },
  { label: 'Playfair',       value: "'Playfair Display', serif",     googleUrl: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap' },
  { label: 'Lora',           value: "'Lora', serif",                 googleUrl: 'https://fonts.googleapis.com/css2?family=Lora:wght@400;600;700&display=swap' },
  { label: 'Merriweather',   value: "'Merriweather', serif",         googleUrl: 'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&display=swap' },
  { label: 'Roboto Mono',    value: "'Roboto Mono', monospace",      googleUrl: 'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500&display=swap' },
];

const RADIUS_OPTIONS = [
  { label: 'None',   value: '0' },
  { label: 'SM',     value: '0.25rem' },
  { label: 'MD',     value: '0.375rem' },
  { label: 'LG',     value: '0.5rem' },
  { label: 'XL',     value: '0.75rem' },
  { label: '2XL',    value: '1rem' },
  { label: 'Full',   value: '9999px' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function injectGoogleFont(url: string) {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`link[href="${url}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}

function resolveCssVar(cssVar: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(`--${cssVar}`).trim();
}

// ─── ColorRow component ────────────────────────────────────────────────────────

function ColorRow({
  label,
  cssVar,
  defaultHex,
  themeDefaultHex,
  mode,
  openColorPickerCssVar,
  onOpenColorPickerChange,
}: {
  label: string;
  cssVar: string;
  defaultHex: string;
  themeDefaultHex: string;
  mode: 'light' | 'dark';
  openColorPickerCssVar: string | null;
  onOpenColorPickerChange: (cssVar: string | null) => void;
}) {
  const patchTheme = useBuilderStore(s => s.patchTheme);
  const themeOverrides = useBuilderStore(s => s.themeOverrides);
  const themeDarkOverrides = useBuilderStore(s => s.themeDarkOverrides);

  const overrides = mode === 'dark' ? themeDarkOverrides : themeOverrides;
  const currentHex = overrides[cssVar] ?? defaultHex;
  const isOpen = openColorPickerCssVar === cssVar;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, alignItems: 'center', marginBottom: 6 }}>
      <span style={{ fontSize: 11, color: '#d1d5db' }}>{label}</span>
      <FigmaColorPicker
        value={currentHex}
        onChange={hex => patchTheme(cssVar, hex, mode)}
        editingCssVar={cssVar}
        editingDefaultHex={themeDefaultHex}
        open={isOpen}
        onOpenChange={open => onOpenColorPickerChange(open ? cssVar : null)}
      />
    </div>
  );
}

// ─── FontSelect ────────────────────────────────────────────────────────────────

function FontSelect({
  label,
  cssVar,
}: {
  label: string;
  cssVar: string;
}) {
  const patchTheme = useBuilderStore(s => s.patchTheme);
  const themeOverrides = useBuilderStore(s => s.themeOverrides);
  const current = themeOverrides[cssVar] ?? (resolveCssVar(cssVar) || FONT_OPTIONS[0].value);

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 9, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <select
        value={current}
        onChange={e => {
          const opt = FONT_OPTIONS.find(f => f.value === e.target.value);
          if (opt?.googleUrl) injectGoogleFont(opt.googleUrl);
          patchTheme(cssVar, e.target.value);
        }}
        style={{
          width: '100%',
          background: '#1f2937',
          border: '1px solid #374151',
          borderRadius: 4,
          color: '#f3f4f6',
          fontSize: 11,
          padding: '4px 6px',
        }}
      >
        {FONT_OPTIONS.map(f => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>
      <div
        style={{
          marginTop: 4,
          fontSize: 13,
          color: '#9ca3af',
          fontFamily: current,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        }}
      >
        The quick brown fox
      </div>
    </div>
  );
}

// ─── Theme presets ────────────────────────────────────────────────────────────

interface ThemePreset {
  id: string;
  name: string;
  /** Accent swatch shown on the preset chip */
  swatchColors: string[];
  fonts?: { heading?: string; body?: string };
  light: Record<string, string>;
  dark:  Record<string, string>;
}

const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'clean',
    name: 'Clean',
    swatchColors: ['#1e293b', '#f1f5f9', '#ffffff'],
    fonts: { heading: 'system-ui, sans-serif', body: 'system-ui, sans-serif' },
    light: {
      background: '#ffffff', foreground: '#171923',
      card: '#ffffff', 'card-foreground': '#171923',
      popover: '#ffffff', 'popover-foreground': '#171923',
      primary: '#1e293b', 'primary-foreground': '#f8fafc',
      secondary: '#f1f5f9', 'secondary-foreground': '#1e293b',
      muted: '#f1f5f9', 'muted-foreground': '#64748b',
      accent: '#f1f5f9', 'accent-foreground': '#1e293b',
      destructive: '#ef4444', 'destructive-foreground': '#ffffff',
      border: '#e2e8f0', input: '#e2e8f0', ring: '#94a3b8',
    },
    dark: {
      background: '#0f172a', foreground: '#f8fafc',
      card: '#1e293b', 'card-foreground': '#f8fafc',
      popover: '#1e293b', 'popover-foreground': '#f8fafc',
      primary: '#f8fafc', 'primary-foreground': '#1e293b',
      secondary: '#1e293b', 'secondary-foreground': '#f8fafc',
      muted: '#334155', 'muted-foreground': '#94a3b8',
      accent: '#334155', 'accent-foreground': '#f8fafc',
      destructive: '#ef4444', 'destructive-foreground': '#f8fafc',
      border: '#334155', input: '#334155', ring: '#94a3b8',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    swatchColors: ['#0284c7', '#e0f2fe', '#f0f9ff'],
    fonts: { heading: "'Inter', sans-serif", body: "'Inter', sans-serif" },
    light: {
      background: '#f0f9ff', foreground: '#0c2340',
      card: '#ffffff', 'card-foreground': '#0c2340',
      popover: '#ffffff', 'popover-foreground': '#0c2340',
      primary: '#0284c7', 'primary-foreground': '#ffffff',
      secondary: '#e0f2fe', 'secondary-foreground': '#0c2340',
      muted: '#e0f2fe', 'muted-foreground': '#0369a1',
      accent: '#bae6fd', 'accent-foreground': '#0c2340',
      destructive: '#ef4444', 'destructive-foreground': '#ffffff',
      border: '#bae6fd', input: '#bae6fd', ring: '#0284c7',
    },
    dark: {
      background: '#082032', foreground: '#e0f2fe',
      card: '#0c2d48', 'card-foreground': '#e0f2fe',
      popover: '#0c2d48', 'popover-foreground': '#e0f2fe',
      primary: '#38bdf8', 'primary-foreground': '#082032',
      secondary: '#0c3a5c', 'secondary-foreground': '#e0f2fe',
      muted: '#0c3a5c', 'muted-foreground': '#7dd3fc',
      accent: '#0c3a5c', 'accent-foreground': '#e0f2fe',
      destructive: '#ef4444', 'destructive-foreground': '#ffffff',
      border: '#1d4f72', input: '#1d4f72', ring: '#38bdf8',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    swatchColors: ['#16a34a', '#dcfce7', '#f0fdf4'],
    fonts: { heading: "'DM Sans', sans-serif", body: "'DM Sans', sans-serif" },
    light: {
      background: '#f0fdf4', foreground: '#052e16',
      card: '#ffffff', 'card-foreground': '#052e16',
      popover: '#ffffff', 'popover-foreground': '#052e16',
      primary: '#16a34a', 'primary-foreground': '#ffffff',
      secondary: '#dcfce7', 'secondary-foreground': '#052e16',
      muted: '#dcfce7', 'muted-foreground': '#15803d',
      accent: '#bbf7d0', 'accent-foreground': '#052e16',
      destructive: '#ef4444', 'destructive-foreground': '#ffffff',
      border: '#bbf7d0', input: '#bbf7d0', ring: '#16a34a',
    },
    dark: {
      background: '#052e16', foreground: '#dcfce7',
      card: '#14532d', 'card-foreground': '#dcfce7',
      popover: '#14532d', 'popover-foreground': '#dcfce7',
      primary: '#4ade80', 'primary-foreground': '#052e16',
      secondary: '#14532d', 'secondary-foreground': '#dcfce7',
      muted: '#166534', 'muted-foreground': '#86efac',
      accent: '#166534', 'accent-foreground': '#dcfce7',
      destructive: '#f87171', 'destructive-foreground': '#1a1a1a',
      border: '#166534', input: '#166534', ring: '#4ade80',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    swatchColors: ['#ea580c', '#fde68a', '#fffbeb'],
    fonts: { heading: "'Poppins', sans-serif", body: "'Poppins', sans-serif" },
    light: {
      background: '#fffbeb', foreground: '#431407',
      card: '#ffffff', 'card-foreground': '#431407',
      popover: '#ffffff', 'popover-foreground': '#431407',
      primary: '#ea580c', 'primary-foreground': '#ffffff',
      secondary: '#fff7ed', 'secondary-foreground': '#431407',
      muted: '#fed7aa', 'muted-foreground': '#9a3412',
      accent: '#fde68a', 'accent-foreground': '#431407',
      destructive: '#dc2626', 'destructive-foreground': '#ffffff',
      border: '#fed7aa', input: '#fed7aa', ring: '#ea580c',
    },
    dark: {
      background: '#1c0a00', foreground: '#fff7ed',
      card: '#2d1200', 'card-foreground': '#fff7ed',
      popover: '#2d1200', 'popover-foreground': '#fff7ed',
      primary: '#fb923c', 'primary-foreground': '#1c0a00',
      secondary: '#2d1200', 'secondary-foreground': '#fff7ed',
      muted: '#431407', 'muted-foreground': '#fdba74',
      accent: '#431407', 'accent-foreground': '#fff7ed',
      destructive: '#ef4444', 'destructive-foreground': '#fff7ed',
      border: '#431407', input: '#431407', ring: '#fb923c',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    swatchColors: ['#7c3aed', '#ddd6fe', '#faf5ff'],
    fonts: { heading: "'Space Grotesk', sans-serif", body: "'Space Grotesk', sans-serif" },
    light: {
      background: '#faf5ff', foreground: '#3b0764',
      card: '#ffffff', 'card-foreground': '#3b0764',
      popover: '#ffffff', 'popover-foreground': '#3b0764',
      primary: '#7c3aed', 'primary-foreground': '#ffffff',
      secondary: '#ede9fe', 'secondary-foreground': '#3b0764',
      muted: '#ede9fe', 'muted-foreground': '#6d28d9',
      accent: '#ddd6fe', 'accent-foreground': '#3b0764',
      destructive: '#ef4444', 'destructive-foreground': '#ffffff',
      border: '#ddd6fe', input: '#ddd6fe', ring: '#7c3aed',
    },
    dark: {
      background: '#0f0720', foreground: '#ede9fe',
      card: '#1a0a38', 'card-foreground': '#ede9fe',
      popover: '#1a0a38', 'popover-foreground': '#ede9fe',
      primary: '#a78bfa', 'primary-foreground': '#0f0720',
      secondary: '#1a0a38', 'secondary-foreground': '#ede9fe',
      muted: '#2d1b69', 'muted-foreground': '#c4b5fd',
      accent: '#2d1b69', 'accent-foreground': '#ede9fe',
      destructive: '#ef4444', 'destructive-foreground': '#ede9fe',
      border: '#2d1b69', input: '#2d1b69', ring: '#a78bfa',
    },
  },
];

// ─── Color palette definition ─────────────────────────────────────────────────

const LIGHT = themeConfig.cssVariables.root as Record<string, string>;
const DARK  = themeConfig.cssVariables.dark  as Record<string, string>;

/** All design-system color variables with display labels */
const COLOR_VARS: { label: string; cssVar: string }[] = [
  { label: 'Background',       cssVar: 'background'           },
  { label: 'Foreground',       cssVar: 'foreground'           },
  { label: 'Card',             cssVar: 'card'                 },
  { label: 'Card Text',        cssVar: 'card-foreground'      },
  { label: 'Popover',          cssVar: 'popover'              },
  { label: 'Popover Text',     cssVar: 'popover-foreground'   },
  { label: 'Primary',          cssVar: 'primary'              },
  { label: 'Primary Text',     cssVar: 'primary-foreground'   },
  { label: 'Secondary',        cssVar: 'secondary'            },
  { label: 'Secondary Text',   cssVar: 'secondary-foreground' },
  { label: 'Muted',            cssVar: 'muted'                },
  { label: 'Muted Text',       cssVar: 'muted-foreground'     },
  { label: 'Accent',           cssVar: 'accent'               },
  { label: 'Accent Text',      cssVar: 'accent-foreground'    },
  { label: 'Destructive',      cssVar: 'destructive'          },
  { label: 'Destructive Text', cssVar: 'destructive-foreground'},
  { label: 'Border',           cssVar: 'border'               },
  { label: 'Input',            cssVar: 'input'                },
  { label: 'Ring',             cssVar: 'ring'                 },
];

// ─── ThemePanel ────────────────────────────────────────────────────────────────

export function ThemePanel() {
  const resetTheme        = useBuilderStore(s => s.resetTheme);
  const patchTheme        = useBuilderStore(s => s.patchTheme);
  const applyThemePreset  = useBuilderStore(s => s.applyThemePreset);
  const themeOverrides     = useBuilderStore(s => s.themeOverrides);
  const themeDarkOverrides = useBuilderStore(s => s.themeDarkOverrides);

  /** 'light' | 'dark' tab inside the Theme panel */
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light');
  const [openSection, setOpenSection] = useState<string | null>('presets');
  const [activePreset, setActivePreset] = useState<string | null>(null);
  /** Only one theme color picker open at a time — prevents wrong variable being patched when multiple popovers overlap */
  const [openColorPickerCssVar, setOpenColorPickerCssVar] = useState<string | null>(null);

  const toggle = (key: string) => setOpenSection(v => (v === key ? null : key));

  // Close color picker when collapsing Colors section
  useEffect(() => {
    if (openSection !== 'colors') setOpenColorPickerCssVar(null);
  }, [openSection]);

  const currentRadius = themeOverrides['radius'] ?? LIGHT['--radius'] ?? '0.625rem';

  const handleReset = () => {
    resetTheme();
    setActivePreset(null);
  };

  const handleApplyPreset = (preset: ThemePreset) => {
    setActivePreset(preset.id);
    // Inject Google Fonts if needed
    const fontUrl = preset.fonts?.heading?.includes('Inter')         ? 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
                  : preset.fonts?.heading?.includes('DM Sans')       ? 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap'
                  : preset.fonts?.heading?.includes('Poppins')       ? 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap'
                  : preset.fonts?.heading?.includes('Space Grotesk') ? 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap'
                  : null;
    if (fontUrl && typeof document !== 'undefined' && !document.querySelector(`link[href="${fontUrl}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = fontUrl;
      document.head.appendChild(link);
    }
    applyThemePreset(preset.light, preset.dark, preset.fonts);
  };

  return (
    <div style={{ overflowY: 'auto', flex: 1, fontSize: 12, color: '#f3f4f6' }}>

      {/* ── Header ── */}
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#d1d5db' }}>Theme</span>
        <button
          onClick={handleReset}
          title="Reset all theme overrides"
          style={{ fontSize: 10, color: '#6b7280', background: 'none', border: '1px solid #374151', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
        >
          Reset
        </button>
      </div>

      {/* ── Presets ── */}
      <div style={SECTION}>
        <button
          onClick={() => toggle('presets')}
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0, marginBottom: openSection === 'presets' ? 10 : 0 }}
        >
          <span style={LABEL}>Presets</span>
          <span style={{ fontSize: 10, color: '#6b7280' }}>{openSection === 'presets' ? '▲' : '▼'}</span>
        </button>
        {openSection === 'presets' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: 6 }}>
            {THEME_PRESETS.map(preset => (
              <button
                key={preset.id}
                onClick={() => handleApplyPreset(preset)}
                title={preset.name}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 5,
                  padding: '8px 4px',
                  background: activePreset === preset.id ? '#1d4ed8' : '#1f2937',
                  border: `1px solid ${activePreset === preset.id ? '#3b82f6' : '#374151'}`,
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'all 0.1s',
                }}
              >
                {/* Color swatch strip */}
                <div style={{ display: 'flex', gap: 2 }}>
                  {preset.swatchColors.map((c, i) => (
                    <div
                      key={i}
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        background: c,
                        border: '1px solid rgba(255,255,255,0.15)',
                        flexShrink: 0,
                      }}
                    />
                  ))}
                </div>
                <span style={{ fontSize: 9, color: activePreset === preset.id ? '#fff' : '#9ca3af', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                  {preset.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Colors section ── */}
      <div style={SECTION}>
        <button
          onClick={() => toggle('colors')}
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0, marginBottom: openSection === 'colors' ? 10 : 0 }}
        >
          <span style={LABEL}>Colors</span>
          <span style={{ fontSize: 10, color: '#6b7280' }}>{openSection === 'colors' ? '▲' : '▼'}</span>
        </button>

        {openSection === 'colors' && (
          <div>
            {/* Light / Dark sub-tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
              {(['light', 'dark'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setColorMode(m)}
                  style={{
                    flex: 1,
                    padding: '4px 0',
                    background: colorMode === m ? '#1d4ed8' : '#1f2937',
                    border: `1px solid ${colorMode === m ? '#3b82f6' : '#374151'}`,
                    borderRadius: 4,
                    color: colorMode === m ? '#fff' : '#9ca3af',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    letterSpacing: '0.03em',
                  }}
                >
                  {m === 'light' ? '☀ Light' : '🌙 Dark'}
                </button>
              ))}
            </div>

            {/* Color rows for current mode */}
            {COLOR_VARS.map(({ label, cssVar }) => {
              const rawDefault = colorMode === 'light'
                ? LIGHT[`--${cssVar}`]
                : DARK[`--${cssVar}`];
              // Light defaults are stored as "#hex"; DARK too in theme.json
              const themeDefaultHex = rawDefault ?? '#ffffff';
              const overrides = colorMode === 'light' ? themeOverrides : themeDarkOverrides;
              return (
                <ColorRow
                  key={`${colorMode}-${cssVar}`}
                  label={label}
                  cssVar={cssVar}
                  defaultHex={overrides[cssVar] ?? themeDefaultHex}
                  themeDefaultHex={themeDefaultHex}
                  mode={colorMode}
                  openColorPickerCssVar={openColorPickerCssVar}
                  onOpenColorPickerChange={setOpenColorPickerCssVar}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* ── Typography ── */}
      <div style={SECTION}>
        <button
          onClick={() => toggle('typography')}
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0, marginBottom: openSection === 'typography' ? 8 : 0 }}
        >
          <span style={LABEL}>Typography</span>
          <span style={{ fontSize: 10, color: '#6b7280' }}>{openSection === 'typography' ? '▲' : '▼'}</span>
        </button>
        {openSection === 'typography' && (
          <div>
            <FontSelect label="Heading Font" cssVar="font-heading" />
            <FontSelect label="Body Font"    cssVar="font-body" />
          </div>
        )}
      </div>

      {/* ── Border Radius ── */}
      <div style={SECTION}>
        <button
          onClick={() => toggle('radius')}
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0, marginBottom: openSection === 'radius' ? 8 : 0 }}
        >
          <span style={LABEL}>Border Radius</span>
          <span style={{ fontSize: 10, color: '#6b7280' }}>{openSection === 'radius' ? '▲' : '▼'}</span>
        </button>
        {openSection === 'radius' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
              {RADIUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => patchTheme('radius', opt.value, 'light')}
                  style={{
                    background: currentRadius === opt.value ? '#1d4ed8' : '#1f2937',
                    border: `1px solid ${currentRadius === opt.value ? '#3b82f6' : '#374151'}`,
                    borderRadius: 4,
                    color: currentRadius === opt.value ? '#fff' : '#9ca3af',
                    fontSize: 10,
                    padding: '4px 4px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  <div style={{ width: 20, height: 20, background: '#374151', borderRadius: opt.value === '9999px' ? '9999px' : opt.value }} />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 10, color: '#6b7280' }}>
              Current: <span style={{ color: '#9ca3af', fontFamily: 'monospace' }}>{currentRadius}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom padding ── */}
      <div style={{ height: 24 }} />
    </div>
  );
}
