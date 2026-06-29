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
  padding: '8px 12px',
};
const SEC_LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--bld-text-2)',
  textTransform: 'none',
};
const EMPTY: React.CSSProperties = {
  fontSize: 11, color: 'var(--bld-text-3)', fontStyle: 'italic',
  padding: '10px 14px',
};
const ADD_BTN: React.CSSProperties = {
  padding: '3px 10px', background: 'var(--bld-accent)', border: 'none',
  borderRadius: 4, color: '#fff', fontSize: 10, cursor: 'pointer',
};

export function PageTriggersInRightPanel() {
  const {
    focusedPageId,
    pages,
    workflows,
    setWorkflow,
    removeWorkflow,
    openWorkflowCanvas,
  } = useBuilderStore(useShallow(s => ({
    focusedPageId: s.focusedPageId,
    pages: s.pages,
    workflows: s.workflows,
    setWorkflow: s.setWorkflow,
    removeWorkflow: s.removeWorkflow,
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

  const wfMap = workflows as Record<string, import('@/config/types').WorkflowDef>;
  // List only page-scoped triggers for this page
  const entries = Object.entries(wfMap)
    .filter(([, wf]) =>
      wf.isTrigger &&
      !wf.isAppTrigger &&
      (wf.pageScope === pageConfig ||
       wf.pageScope?.toLowerCase() === focusedPage?.name?.toLowerCase()) &&
      PAGE_TRIGGER_VALUES.has(wf.trigger ?? ''),
    )
    .map(([id, wf]) => ({
      id,
      trigger: wf.trigger ?? '',
      name: wf.name ?? id,
      stepCount: (wf.steps ?? []).length,
    }));

  const addNew = () => {
    const id = crypto.randomUUID();
    setWorkflow(id, {
      id,
      name: 'Untitled trigger',
      trigger: 'pageLoad',
      isTrigger: true,
      steps: [],
      ...(pageConfig ? { pageScope: pageConfig } : {}),
    });
    openWorkflowCanvas({ kind: 'pageWorkflow', name: id, isNew: true });
  };

  return (
    <div
      data-testid="page-triggers-panel"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
    >
      {/* Triggers section */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div
          style={{ ...SECTION_HDR, flexShrink: 0, cursor: 'pointer' }}
          onClick={() => setOpen(o => !o)}
        >
          <span style={{ ...SEC_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--bld-text-disabled)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}><polyline points="9 18 15 12 9 6" /></svg>
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
                  onDelete={() => removeWorkflow(entry.id)}
                />
              ))
            )}
          </div>
        )}
      </div>

    </div>
  );
}
