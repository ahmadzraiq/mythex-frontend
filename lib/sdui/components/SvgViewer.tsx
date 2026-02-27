'use client';

import React from 'react';

interface SvgViewerProps {
  svg?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-builder-id'?: string;
  'data-builder-depth'?: string;
}

const SvgViewer = React.forwardRef<HTMLDivElement, SvgViewerProps>(
  ({ svg, className = '', style, ...rest }, ref) => {
    if (!svg) {
      return (
        <div
          ref={ref}
          style={style}
          className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900 ${className}`}
          {...rest}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <span className="mt-2 text-sm text-gray-400">No SVG set</span>
          <span className="text-xs text-gray-300 dark:text-gray-600">Set the &quot;svg&quot; prop with SVG markup</span>
        </div>
      );
    }

    return (
      <div
        ref={ref}
        style={style}
        className={`overflow-hidden ${className}`}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: svg }}
        {...rest}
      />
    );
  },
);

SvgViewer.displayName = 'SvgViewer';
export default SvgViewer;
