'use client';

/**
 * PageTriggersInRightPanel — shown in the right panel when no node is selected.
 *
 * Lists trigger workflows scoped to the currently focused page, and allows adding
 * new ones auto-scoped to that page. Each new trigger gets pageScope set to the
 * focused page's route config name (e.g. "home", "product").
 *
 * App-level triggers (isAppTrigger: true) are managed separately in the left-panel
 * "App Triggers" tab.
 */

import React, { useState } from 'react';
import { useBuilderStore } from './_store';
import { TriggerRow, PAGE_TRIGGER_VALUES } from './_triggers-tab';
import routesConfig from '@/config/routes.json';
import { useShallow } from 'zustand/react/shallow';

const ALL_ROUTES = (routesConfig as { routes: Array<{ path: string; config: string }> }).routes;

const SECTION_HDR: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 12px', borderBottom: '1px solid #1f2937',
};
const SEC_LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#9ca3af',
  textTransform: 'uppercase', letterSpacing: '0.08em',
};
const EMPTY: React.CSSProperties = {
  fontSize: 11, color: '#4b5563', fontStyle: 'italic',
  padding: '10px 14px',
};
const ADD_BTN: React.CSSProperties = {
  padding: '3px 10px', background: '#1d4ed8', border: 'none',
  borderRadius: 4, color: '#fff', fontSize: 10, cursor: 'pointer',
};

export function PageTriggersInRightPanel() {
  const {
    focusedPageId,
    pages,
    pageWorkflows,
    pageWorkflowMeta,
    setPageWorkflow,
    setPageWorkflowMeta,
    removePageWorkflow,
    openWorkflowCanvas,
  } = useBuilderStore(useShallow(s => ({
    focusedPageId: s.focusedPageId,
    pages: s.pages,
    pageWorkflows: s.pageWorkflows,
    pageWorkflowMeta: s.pageWorkflowMeta,
    setPageWorkflow: s.setPageWorkflow,
    setPageWorkflowMeta: s.setPageWorkflowMeta,
    removePageWorkflow: s.removePageWorkflow,
    openWorkflowCanvas: s.openWorkflowCanvas,
  })));

  const [open, setOpen] = useState(true);

  // Find the focused page and its route
  const focusedPage = pages.find(p => p.id === focusedPageId);
  const pageRoute = focusedPage?.route;
  const pageConfig = pageRoute
    ? (ALL_ROUTES.find(r => r.path === pageRoute)?.config ?? pageRoute)
    : undefined;
  const pageName = focusedPage?.name ?? 'this page';

  // List only page-scoped triggers for this page
  const entries = Object.entries(pageWorkflowMeta)
    .filter(([, meta]) =>
      meta?.isTrigger &&
      !meta.isAppTrigger &&
      meta.pageScope === pageConfig &&
      PAGE_TRIGGER_VALUES.has(meta?.trigger ?? ''),
    )
    .map(([id, meta]) => ({
      id,
      trigger: meta?.trigger ?? '',
      name: meta?.name ?? id,
      stepCount: (pageWorkflows[id] as unknown[])?.length ?? 0,
    }));

  const addNew = () => {
    const id = crypto.randomUUID();
    setPageWorkflow(id, []);
    setPageWorkflowMeta(id, {
      id,
      name: 'Untitled trigger',
      trigger: 'pageLoad',
      isTrigger: true,
      isAppTrigger: false,
      ...(pageConfig ? { pageScope: pageConfig } : {}),
    });
    openWorkflowCanvas({ kind: 'pageWorkflow', name: id, isNew: true });
  };

  return (
    <div
      data-testid="page-triggers-panel"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
    >
      {/* Header with page name */}
      <div style={{
        padding: '8px 12px 6px', flexShrink: 0, borderBottom: '1px solid #1f2937',
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', marginBottom: 2 }}>
          Page Triggers
        </div>
        <div style={{ fontSize: 10, color: '#4b5563' }}>
          {pageConfig
            ? <>Scoped to <span style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{pageConfig}</span></>
            : 'Select a page to manage its triggers'}
        </div>
      </div>

      {/* Triggers section */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
        borderBottom: '2px solid #1f2937',
      }}>
        <div
          style={{ ...SECTION_HDR, flexShrink: 0, cursor: 'pointer' }}
          onClick={() => setOpen(o => !o)}
        >
          <span style={{ ...SEC_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              fontSize: 8, color: '#6b7280', transition: 'transform 0.15s',
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block',
            }}>▶</span>
            {pageName}
          </span>
          <button
            data-testid="add-page-trigger"
            onClick={e => { e.stopPropagation(); addNew(); }}
            style={{ ...ADD_BTN, opacity: pageConfig ? 1 : 0.4, cursor: pageConfig ? 'pointer' : 'not-allowed' }}
            disabled={!pageConfig}
          >
            + New
          </button>
        </div>

        {open && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!pageConfig ? (
              <div style={EMPTY}>
                This page has no route config — cannot add page-scoped triggers.
              </div>
            ) : entries.length === 0 ? (
              <div style={EMPTY}>
                No triggers for {pageName}. Add one to react to page lifecycle events.
              </div>
            ) : (
              entries.map(entry => (
                <TriggerRow
                  key={entry.id}
                  triggerValue={entry.trigger}
                  name={entry.name}
                  stepCount={entry.stepCount}
                  onOpen={() => openWorkflowCanvas({ kind: 'pageWorkflow', name: entry.id })}
                  onDelete={() => removePageWorkflow(entry.id)}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Hint about app triggers */}
      <div style={{
        padding: '8px 12px', fontSize: 10, color: '#374151',
        borderTop: '1px solid #111827',
      }}>
        For global app triggers (appLoad, keydown, etc.) use the{' '}
        <button
          style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: 0, fontSize: 10 }}
          onClick={() => window.dispatchEvent(new CustomEvent('builder:open-left-tab', { detail: 'triggers' }))}
        >
          App Triggers tab ↗
        </button>
      </div>
    </div>
  );
}
