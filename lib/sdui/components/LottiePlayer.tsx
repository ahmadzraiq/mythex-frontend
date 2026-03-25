'use client';

/**
 * LottiePlayer — wraps @lottiefiles/dotlottie-react for SDUI JSON usage.
 *
 * Usage in JSON:
 * {
 *   "type": "LottiePlayer",
 *   "props": {
 *     "src": "https://assets4.lottiefiles.com/packages/lf20_fcfjwiyb.json",
 *     "autoplay": true,
 *     "loop": true,
 *     "speed": 1,
 *     "width": 200,
 *     "height": 200,
 *     "className": "..."
 *   }
 * }
 *
 * src can be:
 *   - A .lottie URL  (DotLottie format)
 *   - A .json URL    (legacy Lottie JSON — assets*.lottiefiles.com CDN)
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import type { DotLottie } from '@lottiefiles/dotlottie-react';

export interface LottiePlayerProps {
  /** URL to a .lottie or .json animation file */
  src?: string;
  /** Auto-play on mount (default true) */
  autoplay?: boolean;
  /** Loop the animation (default true) */
  loop?: boolean;
  /** Playback speed multiplier (default 1) */
  speed?: number;
  /** Width in px or CSS string (default 200) */
  width?: number | string;
  /** Height in px or CSS string (default 200) */
  height?: number | string;
  /** Additional CSS class */
  className?: string;
  /** When true, renders a placeholder box regardless of src */
  placeholder?: boolean;
  /** data-testid for E2E tests */
  'data-testid'?: string;
}

function PlaceholderBox({
  width,
  height,
  testId,
  className,
  label,
  ref,
}: {
  width: number | string;
  height: number | string;
  testId?: string;
  className?: string;
  label: string;
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      data-testid={testId}
      className={className}
      style={{
        width,
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1f2937',
        borderRadius: 8,
        color: '#6b7280',
        fontSize: 12,
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <span style={{ fontSize: 24 }}>🎬</span>
      <span>{label}</span>
    </div>
  );
}

function LoadingSkeleton({
  width,
  height,
  testId,
  className,
}: {
  width: number | string;
  height: number | string;
  testId?: string;
  className?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={className}
      style={{
        width,
        height,
        borderRadius: 8,
        background: 'linear-gradient(90deg, #1f2937 0%, #374151 50%, #1f2937 100%)',
        backgroundSize: '200% 100%',
        animation: 'lottie-shimmer 1.4s infinite linear',
      }}
    >
      <style>{`@keyframes lottie-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
    </div>
  );
}

export default function LottiePlayer({
  src,
  autoplay = true,
  loop = true,
  speed = 1,
  width = 200,
  height = 200,
  className,
  placeholder,
  'data-testid': testId,
  ref,
}: LottiePlayerProps & { ref?: React.Ref<HTMLDivElement> }) {
  const dotLottieRef = useRef<DotLottie | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isError, setIsError] = useState(false);

  // Wire up load/error/speed/loop via the instance ref callback.
  // DotLottieReact doesn't expose onLoad/onLoadError as props — events must be
  // subscribed via the DotLottie instance's addEventListener after mount.
  const handleRefCallback = useCallback((dl: DotLottie | null) => {
    dotLottieRef.current = dl;
    if (!dl) return;

    const onLoad = () => {
      setIsLoaded(true);
      dl.setSpeed(speed ?? 1);
      dl.setLoop(loop);
      // Don't stop here — let the animation play once naturally.
      // setLoop(false) already ensures it won't repeat after completing.
    };
    const onLoadError = () => setIsError(true);

    dl.addEventListener('load', onLoad);
    dl.addEventListener('loadError', onLoadError);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep speed/loop in sync when props change after load
  useEffect(() => {
    const dl = dotLottieRef.current;
    if (!dl || !isLoaded) return;
    dl.setSpeed(speed ?? 1);
  }, [speed, isLoaded]);

  useEffect(() => {
    const dl = dotLottieRef.current;
    if (!dl || !isLoaded) return;
    dl.setLoop(loop);
    // If re-enabling loop and the animation has already stopped, restart it
    if (loop && dl.isStopped) dl.play();
  }, [loop, isLoaded]);

  if (!src || placeholder) {
    return (
      <PlaceholderBox
        ref={ref}
        width={width}
        height={height}
        testId={testId}
        className={className}
        label="Lottie — no src"
      />
    );
  }

  if (isError) {
    return (
      <PlaceholderBox
        ref={ref}
        width={width}
        height={height}
        testId={testId}
        className={className}
        label="Lottie — failed to load"
      />
    );
  }

  return (
    <div
      ref={ref}
      data-testid={testId}
      className={className}
      style={{ width, height, display: 'inline-block', position: 'relative' }}
    >
      {/* Loading skeleton shown until onLoad fires */}
      {!isLoaded && (
        <LoadingSkeleton
          width="100%"
          height="100%"
          style={{ position: 'absolute', inset: 0 } as React.CSSProperties}
        />
      )}
      <DotLottieReact
        src={src}
        autoplay={autoplay}
        loop={loop}
        dotLottieRefCallback={handleRefCallback}
        style={{ width: '100%', height: '100%', display: isLoaded ? 'block' : 'none' }}
      />
    </div>
  );
}
