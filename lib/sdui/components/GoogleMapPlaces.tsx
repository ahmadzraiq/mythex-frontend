'use client';

import React, { useState } from 'react';

interface GoogleMapPlacesProps {
  apiKey?: string;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  onChange?: (place: string) => void;
  'data-builder-id'?: string;
  'data-builder-depth'?: string;
}

const GoogleMapPlaces = React.forwardRef<HTMLDivElement, GoogleMapPlacesProps>(
  ({ apiKey, placeholder = 'Search for a place…', className = '', style, onChange, ...rest }, ref) => {
    const [query, setQuery] = useState('');

    if (!apiKey) {
      return (
        <div
          ref={ref}
          style={style}
          className={`flex flex-col gap-2 ${className}`}
          {...rest}
        >
          <div className="flex flex-row items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <span className="text-sm text-gray-400">{placeholder}</span>
          </div>
          <span className="text-xs text-gray-400">
            Set <code className="bg-gray-100 px-1 rounded text-xs dark:bg-gray-800">apiKey</code> prop to enable Places autocomplete
          </span>
        </div>
      );
    }

    return (
      <div ref={ref} style={style} className={`flex flex-col gap-1 ${className}`} {...rest}>
        <div className="relative flex flex-row items-center">
          <svg
            className="absolute left-3 text-gray-400 pointer-events-none"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={query}
            placeholder={placeholder}
            onChange={(e) => { setQuery(e.target.value); onChange?.(e.target.value); }}
            className="w-full rounded-md border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-primary dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
        </div>
        {query && (
          <div className="rounded-md border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-900">
            <div className="px-3 py-2 text-sm text-gray-500 italic">
              Places suggestions would appear here with a real API key
            </div>
          </div>
        )}
      </div>
    );
  },
);

GoogleMapPlaces.displayName = 'GoogleMapPlaces';
export default GoogleMapPlaces;
