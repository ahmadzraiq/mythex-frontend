/**
 * Input wrapper: with children renders real Input; without children auto-injects InputField.
 * Uses forwardRef so the builder can attach data-builder-id via a ref callback.
 *
 * readOnly handling: React Native TextInput uses `editable={false}` for read-only.
 * On web, NativeWind maps editable={false} → readonly DOM attribute. We accept `readOnly`
 * from SDUI props and convert it to `editable={false}` for the InputField.
 */

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
    // Children path: pass readOnly-derived editable to children via context is complex;
    // instead pass it on the Input wrapper — Gluestack Input forwards unknown props to
    // the fieldContext so slotted InputField inherits editable state.
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
        // When a live value IS supplied (e.g. "{{local.data.form.formData.email}}"),
        // the SDUI engine passes the live string here and the input stays controlled.
        value={value as string | undefined}
        editable={readOnly ? false : undefined}
        onChange={handleChange as React.ComponentProps<typeof InputField>['onChange']}
        onChangeText={handleChange as React.ComponentProps<typeof InputField>['onChangeText']}
      />
    </Input>
  );
});
