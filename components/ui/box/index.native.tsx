import React from 'react';
import { View, type ViewProps } from 'react-native';

type BoxProps = ViewProps & { className?: string };

const Box = React.forwardRef<View, BoxProps>(function Box(
  { className, ...props },
  ref
) {
  return <View ref={ref} className={className} {...props} />;
});

Box.displayName = 'Box';
export { Box };
