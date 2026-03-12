/**
 * Input wrapper: with children renders real Gluestack Input; without children auto-injects
 * an InputField child so standalone `<Input>` nodes work without explicit children in JSON.
 *
 * Controlled value for explicit-children case:
 *   When JSON declares `Input > InputField` (the standard builder structure), the `value` prop
 *   injected by the renderer onto the `Input` wrapper node is NOT forwarded to the InputField
 *   child — Gluestack's Input component passes its own props (variant, size, className) to
 *   children via context, not arbitrary user props. The InputField child subscribes to
 *   `{parentInputId}-value` in the global variable store directly via useExternalNodeValueSync
 *   (see form-field-tracker.ts), so the controlled value reaches it without any prop threading.
 *
 * Controlled value for no-children case:
 *   When no children are present, InputWithField renders its own InputField and passes
 *   `value` directly — standard controlled component pattern.
 *
 * readOnly handling: React Native TextInput uses `editable={false}` for read-only.
 * On web, NativeWind maps editable={false} → readonly DOM attribute.
 */

'use client';

import React from 'react';
import { Input, InputField } from '@/components/ui/input';

type InputWithFieldProps = {
  placeholder?: string;
  value?: string;
  readOnly?: boolean;
  onChange?: (e: unknown) => void;
  onChangeText?: (text: string) => void;
  children?: React.ReactNode;
  [k: string]: unknown;
};

export const InputWithField = React.forwardRef<
  React.ComponentRef<typeof Input>,
  InputWithFieldProps
>(function InputWithField(props, ref) {
  const { placeholder, value, readOnly, onChange, onChangeText, children, ...rest } = props;

  // When a controlled `value` is present, remove `defaultValue` to avoid React's
  // "both value and defaultValue" warning on the underlying input element.
  if (value !== undefined) {
    delete (rest as Record<string, unknown>).defaultValue;
  }

  if (children) {
    return (
      <Input
        ref={ref}
        {...(rest as React.ComponentProps<typeof Input>)}
        {...(readOnly ? { readOnly: true } : {})}
      >
        {children as React.ReactNode}
      </Input>
    );
  }

  const handleChange = onChange ?? onChangeText;
  return (
    <Input ref={ref} {...(rest as React.ComponentProps<typeof Input>)}>
      <InputField
        placeholder={placeholder as string}
        // Do NOT default to '' — an explicit undefined keeps the input uncontrolled
        // so the user can type freely when no value binding is provided.
        value={value as string | undefined}
        editable={readOnly ? false : undefined}
        onChange={handleChange as React.ComponentProps<typeof InputField>['onChange']}
        onChangeText={handleChange as React.ComponentProps<typeof InputField>['onChangeText']}
      />
    </Input>
  );
});
