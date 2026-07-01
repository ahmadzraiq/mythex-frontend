import React from 'react';
import { View, TextInput, type ViewProps, type TextInputProps } from 'react-native';

type InputProps = ViewProps & { className?: string };

type InputFieldProps = TextInputProps & {
  className?: string;
  onKeyDown?: (e: unknown) => void;
};

type InputSlotProps = ViewProps & { className?: string };
type InputIconProps = { children?: React.ReactNode; className?: string };

const INPUT_BASE = 'flex-row overflow-hidden items-center';

const Input = React.forwardRef<View, InputProps>(function Input(
  { className, ...props },
  ref
) {
  return <View ref={ref} className={className ? `${INPUT_BASE} ${className}` : INPUT_BASE} {...props} />;
});

const InputField = React.forwardRef<TextInput, InputFieldProps>(function InputField(
  { className, onKeyDown, ...props },
  ref
) {
  return (
    <TextInput
      ref={ref}
      className={className}
      // onKeyDown is web-only and not in TextInputProps; forwarded for react-native-web
      {...(onKeyDown ? { onKeyDown } as unknown as object : {})}
      {...props}
    />
  );
});

const InputSlot = React.forwardRef<View, InputSlotProps>(function InputSlot(
  { className, ...props },
  ref
) {
  return <View ref={ref} className={className} {...props} />;
});

function InputIcon({ children }: InputIconProps) {
  return <>{children}</>;
}

Input.displayName = 'Input';
InputField.displayName = 'InputField';
InputSlot.displayName = 'InputSlot';
InputIcon.displayName = 'InputIcon';

export { Input, InputField, InputSlot, InputIcon };
