'use client';

import React from 'react';

interface IframeProps {
  src?: string;
  title?: string;
  allowFullScreen?: boolean;
  className?: string;
  style?: React.CSSProperties;
  'data-builder-id'?: string;
  'data-builder-depth'?: string;
}

const Iframe = React.forwardRef<HTMLDivElement, IframeProps>(
  ({ src, title = 'Embedded content', allowFullScreen = false, className = '', style, ...rest }, ref) => {
    if (!src) {
      return (
        <div
          ref={ref}
          style={style}
          className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900 ${className}`}
          {...rest}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
          <span className="mt-2 text-sm text-gray-400">No URL set</span>
          <span className="text-xs text-gray-300 dark:text-gray-600">Set the &quot;src&quot; prop to embed a URL</span>
        </div>
      );
    }

    return (
      <div ref={ref} style={style} className={`overflow-hidden rounded-lg ${className}`} {...rest}>
        <iframe
          src={src}
          title={title}
          allowFullScreen={allowFullScreen}
          className="h-full w-full border-0"
        />
      </div>
    );
  },
);

Iframe.displayName = 'Iframe';
export default Iframe;
