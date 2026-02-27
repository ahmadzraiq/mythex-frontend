'use client';

import React from 'react';

interface ColorPickerProps {
  label?: string;
  value?: string;
  className?: string;
  style?: React.CSSProperties;
  onChange?: (value: string) => void;
  'data-builder-id'?: string;
  'data-builder-depth'?: string;
}

const ColorPicker = React.forwardRef<HTMLDivElement, ColorPickerProps>(
  ({ label, value = '#6366f1', className = '', style, onChange, ...rest }, ref) => {
    return (
      <div ref={ref} style={style} className={`flex flex-col gap-1 ${className}`} {...rest}>
        {label && (
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
        )}
        <div className="flex flex-row items-center gap-2">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            className="h-9 w-9 cursor-pointer rounded border border-gray-200 p-0.5 dark:border-gray-700"
          />
          <div
            className="flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:text-gray-100"
            style={{ backgroundColor: value }}
          >
            <span className="font-mono text-xs mix-blend-difference" style={{ color: '#fff' }}>
              {value}
            </span>
          </div>
        </div>
      </div>
    );
  },
);

ColorPicker.displayName = 'ColorPicker';
export default ColorPicker;
