import React from 'react';
import { flattenStyle } from '../flatten-style';

type BoxProps = React.ComponentPropsWithoutRef<'div'> & {
  className?: string;
  nativeID?: string;
};

const Box = React.forwardRef<HTMLDivElement, BoxProps>(function Box(
  { className, style, nativeID, id, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      id={nativeID ?? id}
      className={className}
      style={flattenStyle(style)}
      {...props}
    />
  );
});

Box.displayName = 'Box';
export { Box };
