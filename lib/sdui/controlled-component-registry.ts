/**
 * Controlled Component Registry — single source of truth for all component type classifications.
 *
 * Covers only the SDUI node types that appear in the component registry (component-registry.tsx).
 * Adding a new controlled component type only requires a single edit here.
 *
 * valueType        — the kind of value the component holds ('text' | 'boolean' | 'number')
 * writesOwnId      — true when trackFormFieldProps writes to `{nodeId}-value` directly
 * isInputField     — reserved; currently unused (no inner-field SDUI types exist)
 * skipOwnSlot      — true when the type should NOT register its own `{nodeId}-value` store slot
 * skipExternalSync — true for wrapper types (Input, Textarea): the inner component injected by
 *                    InputWithField / TextareaWithInput is the actual text control.
 *                    Do NOT inject a `value` prop via useExternalNodeValueSync on the wrapper —
 *                    it is a no-op and wastes a subscription. The wrapper writes `{id}-value` on
 *                    change and calls directWriteField when inside a FormContainer.
 * formRegisterable — true when the component should be registered in a FormContainer's formData.
 *                    Wrapper types (Input, Textarea) use false because Strategy C in
 *                    useFormFieldRegistration handles their registration via PARENT_CONTEXT_PROVIDER_TYPES.
 */
export type ControlledComponentConfig = {
  valueType: 'text' | 'boolean' | 'number';
  writesOwnId: boolean;
  isInputField: boolean;
  skipOwnSlot: boolean;
  skipExternalSync?: boolean;
  formRegisterable: boolean;
};

export const CONTROLLED_COMPONENT_CONFIG: Record<string, ControlledComponentConfig> = {
  // Text input wrappers — auto-inject their inner field component (InputWithField / TextareaWithInput)
  Input:    { valueType: 'text', writesOwnId: true, isInputField: false, skipOwnSlot: false, skipExternalSync: true, formRegisterable: false },
  Textarea: { valueType: 'text', writesOwnId: true, isInputField: false, skipOwnSlot: false, skipExternalSync: true, formRegisterable: false },
};

/** All registered controlled component type names */
export const CONTROLLED_TYPES = new Set(Object.keys(CONTROLLED_COMPONENT_CONFIG));

/** Types that write to their own `{nodeId}-value` store slot directly */
export const DIRECT_WRITE_TYPES = new Set(
  Object.entries(CONTROLLED_COMPONENT_CONFIG)
    .filter(([, c]) => c.writesOwnId)
    .map(([k]) => k)
);

/** Types that are boolean-valued (e.g. Checkbox, Switch — add here when introduced) */
export const BOOL_CONTROLLED_TYPES = new Set(
  Object.entries(CONTROLLED_COMPONENT_CONFIG)
    .filter(([, c]) => c.valueType === 'boolean')
    .map(([k]) => k)
);

/** Types that are text-valued and sync an external value prop (for useSyncExternalStore).
 *  Wrapper types (skipExternalSync=true) are excluded — their inner control handles sync. */
export const EXT_TEXT_SYNC_TYPES = new Set(
  Object.entries(CONTROLLED_COMPONENT_CONFIG)
    .filter(([, c]) => c.writesOwnId && c.valueType === 'text' && !c.skipExternalSync)
    .map(([k]) => k)
);

/** Types that are boolean-valued and sync an external isChecked prop */
export const EXT_BOOL_SYNC_TYPES = new Set(
  Object.entries(CONTROLLED_COMPONENT_CONFIG)
    .filter(([, c]) => c.writesOwnId && c.valueType === 'boolean')
    .map(([k]) => k)
);

/** Types that should be registered in a FormContainer's formData via Strategy B.
 *  Wrapper types (Input, Textarea) are registered via Strategy C instead. */
export const FORM_REGISTERABLE_TYPES = new Set(
  Object.entries(CONTROLLED_COMPONENT_CONFIG)
    .filter(([, c]) => c.formRegisterable)
    .map(([k]) => k)
);

/** Types that should register `{nodeId}-value` in the standalone path (skipOwnSlot=false) */
export const SLOT_REGISTER_TYPES = new Set(
  Object.entries(CONTROLLED_COMPONENT_CONFIG)
    .filter(([, c]) => !c.skipOwnSlot)
    .map(([k]) => k)
);

/** Types for which the builder shows a standalone variables['{id}-value'] chip */
export const STANDALONE_VARIABLE_TYPES = new Set(
  Object.entries(CONTROLLED_COMPONENT_CONFIG)
    .filter(([, c]) => c.writesOwnId)
    .map(([k]) => k)
);

/** Types that are form-registerable AND builder should show as form input fields */
export const BUILDER_FORM_INPUT_TYPES = new Set([
  ...FORM_REGISTERABLE_TYPES,
  'Input',
  'Textarea',
]);

/** Types that are inner-field variants (store key is the parent wrapper's ID, not own ID).
 *  Currently empty — no inner-field SDUI types exist (they are React-only, not SDUI nodes). */
export const INPUT_FIELD_TYPES = new Set(
  Object.entries(CONTROLLED_COMPONENT_CONFIG)
    .filter(([, c]) => c.isInputField)
    .map(([k]) => k)
);

/** Types that need browser autofill suppression in builder mode */
export const AUTOFILL_SUPPRESS_TYPES = new Set(['Input', 'Textarea']);

/** Types that wrap an inner React field component and should skip external value sync on the wrapper.
 *  These types also register with FormContainer via Strategy C in useFormFieldRegistration. */
export const PARENT_CONTEXT_PROVIDER_TYPES = new Set(
  Object.entries(CONTROLLED_COMPONENT_CONFIG)
    .filter(([, c]) => c.skipExternalSync)
    .map(([k]) => k)
);
