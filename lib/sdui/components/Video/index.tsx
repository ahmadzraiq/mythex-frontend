'use client';

import React from 'react';

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
  return (
    <video
      ref={ref}
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
