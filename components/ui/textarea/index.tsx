import React from 'react';
import { View, TextInput, type ViewProps, type TextInputProps } from 'react-native';

type TextareaProps = ViewProps & { className?: string };
type TextareaInputProps = TextInputProps & { className?: string };

const Textarea = React.forwardRef<View, TextareaProps>(function Textarea(
  { className, ...props },
  ref
) {
  return <View ref={ref} className={className} {...props} />;
});

const TextareaInput = React.forwardRef<TextInput, TextareaInputProps>(function TextareaInput(
  { className, ...props },
  ref
) {
  return (
    <TextInput
      ref={ref}
      className={className}
      multiline
      textAlignVertical="top"
      {...props}
    />
  );
});

Textarea.displayName = 'Textarea';
TextareaInput.displayName = 'TextareaInput';

export { Textarea, TextareaInput };
