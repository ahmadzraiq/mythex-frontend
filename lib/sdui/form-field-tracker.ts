'use client';

/**
 * Form Field Tracker
 *
 * Single source of truth for all form field registration and value tracking.
 * Consumed by the SDUI renderer — keeps the renderer free of form-specific logic.
 *
 * Public API
 * ----------
 * resolveFieldName(node)                       – extracts the field name from a node
 * writeFormFieldToStore(fieldName, value)       – writes directly to the global variable store
 * trackFormFieldProps(node, cleanProps, formCtx) – wraps change props for any named field node
 * useFormFieldRegistration(node, formCtx)       – React hook: registers fields on mount / cleans up on unmount
 */

import { useEffect } from 'react';
import { getGlobalVariableStore } from './global-variable-store';
import type { FormContextValue, FieldValidationConfig } from './form-context';
import type { SDUINode } from './types';

// ── Field name resolution ──────────────────────────────────────────────────────

/**
 * Returns the field name for a node, checking two locations in priority order:
 *  1. `node.name` — root-level metadata key used by InputField nodes in most screens
 *  2. `node.props.name` — props-level key used by Checkbox, Switch, RadioGroup, etc.
 */
export function resolveFieldName(node: SDUINode): string | undefined {
  const rootName  = (node as { name?: unknown }).name;
  const propsName = (node.props as Record<string, unknown> | undefined)?.name;
  const name      = rootName ?? propsName;
  return typeof name === 'string' && name ? name : undefined;
}

// ── Store write ────────────────────────────────────────────────────────────────

/**
 * Write a single form field value directly to the global variable store at
 * `local.data.form.formData.{fieldName}`.
 *
 * Writing directly (not through FormContext React state) is critical for text
 * inputs: it avoids triggering a full FormContainer subtree re-render, which
 * would cause the focused input to lose its cursor position.
 *
 * The SDUI engine re-renders only the specific node(s) subscribed to this path,
 * and React DOM updates a controlled <input>'s value attribute in-place without
 * removing focus.
 */
export function writeFormFieldToStore(fieldName: string, value: unknown): void {
  getGlobalVariableStore().getState().setState((prev) => {
    const local = (prev['local'] as Record<string, unknown> | undefined) ?? {};
    const data  = (local['data']  as Record<string, unknown> | undefined) ?? {};
    const form  = (data['form']   as Record<string, unknown> | undefined) ??
      { formData: {}, fields: {}, isSubmitting: false, isSubmitted: false, isValid: true };
    const formData = {
      ...(form['formData'] as Record<string, unknown> | undefined) ?? {},
      [fieldName]: value,
    };
    return { ...prev, local: { ...local, data: { ...data, form: { ...form, formData } } } };
  });
}

// ── Change prop extraction config ──────────────────────────────────────────────

/**
 * Maps each standard change-event prop name to an extractor that converts the
 * raw event argument to the plain value written into formData:
 *   - onValueChange / onToggle / onChangeText → value arrives directly as first arg
 *   - onChange → may be a primitive (Checkbox boolean, Slider number, RadioGroup
 *     string) or a synthetic React ChangeEvent (InputField, TextareaInput on web)
 */
const CHANGE_PROP_EXTRACTORS: Array<{ prop: string; extract: (v: unknown) => unknown }> = [
  { prop: 'onValueChange', extract: (v) => v },
  { prop: 'onToggle',      extract: (v) => v },
  { prop: 'onChangeText',  extract: (v) => v },
  {
    prop: 'onChange',
    extract: (e) =>
      typeof e === 'boolean' || typeof e === 'number' || typeof e === 'string'
        ? e
        : (e as React.ChangeEvent<HTMLInputElement>)?.target?.value ?? e,
  },
];

// ── Prop tracking ──────────────────────────────────────────────────────────────

/**
 * For every named node inside a FormContainer, wraps all standard change-event
 * props so that the value is written to `local.data.form.formData` in the global
 * variable store on every change.
 *
 * Handles ALL controlled component types generically:
 *   - Text inputs   (InputField) — `onChange` / `onChangeText`
 *   - Checkbox      — `onChange(isChecked: boolean)`
 *   - Switch        — `onValueChange(value: boolean)` / `onToggle(value: boolean)`
 *   - RadioGroup    — `onChange(value: string)`
 *   - Slider        — `onChange(value: number)`
 *   - TextareaInput, Select, DatePicker, ColorPicker, …
 *
 * Also converts `readOnly={true}` → `editable={false}` for InputField nodes
 * (React Native TextInput requires `editable` while HTML inputs use `readOnly`).
 *
 * Every `Input` node (standalone OR inside a FormContainer) writes to
 * `variables.{id}-value` so formula bindings like `variables['{id}-value']`
 * resolve live in both the builder preview and published pages.
 * `Input` inside a FormContainer is also independently handled — its InputField
 * child continues to write to `local.data.form.formData.{name}` unchanged.
 * `FormContainer` is excluded as the source of FormContext, never a tracked field.
 */
export function trackFormFieldProps(
  node: SDUINode,
  cleanProps: Record<string, unknown>,
  formCtx: FormContextValue | null,
  parentInputId?: string | null,
): void {
  // Convert readOnly → editable for InputField regardless of FormContainer context
  if ((node.type as string) === 'InputField' && cleanProps.readOnly === true) {
    cleanProps.editable = false;
    delete cleanProps.readOnly;
  }

  // InputField inside an Input parent node:
  // Always write to `{parentInputId}-value` so formulas like `variables['input-uuid-value']`
  // update live regardless of whether the Input is inside a FormContainer or not.
  // The parent Input's ID is threaded down via InputParentContext → useParentInputId() in renderer.
  // When also inside a FormContainer, we do NOT return early — the code falls through so that
  // FormContainer tracking (local.data.form.formData.{name}) also runs, composing both writes.
  if ((node.type as string) === 'InputField' && parentInputId) {
    const id = parentInputId;
    for (const { prop, extract } of CHANGE_PROP_EXTRACTORS) {
      const existing = cleanProps[prop] as ((...args: unknown[]) => void) | undefined;
      cleanProps[prop] = (...args: unknown[]) => {
        getGlobalVariableStore().getState().set(`${id}`, extract(args[0]));
        existing?.(...args);
      };
    }
    if (!formCtx) return; // outside FormContainer: only this write needed, done
    // inside FormContainer: fall through to also write to local.data.form.formData.{name}
  }

  // Direct controlled components: Checkbox, Switch, RadioGroup, Select, TextareaInput, Slider.
  // Write variables['uuid'] on every change event, regardless of FormContainer context.
  // When inside a FormContainer, fall through so FormContainer tracking also runs.
  const DIRECT_CONTROLLED = new Set(['Checkbox', 'Switch', 'RadioGroup', 'Select', 'Slider', 'TextareaInput']);
  if (DIRECT_CONTROLLED.has(node.type as string) && node.id) {
    const id = node.id;
    for (const { prop, extract } of CHANGE_PROP_EXTRACTORS) {
      const existing = cleanProps[prop] as ((...args: unknown[]) => void) | undefined;
      cleanProps[prop] = (...args: unknown[]) => {
        getGlobalVariableStore().getState().set(`${id}`, extract(args[0]));
        existing?.(...args);
      };
    }
    if (!formCtx) return; // outside FormContainer: done
    // inside FormContainer: fall through to also write to local.data.form.formData.{name}
  }

  // Standalone Input nodes — wrap change props on the Input wrapper itself.
  // This covers the case where Input has NO explicit children: InputWithField
  // auto-injects an InputField React element that receives onChange/onChangeText
  // directly from the wrapper's props. The context approach above handles the
  // explicit-children case; this handles the no-children fallback.
  if ((node.type as string) === 'Input' && node.id) {
    const id = node.id;
    for (const { prop, extract } of CHANGE_PROP_EXTRACTORS) {
      const existing = cleanProps[prop] as ((...args: unknown[]) => void) | undefined;
      cleanProps[prop] = (...args: unknown[]) => {
        getGlobalVariableStore().getState().set(`${id}`, extract(args[0]));
        existing?.(...args);
      };
    }
    return;
  }

  // Value tracking only applies inside a FormContainer
  if (!formCtx || (node.type as string) === 'FormContainer') return;

  const name = resolveFieldName(node);
  if (!name) return;

  const ctx = formCtx;
  for (const { prop, extract } of CHANGE_PROP_EXTRACTORS) {
    const existing = cleanProps[prop] as ((...args: unknown[]) => void) | undefined;
    cleanProps[prop] = (...args: unknown[]) => {
      const val = extract(args[0]);
      // Write to the flat global-store path (keeps controlled inputs responsive).
      writeFormFieldToStore(name, val);
      // Also update FormContainer React state so variables['{id}-form']?.['formData']
      // picks up the new value on every keystroke.
      ctx.setField(name, val);
      existing?.(...args);
    };
  }
}

// ── Field registration hook ────────────────────────────────────────────────────

/** Checks whether a node's actions contain a `setFormField` step (directly or
 *  inside a runMultiple block). Used by the registration hook to detect the
 *  legacy explicit-action pattern so Strategy B skips the duplicate. */
function hasSetFormFieldAction(actions: unknown): boolean {
  const check = (a: unknown): boolean => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
    const obj = a as Record<string, unknown>;
    if (obj.type === 'setFormField') return true;
    if (obj.type === 'runMultiple' && Array.isArray(obj.actions))
      return (obj.actions as unknown[]).some(check);
    return false;
  };
  if (!actions || typeof actions !== 'object') return false;
  return Object.values(actions as Record<string, unknown>).some(check);
}

/**
 * React hook — registers form fields in the nearest FormContainer on mount
 * and cleans up on unmount.  Encapsulates all field registration logic so the
 * renderer only needs a single call-site.
 *
 * Registration strategies (both run, deduplication is guard-checked):
 *
 *   Strategy A — legacy explicit `setFormField` action on the node:
 *     Finds the field name declared in the action config and registers it.
 *     Kept for backward compatibility with existing JSON that wires setFormField.
 *
 *   Strategy B — `name`-based registration (all other controlled components):
 *     Uses `resolveFieldName(node)` (checks node.name then node.props.name).
 *     Skips if Strategy A already registered the same field.
 *     Picks the best available initial value from _initialValue, value, defaultValue,
 *     or isChecked props so Checkbox / Switch initialise with the right state.
 *
 * Standalone path (no FormContainer):
 *   Registers named standalone InputField / TextareaInput / Checkbox components
 *   at `components.{id}.value` so the formula editor shows live data.
 */
export function useFormFieldRegistration(
  node: SDUINode,
  formCtx: FormContextValue | null,
): void {
  useEffect(() => {
    if (formCtx) {
      let cleanup: (() => void) | undefined;

      // ── Validation registration ───────────────────────────────────────────
      const nodeName      = (node as { name?: string }).name;
      const nodeValidation = (node as { _validation?: unknown })._validation as FieldValidationConfig | undefined;
      if (nodeName && nodeValidation?.rules?.length) {
        formCtx.registerFieldValidation(nodeName, nodeValidation);
        const prev = cleanup;
        cleanup = () => { prev?.(); formCtx.unregisterFieldValidation(nodeName); };
      }

      // ── Strategy A: legacy setFormField action ────────────────────────────
      // Find the field name declared inside a setFormField step and register it.
      const actions = node.actions;
      if (actions) {
        const findSetFormField = (a: unknown): Record<string, unknown> | null => {
          if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
          const obj = a as Record<string, unknown>;
          if (obj.type === 'setFormField') return obj;
          if (obj.type === 'runMultiple' && Array.isArray(obj.actions)) {
            for (const nested of obj.actions) {
              const found = findSetFormField(nested);
              if (found) return found;
            }
          }
          return null;
        };
        for (const a of Object.values(actions)) {
          const action = findSetFormField(a);
          if (action) {
            const fieldName = action.field;
            if (typeof fieldName === 'string' && fieldName) {
              const initialValue = node._initialValue ?? '';
              formCtx.registerField(fieldName, initialValue);
              const prev = cleanup;
              cleanup = () => { prev?.(); formCtx.unregisterField(fieldName); };
              break;
            }
          }
        }
      }

      // ── Strategy B: name-based registration ──────────────────────────────
      // Handles InputField (name at root), Checkbox, Switch, RadioGroup, etc.
      // Only actual form-input component types are registered — action nodes like
      // Button and ButtonText are excluded even when they carry a `name` prop.
      const FORM_INPUT_TYPES = new Set([
        'InputField', 'TextareaInput', 'Checkbox', 'Switch', 'RadioGroup',
        'Slider', 'Select', 'DatePicker', 'ColorPicker',
      ]);
      const fieldName = resolveFieldName(node);
      if (fieldName && FORM_INPUT_TYPES.has(node.type as string)) {
        // Skip if Strategy A already registered this field
        if (!hasSetFormFieldAction(actions)) {
          const propsObj = (node.props as Record<string, unknown> | undefined) ?? {};
          // Skip live-binding template strings (e.g. "{{local.data.form.formData.x}}") —
          // those are runtime bindings, not an initial value. Use '' to avoid storing
          // the raw template string as formData.x, which would show in the Quick tab.
          const rawValue = propsObj.value ?? propsObj.defaultValue ?? propsObj.isChecked ?? '';
          const initialValue =
            node._initialValue ??
            (typeof rawValue === 'string' && rawValue.includes('{{') ? '' : rawValue);
          formCtx.registerField(fieldName, initialValue);
          const prev = cleanup;
          cleanup = () => { prev?.(); formCtx.unregisterField(fieldName); };
        }
      }

      // ── Per-node variable for all controlled types inside FormContainer ─────
      // Store at TOP LEVEL of the variable store as `{nodeId}` (no suffix).
      // finalizeMergedWithVariableStore sets merged.variables = vs (entire store data),
      // so a top-level key `data['uuid']` is reachable as `variables['uuid']` in formulas.
      const CONTROLLED_IN_FORM = new Set([
        'Input', 'InputField', 'TextareaInput',
        'Checkbox', 'Switch', 'RadioGroup', 'Select', 'Slider',
      ]);
      if (CONTROLLED_IN_FORM.has(node.type as string) && node.id) {
        const nodeId = node.id;
        const BOOL_IN_FORM = new Set(['Checkbox', 'Switch']);
        const nodePropsObj = (node.props as Record<string, unknown> | undefined) ?? {};
        const initForForm = BOOL_IN_FORM.has(node.type as string)
          ? (nodePropsObj.isChecked ?? false) : '';
        getGlobalVariableStore().getState().set(`${nodeId}`, initForForm);
        const prev = cleanup;
        cleanup = () => {
          prev?.();
          getGlobalVariableStore().getState().setState((s) => {
            const next = { ...s };
            delete next[`${nodeId}`];
            return next;
          });
        };
      }

      return cleanup;
    }

    // ── Per-node variable registration (outside FormContainer) ───────────
    // Store at TOP LEVEL of the variable store as `{nodeId}` (no suffix).
    // finalizeMergedWithVariableStore sets merged.variables = vs (entire store data),
    // so a top-level key `data['uuid']` is reachable as `variables['uuid']` in formulas.
    // Covers all directly controlled component types.
    const CONTROLLED_TYPES = new Set([
      'Input', 'InputField', 'TextareaInput',
      'Checkbox', 'Switch', 'RadioGroup', 'Select', 'Slider',
    ]);
    if (CONTROLLED_TYPES.has(node.type as string) && node.id) {
      const nodeId = node.id;
      const BOOL_TYPES = new Set(['Checkbox', 'Switch']);
      const propsObj = (node.props as Record<string, unknown> | undefined) ?? {};
      // For Checkbox/Switch: use isChecked (boolean state), NOT `value` (form-submission string).
      // For text inputs: use empty string.
      const initVal = BOOL_TYPES.has(node.type as string)
        ? (propsObj.isChecked ?? false)
        : '';
      getGlobalVariableStore().getState().set(`${nodeId}`, initVal);
      return () => {
        getGlobalVariableStore().getState().setState((prev) => {
          const next = { ...prev };
          delete next[`${nodeId}`];
          return next;
        });
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.actions, node.id, node.type, formCtx?.registerField, formCtx?.unregisterField, formCtx?.registerFieldValidation, formCtx?.unregisterFieldValidation]);
}
