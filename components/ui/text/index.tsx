import React from 'react';
import { flattenStyle } from '../flatten-style';

type TextProps = React.ComponentPropsWithoutRef<'span'> & {
  className?: string;
  nativeID?: string;
};

const Text = React.forwardRef<HTMLSpanElement, TextProps>(function Text(
  { className, style, nativeID, ...props },
  ref
) {
  return (
    <span
      ref={ref}
      id={nativeID}
      className={className}
      style={flattenStyle(style)}
      {...props}
    />
  );
});

Text.displayName = 'Text';
export { Text };
