/**
 * Input wrapper: with children renders real Input; without children auto-injects InputField.
 * Uses forwardRef so the builder can attach data-builder-id via a ref callback.
 */

import React from 'react';
import { Input, InputField } from '@/components/ui/input';

type InputWithFieldProps = {
  placeholder?: string;
  value?: string;
  onChange?: (e: unknown) => void;
  onChangeText?: (text: string) => void;
  children?: React.ReactNode;
  [k: string]: unknown;
};

export const InputWithField = React.forwardRef<
  React.ComponentRef<typeof Input>,
  InputWithFieldProps
>(function InputWithField(props, ref) {
  const { placeholder, value, onChange, onChangeText, children, ...rest } = props;

  if (children) {
    return <Input ref={ref} {...(rest as React.ComponentProps<typeof Input>)}>{children}</Input>;
  }

  const handleChange = onChange ?? onChangeText;
  return (
    <Input ref={ref} {...(rest as React.ComponentProps<typeof Input>)}>
      <InputField
        placeholder={placeholder as string}
        value={value ?? ''}
        onChange={handleChange as React.ComponentProps<typeof InputField>['onChange']}
        onChangeText={handleChange as React.ComponentProps<typeof InputField>['onChangeText']}
      />
    </Input>
  );
});
