/**
 * Controlled Component Registry — single source of truth for all component type classifications.
 *
 * Instead of maintaining 6+ hardcoded Sets across form-field-tracker.ts and builder files,
 * every consumer derives its list from this config. Adding a new controlled component type
 * (e.g. DatePicker, ColorPicker) only requires a single edit here.
 *
 * valueType        — the kind of value the component holds ('text' | 'boolean' | 'number')
 * writesOwnId      — true when trackFormFieldProps writes to `{nodeId}-value` directly
 *                    (false for InputField, which writes to `{parentInputId}-value` instead)
 * isInputField     — true only for InputField: store key is the parent Input's ID, not own ID
 * skipOwnSlot      — true for InputField: do NOT register a `{nodeId}-value` store slot because
 *                    trackFormFieldProps never writes to it (always writes to parent's slot instead)
 * skipExternalSync — true for Input: do NOT inject `value` via useExternalNodeValueSync on the
 *                    wrapper node. Input's actual text control is the InputField child, which
 *                    subscribes via parentInputId. Injecting `value` on the wrapper too is a no-op
 *                    (InputWithField ignores it when explicit children are present) and wastes a
 *                    useSyncExternalStore subscription.
 * formRegisterable — true when the component should be registered in a FormContainer's formData
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
  Input:         { valueType: 'text',    writesOwnId: true,  isInputField: false, skipOwnSlot: false, skipExternalSync: true, formRegisterable: false },
  InputField:    { valueType: 'text',    writesOwnId: false, isInputField: true,  skipOwnSlot: true,  formRegisterable: true  },
  TextareaInput: { valueType: 'text',    writesOwnId: true,  isInputField: false, skipOwnSlot: false, formRegisterable: true  },
  Checkbox:      { valueType: 'boolean', writesOwnId: true,  isInputField: false, skipOwnSlot: false, formRegisterable: true  },
  Switch:        { valueType: 'boolean', writesOwnId: true,  isInputField: false, skipOwnSlot: false, formRegisterable: true  },
  RadioGroup:    { valueType: 'text',    writesOwnId: true,  isInputField: false, skipOwnSlot: false, formRegisterable: true  },
  Select:        { valueType: 'text',    writesOwnId: true,  isInputField: false, skipOwnSlot: false, formRegisterable: true  },
  Slider:        { valueType: 'number',  writesOwnId: true,  isInputField: false, skipOwnSlot: false, formRegisterable: true  },
  DatePicker:    { valueType: 'text',    writesOwnId: true,  isInputField: false, skipOwnSlot: false, formRegisterable: true  },
  ColorPicker:   { valueType: 'text',    writesOwnId: true,  isInputField: false, skipOwnSlot: false, formRegisterable: true  },
};

/** All registered controlled component type names */
export const CONTROLLED_TYPES = new Set(Object.keys(CONTROLLED_COMPONENT_CONFIG));

/** Types that write to their own `{nodeId}-value` store slot directly */
export const DIRECT_WRITE_TYPES = new Set(
  Object.entries(CONTROLLED_COMPONENT_CONFIG)
    .filter(([, c]) => c.writesOwnId)
    .map(([k]) => k)
);

/** Types that are boolean-valued (Checkbox, Switch) */
export const BOOL_CONTROLLED_TYPES = new Set(
  Object.entries(CONTROLLED_COMPONENT_CONFIG)
    .filter(([, c]) => c.valueType === 'boolean')
    .map(([k]) => k)
);

/** Types that are text-valued and sync an external value prop (for useSyncExternalStore).
 *  Input is excluded (skipExternalSync=true) — its text control is the InputField child,
 *  which subscribes via parentInputId; injecting value on the wrapper is a no-op. */
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

/** Types that should be registered in a FormContainer's formData */
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
  'Input', // Input wrapper is shown in form panels even though it delegates to InputField
]);

/** Types that are InputField variants — store key is the parent Input's ID, not own ID */
export const INPUT_FIELD_TYPES = new Set(
  Object.entries(CONTROLLED_COMPONENT_CONFIG)
    .filter(([, c]) => c.isInputField)
    .map(([k]) => k)
);

/** Types that need browser autofill suppression in builder mode (Input wrapper + InputField child) */
export const AUTOFILL_SUPPRESS_TYPES = new Set(['Input', 'InputField']);

/** Types that provide InputParentContext to their children so descendant InputField nodes
 *  can look up their parent Input ID for the `{parentId}-value` store slot.
 *  Derived from skipExternalSync — Input is the only type that wraps children this way. */
export const PARENT_CONTEXT_PROVIDER_TYPES = new Set(
  Object.entries(CONTROLLED_COMPONENT_CONFIG)
    .filter(([, c]) => c.skipExternalSync)
    .map(([k]) => k)
);
