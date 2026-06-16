'use client';

/**
 * SlidePanel — an inline detail panel that opens beside the left or right
 * builder panel without using a modal overlay.
 *
 * Layout slot (managed by page.tsx):
 *   <PanelLeft /> {leftSlide && <SlidePanel side="left" />} <Canvas /> {rightSlide && <SlidePanel side="right" />} <PanelRight />
 *
 * The canvas flex item keeps flex:1 and naturally shrinks when a SlidePanel
 * is present — no backdrop, no blur, canvas stays interactive.
 */

import React, { useEffect, useRef, useCallback } from 'react';

export interface SlidePanelProps {
  title: string;
  side: 'left' | 'right';
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  /** Optional footer content (Save/Cancel buttons etc.) */
  footer?: React.ReactNode;
  /** Optional extra content rendered in the header row, before the × button */
  headerExtra?: React.ReactNode;
  testId?: string;
}

export function SlidePanel({
  title,
  side,
  onClose,
  children,
  width = 320,
  footer,
  headerExtra,
  testId,
}: SlidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Use a stable ref so the event listener is registered once and never stale
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onCloseRef.current();
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  const borderSide = side === 'left'
    ? { borderRight: '1px solid #1f2937', borderLeft: '1px solid #1f2937' }
    : { borderLeft: '1px solid #1f2937', borderRight: '1px solid #1f2937' };

  return (
    <div
      ref={panelRef}
      data-testid={testId ?? 'slide-panel'}
      data-slide-panel
      data-slide-side={side}
      style={{
        width,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bld-bg-panel)',
        ...borderSide,
        overflow: 'hidden',
        zIndex: 10,
      }}
    >
      {/* Header — always shown (carries the × close button) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 10px',
        borderBottom: '1px solid #1f2937',
        flexShrink: 0,
        gap: 6,
        minHeight: 32,
      }}>
        {title ? (
          <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--bld-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
        ) : (
          <span style={{ flex: 1 }} />
        )}
        {headerExtra}
        <button
          data-testid="slide-panel-close"
          onClick={onClose}
          title="Close (Esc)"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--bld-text-disabled)',
            fontSize: 18,
            lineHeight: 1,
            padding: '0 2px',
            flexShrink: 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#f3f4f6')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--bld-text-disabled)')}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {children}
      </div>

      {/* Footer */}
      {footer && (
        <div style={{
          padding: '10px 12px',
          borderTop: '1px solid #1f2937',
          flexShrink: 0,
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
        }}>
          {footer}
        </div>
      )}
    </div>
  );
}

// ─── Shared button styles used inside SlidePanels ────────────────────────────

export const SP_BTN_PRIMARY: React.CSSProperties = {
  padding: '6px 16px',
  background: 'var(--bld-accent)',
  border: 'none',
  borderRadius: 5,
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

export const SP_BTN_SECONDARY: React.CSSProperties = {
  padding: '6px 14px',
  background: 'transparent',
  border: '1px solid #374151',
  borderRadius: 5,
  color: 'var(--bld-text-3)',
  fontSize: 12,
  cursor: 'pointer',
};

export const SP_INPUT: React.CSSProperties = {
  background: 'var(--bld-bg-input)',
  border: '1px solid #374151',
  borderRadius: 4,
  color: 'var(--bld-text-2)',
  fontSize: 11,
  padding: '5px 8px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box' as const,
};

export const SP_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--bld-text-3)',
  display: 'block',
  marginBottom: 3,
};

export const SP_SECTION: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #1f2937',
};
