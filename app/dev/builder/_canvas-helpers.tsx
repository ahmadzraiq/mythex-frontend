'use client';

/**
 * _canvas-helpers.tsx
 *
 * Self-contained helper components for the builder canvas.
 * Extracted from _canvas.tsx — no circular dependencies.
 *
 * Exports:
 *  - VIEWPORT_H
 *  - CanvasContextMenu, CanvasCtxMenuProps
 *  - ZoomBtn, EmptyCanvas
 *  - PageEngine, InactivePageEngine
 */

import React, { useEffect, memo, useDeferredValue, useMemo } from 'react';
import { useBuilderStore } from './_store';
import { SDUIEngine } from '@/lib/sdui/sdui-engine';
import appConfig from '@/config/app';
import type { SDUIConfig } from '@/lib/sdui/types';
import type { SDUINode } from '@/lib/sdui/types/node';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const app = appConfig as any;

export const VIEWPORT_H = 900;

// ─── ZoomBtn ─────────────────────────────────────────────────────────────────

export function ZoomBtn({ label, testId, onClick }: { label: string; testId?: string; onClick: () => void }) {
  return (
    <button data-testid={testId} style={{ fontSize: 14, color: '#d1d5db', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }} onClick={onClick}>
      {label}
    </button>
  );
}

// ─── EmptyCanvas ──────────────────────────────────────────────────────────────

export function EmptyCanvas() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: '#9ca3af', fontFamily: 'system-ui', userSelect: 'none' }}>
      <div style={{ fontSize: 32, opacity: 0.4 }}>+</div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>Drop a component or section to get started</div>
      <div style={{ fontSize: 11, opacity: 0.6 }}>Drag from the Components panel on the left</div>
    </div>
  );
}

// ─── Canvas Context Menu ──────────────────────────────────────────────────────

export interface CanvasCtxMenuProps {
  x: number; y: number;
  nodeId: string | null;
  onClose: () => void;
}

export function CanvasContextMenu({ x, y, nodeId, onClose }: CanvasCtxMenuProps) {
  const store = useBuilderStore();

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest('[data-canvas-ctx-menu]')) onClose(); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [onClose]);

  const nodeItems = nodeId ? [
    { label: 'Copy',         action: () => { store.select(nodeId); store.copyToClipboard(); } },
    { label: 'Duplicate',    action: () => store.duplicateNodes([nodeId]) },
    { label: 'Move Up',      action: () => store.moveNodeUp(nodeId) },
    { label: 'Move Down',    action: () => store.moveNodeDown(nodeId) },
    { label: 'Select Parent',action: () => store.selectParent(nodeId) },
    null,
    { label: 'Delete', action: () => store.deleteNodes([nodeId]), danger: true },
  ] : [
    { label: 'Select All',    action: () => store.selectAll() },
    { label: 'Paste',         action: () => store.pasteFromClipboard() },
    { label: 'Paste in Place',action: () => store.pasteInPlace() },
  ];

  return (
    <div
      data-canvas-ctx-menu="1"
      data-testid={nodeId ? 'canvas-node-ctx-menu' : 'canvas-empty-ctx-menu'}
      style={{ position: 'fixed', left: x, top: y, background: '#1f2937', border: '1px solid #374151', borderRadius: 6, zIndex: 99999, minWidth: 160, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}
    >
      {nodeItems.map((item, i) =>
        item === null ? (
          <div key={i} style={{ height: 1, background: '#374151', margin: '2px 0' }} />
        ) : (
          <button
            key={item.label}
            style={{ display: 'block', width: '100%', padding: '7px 14px', background: 'none', border: 'none', color: (item as { danger?: boolean }).danger ? '#f87171' : '#d1d5db', fontSize: 12, fontFamily: 'system-ui', textAlign: 'left', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#374151')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            onClick={() => { item.action(); onClose(); }}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

// ─── Page Engines ──────────────────────────────────────────────────────────────

export const PageEngine = memo(function PageEngine({
  pageConfig,
  configName,
  previewStates,
  previewData,
}: {
  pageConfig: SDUIConfig;
  configName: string;
  previewStates?: string[];
  previewData?: Record<string, unknown>;
}) {
  if (!pageConfig.ui) return <EmptyCanvas />;
  return (
    <SDUIEngine
      key="builder-engine"
      config={pageConfig}
      configName={configName}
      actionsConfig={app.actions}
      routes={app.routes}
      builderMode
      previewStates={previewStates}
      previewData={previewData}
    />
  );
});

/**
 * Memoized wrapper around SDUIEngine for inactive (background) pages.
 * Receives a stable `nodes` reference — only re-renders when that page's
 * node tree actually changes, not on every pan/zoom/hover update.
 */
export const InactivePageEngine = memo(function InactivePageEngine({
  pageId,
  configName,
  nodes,
  previewStates,
  previewData,
}: {
  pageId: string;
  configName: string;
  nodes: SDUINode[];
  previewStates?: string[];
  previewData?: Record<string, unknown>;
}) {
  // Defer preview state changes for inactive pages so the active page always
  // updates first. This keeps the UI responsive when many pages are visible.
  const deferredPreviewStates = useDeferredValue(previewStates);
  const deferredPreviewData = useDeferredValue(previewData);

  const cfg = useMemo<SDUIConfig>(() => {
    const screenState = (app.screens?.[configName] as { state?: Record<string, unknown> } | undefined)?.state ?? {};
    return {
      state: screenState,
      ui: {
        type: 'Box',
        props: { className: 'flex flex-col w-full min-h-screen items-start relative' },
        children: nodes,
      } as SDUIConfig['ui'],
    };
  }, [configName, nodes]);

  if (!nodes.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: VIEWPORT_H, gap: 8, color: '#9ca3af', fontFamily: 'system-ui', userSelect: 'none' }}>
        <div style={{ fontSize: 24, opacity: 0.3 }}>+</div>
        <div style={{ fontSize: 12 }}>Empty page</div>
      </div>
    );
  }
  return (
    <SDUIEngine
      key={`pg-${pageId}`}
      config={cfg}
      configName={configName}
      actionsConfig={app.actions ?? {}}
      routes={app.routes ?? []}
      builderMode
      previewStates={deferredPreviewStates}
      previewData={deferredPreviewData}
    />
  );
});
