'use client';

/**
 * ThemePanel — left-panel "Theme" tab.
 *
 * Lets the user edit app theme colors, fonts and border radius live in the
 * builder canvas. Changes are applied as CSS variable overrides on
 * document.documentElement and stored in the builder Zustand store.
 */

import React, { useState, useEffect, useMemo } from 'react';
import themeConfig from '@/config/theme.json';
import { useBuilderStore, type CustomColor } from './_store';
import { FigmaColorPicker } from './_color-picker';
import { THEME_PRESETS, type ThemePreset } from '@/lib/builder/theme-presets';

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
  { label: 'System UI',          value: 'system-ui, sans-serif' },
  { label: 'Geist',              value: "'Geist', sans-serif" },
  { label: 'Inter',              value: "'Inter', sans-serif",              googleUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' },
  { label: 'DM Sans',            value: "'DM Sans', sans-serif",            googleUrl: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap' },
  { label: 'Space Grotesk',      value: "'Space Grotesk', sans-serif",      googleUrl: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap' },
  { label: 'Nunito',             value: "'Nunito', sans-serif",             googleUrl: 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap' },
  { label: 'Poppins',            value: "'Poppins', sans-serif",            googleUrl: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap' },
  { label: 'Montserrat',         value: "'Montserrat', sans-serif",         googleUrl: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap' },
  { label: 'Raleway',            value: "'Raleway', sans-serif",            googleUrl: 'https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700&display=swap' },
  { label: 'Josefin Sans',       value: "'Josefin Sans', sans-serif",       googleUrl: 'https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@400;500;600;700&display=swap' },
  { label: 'Jost',               value: "'Jost', sans-serif",               googleUrl: 'https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700&display=swap' },
  { label: 'Open Sans',          value: "'Open Sans', sans-serif",          googleUrl: 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap' },
  { label: 'Roboto',             value: "'Roboto', sans-serif",             googleUrl: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap' },
  { label: 'Comfortaa',          value: "'Comfortaa', cursive",             googleUrl: 'https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;600;700&display=swap' },
  { label: 'Playfair Display',   value: "'Playfair Display', serif",        googleUrl: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap' },
  { label: 'Lora',               value: "'Lora', serif",                    googleUrl: 'https://fonts.googleapis.com/css2?family=Lora:wght@400;600;700&display=swap' },
  { label: 'Merriweather',       value: "'Merriweather', serif",            googleUrl: 'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&display=swap' },
  { label: 'Fraunces',           value: "'Fraunces', serif",                googleUrl: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&display=swap' },
  { label: 'Cormorant Garamond', value: "'Cormorant Garamond', serif",      googleUrl: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&display=swap' },
  { label: 'Crimson Text',       value: "'Crimson Text', serif",            googleUrl: 'https://fonts.googleapis.com/css2?family=Crimson+Text:wght@400;600;700&display=swap' },
  { label: 'Source Sans 3',      value: "'Source Sans 3', sans-serif",      googleUrl: 'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap' },
  { label: 'Roboto Mono',        value: "'Roboto Mono', monospace",         googleUrl: 'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500&display=swap' },
];

/** Exported so _store.ts can inject fonts when loading saved theme overrides */
export const FONT_GOOGLE_URL_MAP: Record<string, string> = Object.fromEntries(
  FONT_OPTIONS.filter(f => f.googleUrl).map(f => [f.value, f.googleUrl!])
);

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

// ─── ColorGroupHeader component ───────────────────────────────────────────────

function ColorGroupHeader({
  groupKey,
  label,
  count,
  expanded,
  onToggle,
}: {
  groupKey: string;
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      data-testid={`color-group-${groupKey}`}
      onClick={onToggle}
      style={{
        width: '100%', background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 0', marginBottom: expanded ? 6 : 0,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#9ca3af', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        <span style={{ fontSize: 9, color: '#6b7280' }}>{expanded ? '▾' : '▸'}</span>
        {label}
        <span style={{ color: '#4b5563', fontWeight: 400 }}>{count}</span>
      </span>
    </button>
  );
}

// ─── CustomColorRow component ─────────────────────────────────────────────────

function CustomColorRow({
  color,
  mode,
  openColorPickerCssVar,
  onOpenColorPickerChange,
  onEdit,
  onDelete,
}: {
  color: CustomColor;
  mode: 'light' | 'dark';
  openColorPickerCssVar: string | null;
  onOpenColorPickerChange: (cssVar: string | null) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const updateCustomColor = useBuilderStore(s => s.updateCustomColor);
  const [hovering, setHovering] = useState(false);
  const currentHex = mode === 'dark' ? color.dark : color.light;
  const pickerKey = `__custom__:${color.id}`;
  const isOpen = openColorPickerCssVar === pickerKey;
  const display = color.label?.trim() || color.name;

  return (
    <div
      data-testid={`custom-color-row-${color.name}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, alignItems: 'center', marginBottom: 6 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        <span
          title={`${display}  •  --${color.name}`}
          style={{ fontSize: 11, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
        >
          {display}
        </span>
        {hovering && (
          <>
            <button
              onClick={onEdit}
              title="Edit color"
              data-testid={`custom-color-edit-${color.name}`}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: '0 2px', fontSize: 12, lineHeight: 1 }}
              onMouseEnter={e => (e.currentTarget.style.color = '#a78bfa')}
              onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
            >
              ✎
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete custom color "${display}"?`)) onDelete();
              }}
              title="Delete color"
              data-testid={`custom-color-delete-${color.name}`}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: '0 2px', fontSize: 12, lineHeight: 1 }}
              onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
              onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
            >
              ×
            </button>
          </>
        )}
      </div>
      <FigmaColorPicker
        value={currentHex}
        onChange={hex => {
          if (mode === 'dark') updateCustomColor(color.id, { dark: hex });
          else                 updateCustomColor(color.id, { light: hex });
        }}
        editingCssVar={color.name}
        editingDefaultHex={currentHex}
        open={isOpen}
        onOpenChange={open => onOpenColorPickerChange(open ? pickerKey : null)}
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
        data-testid={`select-${cssVar}`}
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

export interface ThemePanelProps {
  /** Open the right-side slide panel for adding or editing a custom theme color. */
  onOpenColorSlide?: (state: { kind: 'addColor' } | { kind: 'editColor'; id: string }) => void;
}

export function ThemePanel({ onOpenColorSlide }: ThemePanelProps = {}) {
  const resetTheme        = useBuilderStore(s => s.resetTheme);
  const patchTheme        = useBuilderStore(s => s.patchTheme);
  const applyThemePreset  = useBuilderStore(s => s.applyThemePreset);
  const themeOverrides     = useBuilderStore(s => s.themeOverrides);
  const themeDarkOverrides = useBuilderStore(s => s.themeDarkOverrides);
  const customColors       = useBuilderStore(s => s.customColors);
  const colorFolders       = useBuilderStore(s => s.colorFolders);
  const removeCustomColor  = useBuilderStore(s => s.removeCustomColor);

  /** 'light' | 'dark' tab inside the Theme panel */
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light');
  const [openSection, setOpenSection] = useState<string | null>('presets');
  const [activePreset, setActivePreset] = useState<string | null>(null);
  /** Only one theme color picker open at a time — prevents wrong variable being patched when multiple popovers overlap */
  const [openColorPickerCssVar, setOpenColorPickerCssVar] = useState<string | null>(null);

  /** Per-group expanded state for the Colors section (System, custom folders, Ungrouped). */
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ system: true });

  const toggle = (key: string) => setOpenSection(v => (v === key ? null : key));
  const toggleGroup = (key: string) => setExpandedGroups(g => ({ ...g, [key]: !g[key] }));

  // Group customColors by folderId for rendering
  const customColorsByFolder = useMemo(() => {
    const grouped = new Map<string | undefined, CustomColor[]>();
    for (const c of customColors) {
      const key = c.folderId;
      const arr = grouped.get(key) ?? [];
      arr.push(c);
      grouped.set(key, arr);
    }
    return grouped;
  }, [customColors]);

  const ungroupedCustom = customColorsByFolder.get(undefined) ?? [];

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: openSection === 'colors' ? 10 : 0 }}>
          <button
            onClick={() => toggle('colors')}
            style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0 }}
          >
            <span style={LABEL}>Colors</span>
            <span style={{ fontSize: 10, color: '#6b7280' }}>{openSection === 'colors' ? '▲' : '▼'}</span>
          </button>
          {openSection === 'colors' && onOpenColorSlide && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenColorSlide({ kind: 'addColor' }); }}
              title="Add custom color"
              data-testid="add-custom-color"
              style={{
                marginLeft: 8, width: 22, height: 22, borderRadius: 4,
                background: '#1f2937', border: '1px solid #374151', color: '#a78bfa',
                cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#374151'; e.currentTarget.style.color = '#c4b5fd'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#1f2937'; e.currentTarget.style.color = '#a78bfa'; }}
            >
              +
            </button>
          )}
        </div>

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

            {/* ── System folder (built-in, non-editable) ── */}
            <ColorGroupHeader
              groupKey="system"
              label="System"
              count={COLOR_VARS.length}
              expanded={expandedGroups.system !== false}
              onToggle={() => toggleGroup('system')}
            />
            {expandedGroups.system !== false && (
              <div style={{ marginBottom: 10 }}>
                {COLOR_VARS.map(({ label, cssVar }) => {
                  const rawDefault = colorMode === 'light'
                    ? LIGHT[`--${cssVar}`]
                    : DARK[`--${cssVar}`];
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

            {/* ── User folders ── */}
            {colorFolders.map(folder => {
              const folderColors = customColorsByFolder.get(folder.id) ?? [];
              const groupKey = `folder:${folder.id}`;
              const isExpanded = expandedGroups[groupKey] !== false;
              return (
                <React.Fragment key={folder.id}>
                  <ColorGroupHeader
                    groupKey={groupKey}
                    label={folder.name}
                    count={folderColors.length}
                    expanded={isExpanded}
                    onToggle={() => toggleGroup(groupKey)}
                  />
                  {isExpanded && (
                    <div style={{ marginBottom: 10 }}>
                      {folderColors.length === 0 && (
                        <div style={{ fontSize: 10, color: '#4b5563', fontStyle: 'italic', padding: '4px 0' }}>
                          No colors in this folder.
                        </div>
                      )}
                      {folderColors.map(c => (
                        <CustomColorRow
                          key={c.id}
                          color={c}
                          mode={colorMode}
                          openColorPickerCssVar={openColorPickerCssVar}
                          onOpenColorPickerChange={setOpenColorPickerCssVar}
                          onEdit={() => onOpenColorSlide?.({ kind: 'editColor', id: c.id })}
                          onDelete={() => removeCustomColor(c.id)}
                        />
                      ))}
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* ── Ungrouped custom colors ── */}
            {ungroupedCustom.length > 0 && (() => {
              const groupKey = 'ungrouped';
              const isExpanded = expandedGroups[groupKey] !== false;
              return (
                <>
                  <ColorGroupHeader
                    groupKey={groupKey}
                    label="Ungrouped"
                    count={ungroupedCustom.length}
                    expanded={isExpanded}
                    onToggle={() => toggleGroup(groupKey)}
                  />
                  {isExpanded && (
                    <div style={{ marginBottom: 10 }}>
                      {ungroupedCustom.map(c => (
                        <CustomColorRow
                          key={c.id}
                          color={c}
                          mode={colorMode}
                          openColorPickerCssVar={openColorPickerCssVar}
                          onOpenColorPickerChange={setOpenColorPickerCssVar}
                          onEdit={() => onOpenColorSlide?.({ kind: 'editColor', id: c.id })}
                          onDelete={() => removeCustomColor(c.id)}
                        />
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── Typography ── */}
      <div style={SECTION}>
        <button
          data-testid="typography-section-toggle"
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
