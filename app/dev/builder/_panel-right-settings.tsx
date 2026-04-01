'use client';

/**
 * _panel-right-settings.tsx
 *
 * SettingsTab and AlignDistributePanel components for the builder right panel.
 * Extracted from _panel-right.tsx.
 *
 * Exports: SettingsTab, AlignDistributePanel
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useBuilderStore, findParentNode } from './_store';
import type { SDUINode } from '@/lib/sdui/types/node';
import { SECTION_STYLE, LABEL_STYLE, SectionHeader, ToggleBtn } from './_panel-primitives';
import { FieldWithBinding, BindingIcon, isBoundValue, type FormulaValue, closeAllEditors, registerEditorClose } from './_formula-panel';
import { FormulaEditor } from './_formula-editor';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';
import { FigmaColorPicker } from './_color-picker';

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
function SettingsTextInput({ value, onChange, placeholder, expandable = false, testId }: { value: string; onChange: (v: string) => void; placeholder?: string; expandable?: boolean; testId?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'flex-end' }}>
      <input
        data-testid={testId}
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

type ValidationRuleType = 'required' | 'email' | 'minLength' | 'maxLength' | 'phone' | 'url' | 'pattern' | 'equalsField' | 'formula';
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
  { value: 'required',    label: 'Required' },
  { value: 'email',       label: 'Email' },
  { value: 'minLength',   label: 'Min length',    hasValue: true, valuePlaceholder: '2' },
  { value: 'maxLength',   label: 'Max length',    hasValue: true, valuePlaceholder: '100' },
  { value: 'phone',       label: 'Phone' },
  { value: 'url',         label: 'URL' },
  { value: 'pattern',     label: 'Pattern (regex)', hasValue: true, valuePlaceholder: '^[a-z]+$' },
  { value: 'equalsField', label: 'Equals field',  hasValue: true, valuePlaceholder: 'fieldName' },
  { value: 'formula',     label: 'Custom formula' },
];
const RULE_DEFAULTS: Record<ValidationRuleType, Partial<ValidationRule>> = {
  required:    { message: 'This field is required' },
  email:       { message: 'Please enter a valid email address' },
  minLength:   { message: 'Must be at least N characters', value: '2' },
  maxLength:   { message: 'Must be at most N characters', value: '100' },
  phone:       { message: 'Please enter a valid phone number' },
  url:         { message: 'Please enter a valid URL' },
  pattern:     { message: 'Invalid format', value: '' },
  equalsField: { message: 'Fields do not match', value: '' },
  formula:     { message: 'Invalid value' },
};

const ICONIFY_API_BASE = 'https://api.iconify.design';

// ── SpecificRow: SettingsRow label + FieldWithBinding bind button ────────────

/** A settings row that includes a formula-binding button beside every field. */
function SpecificRow({
  label,
  fieldKey,
  value,
  onChange,
  hint,
  expectedType = 'string' as const,
  children,
}: {
  label: string;
  fieldKey: string;
  value: FormulaValue;
  onChange: (v: FormulaValue) => void;
  hint?: string;
  expectedType?: 'string' | 'number' | 'boolean' | 'any';
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '3px 12px', gap: 8 }}>
      <span style={{ fontSize: 11, color: '#d1d5db', flexShrink: 0, minWidth: 80 }}>{label}</span>
      <FieldWithBinding label={fieldKey} value={value} onChange={onChange} hint={hint} expectedType={expectedType}>
        {children}
      </FieldWithBinding>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve a CSS color value to hex for display in the FigmaColorPicker.
 *  Handles hex strings, `var(--name)`, and `var(--name, fallback)` syntax.
 *  Theme vars may be "R G B" triplets or plain hex strings on :root. */
function resolveCssVarToHex(color: string): string {
  if (!color || color === 'currentColor') return '#6b7280';
  if (color.startsWith('#')) return color;
  if (typeof document === 'undefined') return '#6b7280';
  // Match both var(--name) and var(--name, fallback)
  const match = color.match(/var\(--([\w-]+)/);
  if (match) {
    const val = getComputedStyle(document.documentElement).getPropertyValue(`--${match[1]}`).trim();
    if (val) {
      if (val.startsWith('#')) return val;
      // "R G B" triplet → hex
      const parts = val.split(/\s+/).map(Number);
      if (parts.length === 3 && parts.every(n => !isNaN(n))) {
        return `#${parts.map(n => n.toString(16).padStart(2, '0')).join('')}`;
      }
      return val;
    }
    // CSS var not defined — extract fallback from var(--name, fallback)
    const fbMatch = color.match(/var\(--[\w-]+,\s*(.+)\)$/);
    if (fbMatch) return resolveCssVarToHex(fbMatch[1].trim());
  }
  return '#6b7280';
}

// ── Icon Settings ───────────────────────────────────────────────────────

function IconifySettings({ nodeId, nodeProps }: { nodeId: string; nodeProps: Record<string, unknown> }) {
  const store = useBuilderStore();
  const isBoundIcon = isBoundValue(nodeProps.icon as FormulaValue);
  const iconValue = (!isBoundIcon && typeof nodeProps.icon === 'string') ? nodeProps.icon : '';
  // 'currentColor' means inherit surrounding CSS color
  // Guard against formula objects — if color is bound, fall back to 'currentColor'
  const isBoundColor = isBoundValue(nodeProps.color as FormulaValue);
  const rawColor = (!isBoundColor && typeof nodeProps.color === 'string') ? nodeProps.color : 'currentColor';
  // Resolve to hex for FigmaColorPicker display (it only accepts hex)
  const resolvedHex = (rawColor === 'currentColor' || !rawColor) ? '#6b7280' : resolveCssVarToHex(rawColor);
  // For the Iconify preview thumbnail
  const previewColor = resolvedHex;

  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [searching,     setSearching]     = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Patch a single prop key with any value (string, FormulaValue, etc.) */
  const patchProp = (key: string, value: unknown) =>
    store.patchNodeField(nodeId, 'props', { ...nodeProps, [key]: value });

  /** Patch multiple prop keys atomically */
  const patchProps = (patch: Record<string, unknown>) =>
    store.patchNodeField(nodeId, 'props', { ...nodeProps, ...patch });

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`${ICONIFY_API_BASE}/search?query=${encodeURIComponent(q)}&limit=30`);
      if (res.ok) {
        const data = await res.json() as { icons?: string[] };
        setSearchResults(data.icons ?? []);
      }
    } catch { /* ignore */ } finally { setSearching(false); }
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { void doSearch(searchQuery); }, 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery, doSearch]);

  const svgPreviewUrl = (!isBoundIcon && iconValue.includes(':'))
    ? `${ICONIFY_API_BASE}/${iconValue.split(':')[0]}/${iconValue.split(':')[1]}.svg?color=${encodeURIComponent(previewColor)}`
    : null;

  return (
    <div style={{ borderBottom: '1px solid #1f2937', padding: '8px 0 4px' }}>
      <div style={{ padding: '0 12px 6px', fontSize: 10, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em', fontWeight: 600 }}>Icon</div>

      {/* Preview + icon identifier (with binding support) */}
      <div style={{ padding: '0 12px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 4, background: '#1f2937', border: '1px solid #374151', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4 }}>
          {svgPreviewUrl
            ? <img src={svgPreviewUrl} alt="icon" style={{ width: 20, height: 20 }} />
            : <span style={{ fontSize: 14, color: '#4b5563' }}>◈</span>}
        </div>
        <FieldWithBinding
          label="icon"
          value={(nodeProps.icon as FormulaValue) ?? ''}
          onChange={v => patchProp('icon', v)}
          hint="Iconify icon identifier e.g. heroicons:star, lucide:heart"
          expectedType="string"
        >
          <input
            data-testid="specific-icon-name"
            value={iconValue}
            onChange={e => patchProp('icon', e.target.value)}
            placeholder="heroicons:star"
            style={{ flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '4px 7px', outline: 'none', width: '100%' }}
          />
        </FieldWithBinding>
      </div>

      {/* Icon color — controls SVG stroke/fill; uses full theme color picker */}
      <SpecificRow
        label="Color"
        fieldKey="color"
        value={(nodeProps.color as FormulaValue) ?? 'currentColor'}
        onChange={v => patchProp('color', v)}
        hint="CSS color or CSS variable e.g. var(--primary), #3b82f6"
        expectedType="string"
      >
        <FigmaColorPicker
          testId="specific-icon-color"
          value={resolvedHex}
          onChange={(hex, cssVar) => {
            // Store the CSS var reference when a theme swatch is picked so the icon
            // reacts to theme changes automatically; otherwise store the raw hex.
            patchProp('color', cssVar ? `var(--${cssVar})` : hex);
          }}
          onCommit={() => store._pushHistory?.()}
        />
      </SpecificRow>

      {/* Icon search picker */}
      <div style={{ padding: '0 12px 6px' }}>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search icons…"
          style={{ width: '100%', boxSizing: 'border-box' as const, background: '#111827', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 11, padding: '4px 7px', outline: 'none' }}
        />
      </div>

      {(searchResults.length > 0 || searching) && (
        <div style={{ padding: '0 12px 8px' }}>
          {searching ? (
            <div style={{ fontSize: 10, color: '#4b5563', textAlign: 'center' as const, padding: '4px 0' }}>Searching…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 3 }}>
              {searchResults.map(name => {
                const parts = name.split(':');
                const url = `${ICONIFY_API_BASE}/${parts[0]}/${parts[1]}.svg?color=%23d1d5db`;
                return (
                  <button
                    key={name}
                    title={name}
                    onClick={() => {
                      // When picking an icon, also initialize color to primary
                      // if it was never set (currentColor = no explicit color chosen yet).
                      const needsColor = !nodeProps.color || nodeProps.color === 'currentColor';
                      patchProps({ icon: name, ...(needsColor ? { color: 'var(--primary)' } : {}) });
                    }}
                    style={{
                      background: name === iconValue ? '#1d4ed8' : '#1f2937',
                      border: `1px solid ${name === iconValue ? '#3b82f6' : '#374151'}`,
                      borderRadius: 4, padding: 4, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <img src={url} alt={parts[1]} style={{ width: 16, height: 16 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Image Settings ─────────────────────────────────────────────────────────────

function ImageSettings({ nodeId, nodeProps, nodeSrc }: { nodeId: string; nodeProps: Record<string, unknown>; nodeSrc: string }) {
  const store = useBuilderStore();
  const altValue  = (nodeProps.alt       as string | undefined) ?? '';
  // objectFit is a top-level prop on NextImage (read via rest.objectFit inside the img tag)
  const objectFit = (nodeProps.objectFit as string | undefined) ?? '';

  /** Patch one prop key; also accepts FormulaValue objects for formula bindings */
  const patchProp = (key: string, value: unknown) =>
    store.patchNodeField(nodeId, 'props', { ...nodeProps, [key]: value });
  const patchSrc  = (value: string) =>
    store.patchNodeField(nodeId, 'src', value);

  const SELECT_STYLE: React.CSSProperties = {
    background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
    color: '#f3f4f6', fontSize: 11, padding: '3px 6px', outline: 'none', width: '100%',
  };

  return (
    <div style={{ borderBottom: '1px solid #1f2937', padding: '8px 0 4px' }}>
      <div style={{ padding: '0 12px 6px', fontSize: 10, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em', fontWeight: 600 }}>Image</div>

      {/* Source URL — with binding support */}
      <SpecificRow
        label="Source URL"
        fieldKey="src"
        value={nodeSrc as FormulaValue}
        onChange={v => patchSrc(typeof v === 'string' ? v : '')}
        hint="Image URL e.g. https://example.com/photo.jpg"
        expectedType="string"
      >
        <SettingsTextInput value={nodeSrc} onChange={patchSrc} placeholder="https://..." testId="specific-image-src" />
      </SpecificRow>

      {/* Preview thumbnail */}
      {nodeSrc && typeof nodeSrc === 'string' && (
        <div style={{ padding: '0 12px 8px' }}>
          <img
            src={nodeSrc} alt="preview"
            style={{ width: '100%', maxHeight: 80, objectFit: 'cover', borderRadius: 4, border: '1px solid #1f2937' }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}

      {/* Alt text — with binding support */}
      <SpecificRow
        label="Alt text"
        fieldKey="alt"
        value={(nodeProps.alt as FormulaValue) ?? ''}
        onChange={v => patchProp('alt', v)}
        hint="Accessible description of the image"
        expectedType="string"
      >
        <SettingsTextInput value={altValue} onChange={v => patchProp('alt', v)} placeholder="Description…" />
      </SpecificRow>

      {/* Object fit — with binding support */}
      <SpecificRow
        label="Object fit"
        fieldKey="objectFit"
        value={(nodeProps.objectFit as FormulaValue) ?? ''}
        onChange={v => patchProp('objectFit', v)}
        hint="CSS object-fit: cover | contain | fill | none | scale-down"
        expectedType="string"
      >
        <select
          value={objectFit}
          onChange={e => patchProp('objectFit', e.target.value || undefined)}
          style={SELECT_STYLE}
        >
          <option value="">Default (cover)</option>
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
          <option value="fill">Fill</option>
          <option value="none">None</option>
          <option value="scale-down">Scale down</option>
        </select>
      </SpecificRow>
    </div>
  );
}

// ── Video Settings ─────────────────────────────────────────────────────────────

function VideoSettings({ nodeId, nodeProps, nodeSrc }: { nodeId: string; nodeProps: Record<string, unknown>; nodeSrc: string }) {
  const store = useBuilderStore();
  const posterVal = (nodeProps.poster   as string  | undefined) ?? '';
  const autoPlay  = (nodeProps.autoPlay as boolean | undefined) ?? false;
  const loop      = (nodeProps.loop     as boolean | undefined) ?? false;
  const muted     = (nodeProps.muted    as boolean | undefined) ?? true;
  const controls  = (nodeProps.controls as boolean | undefined) ?? false;
  const objectFit = (nodeProps.objectFit as string | undefined) ?? '';

  const patchProp = (key: string, value: unknown) =>
    store.patchNodeField(nodeId, 'props', { ...nodeProps, [key]: value });
  // Video nodes from assets-tab store src in props.src; write back to the same field.
  const patchSrc  = (value: string) =>
    store.patchNodeField(nodeId, 'props', { ...nodeProps, src: value });

  const SELECT_STYLE: React.CSSProperties = {
    background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
    color: '#f3f4f6', fontSize: 11, padding: '3px 6px', outline: 'none', width: '100%',
  };

  const TOGGLES: { key: 'autoPlay' | 'loop' | 'muted' | 'controls'; label: string; value: boolean }[] = [
    { key: 'autoPlay', label: 'Auto Play', value: autoPlay },
    { key: 'loop',     label: 'Loop',      value: loop     },
    { key: 'muted',    label: 'Muted',     value: muted    },
    { key: 'controls', label: 'Controls',  value: controls },
  ];

  return (
    <div style={{ borderBottom: '1px solid #1f2937', padding: '8px 0 4px' }}>
      <div style={{ padding: '0 12px 6px', fontSize: 10, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em', fontWeight: 600 }}>Video</div>

      {/* Source URL — with binding support */}
      <SpecificRow
        label="Source URL"
        fieldKey="src"
        value={nodeSrc as FormulaValue}
        onChange={v => patchSrc(typeof v === 'string' ? v : '')}
        hint="Video URL e.g. https://example.com/video.mp4"
        expectedType="string"
      >
        <SettingsTextInput value={nodeSrc} onChange={patchSrc} placeholder="https://…mp4" testId="specific-video-src" />
      </SpecificRow>

      {/* Poster — with binding support */}
      <SpecificRow
        label="Poster"
        fieldKey="poster"
        value={(nodeProps.poster as FormulaValue) ?? ''}
        onChange={v => patchProp('poster', v)}
        hint="Thumbnail/poster image URL shown before the video plays"
        expectedType="string"
      >
        <SettingsTextInput value={posterVal} onChange={v => patchProp('poster', v)} placeholder="https://…jpg" />
      </SpecificRow>

      {posterVal && typeof posterVal === 'string' && (
        <div style={{ padding: '0 12px 8px' }}>
          <img src={posterVal} alt="poster" style={{ width: '100%', maxHeight: 64, objectFit: 'cover', borderRadius: 4, border: '1px solid #1f2937' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
      )}

      {/* Object fit — with binding support */}
      <SpecificRow
        label="Object fit"
        fieldKey="objectFit"
        value={(nodeProps.objectFit as FormulaValue) ?? ''}
        onChange={v => patchProp('objectFit', v)}
        hint="CSS object-fit: cover | contain | fill"
        expectedType="string"
      >
        <select
          value={objectFit}
          onChange={e => patchProp('objectFit', e.target.value || undefined)}
          style={SELECT_STYLE}
        >
          <option value="">Default (cover)</option>
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
          <option value="fill">Fill</option>
        </select>
      </SpecificRow>

      {/* Playback toggles — with binding support */}
      <div style={{ padding: '6px 12px 4px', borderTop: '1px solid #111827' }}>
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Playback</div>
        {TOGGLES.map(({ key, label, value }) => (
          <SpecificRow
            key={key}
            label={label}
            fieldKey={key}
            value={(nodeProps[key] as FormulaValue) ?? value}
            onChange={v => patchProp(key, v)}
            hint={`Boolean — controls video ${key} behaviour`}
            expectedType="boolean"
          >
            <div data-testid={`specific-video-${key}`} style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <OnOffToggle value={value} onChange={v => patchProp(key, v)} />
            </div>
          </SpecificRow>
        ))}
      </div>
    </div>
  );
}

function findSubmitButtonInTree(nodes: SDUINode[]): SDUINode | null {
  for (const n of nodes) {
    const actions = (n.actions ?? {}) as Record<string, unknown>;
    if ((actions.click as Record<string, unknown> | undefined)?.type === 'submitForm') return n;
    const child = n.children as SDUINode[] | undefined;
    if (child?.length) { const found = findSubmitButtonInTree(child); if (found) return found; }
  }
  return null;
}

export function SettingsTab({ node, pageNodes }: { node: SDUINode; pageNodes: SDUINode[] }) {
  const store = useBuilderStore();
  const nodeId = (node as { id?: string }).id ?? '';
  const nodeType = node.type as string;

  // ── Node name (shown for all types) ──────────────────────────────────────────
  const currentName = (node as { name?: string }).name ?? '';
  const [nameDraft, setNameDraft] = useState(currentName);
  useEffect(() => { setNameDraft(currentName); }, [currentName]);

  // Captured at focus time to avoid two stale-closure bugs:
  //
  // Bug A — wrong target: When the user clicks a different canvas element while editing,
  // React synchronously re-renders (useSyncExternalStore) with the new element's node prop
  // BEFORE blur fires. nodeId/nodeProps in the closure now refer to the NEW element.
  // Fix: capture nodeId at focus time, always commit to that node.
  //
  // Bug B — wrong value: The same React re-render also updates the controlled input
  // (value={fieldNameDraft}) with the NEW element's field name BEFORE blur fires.
  // So e.target.value in onBlur is the NEW element's name, not what the user typed.
  // Fix: track the typed value in the ref (updated on every onChange), use it at commit.
  const nameEditRef = useRef<{ nodeId: string; currentName: string; draftValue: string } | null>(null);
  const fieldEditRef = useRef<{
    nodeId: string;
    nodeProps: Record<string, unknown>;
    formContainerAncestor: SDUINode | null;
    fieldName: string;
    draftValue: string;
  } | null>(null);

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
  // Video nodes from the assets tab store src in props.src; Image nodes use node.src.
  // Read from both, preferring the top-level node.src.
  const nodeSrc = (nodeExtra.src as string | undefined) ?? (nodeProps.src as string | undefined) ?? '';
  const validation = nodeExtra._validation as NodeValidation | undefined;
  const debounce = nodeExtra._debounce as NodeDebounce | undefined;

  // Extract field name from node.props.name
  const fieldName = useMemo(() => {
    return (nodeProps.name as string | undefined) ?? '';
  }, [nodeProps]);

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

  const commitName = () => {
    const ctx = nameEditRef.current;
    if (!ctx) return;
    nameEditRef.current = null;
    const trimmed = ctx.draftValue.trim() || undefined;
    if (trimmed === ctx.currentName) return;
    store.patchNodeField(ctx.nodeId, 'name', trimmed);
  };

  const syncValidationToAction = (nextValidation: NodeValidation) => {
    const rules = nextValidation.rules ?? [];
    const reqRule = rules.find(r => r.type === 'required');

    // Update the submit button's fieldValidations so submitForm knows about this field's rules
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

  const patchDebounce = (patch: Partial<NodeDebounce>) => {
    const next = { ...(debounce ?? {}), ...patch };
    store.patchNodeField(nodeId, '_debounce', next);
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

  const commitFieldName = () => {
    // Use ref captured at focus time — the closure might have stale nodeId/nodeProps
    // if the user clicked a different canvas element while this input had focus.
    // draftValue is updated on every onChange, so it always holds what the user typed —
    // NOT e.target.value which React may have overwritten with the new element's name.
    const ctx = fieldEditRef.current;
    if (!ctx) return;
    fieldEditRef.current = null;
    const { nodeId: targetId, nodeProps: targetProps, formContainerAncestor: fc, fieldName: oldName, draftValue } = ctx;

    const trimmed = draftValue.trim();
    if (!trimmed) return;

    // 1. Write the field name to node.props.name (source of truth)
    store.patchNodeField(targetId, 'props', { ...targetProps, name: trimmed });

    // 2. Update node.name (display name) to match the field name
    store.patchNodeField(targetId, 'name', trimmed);

    // 3. Rename the key in FormContainer's initialFormData so the formula path stays in sync
    if (oldName && oldName !== trimmed && fc) {
      const fcId = (fc as { id?: string }).id ?? '';
      const fcProps = (fc.props ?? {}) as Record<string, unknown>;
      const oldData = (fcProps.initialFormData ?? {}) as Record<string, unknown>;
      if (oldName in oldData) {
        const { [oldName]: oldVal, ...rest } = oldData;
        store.patchNodeField(fcId, 'props', { ...fcProps, initialFormData: { ...rest, [trimmed]: oldVal } });
      }

      // 4. Immediately rename the key in the live runtime variable store so the formula
      //    tree and data source panel update without requiring the user to type in the field.
      if (fcId) {
        const runtimeKey = `${fcId}-form`;
        getGlobalVariableStore().getState().setState(vs => {
          const formEntry = (vs[runtimeKey] ?? {}) as Record<string, unknown>;
          const fd    = (formEntry['formData'] ?? {}) as Record<string, unknown>;
          const flds  = (formEntry['fields']   ?? {}) as Record<string, unknown>;
          const { [oldName]: oldFdVal,  ...restFd   } = fd;
          const { [oldName]: oldFldVal, ...restFlds  } = flds;

          const storedLocal = (vs['local'] ?? {}) as Record<string, unknown>;
          const storedData  = (storedLocal['data'] ?? {}) as Record<string, unknown>;
          const storedForm  = (storedData['form']  ?? {}) as Record<string, unknown>;
          const localFd   = (storedForm['formData'] ?? {}) as Record<string, unknown>;
          const localFlds = (storedForm['fields']   ?? {}) as Record<string, unknown>;
          const { [oldName]: oldLocalFdVal,  ...restLocalFd   } = localFd;
          const { [oldName]: oldLocalFldVal, ...restLocalFlds  } = localFlds;

          return {
            ...vs,
            [runtimeKey]: {
              ...formEntry,
              formData: { ...restFd,   [trimmed]: oldFdVal  ?? '' },
              fields:   { ...restFlds, [trimmed]: oldFldVal ?? { value: '', isValid: '' } },
            },
            local: {
              ...storedLocal,
              data: {
                ...storedData,
                form: {
                  ...storedForm,
                  formData: { ...restLocalFd,   [trimmed]: oldLocalFdVal  ?? '' },
                  fields:   { ...restLocalFlds, [trimmed]: oldLocalFldVal ?? { value: '', isValid: '' } },
                },
              },
            },
          };
        });
      }
    }
  };

  const isReadOnly = !!(nodeProps.readOnly ?? nodeProps.isReadOnly);
  const autocomplete = nodeProps.autoComplete as string | undefined;
  const placeholder = (nodeProps.placeholder as string | undefined) ?? '';
  const initValue = ((node as unknown as Record<string, unknown>)._initialValue as string | undefined) ?? '';
  const debounceEnabled = debounce?.enabled ?? false;
  const debounceDelay = debounce?.delay ?? 500;

  // Input type — map raw prop to option value
  const rawInputType = (nodeProps.type as string | undefined) ?? 'text';
  const currentInputType = rawInputType === 'number' && nodeProps.step === '0.01' ? 'decimal' : rawInputType;

  // Button submit detection — renderer uses props.type === 'submit' to wire the button to formCtx.submit()
  const isSubmitButton = (nodeProps as unknown as Record<string, unknown>).type === 'submit';

  const selectInputType = (val: string) => {
    if (val === 'decimal' || val === 'currency') {
      store.patchNodeField(nodeId, 'props', { ...nodeProps, type: 'number', step: '0.01' });
    } else {
      const { step: _s, ...rest } = nodeProps as Record<string, unknown>;
      void _s;
      store.patchNodeField(nodeId, 'props', { ...rest, type: val });
    }
  };

  // Determine if there is anything specific to show for this node type
  const hasSpecific = nodeType === 'Icon' || nodeType === 'Image' || nodeType === 'Video'
    || nodeType === 'Button' || nodeType === 'FormContainer'
    || SETTINGS_INPUT_TYPES.has(nodeType);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderBottom: hasSpecific ? '1px solid #374151' : undefined }}>

      {/* ── Name (all types; hidden when inside FormContainer — field name serves as name) ── */}
      {!formContainerAncestor && (
        <div style={{ borderBottom: '1px solid #1f2937', padding: '8px 12px' }}>
          <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Name</div>
          <input
            data-testid="settings-name-input"
            value={nameDraft}
            onFocus={() => { nameEditRef.current = { nodeId, currentName, draftValue: nameDraft }; }}
            onChange={e => { setNameDraft(e.target.value); if (nameEditRef.current) nameEditRef.current.draftValue = e.target.value; }}
            onBlur={() => commitName()}
            onKeyDown={e => { if (e.key === 'Enter') { commitName(); (e.target as HTMLInputElement).blur(); } }}
            placeholder={`e.g. ${nodeType}`}
            style={{ width: '100%', boxSizing: 'border-box' as const, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '4px 7px', outline: 'none' }}
          />
        </div>
      )}

      {/* ── "Specific" section header — only shown when there IS component-specific content ── */}
      {hasSpecific && (
        <div style={{ padding: '8px 12px 2px', fontSize: 10, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.06em', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          Specific
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
                      store.patchNodeField(nodeId, 'props', { ...(nodeProps as unknown as Record<string, unknown>), type: 'submit' });
                    } else {
                      const { type: _t, ...rest } = nodeProps as unknown as Record<string, unknown>;
                      void _t;
                      store.patchNodeField(nodeId, 'props', rest);
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

      {/* ── FormContainer: registered fields inspector ───────────────────────── */}
      {nodeType === 'FormContainer' && <FormContainerFieldsPanel nodeId={nodeId} />}

      {/* ── Icon settings ─────────────────────────────────────────────── */}
      {nodeType === 'Icon' && (
        <IconifySettings nodeId={nodeId} nodeProps={nodeProps} />
      )}

      {/* ── Image settings ───────────────────────────────────────────────────── */}
      {(nodeType === 'Image' || nodeType === 'Image') && (
        <ImageSettings nodeId={nodeId} nodeProps={nodeProps} nodeSrc={nodeSrc} />
      )}

      {/* ── Video settings ───────────────────────────────────────────────────── */}
      {nodeType === 'Video' && (
        <VideoSettings nodeId={nodeId} nodeProps={nodeProps} nodeSrc={nodeSrc} />
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
              onFocus={() => { fieldEditRef.current = { nodeId, nodeProps, formContainerAncestor, fieldName, draftValue: fieldNameDraft }; }}
              onChange={e => { setFieldNameDraft(e.target.value); if (fieldEditRef.current) fieldEditRef.current.draftValue = e.target.value; }}
              onBlur={() => commitFieldName()}
              onKeyDown={e => { if (e.key === 'Enter') { commitFieldName(); (e.target as HTMLInputElement).blur(); } }}
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
                            ƒ {(rule.formula || rule.value) ? 'Edit formula' : 'Add formula'}
                          </button>
                          {isFormulaOpen && (
                            <FormulaEditor
                              label="Validation formula"
                              value={rule.formula ?? (rule.value ? { formula: rule.value } : null)}
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

export function AlignDistributePanel({ ids }: { ids: string[] }) {
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

// ─── FormContainer Fields Inspector ───────────────────────────────────────────

function FormContainerFieldsPanel({ nodeId }: { nodeId: string }) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [fields, setFields] = useState<Record<string, { value?: unknown; isValid?: unknown }>>({});
  const [flags, setFlags] = useState({ isSubmitting: false, isSubmitted: false, isValid: false });
  const formStoreKey = nodeId ? `${nodeId}-form` : null;

  useEffect(() => {
    const read = () => {
      const vs = getGlobalVariableStore().getState().getFullState();
      // Read from per-container key (variables[nodeId-form]) so we only see THIS
      // FormContainer's fields — not fields from other containers on the same page.
      const form = formStoreKey
        ? (vs[formStoreKey] as Record<string, unknown> | undefined)
        : undefined;
      setFormData((form?.['formData'] as Record<string, unknown>) ?? {});
      setFields((form?.['fields'] as Record<string, { value?: unknown; isValid?: unknown }>) ?? {});
      setFlags({
        isSubmitting: Boolean(form?.['isSubmitting']),
        isSubmitted: Boolean(form?.['isSubmitted']),
        isValid: Boolean(form?.['isValid']),
      });
    };
    read();
    return getGlobalVariableStore().subscribe(() => read());
  }, [nodeId, formStoreKey]);

  const fieldNames = Object.keys(formData);

  return (
    <div style={{ borderBottom: '1px solid #1f2937', padding: '8px 0 4px' }}>
      <div style={{ padding: '0 12px 6px', display: 'flex', alignItems: 'center', gap: 5 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 10h8M8 14h5"/>
        </svg>
        <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Registered Fields</span>
      </div>

      {/* Formula path hint */}
      {formStoreKey && (
        <div style={{ padding: '0 12px 6px', fontSize: 9, color: '#4b5563', lineHeight: 1.4 }}>
          Formula path:{' '}
          <code style={{ background: '#1f2937', padding: '1px 4px', borderRadius: 3, color: '#6366f1' }}>
            variables[&apos;{formStoreKey}&apos;].formData.fieldName
          </code>
        </div>
      )}
      {!formStoreKey && (
        <div style={{ padding: '4px 12px 6px', fontSize: 9, color: '#f87171' }}>
          Set an <code style={{ background: '#1f2937', padding: '1px 4px', borderRadius: 3 }}>id</code> on this FormContainer to enable per-form tracking.
        </div>
      )}
      {fieldNames.length === 0 ? (
        <div style={{ padding: '4px 12px 8px', fontSize: 10, color: '#4b5563', fontStyle: 'italic' }}>
          No fields registered yet — add InputField nodes with a{' '}
          <code style={{ background: '#1f2937', padding: '1px 4px', borderRadius: 3 }}>name</code> prop.
        </div>
      ) : (
        <div style={{ padding: '0 12px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {fieldNames.map(name => {
            const val = formData[name];
            const isValid = fields[name]?.isValid;
            return (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', background: '#0f172a', borderRadius: 4, border: '1px solid #1e293b' }}>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#86efac', minWidth: 80, flexShrink: 0 }}>{name}</span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {val === undefined || val === null || val === '' ? <span style={{ color: '#374151' }}>(empty)</span> : String(val)}
                </span>
                {isValid ? (
                  <span style={{ fontSize: 9, color: '#f87171', flexShrink: 0 }}>⚠ {String(isValid)}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Form state flags */}
      <div style={{ padding: '4px 12px 6px', display: 'flex', gap: 8 }}>
        {(['isSubmitting', 'isSubmitted', 'isValid'] as const).map(key => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: flags[key] ? '#86efac' : '#374151', flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: '#6b7280' }}>{key}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
