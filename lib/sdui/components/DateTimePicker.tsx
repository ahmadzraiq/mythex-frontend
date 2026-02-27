'use client';

import React from 'react';

interface DateTimePickerProps {
  label?: string;
  value?: string;
  className?: string;
  style?: React.CSSProperties;
  onChange?: (value: string) => void;
  'data-builder-id'?: string;
  'data-builder-depth'?: string;
}

const DateTimePicker = React.forwardRef<HTMLDivElement, DateTimePickerProps>(
  ({ label, value, className = '', style, onChange, ...rest }, ref) => {
    return (
      <div ref={ref} style={style} className={`flex flex-col gap-1 ${className}`} {...rest}>
        {label && (
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
        )}
        <input
          type="datetime-local"
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-primary dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
      </div>
    );
  },
);

DateTimePicker.displayName = 'DateTimePicker';
export default DateTimePicker;
