'use client';

/**
 * _custom-color-form.tsx
 *
 * Slide-panel form for adding and editing user-defined theme colors.
 * Mirrors the structure of `_variable-form.tsx` (VariableSlideContent) so the
 * Theme tab's color creation flow feels identical to global-variable creation.
 *
 * Custom colors carry a CSS-var-safe `name` plus a Light + Dark hex value;
 * once saved, `_applyLightOverrides` / `_applyDarkOverrides` write them to
 * the DOM as `--<name>` (rgb triplet) and `--theme-<name>` (hex) so they
 * behave identically to system theme tokens.
 */

import React, { useMemo, useState } from 'react';
import { useBuilderStore, type CustomColor } from './_store';
import { SP_BTN_PRIMARY, SP_BTN_SECONDARY, SP_INPUT, SP_LABEL } from './_slide-panel';
import { FolderPicker } from './_data-source-form';
import { FigmaColorPicker } from './_color-picker';

/** Names that are baked into the design-system theme; users cannot shadow them with a custom color. */
const RESERVED_SYSTEM_COLOR_NAMES = new Set<string>([
  'background', 'foreground',
  'card', 'card-foreground',
  'popover', 'popover-foreground',
  'primary', 'primary-foreground',
  'secondary', 'secondary-foreground',
  'muted', 'muted-foreground',
  'accent', 'accent-foreground',
  'destructive', 'destructive-foreground',
  'border', 'input', 'ring',
  'radius',
]);

const NAME_RE = /^[a-z][a-z0-9-]*$/;

interface CustomColorSlideProps {
  initial: Partial<CustomColor> & { isNew?: boolean };
  onSave: (c: CustomColor) => void;
  onClose: () => void;
}

export function CustomColorSlideContent({ initial, onSave, onClose }: CustomColorSlideProps) {
  const customColors = useBuilderStore(s => s.customColors);

  const [name, setName] = useState(initial.name ?? '');
  const [label, setLabel] = useState(initial.label ?? '');
  const [folderId, setFolderId] = useState<string | undefined>(initial.folderId);
  const [description, setDescription] = useState(initial.description ?? '');
  const [light, setLight] = useState(initial.light ?? '#7c3aed');
  const [dark, setDark]   = useState(initial.dark  ?? '#a78bfa');
  const [nameTouched, setNameTouched] = useState(false);

  const isEditingExisting = !initial.isNew && !!initial.id;

  const nameError = useMemo<string | null>(() => {
    const trimmed = name.trim();
    if (!trimmed) return 'A name is required.';
    if (!NAME_RE.test(trimmed)) return 'Use lowercase letters, digits and hyphens only (must start with a letter).';
    if (RESERVED_SYSTEM_COLOR_NAMES.has(trimmed)) return `"${trimmed}" is a reserved system color name.`;
    if (customColors.some(c => c.name === trimmed && c.id !== initial.id)) return `A custom color named "${trimmed}" already exists.`;
    return null;
  }, [name, customColors, initial.id]);

  const canSave = !nameError;

  const save = () => {
    if (!canSave) return;
    const id = initial.id ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `cc-${Date.now()}`);
    onSave({
      id,
      name: name.trim(),
      label: label.trim() || undefined,
      folderId,
      description: description.trim() || undefined,
      light: light || '#000000',
      dark: dark || '#000000',
    });
  };

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
      {/* Name */}
      <div>
        <label style={SP_LABEL}>Name *</label>
        <input
          data-testid="color-name"
          value={name}
          onChange={e => { setName(e.target.value); setNameTouched(true); }}
          onBlur={() => setNameTouched(true)}
          placeholder="brand-primary"
          style={{ ...SP_INPUT, border: `1px solid ${nameTouched && nameError ? '#f59e0b' : '#374151'}`, fontFamily: 'monospace' }}
          disabled={isEditingExisting}
        />
        {nameTouched && nameError && (
          <div style={{ marginTop: 4, padding: '5px 8px', background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#d97706', fontSize: 12 }}>⚠</span>
            <span style={{ color: '#92400e', fontSize: 11 }}>{nameError}</span>
          </div>
        )}
        {!nameError && (
          <div style={{ marginTop: 4, fontSize: 10, color: 'var(--bld-text-disabled)', lineHeight: 1.4 }}>
            Used as the CSS variable (<code style={{ color: '#a78bfa' }}>--{name.trim() || 'name'}</code>) and in formulas via <code style={{ color: '#a78bfa' }}>theme.colors[&apos;{name.trim() || 'name'}&apos;]</code>.
          </div>
        )}
      </div>

      {/* Label */}
      <div>
        <label style={SP_LABEL}>Label</label>
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="Human-readable name…"
          style={SP_INPUT}
        />
      </div>

      {/* Folder */}
      <div>
        <label style={SP_LABEL}>Folder</label>
        <FolderPicker value={folderId} onChange={setFolderId} scope="color" />
      </div>

      {/* Description */}
      <div>
        <label style={SP_LABEL}>Description</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Describe this color…"
          rows={3}
          style={{ ...SP_INPUT, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
        />
      </div>

      {/* Light value */}
      <div>
        <label style={SP_LABEL}>Light value *</label>
        <FigmaColorPicker
          testId="color-light"
          value={light}
          onChange={hex => setLight(hex)}
        />
      </div>

      {/* Dark value */}
      <div>
        <label style={SP_LABEL}>Dark value *</label>
        <FigmaColorPicker
          testId="color-dark"
          value={dark}
          onChange={hex => setDark(hex)}
        />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4, paddingBottom: 4 }}>
        <button onClick={onClose} style={SP_BTN_SECONDARY}>Cancel</button>
        <button
          data-testid="color-save"
          onClick={save}
          disabled={!canSave}
          style={{ ...SP_BTN_PRIMARY, opacity: canSave ? 1 : 0.4, cursor: canSave ? 'pointer' : 'not-allowed' }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

export { RESERVED_SYSTEM_COLOR_NAMES };
