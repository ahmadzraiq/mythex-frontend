'use client';

/**
 * _panel-right-workflows.tsx
 *
 * PreviewDataEditor and ElementWorkflowsTab for the builder right panel.
 * Extracted from _panel-right.tsx.
 *
 * Exports: PreviewDataEditor, ElementWorkflowsTab
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useBuilderStore } from './_store';
import type { SDUINode } from '@/lib/sdui/types/node';
import { WorkflowBindButton, toHumanName } from './_workflow-canvas';

// ─── Preview Data Editor ──────────────────────────────────────────────────────

// Stable empty object — avoids creating a new {} reference on every render for pages without previewData
const EMPTY_PREVIEW_DATA: Record<string, unknown> = {};

export function PreviewDataEditor() {
  // Use targeted selectors to avoid re-rendering on every store change
  const setCurrentPagePreviewData = useBuilderStore(s => s.setCurrentPagePreviewData);
  const appPreviewData = useBuilderStore(s => s.appPreviewData);
  const pageData = useBuilderStore(s => s.pages.find(p => p.id === s.currentPageId)?.previewData ?? EMPTY_PREVIEW_DATA);

  // Keep a ref for appPreviewData so the effect closure always has the latest without it being a dep
  const appPreviewDataRef = useRef(appPreviewData);
  appPreviewDataRef.current = appPreviewData;

  // Show merged data as starting point when page data is empty so user sees all applied data
  const initialDraft = Object.keys(pageData).length > 0
    ? pageData
    : { ...appPreviewData, ...pageData };

  const [draft, setDraft] = useState(() => JSON.stringify(initialDraft, null, 2));
  const [error, setError] = useState<string | null>(null);
  const prevPageDataRef = useRef<Record<string, unknown>>(pageData);

  // Sync external store changes into the draft only when pageData identity changes.
  // appPreviewData is intentionally not in deps — we read it via ref to avoid excess re-runs.
  useEffect(() => {
    if (prevPageDataRef.current !== pageData) {
      prevPageDataRef.current = pageData;
      const newDraft = Object.keys(pageData).length > 0
        ? pageData
        : { ...appPreviewDataRef.current, ...pageData };
      setDraft(JSON.stringify(newDraft, null, 2));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageData]);

  const handleSave = useCallback(() => {
    try {
      const parsed = JSON.parse(draft) as Record<string, unknown>;
      setError(null);
      setCurrentPagePreviewData(parsed);
    } catch {
      setError('Invalid JSON');
    }
  }, [draft, setCurrentPagePreviewData]);

  const appKeyCount = Object.keys(appPreviewData).length;
  const pageKeyCount = Object.keys(pageData).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: 12, gap: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa', letterSpacing: '0.05em' }}>PREVIEW DATA</span>
        <button
          data-testid="preview-data-save"
          onClick={handleSave}
          style={{ padding: '3px 10px', background: '#7c3aed', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, cursor: 'pointer' }}
        >
          Apply
        </button>
      </div>
      {/* Badge showing app vs page key counts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, background: '#1e1b4b', color: '#a78bfa', padding: '2px 6px', borderRadius: 4, border: '1px solid #4c1d95' }}>
          App: {appKeyCount} keys
        </span>
        <span style={{ fontSize: 10, background: '#1f2937', color: '#9ca3af', padding: '2px 6px', borderRadius: 4, border: '1px solid #374151' }}>
          Page override: {pageKeyCount} keys
        </span>
      </div>
      <div style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.5 }}>
        Editing saves page-level overrides. App-level data is set in <strong style={{ color: '#9ca3af' }}>App &rarr; Preview Data</strong>.
      </div>
      <textarea
        data-testid="preview-data-editor"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={handleSave}
        spellCheck={false}
        style={{
          flex: 1,
          minHeight: 200,
          background: '#111827',
          color: '#e5e7eb',
          border: `1px solid ${error ? '#f87171' : '#374151'}`,
          borderRadius: 6,
          padding: 10,
          fontSize: 11,
          fontFamily: 'monospace',
          resize: 'vertical',
          outline: 'none',
          lineHeight: 1.6,
        }}
      />
      {error && <span style={{ fontSize: 11, color: '#f87171' }}>{error}</span>}
    </div>
  );
}

// ─── Element Workflows Tab ────────────────────────────────────────────────────

function WorkflowRowMenu({ uuid, onOpen, onRemove }: { uuid: string; onOpen: () => void; onRemove: () => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px 4px', fontSize: 16, lineHeight: 1, borderRadius: 4 }}
        title="More options"
      >
        ⋮
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', right: 0, top: '100%', zIndex: 999,
            background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)', minWidth: 150, overflow: 'hidden',
          }}
          onClick={e => e.stopPropagation()}
        >
          {uuid && (
            <button
              onClick={() => { setOpen(false); onOpen(); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', color: '#e2e8f0', fontSize: 12, cursor: 'pointer' }}
            >
              ↗ Open in canvas
            </button>
          )}
          <button
            onClick={() => { setOpen(false); onRemove(); }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer' }}
          >
            × Remove
          </button>
        </div>
      )}
    </div>
  );
}

export function ElementWorkflowsTab({ node }: { node: SDUINode | null }) {
  const { openWorkflowCanvas, pageWorkflowMeta, patchNodeField, setPageWorkflow, setPageWorkflowMeta } = useBuilderStore();
  const [hovered, setHovered] = useState<string | null>(null);

  if (!node) {
    return (
      <div
        data-testid="right-workflows-empty"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', gap: 10 }}
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#d1d5db' }}>Workflows</span>
        <span style={{ fontSize: 11, color: '#4b5563', lineHeight: 1.5 }}>Select an element to manage its workflows.</span>
      </div>
    );
  }

  const nodeId = (node as { id?: string }).id ?? '';

  // Normalise actions: new format is an array of ActionRefs, legacy is an event-keyed object
  const rawActions = node.actions;
  type WorkflowEntry = { uuid: string; trigger: string; idx: number };
  let workflowEntries: WorkflowEntry[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawActionsArr = Array.isArray(rawActions) ? (rawActions as any[]) : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawActionsObj = (!Array.isArray(rawActions) && rawActions && typeof rawActions === 'object') ? (rawActions as Record<string, any>) : null;

  if (rawActionsArr) {
    // New format: [{ action: "uuid" }, ...]
    workflowEntries = rawActionsArr
      .filter((a: unknown) => a && typeof (a as Record<string, unknown>).action === 'string')
      .map((a: Record<string, unknown>, idx: number) => {
        const uuid = a.action as string;
        const trigger = pageWorkflowMeta[uuid]?.trigger ?? 'click';
        return { uuid, trigger, idx };
      })
      // Hide system-managed workflows (auto-generated onChange setters)
      .filter(({ uuid }) => !pageWorkflowMeta[uuid]?.isSystem);
  } else if (rawActionsObj) {
    // Legacy event-keyed object format — skip inline system actions (e.g. setFormField)
    // only show pure ActionRef entries { action: "uuid" } which have no "type" property
    workflowEntries = Object.entries(rawActionsObj)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter(([, actionDef]) => !(actionDef as any)?.type)
      .map(([event, actionDef], idx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const uuid = (actionDef as any)?.action as string ?? event;
        return { uuid, trigger: event, idx };
      });
  }

  function handleBind(idx: number, newUuid: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current: any[] = rawActionsArr ? [...rawActionsArr] : [];
    if (!newUuid) {
      const updated = current.filter((_: unknown, i: number) => i !== idx);
      patchNodeField(nodeId, 'actions', updated.length > 0 ? updated : undefined);
    } else {
      current[idx] = { action: newUuid };
      patchNodeField(nodeId, 'actions', current);
    }
  }

  function handleAddNew() {
    // Create a new empty workflow, attach it to this element, and open the canvas immediately
    const uuid = crypto.randomUUID();
    setPageWorkflow(uuid, []);
    setPageWorkflowMeta(uuid, { id: uuid, name: 'New Workflow', trigger: 'click' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current: any[] = rawActionsArr ? [...rawActionsArr] : [];
    patchNodeField(nodeId, 'actions', [...current, { action: uuid }]);
    openWorkflowCanvas({ kind: 'pageWorkflow', name: uuid, nodeId });
  }

  return (
    <div data-testid="right-workflows-panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#e5e7eb', letterSpacing: '0.01em' }}>
          ⚡ Workflows
        </span>
        <button
          data-testid="right-workflows-new-btn"
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 12px', background: '#1d4ed8', border: 'none',
            borderRadius: 6, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}
          onClick={handleAddNew}
        >
          + New
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {workflowEntries.length === 0 ? (
          <div
            data-testid="right-workflows-create-cta"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24, gap: 8, textAlign: 'center' }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#d1d5db' }}>No workflows yet</span>
            <span style={{ fontSize: 11, color: '#4b5563', lineHeight: 1.5 }}>Click + New to attach a workflow to this element.</span>
          </div>
        ) : (
          workflowEntries.map(({ uuid, trigger, idx }) => {
            const meta = pageWorkflowMeta[uuid];
            const displayName = meta?.name ? toHumanName(meta.name) : 'Unnamed Workflow';
            const triggerDisplay = trigger ? `On ${trigger}` : 'On click';
            return (
              <div
                key={`${uuid}-${idx}`}
                data-testid={`right-workflow-row-${idx}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px',
                  borderBottom: '1px solid #1f2937',
                  background: hovered === `${idx}` ? 'rgba(255,255,255,0.04)' : 'transparent',
                  cursor: 'default',
                }}
                onMouseEnter={() => setHovered(`${idx}`)}
                onMouseLeave={() => setHovered(null)}
              >
                {/* Left: trigger icon */}
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: '#1e293b', border: '1px solid #334155',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, color: '#94a3b8',
                }}>
                  {/* cursor/pointer icon */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
                  </svg>
                </div>

                {/* Center: name + trigger */}
                {uuid ? (
                  <div
                    style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                    onClick={() => openWorkflowCanvas({ kind: 'pageWorkflow', name: uuid, nodeId })}
                    title="Open workflow canvas"
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {displayName}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                      {triggerDisplay}
                    </div>
                  </div>
                ) : (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <WorkflowBindButton value="" onChange={newUuid => handleBind(idx, newUuid)} />
                  </div>
                )}

                {/* Right: three-dot menu */}
                <WorkflowRowMenu
                  uuid={uuid}
                  onOpen={() => uuid && openWorkflowCanvas({ kind: 'pageWorkflow', name: uuid, nodeId })}
                  onRemove={() => handleBind(idx, '')}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

