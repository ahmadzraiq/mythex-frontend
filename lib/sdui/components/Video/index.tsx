'use client';

import React, { useRef, useEffect, useCallback } from 'react';

export interface VideoProps {
  src?: string;
  poster?: string;
  loop?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  controls?: boolean;
  objectFit?: 'cover' | 'contain' | 'fill';
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
  'data-testid'?: string;
  ref?: React.Ref<HTMLVideoElement>;
}

const Video = React.forwardRef<HTMLVideoElement, VideoProps>(function Video(
  {
    src,
    poster,
    loop = false,
    autoPlay = false,
    muted = true,
    controls = false,
    objectFit = 'cover',
    width,
    height,
    className,
    style,
    'data-testid': testId,
  },
  ref
) {
  const innerRef = useRef<HTMLVideoElement>(null);

  // Sync ref forwarding with our internal ref
  const setRef = useCallback((el: HTMLVideoElement | null) => {
    (innerRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLVideoElement | null>).current = el;
  }, [ref]);

  // `muted` is NOT reliably updated by React after mount (browser limitation).
  // Imperatively set it whenever the prop changes.
  useEffect(() => {
    const el = innerRef.current;
    if (el && el.muted !== muted) el.muted = muted;
  }, [muted]);

  // Use a key on the <video> element so it remounts when boolean playback props
  // change — this guarantees the browser picks up the new attribute state.
  const videoKey = `${autoPlay ? 1 : 0}-${muted ? 1 : 0}-${controls ? 1 : 0}-${loop ? 1 : 0}-${src ?? ''}`;

  return (
    <video
      key={videoKey}
      ref={setRef}
      src={src}
      poster={poster}
      autoPlay={autoPlay}
      muted={muted}
      loop={loop}
      playsInline
      controls={controls}
      className={className}
      data-testid={testId}
      style={{ objectFit, width, height, display: 'block', ...style }}
    />
  );
});

export default Video;
