import React from 'react';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

type TextProps = RNTextProps & { className?: string };

const Text = React.forwardRef<InstanceType<typeof RNText>, TextProps>(function Text(
  { className, ...props },
  ref
) {
  return <RNText ref={ref} className={className} {...props} />;
});

Text.displayName = 'Text';
export { Text };
