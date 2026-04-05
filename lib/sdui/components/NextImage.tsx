/**
 * Image component for SDUI and the visual builder.
 *
 * Plain <img> with no wrapper div — className and style land directly on the element.
 * This means the styling agent's set_style calls (w-full, h-full, etc.) apply exactly
 * where needed. The agent sets size on the Image node; the img fills the CSS layout slot.
 *
 * forwardRef lands on <img> (real src) or <div> (placeholder), so data-builder-id works.
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
  objectFit?: React.CSSProperties['objectFit'];
};

/**
 * Converts a React Native transform array to a CSS transform string.
 * Reanimated passes transforms as [{scale:1.05}, {translateY:-4}] on web.
 * Setting element.style[0] (indexed) throws "Indexed property setter not supported".
 */
function rnTransformToCss(transform: unknown): string | undefined {
  if (!Array.isArray(transform)) return undefined;
  return transform
    .map((t: Record<string, unknown>) => {
      const key = Object.keys(t)[0];
      const val = t[key];
      if (key === 'scale')      return `scale(${val})`;
      if (key === 'scaleX')     return `scaleX(${val})`;
      if (key === 'scaleY')     return `scaleY(${val})`;
      if (key === 'translateX') return typeof val === 'string' ? `translateX(${val})` : `translateX(${val}px)`;
      if (key === 'translateY') return typeof val === 'string' ? `translateY(${val})` : `translateY(${val}px)`;
      if (key === 'rotate')     return `rotate(${val})`;
      if (key === 'rotateX')    return `rotateX(${val})`;
      if (key === 'rotateY')    return `rotateY(${val})`;
      if (key === 'skewX')      return `skewX(${val})`;
      if (key === 'skewY')      return `skewY(${val})`;
      if (key === 'perspective') return `perspective(${val}px)`;
      return '';
    })
    .filter(Boolean)
    .join(' ') || undefined;
}

/**
 * Flatten a style value that might be:
 *  - a plain CSSProperties object
 *  - an array of style objects (Reanimated passes arrays)
 *  - null/undefined
 * Also converts RN transform arrays to CSS transform strings so the style
 * is safe to spread onto a plain <img> or <div> element.
 */
function flattenStyle(style: unknown): React.CSSProperties | undefined {
  if (!style) return undefined;
  // Flatten array styles (Reanimated may pass style={[animated, static, ...]} through)
  const flat: Record<string, unknown> = Array.isArray(style)
    ? Object.assign({}, ...(style as object[]))
    : { ...(style as object) };
  // Convert RN transform array → CSS string to avoid "indexed property setter" error
  if (Array.isArray(flat.transform)) {
    const css = rnTransformToCss(flat.transform);
    if (css) flat.transform = css;
    else delete flat.transform;
  }
  return flat as React.CSSProperties;
}

export const NextImage = React.forwardRef<HTMLElement, NextImageProps>(
  function NextImage({ src, alt, className, style, objectFit = 'cover' }, ref) {
    const flatStyle = flattenStyle(style);

    // No src — visible grey placeholder, selectable in the builder
    if (!src || src === '/') {
      return (
        <div
          ref={ref as React.Ref<HTMLDivElement>}
          className={className}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#e5e7eb',
            color: '#9ca3af',
            fontSize: '13px',
            fontFamily: 'sans-serif',
            ...flatStyle,
          }}
        >
          Image
        </div>
      );
    }

    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={ref as React.Ref<HTMLImageElement>}
        src={src}
        alt={alt || ''}
        className={className}
        style={{ objectFit, display: 'block', ...flatStyle }}
      />
    );
  }
);
