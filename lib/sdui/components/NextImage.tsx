/**
 * Image component for SDUI and the visual builder.
 *
 * Uses a plain <img> tag (no Next.js image optimization) so:
 *  - Any URL works without domain allow-list in next.config
 *  - forwardRef lands on a real div (data-builder-id works in the builder)
 *  - Empty/missing src shows a visible gray placeholder (builder UX)
 *
 * The wrapper div receives style/className so the builder's W/H/border-radius
 * controls apply directly without fighting Next.js Image's own inline styles.
 */

import React from 'react';

type NextImageProps = {
  src?: string;
  alt?: string;
  fill?: boolean;
  width?: number;
  height?: number;
  priority?: boolean;
  className?: string;
  style?: React.CSSProperties;
  [k: string]: unknown;
};

export const NextImage = React.forwardRef<HTMLDivElement, NextImageProps>(
  function NextImage({ src, alt, fill, className, style, ...rest }, ref) {
    const hasSrc = !!(src && src !== '/');

    // Gray placeholder when no src — visible and selectable in the builder
    if (!hasSrc) {
      return (
        <div
          ref={ref}
          className={className}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#e5e7eb',
            color: '#9ca3af',
            fontSize: '13px',
            fontFamily: 'sans-serif',
            ...style,
          }}
        >
          Image
        </div>
      );
    }

    if (fill) {
      return (
        <div ref={ref} style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt || ''} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} className={className} />
        </div>
      );
    }

    // Wrapper div owns dimensions; img fills it with object-fit: cover by default
    return (
      <div ref={ref} style={{ display: 'inline-block', overflow: 'hidden', ...style }} className={className}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt || ''}
          style={{ width: '100%', height: '100%', objectFit: (rest.objectFit as React.CSSProperties['objectFit']) ?? 'cover', display: 'block' }}
        />
      </div>
    );
  }
);
