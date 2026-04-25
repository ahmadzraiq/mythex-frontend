'use client';

/**
 * Form Field Tracker
 *
 * Single source of truth for all form field registration and value tracking.
 * Consumed by the SDUI renderer — keeps the renderer free of form-specific logic.
 *
 * Public API
 * ----------
 * resolveFieldName(node)                                         – extracts the field name from a node
 * trackFormFieldProps(node, cleanProps, formCtx, parentInputId) – wraps change props for any named field node
 * useFormFieldRegistration(node, formCtx)                       – React hook: registers fields on mount / cleans up on unmount
 * useExternalNodeValueSync(node, formCtx, parentInputId)        – React hook: returns { value?, isChecked? } from variable store for controlled injection
 * useExternalFormSync(node, formCtx, parentInputId, externalValue, externalIsChecked)
 *                                                               – React hook: syncs external variable-store writes back into FormContainer state
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getGlobalVariableStore } from './global-variable-store';
import type { FormContextValue, FieldValidationConfig } from './form-context';
import type { SDUINode } from './types';
import {
  CONTROLLED_COMPONENT_CONFIG,
  DIRECT_WRITE_TYPES,
  BOOL_CONTROLLED_TYPES,
  FORM_REGISTERABLE_TYPES,
  SLOT_REGISTER_TYPES,
  EXT_TEXT_SYNC_TYPES,
  EXT_BOOL_SYNC_TYPES,
  INPUT_FIELD_TYPES,
} from './controlled-component-registry';

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

// ── Change prop wrapping helper ────────────────────────────────────────────────

/**
 * Wraps every standard change-event prop on `cleanProps` so that `writer` is
 * called with the extracted value on each change, then the original handler runs.
 * Replaces three previously duplicated CHANGE_PROP_EXTRACTORS loop blocks.
 */
function wrapChangeProps(
  cleanProps: Record<string, unknown>,
  writer: (value: unknown) => void,
): void {
  for (const { prop, extract } of CHANGE_PROP_EXTRACTORS) {
    const existing = cleanProps[prop] as ((...args: unknown[]) => void) | undefined;
    cleanProps[prop] = (...args: unknown[]) => {
      writer(extract(args[0]));
      existing?.(...args);
    };
  }
}

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
 *   - TextareaInput, Select, …
 *
 * Also converts `readOnly={true}` → `editable={false}` for InputField nodes
 * (React Native TextInput requires `editable` while HTML inputs use `readOnly`).
 *
 * Every controlled component (standalone OR inside a FormContainer) writes to
 * `variables.{id}-value` so formula bindings resolve live in both the builder
 * preview and published pages. Inside a FormContainer, the fall-through path
 * also writes to `local.data.form.formData.{name}` via `directWriteField`.
 * `FormContainer` is excluded as the source of FormContext, never a tracked field.
 *
 * Which type falls through to FormContainer tracking:
 *   - InputField (usesParentId): writes parentId-value, then falls through when formCtx present
 *   - Direct-write types (Checkbox, Select, etc.): writes nodeId-value, then falls through when formCtx present
 *   - Input wrapper (skipExternalSync): writes nodeId-value, returns early — its InputField child
 *     handles FormContainer tracking independently
 */
export function trackFormFieldProps(
  node: SDUINode,
  cleanProps: Record<string, unknown>,
  formCtx: FormContextValue | null,
  parentInputId?: string | null,
): void {
  const nodeType = node.type as string;
  const cfg = CONTROLLED_COMPONENT_CONFIG[nodeType];
  const store = getGlobalVariableStore().getState();

  // Convert readOnly → editable for InputField regardless of FormContainer context
  // (React Native TextInput uses `editable={false}` for read-only, not `readOnly`).
  if (INPUT_FIELD_TYPES.has(nodeType) && cleanProps.readOnly === true) {
    cleanProps.editable = false;
    delete cleanProps.readOnly;
  }

  // InputField inside an Input parent node:
  // Always write to `{parentInputId}-value` so formulas like `variables['input-uuid-value']`
  // update live regardless of whether the Input is inside a FormContainer or not.
  // The parent Input's ID is threaded down via InputParentContext → useParentInputId() in renderer.
  // When also inside a FormContainer, fall through so FormContainer tracking also runs.
  if (INPUT_FIELD_TYPES.has(nodeType) && parentInputId) {
    const id = parentInputId;
    wrapChangeProps(cleanProps, (val) => store.set(`${id}-value`, val));
    if (!formCtx) return; // outside FormContainer: only this write needed
    // inside FormContainer: fall through to write local.data.form.formData.{name}
  }

  // Direct-write controlled components: Checkbox, Switch, RadioGroup, Select, TextareaInput,
  // Slider — all have writesOwnId:true and skipExternalSync:undefined.
  // Write variables['{nodeId}-value'] on every change. Inside a FormContainer, fall through
  // so FormContainer tracking also runs.
  // Input wrapper is excluded via skipExternalSync:true (handled separately below).
  if (DIRECT_WRITE_TYPES.has(nodeType) && !cfg?.skipExternalSync && node.id) {
    const id = node.id;
    wrapChangeProps(cleanProps, (val) => store.set(`${id}-value`, val));
    if (!formCtx) return; // outside FormContainer: done
    // inside FormContainer: fall through to write local.data.form.formData.{name}
  }

  // Input wrapper (skipExternalSync=true) — covers the no-explicit-children case where
  // InputWithField auto-injects an InputField that reads onChange/onChangeText from the
  // wrapper's props. Returns early — no FormContainer tracking (the InputField child handles that).
  if (cfg?.skipExternalSync && node.id) {
    const id = node.id;
    wrapChangeProps(cleanProps, (val) => store.set(`${id}-value`, val));
    return;
  }

  // FormContainer field tracking — only applies inside a FormContainer
  if (!formCtx || nodeType === 'FormContainer') return;

  const name = resolveFieldName(node);
  if (!name) return;

  const ctx = formCtx;
  wrapChangeProps(cleanProps, (val) => {
    // Single atomic write: updates both local.data.form.formData.{name} AND
    // variables['{formStoreKey}'].formData.{name} without a React re-render cycle.
    // Zero-latency fast path — one store write, one subscription trigger,
    // one re-render pass for all bound nodes.
    ctx.directWriteField(name, val);
  });
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
  parentInputId?: string | null,
): void {
  useEffect(() => {
    if (formCtx) {
      let cleanup: (() => void) | undefined;

      // Register {parentInputId}-value slot with FormContainer so reset() can clear it.
      if (INPUT_FIELD_TYPES.has(node.type as string) && parentInputId) {
        const slotKey = `${parentInputId}-value`;
        formCtx.registerFieldSlot(slotKey);
        const prev = cleanup;
        cleanup = () => { prev?.(); formCtx.unregisterFieldSlot(slotKey); };
      }

      // Auto-register named variable bindings: if the InputField has
      // value="{{variables['UUID']}}" in its props, register the UUID so reset() can
      // reset that variable back to its initial value — making resetForm self-sufficient.
      if (INPUT_FIELD_TYPES.has(node.type as string)) {
        const valueProp = (node.props as Record<string, unknown> | undefined)?.value;
        if (typeof valueProp === 'string') {
          const match = valueProp.match(/\{\{variables\['([^']+)'\]\}\}/);
          if (match) {
            const uuid = match[1];
            formCtx.registerVariableBinding(uuid, '');
            const prev = cleanup;
            cleanup = () => { prev?.(); formCtx.unregisterVariableBinding(uuid); };
          }
        }
      }

      // ── Validation registration ───────────────────────────────────────────
      // Use resolveFieldName so that name in node.props.name is found too
      const nodeName      = resolveFieldName(node);
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
      const fieldName = resolveFieldName(node);
      if (fieldName && FORM_REGISTERABLE_TYPES.has(node.type as string)) {
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
      // Store at TOP LEVEL of the variable store as `{nodeId}-value`.
      // finalizeMergedWithVariableStore sets merged.variables = vs (entire store data),
      // so a top-level key `data['uuid-value']` is reachable as `variables['uuid-value']` in formulas.
      // InputField nodes use skipOwnSlot=true — their slot is owned by the parent Input node.
      if (SLOT_REGISTER_TYPES.has(node.type as string) && node.id) {
        const nodeId = node.id;
        const nodePropsObj = (node.props as Record<string, unknown> | undefined) ?? {};
        const initForForm = BOOL_CONTROLLED_TYPES.has(node.type as string)
          ? (nodePropsObj.isChecked ?? false) : '';
        getGlobalVariableStore().getState().set(`${nodeId}-value`, initForForm);
        const prev = cleanup;
        cleanup = () => {
          prev?.();
          getGlobalVariableStore().getState().setState((s) => {
            const next = { ...s };
            delete next[`${nodeId}-value`];
            return next;
          });
        };
      }

      return cleanup;
    }

    // ── Per-node variable registration (outside FormContainer) ───────────
    // Store at TOP LEVEL of the variable store as `{nodeId}-value`.
    // finalizeMergedWithVariableStore sets merged.variables = vs (entire store data),
    // so a top-level key `data['uuid-value']` is reachable as `variables['uuid-value']` in formulas.
    // Covers all directly controlled component types. InputField uses skipOwnSlot=true —
    // its store slot is owned by the parent Input node, not itself.
    if (SLOT_REGISTER_TYPES.has(node.type as string) && node.id) {
      const nodeId = node.id;
      const propsObj = (node.props as Record<string, unknown> | undefined) ?? {};
      // For Checkbox/Switch: use isChecked (boolean state), NOT `value` (form-submission string).
      // For text inputs: use empty string.
      const initVal = BOOL_CONTROLLED_TYPES.has(node.type as string)
        ? (propsObj.isChecked ?? false)
        : '';
      getGlobalVariableStore().getState().set(`${nodeId}-value`, initVal);
      return () => {
        getGlobalVariableStore().getState().setState((prev) => {
          const next = { ...prev };
          delete next[`${nodeId}-value`];
          return next;
        });
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.actions, node.id, node.type, parentInputId, formCtx?.registerField, formCtx?.unregisterField, formCtx?.registerFieldSlot, formCtx?.unregisterFieldSlot, formCtx?.registerFieldValidation, formCtx?.unregisterFieldValidation]);
}

// ── External value sync ────────────────────────────────────────────────────────

// EXT_TEXT_SYNC_TYPES and EXT_BOOL_SYNC_TYPES are derived from controlled-component-registry.
// They determine which component types subscribe to external variable-store writes so the
// React-controlled value prop reflects workflow-driven changes (e.g. "Change variable value").
// InputField is excluded from EXT_TEXT_SYNC_TYPES — it uses the parentInputId path below.

const NOOP_SUBSCRIBE = (_cb: () => void) => () => {};

// Per-key subscribe cache — each entry subscribes ONLY to changes for that specific
// store key using Zustand's subscribeWithSelector. This means when any variable-store
// key changes (e.g. a user typing in Input2), only the subscriber for that exact key
// fires — not all N subscribed components across the page. Without this, a single
// keystroke would invoke every useSyncExternalStore snapshot function on the page
// (O(N) per keystroke → 230ms input-handler violations on large pages).
//
// The cache ensures the subscribe function reference is stable across re-renders,
// which is required by useSyncExternalStore to avoid subscribe/unsubscribe churn.
const KEY_SUB_CACHE = new Map<string, (cb: () => void) => () => void>();

function getKeySubscribe(key: string): (cb: () => void) => () => void {
  let fn = KEY_SUB_CACHE.get(key);
  if (!fn) {
    fn = (cb: () => void) =>
      getGlobalVariableStore().subscribe(
        (state) => (state as { data: Record<string, unknown> }).data[key],
        () => cb(),
      );
    KEY_SUB_CACHE.set(key, fn);
  }
  return fn;
}

// Subscribe to nested form field value: local.data.form.formData.{fieldName}
// Watches the top-level 'local' slice for any form data change.
const FORM_FIELD_SUB_CACHE = new Map<string, (cb: () => void) => () => void>();

function getFormFieldSubscribe(fieldName: string): (cb: () => void) => () => void {
  let fn = FORM_FIELD_SUB_CACHE.get(fieldName);
  if (!fn) {
    fn = (cb: () => void) =>
      getGlobalVariableStore().subscribe(
        (state) => {
          const d = (state as { data: Record<string, unknown> }).data;
          const local = d['local'] as Record<string, unknown> | undefined;
          const data = local?.['data'] as Record<string, unknown> | undefined;
          const form = data?.['form'] as Record<string, unknown> | undefined;
          const fd = form?.['formData'] as Record<string, unknown> | undefined;
          return fd?.[fieldName];
        },
        () => cb(),
      );
    FORM_FIELD_SUB_CACHE.set(fieldName, fn);
  }
  return fn;
}

function getFormFieldSnapshot(fieldName: string): string {
  const d = getGlobalVariableStore().getState().getFullState();
  const local = d['local'] as Record<string, unknown> | undefined;
  const data = local?.['data'] as Record<string, unknown> | undefined;
  const form = data?.['form'] as Record<string, unknown> | undefined;
  const fd = form?.['formData'] as Record<string, unknown> | undefined;
  return (fd?.[fieldName] as string | undefined) ?? '';
}

/**
 * React hook — subscribes to `{nodeId}-value` in the global variable store and
 * returns it as a controlled React prop (`value` for text, `isChecked` for booleans).
 *
 * Active for ALL controlled components, including those inside a FormContainer, so
 * that external workflow writes (e.g. `changeVariableValue`) update the displayed
 * value for every type — not just standalone components.
 *
 * Both text and boolean types use `useSyncExternalStore` — pure React, no DOM
 * manipulation, no querySelector. The snapshot is a single O(1) hash-map read
 * per component per store update, making per-keystroke cost negligible.
 *
 * Text inputs (TextareaInput, RadioGroup, Select, etc.):
 *   Defaults to '' so the input is controlled from first render (avoids the
 *   React "uncontrolled → controlled" warning). React 18 automatic batching
 *   ensures the controlled re-render happens within the same event handler update
 *   as the user's keystroke — cursor position is preserved.
 *
 * Boolean inputs (Checkbox, Switch):
 *   Reads the stored boolean and returns it as `isChecked`.
 *
 * InputField inside an Input wrapper:
 *   The variable is always keyed by the PARENT Input node's ID (not InputField's own ID)
 *   because that's what trackFormFieldProps writes to. When the Input node has explicit
 *   InputField children (the standard builder structure), the `value` injected on the
 *   Input wrapper is ignored by InputWithField. Instead, we inject `value` directly
 *   on the InputField node using the parent Input's ID as the lookup key.
 *   parentInputId is provided by useParentInputId() in the renderer.
 */
export function useExternalNodeValueSync(
  node: SDUINode,
  formCtx: FormContextValue | null,
  parentInputId?: string | null,
): { value?: string; isChecked?: boolean } {
  const nodeType = node.type as string;
  const isBool = EXT_BOOL_SYNC_TYPES.has(nodeType);
  const isText = EXT_TEXT_SYNC_TYPES.has(nodeType);
  // InputField nodes use the parent Input's ID as the key (written by trackFormFieldProps)
  const isInputFieldNode = INPUT_FIELD_TYPES.has(nodeType);

  // Active for all controlled types including those inside FormContainer — external workflow
  // writes (changeVariableValue) must update the displayed value for Checkbox, Switch, etc.
  // just as they do for InputField. The previous !formCtx guard blocked this.
  const active = !!node.id && (isBool || isText);
  // InputField uses the parent Input's ID as the store key
  const inputFieldActive = isInputFieldNode && !!parentInputId;

  // Fallback: InputField inside FormContainer without a parentInputId.
  // Subscribe to local.data.form.formData.{fieldName} so reset/prefill works
  // even when the Input wrapper has no id (and therefore parentInputId is null).
  const fieldName = isInputFieldNode && !parentInputId && !!formCtx ? resolveFieldName(node) : undefined;
  const isFormFieldFallback = !!fieldName;

  const shouldSubscribeStandard = active || inputFieldActive;
  const storeKey = inputFieldActive ? `${parentInputId}-value` : `${node.id}-value`;

  const storedValueStandard = useSyncExternalStore(
    shouldSubscribeStandard ? getKeySubscribe(storeKey) : NOOP_SUBSCRIBE,
    () => {
      if (!shouldSubscribeStandard) return undefined;
      const val = getGlobalVariableStore().getState().getFullState()[storeKey];
      if (isText || inputFieldActive) return (val as string | undefined) ?? '';
      if (isBool) return val as boolean | undefined;
      return undefined;
    },
    () => ((active && isText) || inputFieldActive ? '' : undefined),
  );

  // Separate subscription for form field fallback (nested path, different subscriber)
  const storedValueFallback = useSyncExternalStore(
    isFormFieldFallback ? getFormFieldSubscribe(fieldName!) : NOOP_SUBSCRIBE,
    () => isFormFieldFallback ? getFormFieldSnapshot(fieldName!) : undefined,
    () => isFormFieldFallback ? '' : undefined,
  );

  if (shouldSubscribeStandard) {
    if (storedValueStandard === undefined) return {};
    if (isText || inputFieldActive) return { value: storedValueStandard as string };
    if (isBool) return { isChecked: storedValueStandard as boolean };
    return {};
  }
  if (isFormFieldFallback) {
    return { value: storedValueFallback as string ?? '' };
  }
  return {};
}

// ── FormContainer external value sync ─────────────────────────────────────────

/**
 * React hook — syncs externally-written variable-store values back into the
 * nearest FormContainer for ALL controlled component types.
 *
 * Without this, a workflow step (e.g. `changeVariableValue`) that writes to a
 * component's variable slot would update the displayed DOM value (via
 * useExternalNodeValueSync + the injected value prop) but would NOT update
 * `local.data.form.formData.{fieldName}` — so form submission and any formula
 * reading from the FormContainer's state would still see the old value.
 *
 * Covers:
 *   - InputField (text): syncs when parentInputId present and value changes
 *   - Direct-write types (Checkbox, Switch, RadioGroup, Select, etc.): syncs when
 *     inside FormContainer and value/isChecked changes
 *
 * The `prevRef` guard skips the initial mount so we do NOT overwrite any
 * `initialFormData` values that FormContainer was given on construction.
 */
export function useExternalFormSync(
  node: SDUINode,
  formCtx: FormContextValue | null,
  parentInputId: string | null | undefined,
  externalValue: string | undefined,
  externalIsChecked: boolean | undefined,
): void {
  const fieldName = resolveFieldName(node);
  const nodeType = node.type as string;
  const cfg = CONTROLLED_COMPONENT_CONFIG[nodeType];
  const isInputFieldNode = INPUT_FIELD_TYPES.has(nodeType);
  // Direct-write types (Checkbox, Switch, etc.) but NOT the Input wrapper (skipExternalSync)
  const isDirectControlled = DIRECT_WRITE_TYPES.has(nodeType) && !cfg?.skipExternalSync;

  const shouldSync = !!(
    formCtx && fieldName && (
      (isInputFieldNode && !!parentInputId) ||
      isDirectControlled
    )
  );

  // Track the last-synced value so the initial mount is skipped — prevents
  // overwriting FormContainer's initialFormData with the store's default empty value.
  // Initialized to the current value so first render is always a no-op.
  const prevRef = useRef<unknown>(isInputFieldNode ? externalValue : externalIsChecked);

  useEffect(() => {
    if (!shouldSync || !formCtx || !fieldName) return;
    const currentVal = isInputFieldNode ? externalValue : externalIsChecked;
    if (prevRef.current === currentVal) return; // skip initial mount
    prevRef.current = currentVal;
    if (currentVal !== undefined) {
      formCtx.directWriteField(fieldName, currentVal);
    }
  }, [externalValue, externalIsChecked, shouldSync, formCtx, fieldName, isInputFieldNode]);

  // Watch the named variable UUID directly so that changeVariableValue workflow steps
  // (pre-fill, external updates) also write through to local.data.form.formData.
  // The {parentInputId}-value registry path (tracked by shouldSync above) is only
  // updated when the user types — external variable changes bypass it entirely.
  // This second subscription catches those external writes.
  const namedVarUuid = (() => {
    if (!formCtx || !fieldName || !isInputFieldNode) return null;
    const valueProp = (node.props as Record<string, unknown> | undefined)?.value;
    if (typeof valueProp !== 'string') return null;
    const match = valueProp.match(/\{\{variables\['([^']+)'\]\}\}/);
    return match?.[1] ?? null;
  })();

  const namedVarValue = useSyncExternalStore(
    namedVarUuid ? getKeySubscribe(namedVarUuid) : NOOP_SUBSCRIBE,
    () => {
      if (!namedVarUuid) return undefined;
      const val = getGlobalVariableStore().getState().getFullState()[namedVarUuid];
      return val as string | undefined;
    },
    () => undefined,
  );

  const prevNamedVarRef = useRef<unknown>(namedVarValue);

  useEffect(() => {
    if (!formCtx || !fieldName || !namedVarUuid) return;
    if (namedVarValue === prevNamedVarRef.current) return; // skip initial mount
    prevNamedVarRef.current = namedVarValue;
    // Sync the new variable value into the form data so doSubmit reads it correctly.
    formCtx.directWriteField(fieldName, namedVarValue ?? '');
  }, [namedVarValue, formCtx, fieldName, namedVarUuid]);
}
