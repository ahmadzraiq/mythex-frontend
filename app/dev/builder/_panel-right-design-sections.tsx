'use client';

/**
 * _panel-right-design-sections.tsx
 *
 * Standalone design-related section components that live outside the DesignTab function.
 * Extracted from _panel-right.tsx.
 *
 * Exports:
 *  - ToggleBind            — bind-icon + value toggle pair
 *  - VisibilityInDesign    — visibility condition editor
 *  - DisableInDesign       — disabled-when condition editor
 *  - RepeatInDesign        — map/repeat configuration
 *  - NodeNameInDesign      — node ID rename
 *  - GridOverlayPanel      — grid column overlay controls
 *  - PropsTab              — props editor tab
 *  - JsonTab               — JSON view tab
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useBuilderStore } from './_store';
import type { SDUINode } from '@/lib/sdui/types/node';
import { BindingIcon, isBoundValue, type FormulaValue } from './_formula-panel';
import { FormulaEditor } from './_formula-editor';
import { PANEL_STYLE, SECTION_STYLE, LABEL_STYLE, SectionHeader, NumberInput, SelectInput, ToggleBtn, DirectChangedLabel, ResponsiveDot } from './_panel-primitives';
import { FigmaColorPicker } from './_color-picker';
import { BREAKPOINT_CASCADE } from '@/lib/sdui/types/node';
import type { BreakpointKey } from '@/lib/sdui/types/node';
import { BUILDER_FORM_INPUT_TYPES } from '@/lib/sdui/controlled-component-registry';

// ─── Design-tab inline sections (moved from Logic) ────────────────────────────

export const INTERACTIVE_TYPES = new Set(['Input', 'Select', 'SelectTrigger', 'Checkbox', 'Switch', 'RadioGroup', 'TextareaInput']);
export const FORM_INPUT_TYPES = BUILDER_FORM_INPUT_TYPES;

export const DESIGN_INLINE_STYLE: React.CSSProperties = {
  borderTop: '1px solid var(--bld-border-subtle)',
  padding: '8px 12px',
};

const DESIGN_LABEL: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--bld-text-3)',
  textTransform: 'none' as const,
  display: 'block',
  marginBottom: 4,
};

// ─── ToggleBind ───────────────────────────────────────────────────────────────
// Compact row: LABEL | [toggle / ƒ Edit formula] [≈]
// Used for Visible, Disabled, and Repeat sections.
export function ToggleBind({
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
        <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', textTransform: 'none' }}>
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
              padding: '3px 10px', background: 'color-mix(in srgb, var(--bld-accent) 10%, transparent)', border: '1px solid var(--bld-accent)',
              borderRadius: 5, color: 'var(--bld-accent)', fontSize: 11, cursor: 'pointer', fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            ƒ Edit formula
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 2 }}>
            <ToggleBtn
              data-testid={`toggle-on-${fieldId}`}
              active={isOn}
              onClick={() => { if (!isOn) onToggle(); }}
              style={{ padding: '2px 8px', fontSize: 10 }}
            >On</ToggleBtn>
            <ToggleBtn
              data-testid={`toggle-off-${fieldId}`}
              active={!isOn}
              onClick={() => { if (isOn) onToggle(); }}
              style={{ padding: '2px 8px', fontSize: 10 }}
            >Off</ToggleBtn>
          </div>
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

// ─── State tag options ───────────────────────────────────────────────────────

const STATE_TAG_OPTIONS = [
  { id: undefined,   label: 'None',    icon: '–',  color: 'var(--bld-text-disabled)', bg: 'transparent', border: 'var(--bld-border)' },
  { id: 'loading',   label: 'Loading', icon: '⟳',  color: 'var(--bld-warning)', bg: '#451a03',     border: 'var(--bld-warning)' },
  { id: 'empty',     label: 'Empty',   icon: '○',  color: '#6ee7b7', bg: '#022c22',     border: '#6ee7b7' },
  { id: 'default',   label: 'Default', icon: '◉',  color: 'var(--bld-text-3)', bg: 'var(--bld-bg-input)',     border: 'var(--bld-text-3)' },
  { id: 'custom',    label: 'Custom',  icon: '◈',  color: '#c084fc', bg: '#2e1065',     border: '#c084fc' },
] as const;

function StateTagPicker({ nodeId, node }: { nodeId: string; node: SDUINode }) {
  const store = useBuilderStore();
  const currentTag = (node as unknown as Record<string, unknown>)._stateTag as string | undefined;

  // Determine which pill is active: if tag exists but isn't one of the fixed ids, it's 'custom'
  const fixedIds = ['loading', 'empty', 'default'] as const;
  const isCustom = !!currentTag && !(fixedIds as readonly string[]).includes(currentTag);
  const activeId = isCustom ? 'custom' : currentTag;

  const [customInput, setCustomInput] = useState(isCustom ? currentTag : '');

  // Keep custom input in sync when node changes (e.g. different node selected)
  useEffect(() => {
    const tag = (node as unknown as Record<string, unknown>)._stateTag as string | undefined;
    const isC = !!tag && !(fixedIds as readonly string[]).includes(tag);
    setCustomInput(isC ? tag : '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  const selectTag = (id: string | undefined) => {
    if (id === 'custom') {
      // Keep whatever was in custom input, or clear to let user type
      const val = customInput.trim() || '';
      store.patchNodeField(nodeId, '_stateTag', val || undefined);
    } else {
      store.patchNodeField(nodeId, '_stateTag', id);
      setCustomInput('');
    }
  };

  const commitCustom = () => {
    const val = customInput.trim();
    store.patchNodeField(nodeId, '_stateTag', val || undefined);
  };

  return (
    <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--bld-border-subtle)' }}>
      <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)', textTransform: 'none', display: 'block', marginBottom: 5 }}>
        State
      </span>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {STATE_TAG_OPTIONS.map(opt => {
          const isActive = opt.id === undefined ? !currentTag : opt.id === activeId;
          return (
            <button
              key={String(opt.id ?? 'none')}
              data-testid={`state-tag-pill-${opt.id ?? 'none'}`}
              onClick={() => selectTag(opt.id)}
              title={opt.label}
              style={{
                fontSize: 9,
                padding: '2px 7px',
                borderRadius: 4,
                border: `1px solid ${isActive ? opt.border : '#374151'}`,
                background: isActive ? opt.bg : 'transparent',
                color: isActive ? opt.color : 'var(--bld-text-disabled)',
                cursor: 'pointer',
                fontWeight: isActive ? 600 : 400,
                transition: 'all 0.1s',
                whiteSpace: 'nowrap',
              }}
            >
              {opt.icon} {opt.label}
            </button>
          );
        })}
      </div>
      {activeId === 'custom' && (
        <input
          data-testid="state-tag-custom-input"
          value={customInput}
          onChange={e => setCustomInput(e.target.value)}
          onBlur={commitCustom}
          onKeyDown={e => { if (e.key === 'Enter') commitCustom(); }}
          placeholder="state name…"
          style={{
            marginTop: 5,
            background: 'var(--bld-bg-input)',
            border: '1px solid var(--bld-border-subtle)',
            borderRadius: 4,
            color: '#c084fc',
            fontSize: 10,
            padding: '3px 7px',
            width: '100%',
            outline: 'none',
          }}
        />
      )}
    </div>
  );
}

export function VisibilityInDesign({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const nodeId = (node as { id?: string }).id ?? '';
  const abp = useBuilderStore(s => s.activeBreakpoint);

  // Cascade condition from responsive overrides at non-desktop
  const rawCondition = useMemo(() => {
    if (abp === 'desktop' || !node.responsive) return (node as { condition?: unknown }).condition;
    let v: unknown = (node as { condition?: unknown }).condition;
    for (const bp of BREAKPOINT_CASCADE as BreakpointKey[]) {
      const ov = (node.responsive as Record<string, unknown>)[bp] as { condition?: unknown } | undefined;
      if (ov && 'condition' in ov) v = ov.condition;
      if (bp === abp) break;
    }
    return v;
  }, [abp, node]);

  // Which breakpoints have condition overrides?
  const conditionOverrideBps = useMemo(() => {
    if (!node.responsive) return [];
    return (BREAKPOINT_CASCADE as BreakpointKey[]).filter(bp => {
      const ov = (node.responsive as Record<string, unknown>)[bp] as { condition?: unknown } | undefined;
      return ov && 'condition' in ov;
    });
  }, [node.responsive]);

  // Normalize: plain string conditions (JS formula expressions) → { formula } so the editor recognises them as bound
  const condition: FormulaValue = typeof rawCondition === 'string' && rawCondition !== ''
    ? { formula: rawCondition }
    : rawCondition as FormulaValue;
  const isBound = isBoundValue(condition);
  const isHidden = !isBound && rawCondition === false;
  const hasCondition = rawCondition != null;
  const forceShow = !!(node as { _forceShowInEditor?: boolean })._forceShowInEditor;

  const patchConditionResponsive = useCallback((value: unknown | null) => {
    if (abp !== 'desktop') {
      const rbp = abp as 'laptop' | 'tablet' | 'mobile';
      if (value === null) store.removeResponsiveOverride(nodeId, rbp, 'condition');
      else store.patchResponsive(nodeId, rbp, 'condition', value);
      store._pushHistory();
    } else {
      store.patchCondition(nodeId, value as object | null);
    }
  }, [abp, nodeId, store]);

  return (
    <div style={DESIGN_INLINE_STYLE}>
      {conditionOverrideBps.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <ResponsiveDot
            cssProp="condition"
            overriddenBreakpoints={conditionOverrideBps}
            onRemove={bp => { store.removeResponsiveOverride(nodeId, bp as 'laptop'|'tablet'|'mobile', 'condition'); store._pushHistory(); }}
            onResetAll={() => { for (const bp of BREAKPOINT_CASCADE as BreakpointKey[]) { store.removeResponsiveOverride(nodeId, bp, 'condition'); } store._pushHistory(); }}
          />
        </div>
      )}
      <ToggleBind
        rowLabel="Visible"
        fieldId="visibility-condition"
        hint="e.g. variables['UUID'] > 0, local?.data?.form?.isSubmitting"
        expectedType="boolean"
        isOn={!isHidden}
        value={isBound ? condition : !isHidden as unknown as FormulaValue}
        onToggle={() => patchConditionResponsive(isHidden ? null : false)}
        onChange={v => {
          if (isBoundValue(v)) {
            // Unwrap { formula: "..." } back to plain string for runtime compatibility
            const f = (v as { formula?: string }).formula;
            patchConditionResponsive(typeof f === 'string' ? f : v);
          } else {
            patchConditionResponsive(null);
          }
        }}
        style={{ borderTop: 'none', padding: 0 }}
      />
      {hasCondition && (
        <>
          <StateTagPicker nodeId={nodeId} node={node} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--bld-border-subtle)' }}>
            <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>Force show in editor</span>
            <div style={{ display: 'flex', gap: 2 }}>
              <ToggleBtn active={forceShow} onClick={() => store.patchNodeField(nodeId, '_forceShowInEditor', forceShow ? undefined : true)} style={{ padding: '2px 8px', fontSize: 10 }}>On</ToggleBtn>
              <ToggleBtn active={!forceShow} onClick={() => store.patchNodeField(nodeId, '_forceShowInEditor', forceShow ? undefined : true)} style={{ padding: '2px 8px', fontSize: 10 }}>Off</ToggleBtn>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function DisableInDesign({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const nodeId = (node as { id?: string }).id ?? '';
  const abp = useBuilderStore(s => s.activeBreakpoint);

  // Cascade props.disabled from responsive overrides at non-desktop
  const disabled = useMemo(() => {
    const base = (node.props as Record<string, unknown> | undefined)?.disabled;
    if (abp === 'desktop' || !node.responsive) return base;
    let v: unknown = base;
    for (const bp of BREAKPOINT_CASCADE as BreakpointKey[]) {
      const ov = (node.responsive as Record<string, unknown>)[bp] as { props?: Record<string, unknown> } | undefined;
      if (ov?.props && 'disabled' in ov.props) v = ov.props.disabled;
      if (bp === abp) break;
    }
    return v;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abp, node.responsive, node.props]);

  // Which breakpoints have props.disabled overrides?
  const disabledOverrideBps = useMemo(() => {
    if (!node.responsive) return [];
    return (BREAKPOINT_CASCADE as BreakpointKey[]).filter(bp => {
      const ov = (node.responsive as Record<string, unknown>)[bp] as { props?: Record<string, unknown> } | undefined;
      return ov?.props && 'disabled' in ov.props;
    });
  }, [node.responsive]);

  const isBound = isBoundValue(disabled as FormulaValue);
  const isDisabled = !isBound && !!disabled;
  const showOverlay = isDisabled || isBound;

  const patchDisabled = useCallback((value: unknown) => {
    if (abp !== 'desktop') {
      const rbp = abp as 'laptop' | 'tablet' | 'mobile';
      if (value === undefined) store.removeResponsiveOverride(nodeId, rbp, 'props.disabled');
      else store.patchResponsive(nodeId, rbp, 'props.disabled', value);
      store._pushHistory();
    } else {
      store.patchProp(nodeId, 'props.disabled', value);
    }
  }, [abp, nodeId, store]);

  // Base overlay (desktop)
  const baseOverlay = ((node as Record<string, unknown>)._disabledOverlay ?? {}) as {
    color?: string; opacity?: number; blur?: number;
  };

  // Cascade responsive _disabledOverlay fields on top of base for the active breakpoint.
  const effectiveOverlay = useMemo(() => {
    if (abp === 'desktop' || !node.responsive) return baseOverlay;
    const merged = { ...baseOverlay };
    for (const bp of BREAKPOINT_CASCADE) {
      const ov = (node.responsive as Record<string, unknown>)[bp] as
        | { _disabledOverlay?: { color?: string | null; opacity?: number | null; blur?: number | null } }
        | undefined;
      if (ov?._disabledOverlay) {
        for (const [k, v] of Object.entries(ov._disabledOverlay)) {
          if (v === null) delete (merged as Record<string, unknown>)[k];
          else (merged as Record<string, unknown>)[k] = v;
        }
      }
      if (bp === abp) break;
    }
    return merged;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abp, node.responsive, baseOverlay]);

  // Per-field: which breakpoints have that field overridden vs base?
  const fieldOverriddenBps = useMemo(() => {
    const result = { color: [] as string[], opacity: [] as string[], blur: [] as string[] };
    if (!node.responsive) return result;
    for (const bp of BREAKPOINT_CASCADE as BreakpointKey[]) {
      const ov = (node.responsive as Record<string, unknown>)[bp] as
        | { _disabledOverlay?: { color?: string | null; opacity?: number | null; blur?: number | null } }
        | undefined;
      const d = ov?._disabledOverlay;
      if (!d) continue;
      if ('color'   in d && d.color   !== baseOverlay.color)                              result.color.push(bp);
      if ('opacity' in d && d.opacity !== baseOverlay.opacity)                            result.opacity.push(bp);
      if ('blur'    in d && d.blur    !== baseOverlay.blur)                               result.blur.push(bp);
    }
    return result;
  }, [node.responsive, baseOverlay]);

  const forceShow = !!(node as Record<string, unknown>)._forceDisabledInEditor;

  // Write a single field to the right channel (responsive or base).
  const writeField = useCallback((field: 'color' | 'opacity' | 'blur', value: string | number | null) => {
    if (abp !== 'desktop') {
      store.patchResponsive(nodeId, abp as 'laptop' | 'tablet' | 'mobile', `_disabledOverlay.${field}`, value);
    } else {
      store.patchNodeField(nodeId, '_disabledOverlay', { ...baseOverlay, [field]: value });
    }
  }, [abp, nodeId, store, baseOverlay]);

  // Reset a field at the active bp back to base (remove the responsive override).
  const resetField = useCallback((field: 'color' | 'opacity' | 'blur') => {
    if (abp !== 'desktop') {
      store.removeResponsiveOverride(nodeId, abp as 'laptop' | 'tablet' | 'mobile', `_disabledOverlay.${field}`);
    } else {
      const next = { ...baseOverlay };
      delete (next as Record<string, unknown>)[field];
      store.patchNodeField(nodeId, '_disabledOverlay', next);
    }
    store._pushHistory();
  }, [abp, nodeId, store, baseOverlay]);

  // Local state for live slider updates.
  const [localOpacity, setLocalOpacity] = useState(Math.round((effectiveOverlay.opacity ?? 0.3) * 100));
  const [localBlur, setLocalBlur] = useState(effectiveOverlay.blur ?? 0);
  const opacityRaf = useRef<number | null>(null);
  const blurRaf    = useRef<number | null>(null);

  // Sync local state on node or breakpoint change.
  useEffect(() => {
    setLocalOpacity(Math.round((effectiveOverlay.opacity ?? 0.3) * 100));
    setLocalBlur(effectiveOverlay.blur ?? 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, abp]);

  const effectiveRef = useRef(effectiveOverlay);
  effectiveRef.current = effectiveOverlay;

  const commitHistory = () => store._pushHistory();

  const patchOpacityLive = (pct: number) => {
    setLocalOpacity(pct);
    if (opacityRaf.current !== null) cancelAnimationFrame(opacityRaf.current);
    opacityRaf.current = requestAnimationFrame(() => {
      writeField('opacity', pct / 100);
      opacityRaf.current = null;
    });
  };

  const patchBlurLive = (px: number) => {
    setLocalBlur(px);
    if (blurRaf.current !== null) cancelAnimationFrame(blurRaf.current);
    blurRaf.current = requestAnimationFrame(() => {
      writeField('blur', px);
      blurRaf.current = null;
    });
  };

  const patchColorLive = (hex: string) => writeField('color', hex);

  const DEF_COLOR   = '#000000';
  const DEF_OPACITY = 0.3;
  const DEF_BLUR    = 0;

  // Helper: build a ResponsiveDot for a field with field-specific reset.
  const fieldChip = (field: 'color' | 'opacity' | 'blur', bps: string[]) =>
    bps.length > 0 ? (
      <ResponsiveDot
        cssProp={`disabledOverlay-${field}`}
        overriddenBreakpoints={bps}
        onRemove={bp => {
          store.removeResponsiveOverride(nodeId, bp as 'laptop' | 'tablet' | 'mobile', `_disabledOverlay.${field}`);
          commitHistory();
        }}
        onResetAll={() => {
          for (const bp of BREAKPOINT_CASCADE as BreakpointKey[]) {
            store.removeResponsiveOverride(nodeId, bp, `_disabledOverlay.${field}`);
          }
          commitHistory();
        }}
      />
    ) : null;

  return (
    <>
      {disabledOverrideBps.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 12px 0' }}>
          <ResponsiveDot
            cssProp="props-disabled"
            overriddenBreakpoints={disabledOverrideBps}
            onRemove={bp => { store.removeResponsiveOverride(nodeId, bp as 'laptop'|'tablet'|'mobile', 'props.disabled'); store._pushHistory(); }}
            onResetAll={() => { for (const bp of BREAKPOINT_CASCADE as BreakpointKey[]) { store.removeResponsiveOverride(nodeId, bp, 'props.disabled'); } store._pushHistory(); }}
          />
        </div>
      )}
      <ToggleBind
        rowLabel="Disabled"
        fieldId="disabled-state"
        hint="e.g. {{!isLoggedIn}}, {{form.loading}}"
        expectedType="boolean"
        isOn={isDisabled}
        value={(isBound ? disabled : isDisabled) as FormulaValue}
        onToggle={() => patchDisabled(isDisabled ? undefined : true)}
        onChange={v => {
          if (isBoundValue(v)) patchDisabled(v);
          else patchDisabled(undefined);
        }}
      />
      {showOverlay && (
        <div style={{ borderTop: '1px solid var(--bld-border-subtle)', padding: '6px 12px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ ...DESIGN_LABEL, marginBottom: 0 }}>Overlay</span>

          {/* Color */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
              <DirectChangedLabel
                text="Color"
                changed={effectiveOverlay.color !== undefined && effectiveOverlay.color !== DEF_COLOR}
                onReset={() => resetField('color')}
              />
              {fieldChip('color', fieldOverriddenBps.color)}
            </div>
            <FigmaColorPicker
              value={effectiveOverlay.color?.startsWith('#') ? effectiveOverlay.color : DEF_COLOR}
              onChange={hex => patchColorLive(hex)}
              onCommit={commitHistory}
            />
          </div>

          {/* Opacity */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
              <DirectChangedLabel
                text="Opacity %"
                changed={effectiveOverlay.opacity !== undefined && Math.abs((effectiveOverlay.opacity ?? DEF_OPACITY) - DEF_OPACITY) > 0.005}
                onReset={() => resetField('opacity')}
              />
              {fieldChip('opacity', fieldOverriddenBps.opacity)}
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type="number" min={0} max={100} step={5}
                value={localOpacity}
                onChange={e => patchOpacityLive(Math.min(100, Math.max(0, Number(e.target.value))))}
                onBlur={() => commitHistory()}
                style={{ background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-2)', fontSize: 11, padding: '2px 5px', width: 44, textAlign: 'center' as const, flexShrink: 0 }}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
              <DirectChangedLabel
                text="Blur px"
                changed={(effectiveOverlay.blur ?? DEF_BLUR) !== DEF_BLUR}
                onReset={() => resetField('blur')}
              />
              {fieldChip('blur', fieldOverriddenBps.blur)}
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type="number" min={0} max={40} step={1}
                value={localBlur}
                onChange={e => patchBlurLive(Math.min(40, Math.max(0, Number(e.target.value))))}
                onBlur={() => commitHistory()}
                style={{ background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-2)', fontSize: 11, padding: '2px 5px', width: 44, textAlign: 'center' as const }}
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--bld-text-3)', cursor: 'pointer', paddingTop: 2 }}>
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

export function RepeatInDesign({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const nodeId = (node as { id?: string }).id ?? '';
  const abp = useBuilderStore(s => s.activeBreakpoint);

  // Cascade map from responsive overrides at non-desktop
  const mapValue = useMemo(() => {
    const base = (node as { map?: unknown }).map;
    if (abp === 'desktop' || !node.responsive) return base;
    let v: unknown = base;
    for (const bp of BREAKPOINT_CASCADE as BreakpointKey[]) {
      const ov = (node.responsive as Record<string, unknown>)[bp] as { map?: unknown } | undefined;
      if (ov && 'map' in ov) v = ov.map;
      if (bp === abp) break;
    }
    return v;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abp, node.responsive, (node as { map?: unknown }).map]);

  // Which breakpoints have map overrides?
  const mapOverrideBps = useMemo(() => {
    if (!node.responsive) return [];
    return (BREAKPOINT_CASCADE as BreakpointKey[]).filter(bp => {
      const ov = (node.responsive as Record<string, unknown>)[bp] as { map?: unknown } | undefined;
      return ov && 'map' in ov;
    });
  }, [node.responsive]);

  const hasMap = !!mapValue && mapValue !== null;
  // Normalise: plain string paths become { formula } so the editor can display/edit them
  const mapFormulaValue: FormulaValue = isBoundValue(mapValue as FormulaValue)
    ? (mapValue as FormulaValue)
    : typeof mapValue === 'string' && mapValue
      ? { formula: mapValue }
      : false;

  const patchMapResponsive = useCallback((value: string | object | null) => {
    if (abp !== 'desktop') {
      const rbp = abp as 'laptop' | 'tablet' | 'mobile';
      if (value === null) store.patchResponsive(nodeId, rbp, 'map', null);
      else store.patchResponsive(nodeId, rbp, 'map', value);
      store._pushHistory();
    } else {
      if (value === null) store.patchMap(nodeId, null);
      else if (typeof value === 'string') store.patchMap(nodeId, value);
      else store.patchNodeField(nodeId, 'map', value);
    }
  }, [abp, nodeId, store]);

  return (
    <>
      {mapOverrideBps.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 12px 0' }}>
          <ResponsiveDot
            cssProp="map"
            overriddenBreakpoints={mapOverrideBps}
            onRemove={bp => { store.removeResponsiveOverride(nodeId, bp as 'laptop'|'tablet'|'mobile', 'map'); store._pushHistory(); }}
            onResetAll={() => { for (const bp of BREAKPOINT_CASCADE as BreakpointKey[]) { store.removeResponsiveOverride(nodeId, bp, 'map'); } store._pushHistory(); }}
          />
        </div>
      )}
      <ToggleBind
        rowLabel="Repeat / List"
        fieldId="repeat-map"
        hint="e.g. store.products, cart.items"
        expectedType="any"
        isOn={hasMap}
        value={mapFormulaValue}
        onToggle={() => patchMapResponsive(hasMap ? null : 'store.items')}
        onChange={v => {
          if (isBoundValue(v)) {
            const raw = v as Record<string, unknown>;
            const f = String(raw.formula ?? raw.js ?? '').trim();
            const isSimplePath = /^[\w$.]+$/.test(f);
            // Preserve js-binding objects as-is; only simplify formula strings
            if (raw.js !== undefined) {
              patchMapResponsive(v as object);
            } else {
              patchMapResponsive(isSimplePath ? f : v as object);
            }
          } else {
            patchMapResponsive(null);
          }
        }}
      />
    </>
  );
}

/** Name input for the node — display label shown in formula editor component picker */
export function NodeNameInDesign({
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
          background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4,
          color: 'var(--bld-text-2)', fontSize: 11, padding: '4px 7px', outline: 'none',
        }}
      />
    </div>
  );
}



// ─── Grid overlay mini-panel ──────────────────────────────────────────────────

export function GridOverlayPanel() {
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

export function PropsTab({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const nodeId = (node as { id?: string }).id ?? '';
  const props = (node.props ?? {}) as Record<string, unknown>;
  const [localProps, setLocalProps] = useState<Record<string, string>>({});
  const isImageNode = node.type === 'Image' || node.type === 'Image';

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
      <div style={{ fontSize: 10, color: 'var(--bld-text-3)', marginBottom: 10, fontStyle: 'italic' }}>
        className and layout props are managed in the Design tab.
      </div>
      {filteredEntries.map(([key, val]) => (
        <div key={key} style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', display: 'block', marginBottom: 2 }}>{key}</span>
          <input
            type="text"
            value={val}
            onChange={e => setLocalProps(prev => ({ ...prev, [key]: e.target.value }))}
            onBlur={() => commitProp(key, localProps[key])}
            onKeyDown={e => { if (e.key === 'Enter') commitProp(key, localProps[key]); }}
            style={{ width: '100%', background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-2)', fontSize: 11, padding: '4px 6px', boxSizing: 'border-box' }}
          />
        </div>
      ))}
      {filteredEntries.length === 0 && (
        <div style={{ color: 'var(--bld-text-disabled)', fontSize: 12 }}>
          No additional props — use the Design tab to adjust layout and style.
        </div>
      )}
    </div>
  );
}

// ─── JSON Tab ─────────────────────────────────────────────────────────────────

export function JsonTab({ node }: { node: SDUINode }) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
      <pre style={{ fontSize: 10, color: '#86efac', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {JSON.stringify(node, null, 2)}
      </pre>
    </div>
  );
}
