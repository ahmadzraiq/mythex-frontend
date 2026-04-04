import React from 'react';
import { boxStyle } from './styles';
import { flattenStyle } from '../flatten-style';

import type { VariantProps } from '@gluestack-ui/utils/nativewind-utils';

type IBoxProps = React.ComponentPropsWithoutRef<'div'> &
  VariantProps<typeof boxStyle> & { className?: string };

const Box = React.forwardRef<HTMLDivElement, IBoxProps>(function Box(
  { className, style, ...props },
  ref
) {
  return (
    <div ref={ref} className={boxStyle({ class: className })} style={flattenStyle(style)} {...props} />
  );
});

Box.displayName = 'Box';
export { Box };
