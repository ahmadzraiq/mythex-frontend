/**
 * Textarea wrapper: with children renders real Gluestack Textarea; without children
 * auto-injects a TextareaInput child so standalone `<Textarea>` nodes work without
 * explicit children in JSON.
 *
 * Controlled value for no-children case:
 *   When no children are present, TextareaWithInput renders its own TextareaInput and
 *   passes `value` directly — standard controlled component pattern.
 *
 * When explicit children are present (e.g. Textarea > TextareaInput in JSON), the
 * TextareaInput child subscribes to `{parentInputId}-value` in the global variable store
 * directly via useExternalNodeValueSync (see form-field-tracker.ts).
 */

'use client';

import React from 'react';
import { Textarea, TextareaInput } from '@/components/ui/textarea';

type TextareaWithInputProps = {
  placeholder?: string;
  value?: string;
  onChange?: (e: unknown) => void;
  onChangeText?: (text: string) => void;
  children?: React.ReactNode;
  [k: string]: unknown;
};

export const TextareaWithInput = React.forwardRef<
  React.ComponentRef<typeof Textarea>,
  TextareaWithInputProps
>(function TextareaWithInput(props, ref) {
  const { placeholder, value, onChange, onChangeText, children, ...rest } = props;

  // When a controlled `value` is present, remove `defaultValue` to avoid React's
  // "both value and defaultValue" warning on the underlying input element.
  if (value !== undefined) {
    delete (rest as Record<string, unknown>).defaultValue;
  }

  if (children) {
    return (
      <Textarea ref={ref} {...(rest as React.ComponentProps<typeof Textarea>)}>
        {children as React.ReactNode}
      </Textarea>
    );
  }

  const { className, placeholderTextColor = '#737373', ...restWithoutClass } = rest as Record<string, unknown> & { className?: string; placeholderTextColor?: string };
  const handleChange = onChange ?? onChangeText;
  // Only forward padding-related classes to TextareaInput so the inner element doesn't
  // pick up border/bg classes and render a double border.
  const innerClassName = className
    ? className.split(/\s+/).filter(c => /^p[xylrtbse]?-/.test(c)).join(' ') || undefined
    : undefined;
  return (
    <Textarea ref={ref} {...(restWithoutClass as React.ComponentProps<typeof Textarea>)} className={className}>
      <TextareaInput
        placeholder={placeholder as string}
        placeholderTextColor={placeholderTextColor}
        // Do NOT default to '' — an explicit undefined keeps the textarea uncontrolled
        // so the user can type freely when no value binding is provided.
        value={value as string | undefined}
        onChange={handleChange as React.ComponentProps<typeof TextareaInput>['onChange']}
        onChangeText={handleChange as React.ComponentProps<typeof TextareaInput>['onChangeText']}
        className={innerClassName}
      />
    </Textarea>
  );
});

export default TextareaWithInput;
