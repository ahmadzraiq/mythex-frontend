'use client';

import { useEffect, useState } from 'react';
import { useSduiStore } from '@/store/sdui-store';
import { getNestedValue } from '@/lib/sdui/nested-utils';

interface CountdownTimerProps {
  /** ISO date string target, e.g. "2026-03-01T00:00:00Z" */
  target?: string;
  /** Path in store to read ISO date string from, e.g. "flashSale.endsAt" */
  targetPath?: string;
  className?: string;
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function calcTimeLeft(targetDate: string): TimeLeft | null {
  const diff = new Date(targetDate).getTime() - Date.now();
  if (diff <= 0) return null;
  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / 1000 / 60) % 60),
    seconds: Math.floor((diff / 1000) % 60),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function CountdownTimer({ target, targetPath, className = '' }: CountdownTimerProps) {
  const storeData = useSduiStore((s) => s.data);

  const resolvedTarget = target ?? (() => {
    if (!targetPath) return null;
    // Try flat key first (how setData stores it), then nested
    const flat = storeData[targetPath] as string | undefined;
    if (flat) return flat;
    return getNestedValue(storeData as Record<string, unknown>, targetPath) as string | null;
  })();

  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(
    resolvedTarget ? calcTimeLeft(resolvedTarget) : null
  );

  useEffect(() => {
    if (!resolvedTarget) return;
    const tick = () => setTimeLeft(calcTimeLeft(resolvedTarget));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [resolvedTarget]);

  if (!timeLeft) {
    return <span className={className}>Sale ended</span>;
  }

  const { days, hours, minutes, seconds } = timeLeft;

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {days > 0 && (
        <>
          <span>{pad(days)}</span>
          <span className="opacity-60">d</span>
          <span className="opacity-60 mx-0.5">:</span>
        </>
      )}
      <span>{pad(hours)}</span>
      <span className="opacity-60">h</span>
      <span className="opacity-60 mx-0.5">:</span>
      <span>{pad(minutes)}</span>
      <span className="opacity-60">m</span>
      <span className="opacity-60 mx-0.5">:</span>
      <span>{pad(seconds)}</span>
      <span className="opacity-60">s</span>
    </span>
  );
}
