import React from 'react';
import { View, type ViewProps } from 'react-native';

type BoxProps = Omit<ViewProps, 'style'> & { className?: string };

// RNW sets zIndex:0 by default on View (position:relative + zIndex:0 creates a CSS
// stacking context). That traps absolutely/fixed-positioned descendants (like popover
// panels) inside the box's stacking context, preventing them from painting above
// sibling boxes. Override with 'auto' so no stacking context is created by default.
const BOX_STYLE = { overflow: 'visible' as const, zIndex: 'auto' as unknown as number };

const Box = React.forwardRef<View, BoxProps>(function Box(
  { className, ...props },
  ref
) {
  return <View ref={ref} className={`flex-row${className ? ` ${className}` : ''}`} style={BOX_STYLE} {...props} />;
});

Box.displayName = 'Box';
export { Box };
