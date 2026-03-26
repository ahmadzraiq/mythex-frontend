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
 *  - PageEngine, InactivePageEngine, InactivePagesGrid
 */

import React, { useEffect, memo, useMemo, useState } from 'react';
import { useBuilderStore } from './_store';
import { SDUIEngine } from '@/lib/sdui/sdui-engine';
import appConfig from '@/config/app';
import type { SDUIConfig } from '@/lib/sdui/types';
import type { SDUINode } from '@/lib/sdui/types/node';
import { applyStateTagOverrides } from '@/lib/sdui/builder-preview';
import { getPopups, subscribePopups } from '@/lib/builder/popup-data';

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

// ─── InactivePagesGrid ────────────────────────────────────────────────────────
/**
 * Renders all inactive (background) page frames as a memoized component.
 * Isolated here so it does NOT re-render when the active page's hover/selection
 * state changes — only re-renders when the pages list or preview states change.
 */
export const InactivePagesGrid = memo(function InactivePagesGrid({
  vpWidth,
  PAGE_GAP,
}: {
  vpWidth: number;
  PAGE_GAP: number;
}) {
  const pages = useBuilderStore(s => s.pages);
  const currentPageId = useBuilderStore(s => s.currentPageId);
  const activePreviewStates = useBuilderStore(s => s.activePreviewStates);
  const switchPage = useBuilderStore(s => s.switchPage);

  return (
    <>
      {pages.filter(p => p.id !== currentPageId).map(page => {
        const absIdx = pages.findIndex(pg => pg.id === page.id);
        const worldLeft = absIdx * (vpWidth + PAGE_GAP);
        return (
          <React.Fragment key={page.id}>
            {/* Page name label — click to make this page active */}
            <div
              onClick={() => switchPage(page.id)}
              style={{ position: 'absolute', left: worldLeft, top: -26, fontSize: 11, color: '#9ca3af', userSelect: 'none', fontFamily: 'system-ui', whiteSpace: 'nowrap', display: 'flex', gap: 6, alignItems: 'baseline', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#d1d5db')}
              onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}
            >
              <span style={{ fontWeight: 500 }}>{page.name}</span>
              {page.route && <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#4b5563' }}>{page.route}</span>}
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#374151' }}>{vpWidth}px</span>
            </div>
            {/* Frame */}
            <div
              data-builder-page-id={page.id}
              style={{
                position: 'absolute',
                left: worldLeft,
                top: 0,
                width: vpWidth,
                minHeight: VIEWPORT_H,
                background: 'rgb(var(--background, 255 255 255))',
                overflow: 'hidden',
                boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                transform: 'translateZ(0)',
              }}
            >
              <InactivePageEngine
                pageId={page.id}
                configName={page.name || 'page'}
                nodes={applyStateTagOverrides(page.nodes as SDUINode[], activePreviewStates)}
                previewStates={activePreviewStates}
              />
              {/* Click-to-activate overlay */}
              <div
                data-builder-inactive-frame="1"
                onClick={() => switchPage(page.id)}
                title={`Click to edit ${page.name}`}
                style={{ position: 'absolute', inset: 0, zIndex: 9998, cursor: 'pointer', background: 'transparent' }}
              />
              {/* Fold line */}
              <div
                data-builder-overlay="fold-line"
                style={{ position: 'absolute', left: 0, right: 0, top: VIEWPORT_H, height: 0, borderTop: '1.5px dashed rgba(99,130,246,0.3)', pointerEvents: 'none', zIndex: 9990 }}
              />
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
});

// ─── Page Engines ──────────────────────────────────────────────────────────────

export const PageEngine = memo(function PageEngine({
  pageConfig,
  configName,
  previewStates,
  previewData,
  actionsConfig: actionsConfigProp,
  showPopups: showPopupsProp,
}: {
  pageConfig: SDUIConfig;
  configName: string;
  previewStates?: string[];
  previewData?: Record<string, unknown>;
  actionsConfig?: Record<string, unknown>;
  /** Whether to render popup overlays (false when popup content is the page itself). */
  showPopups?: boolean;
}) {
  // Subscribe to the in-memory popup store so live edits appear in PopupRenderer
  // without needing to write to disk.
  const [livePopupModels, setLivePopupModels] = useState(() => getPopups());
  useEffect(() => subscribePopups(() => setLivePopupModels(getPopups())), []);

  if (!pageConfig.ui) return <EmptyCanvas />;
  return (
    <SDUIEngine
      key="builder-engine"
      config={pageConfig}
      configName={configName}
      actionsConfig={actionsConfigProp ?? app.actions}
      routes={app.routes}
      builderMode
      showPopups={showPopupsProp ?? true}
      builderViewportHeight={VIEWPORT_H}
      previewStates={previewStates}
      previewData={previewData}
      popupModels={livePopupModels as Record<string, unknown>}
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
}: {
  pageId: string;
  configName: string;
  nodes: SDUINode[];
  previewStates?: string[];
}) {
  // Apply state-tag overrides inside the memo so this only recomputes when
  // nodes or previewStates change — not on every canvas pan/zoom render.
  const displayNodes = useMemo(
    () => applyStateTagOverrides(nodes, previewStates ?? ['normal']),
    [nodes, previewStates],
  );

  const cfg = useMemo<SDUIConfig>(() => {
    const screenState = (app.screens?.[configName] as { state?: Record<string, unknown> } | undefined)?.state ?? {};
    return {
      state: screenState,
      ui: {
        type: 'Box',
        props: { className: 'flex flex-col w-full min-h-screen items-start relative' },
        children: displayNodes,
      } as SDUIConfig['ui'],
    };
  }, [configName, displayNodes]);

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
      showPopups={false}
      previewStates={previewStates}
    />
  );
});
