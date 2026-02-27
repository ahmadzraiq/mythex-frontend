'use client';

import React from 'react';

interface GoogleMapProps {
  apiKey?: string;
  lat?: number;
  lng?: number;
  zoom?: number;
  mapId?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-builder-id'?: string;
  'data-builder-depth'?: string;
}

const GoogleMap = React.forwardRef<HTMLDivElement, GoogleMapProps>(
  ({ apiKey, lat = 37.7749, lng = -122.4194, zoom = 13, mapId, className = '', style, ...rest }, ref) => {
    if (!apiKey) {
      return (
        <div
          ref={ref}
          style={style}
          className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-100 dark:border-gray-700 dark:bg-gray-900 ${className}`}
          {...rest}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
            <circle cx="12" cy="9" r="2.5" />
          </svg>
          <span className="text-sm font-medium text-gray-500">Google Map</span>
          <span className="text-xs text-gray-400 text-center px-4">
            Set <code className="text-xs bg-gray-200 px-1 rounded">apiKey</code> prop to load the map
          </span>
        </div>
      );
    }

    const src = `https://www.google.com/maps/embed/v1/view?key=${apiKey}&center=${lat},${lng}&zoom=${zoom}${mapId ? `&map_id=${mapId}` : ''}`;

    return (
      <div ref={ref} style={style} className={`overflow-hidden rounded-lg ${className}`} {...rest}>
        <iframe
          src={src}
          title="Google Map"
          className="h-full w-full border-0"
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    );
  },
);

GoogleMap.displayName = 'GoogleMap';
export default GoogleMap;
