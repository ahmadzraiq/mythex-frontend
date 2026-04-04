import React from 'react';
import { cardStyle } from './styles';
import { flattenStyle } from '../flatten-style';
import type { VariantProps } from '@gluestack-ui/utils/nativewind-utils';

type ICardProps = React.ComponentPropsWithoutRef<'div'> &
  VariantProps<typeof cardStyle>;

const Card = React.forwardRef<HTMLDivElement, ICardProps>(function Card(
  { className, size = 'md', variant = 'elevated', style, ...props },
  ref
) {
  return (
    <div
      className={cardStyle({ size, variant, class: className })}
      style={flattenStyle(style)}
      {...props}
      ref={ref}
    />
  );
});

Card.displayName = 'Card';

export { Card };
