import React from 'react';
import { boxStyle } from './styles';
import { flattenStyle } from '../flatten-style';

import type { VariantProps } from '@gluestack-ui/utils/nativewind-utils';

type IBoxProps = React.ComponentPropsWithoutRef<'div'> &
  VariantProps<typeof boxStyle> & { className?: string; nativeID?: string };

const Box = React.forwardRef<HTMLDivElement, IBoxProps>(function Box(
  { className, style, nativeID, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      id={nativeID ?? (props as { id?: string }).id}
      className={boxStyle({ class: className })}
      style={flattenStyle(style)}
      {...props}
    />
  );
});

Box.displayName = 'Box';
export { Box };
