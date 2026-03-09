/**
 * Thin wrapper around Gluestack InputField that maps the SDUI `readOnly` prop
 * to React Native's `editable={false}` so it works on both web and native.
 * Also applies the HTML `readOnly` attribute via the ref on web.
 */

import React from 'react';
import { InputField } from '@/components/ui/input';

type ControlledInputFieldProps = React.ComponentProps<typeof InputField> & {
  readOnly?: boolean;
};

export const ControlledInputField = React.forwardRef<
  React.ComponentRef<typeof InputField>,
  ControlledInputFieldProps
>(function ControlledInputField({ readOnly, ...props }, ref) {
  return (
    <InputField
      ref={ref}
      editable={readOnly ? false : undefined}
      {...(props as React.ComponentProps<typeof InputField>)}
    />
  );
});
