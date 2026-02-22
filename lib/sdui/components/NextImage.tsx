/**
 * Next/image wrapper for SDUI - fallback to logo when src empty
 */

import React from 'react';
import Image from 'next/image';

type NextImageProps = {
  src: string;
  alt?: string;
  fill?: boolean;
  width?: number;
  height?: number;
  priority?: boolean;
  className?: string;
  [k: string]: unknown;
};

export function NextImage(props: NextImageProps) {
  const { src, alt, fill, width, height, priority, className, ...rest } = props;
  const safeSrc = src && src !== '/' ? src : '/logo.svg';
  if (fill) {
    return <Image src={safeSrc} alt={alt || ''} fill priority={!!priority} className={className as string} {...rest} />;
  }
  return (
    <Image
      src={safeSrc}
      alt={alt || ''}
      width={(width as number) ?? 22}
      height={(height as number) ?? 22}
      priority={!!priority}
      className={className as string}
      {...rest}
    />
  );
}
