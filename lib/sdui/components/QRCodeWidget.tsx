'use client';

import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface QRCodeWidgetProps {
  value?: string;
  size?: number;
  level?: 'L' | 'M' | 'Q' | 'H';
  includeMargin?: boolean;
  fgColor?: string;
  bgColor?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-builder-id'?: string;
  'data-builder-depth'?: string;
}

const QRCodeWidget = React.forwardRef<HTMLDivElement, QRCodeWidgetProps>(
  (
    {
      value,
      size = 160,
      level = 'M',
      includeMargin = true,
      fgColor = '#000000',
      bgColor = '#ffffff',
      className = '',
      style,
      ...rest
    },
    ref,
  ) => {
    if (!value) {
      return (
        <div
          ref={ref}
          style={{ width: size, height: size, ...style }}
          className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900 ${className}`}
          {...rest}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="3" height="3" />
          </svg>
          <span className="mt-1 text-xs text-gray-400">No value set</span>
        </div>
      );
    }

    return (
      <div ref={ref} style={style} className={`inline-flex ${className}`} {...rest}>
        <QRCodeSVG
          value={value}
          size={size}
          level={level}
          includeMargin={includeMargin}
          fgColor={fgColor}
          bgColor={bgColor}
        />
      </div>
    );
  },
);

QRCodeWidget.displayName = 'QRCodeWidget';
export default QRCodeWidget;
