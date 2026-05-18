'use client';
import React from 'react';
import { createTextarea } from '@gluestack-ui/core/textarea/creator';
import { View, TextInput } from 'react-native';
import { tva } from '@gluestack-ui/utils/nativewind-utils';
import {
  withStyleContext,
  useStyleContext,
} from '@gluestack-ui/utils/nativewind-utils';
import type { VariantProps } from '@gluestack-ui/utils/nativewind-utils';

const SCOPE = 'TEXTAREA';

const ResetTextInput = React.forwardRef<any, React.ComponentProps<typeof TextInput>>(
  (props, ref) => (
    <TextInput
      ref={ref}
      {...props}
      style={[{ fontFamily: 'inherit' as any, fontSize: 'inherit' as any, fontWeight: 'inherit' as any }, props.style]}
    />
  )
);

const UITextarea = createTextarea({
  Root: withStyleContext(View, SCOPE),
  Input: ResetTextInput,
});

const textareaStyle = tva({
  base: 'w-full h-[100px] border border-background-300 rounded data-[hover=true]:border-outline-400 data-[focus=true]:border-primary-700 data-[focus=true]:data-[hover=true]:border-primary-700 data-[disabled=true]:opacity-40 data-[disabled=true]:bg-background-50 data-[disabled=true]:data-[hover=true]:border-background-300',

  variants: {
    variant: {
      default:
        'data-[focus=true]:border-primary-700 data-[focus=true]:web:ring-1 data-[focus=true]:web:ring-inset data-[focus=true]:web:ring-indicator-primary data-[invalid=true]:border-error-700 data-[invalid=true]:web:ring-1 data-[invalid=true]:web:ring-inset data-[invalid=true]:web:ring-indicator-error data-[invalid=true]:data-[hover=true]:border-error-700 data-[invalid=true]:data-[focus=true]:data-[hover=true]:border-primary-700 data-[invalid=true]:data-[focus=true]:data-[hover=true]:web:ring-1 data-[invalid=true]:data-[focus=true]:data-[hover=true]:web:ring-inset data-[invalid=true]:data-[focus=true]:data-[hover=true]:web:ring-indicator-primary data-[invalid=true]:data-[disabled=true]:data-[hover=true]:border-error-700 data-[invalid=true]:data-[disabled=true]:data-[hover=true]:web:ring-1 data-[invalid=true]:data-[disabled=true]:data-[hover=true]:web:ring-inset data-[invalid=true]:data-[disabled=true]:data-[hover=true]:web:ring-indicator-error ',
    },
    size: {
      sm: '',
      md: '',
      lg: '',
      xl: '',
    },
  },
});

const textareaInputStyle = tva({
  base: 'p-2 web:outline-0 web:outline-none flex-1 web:cursor-text web:data-[disabled=true]:cursor-not-allowed',
});

type ITextareaProps = React.ComponentProps<typeof UITextarea> &
  VariantProps<typeof textareaStyle>;

const Textarea = React.forwardRef<
  React.ComponentRef<typeof UITextarea>,
  ITextareaProps
>(function Textarea(
  { className, variant = 'default', size, ...props },
  ref
) {
  return (
    <UITextarea
      ref={ref}
      {...props}
      className={textareaStyle({ variant, class: className })}
      context={{ size }}
    />
  );
});

type ITextareaInputProps = React.ComponentProps<typeof UITextarea.Input> &
  VariantProps<typeof textareaInputStyle>;

const TextareaInput = React.forwardRef<
  React.ComponentRef<typeof UITextarea.Input>,
  ITextareaInputProps
>(function TextareaInput({ className, ...props }, ref) {
  const { size: parentSize } = useStyleContext(SCOPE);

  return (
    <UITextarea.Input
      ref={ref}
      {...props}
      textAlignVertical="top"
      className={textareaInputStyle({ class: className })}
    />
  );
});

Textarea.displayName = 'Textarea';
TextareaInput.displayName = 'TextareaInput';

export { Textarea, TextareaInput };
