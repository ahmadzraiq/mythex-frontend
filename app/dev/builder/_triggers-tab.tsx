'use client';

/**
 * Triggers Tab — left panel "App Triggers" tab.
 *
 * Shows only app-level triggers (isAppTrigger: true). These fire globally on
 * every page regardless of route — e.g. appLoad, keydown, scroll.
 *
 * Page-scoped triggers (isTrigger: true, isAppTrigger: false, pageScope set)
 * are shown in the right panel's PageTriggersInRightPanel when no node is selected.
 *
 * Stored in store.workflows with { isTrigger: true, isAppTrigger: true }.
 */

import React, { useState } from 'react';
import { useBuilderStore } from './_store';
import routesConfig from '@/config/routes.json';

// ─── All available pages (from routes.json) ──────────────────────────────────

const ALL_PAGES = (routesConfig as { routes: Array<{ path: string; config: string }> })
  .routes.map(r => ({ config: r.config, path: r.path }));

// ─── Shared styles (mirrors _logic-tab.tsx) ───────────────────────────────────

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

// ─── Icon atoms ───────────────────────────────────────────────────────────────

const Icons = {
  Zap: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  Globe: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  Page: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  Scroll: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 11 12 6 7 11" />
      <polyline points="17 18 12 13 7 18" />
    </svg>
  ),
  Resize: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  ),
  Keyboard: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <line x1="6" y1="10" x2="6" y2="10" strokeWidth="3" />
      <line x1="10" y1="10" x2="10" y2="10" strokeWidth="3" />
      <line x1="14" y1="10" x2="14" y2="10" strokeWidth="3" />
      <line x1="18" y1="10" x2="18" y2="10" strokeWidth="3" />
      <line x1="6" y1="14" x2="18" y2="14" />
    </svg>
  ),
  AlertCircle: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
};

type IconComponent = () => JSX.Element;

// ─── Trigger type definitions (for icon lookup) ───────────────────────────────

export interface TriggerTypeDef {
  value: string;
  label: string;
  category: string;
}

export const APP_TRIGGER_DEFS: TriggerTypeDef[] = [
  { value: 'appLoadBefore',        label: 'On app load (before fetching collections)', category: 'Lifecycle'      },
  { value: 'appLoad',              label: 'On app load',                               category: 'Lifecycle'      },
  { value: 'pageLoadBefore',       label: 'On page load (before fetching collections)', category: 'Lifecycle'     },
  { value: 'pageLoad',             label: 'On page load',                               category: 'Lifecycle'     },
  { value: 'pageUnload',           label: 'On page unload',                             category: 'Lifecycle'     },
  { value: 'scroll',               label: 'On page scroll',                             category: 'Listeners'     },
  { value: 'resize',               label: 'On page resize',                             category: 'Listeners'     },
  { value: 'keydown',              label: 'On keydown',                                 category: 'Listeners'     },
  { value: 'keyup',                label: 'On keyup',                                   category: 'Listeners'     },
  { value: 'collectionFetchError', label: 'On collection fetch error',                  category: 'Error handling'},
];

export const PAGE_TRIGGER_DEFS: TriggerTypeDef[] = [
  { value: 'pageLoadBefore',       label: 'On page load (before fetching collections)', category: 'Lifecycle'      },
  { value: 'pageLoad',             label: 'On page load',                               category: 'Lifecycle'      },
  { value: 'pageUnload',           label: 'On page unload',                             category: 'Lifecycle'      },
  { value: 'scroll',               label: 'On page scroll',                             category: 'Listeners'      },
  { value: 'resize',               label: 'On page resize',                             category: 'Listeners'      },
  { value: 'keydown',              label: 'On keydown',                                 category: 'Listeners'      },
  { value: 'keyup',                label: 'On keyup',                                   category: 'Listeners'      },
  { value: 'collectionFetchError', label: 'On collection fetch error',                  category: 'Error handling' },
];

// ─── Icon map ─────────────────────────────────────────────────────────────────

const TRIGGER_ICONS: Record<string, { Icon: IconComponent; color: string }> = {
  appLoadBefore:        { Icon: Icons.Globe,       color: '#a78bfa' },
  appLoad:              { Icon: Icons.Globe,       color: '#a78bfa' },
  pageLoadBefore:       { Icon: Icons.Page,        color: 'var(--bld-info)' },
  pageLoad:             { Icon: Icons.Page,        color: 'var(--bld-info)' },
  pageUnload:           { Icon: Icons.Page,        color: 'var(--bld-info)' },
  scroll:               { Icon: Icons.Scroll,      color: '#34d399' },
  resize:               { Icon: Icons.Resize,      color: '#34d399' },
  keydown:              { Icon: Icons.Keyboard,    color: '#34d399' },
  keyup:                { Icon: Icons.Keyboard,    color: '#34d399' },
  collectionFetchError: { Icon: Icons.AlertCircle, color: 'var(--bld-error)' },
};

// ─── Trigger workflow row (exported for reuse in PageTriggersInRightPanel) ────

export function TriggerRow({
  triggerValue,
  name,
  stepCount,
  onOpen,
  onDelete,
}: {
  triggerValue: string;
  name: string;
  stepCount: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const iconDef = TRIGGER_ICONS[triggerValue];
  const Icon = iconDef?.Icon ?? Icons.Zap;
  const iconColor = iconDef?.color ?? 'var(--bld-info)';
  const stepsLabel = `${stepCount} step${stepCount !== 1 ? 's' : ''}`;

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column',
        borderBottom: '1px solid #111827',
        background: hovered ? 'rgba(255,255,255,0.03)' : 'transparent',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Main row */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px 6px', cursor: 'pointer' }}
        onClick={onOpen}
      >
        {/* Icon */}
        <div style={{
          width: 28, height: 28, borderRadius: 6, flexShrink: 0,
          background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: iconColor,
        }}>
          <Icon />
        </div>

        {/* Name + step count */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11, fontWeight: 500, color: 'var(--bld-text-2)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {name}
          </div>
          <div style={{ fontSize: 10, color: '#3b82f6', marginTop: 1 }}>
            {stepsLabel}
          </div>
        </div>

        {/* Trigger value badge */}
        <div style={{
          fontSize: 9, color: 'var(--bld-text-disabled)', background: 'var(--bld-bg-base)',
          border: '1px solid var(--bld-bg-elevated)', borderRadius: 3, padding: '2px 5px',
          flexShrink: 0, maxWidth: 80, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {triggerValue}
        </div>

        {/* Delete */}
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--bld-text-disabled)', fontSize: 16, padding: '0 2px', flexShrink: 0, lineHeight: 1,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--bld-error)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--bld-border-subtle)')}
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ─── App Triggers section ─────────────────────────────────────────────────────

function TriggerSection({
  title,
  defaultTrigger,
  triggerSet,
  open,
  onToggle,
}: {
  title: string;
  /** Trigger value pre-selected when creating a new workflow from this section */
  defaultTrigger: string;
  /** Set of trigger values that belong to this section */
  triggerSet: Set<string>;
  open: boolean;
  onToggle: () => void;
}) {
  const { workflows, setWorkflow, removeWorkflow, openWorkflowCanvas } = useBuilderStore();
  const wfMap = workflows as Record<string, import('@/config/types').WorkflowDef>;

  // Only show app-level triggers (isAppTrigger: true)
  const entries = Object.entries(wfMap)
    .filter(([, wf]) => wf.isTrigger && wf.isAppTrigger === true && triggerSet.has(wf.trigger ?? ''))
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
      trigger: defaultTrigger,
      isTrigger: true,
      isAppTrigger: true,
      steps: [],
    });
    openWorkflowCanvas({ kind: 'pageWorkflow', name: id, isNew: true });
  };

  return (
    <div style={{
      flex: open ? '1 1 0' : '0 0 auto', minWidth: 0, minHeight: 0,
      borderBottom: '0.5px solid var(--bld-bg-input)', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', transition: 'flex 0.2s',
    }}>
      {/* Header */}
      <div
        style={{ ...SECTION_HDR, flexShrink: 0, cursor: 'pointer' }}
        onClick={onToggle}
      >
        <span style={{ ...SEC_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--bld-text-disabled)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}><polyline points="9 18 15 12 9 6" /></svg>
          {title}
        </span>
        <button
          data-testid={`add-trigger-${title.toLowerCase().replace(' ', '-')}`}
          onClick={e => { e.stopPropagation(); addNew(); }}
          style={ADD_BTN}
        >+ New</button>
      </div>

      {open && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {entries.length === 0 && (
            <div style={EMPTY}>No triggers — click + New to create one.</div>
          )}
          {entries.map(entry => (
            <TriggerRow
              key={entry.id}
              triggerValue={entry.trigger}
              name={entry.name}
              stepCount={entry.stepCount}
              onOpen={() => openWorkflowCanvas({ kind: 'pageWorkflow', name: entry.id })}
              onDelete={() => removeWorkflow(entry.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main TriggersTab ─────────────────────────────────────────────────────────

const APP_TRIGGER_VALUES = new Set(APP_TRIGGER_DEFS.map(d => d.value));
export const PAGE_TRIGGER_VALUES = new Set(PAGE_TRIGGER_DEFS.map(d => d.value));

export function TriggersTab() {
  const [appOpen, setAppOpen] = useState(true);

  return (
    <div
      data-testid="triggers-tab"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
    >
      <TriggerSection
        title="App Triggers"
        defaultTrigger="appLoad"
        triggerSet={APP_TRIGGER_VALUES}
        open={appOpen}
        onToggle={() => setAppOpen(o => !o)}
      />
    </div>
  );
}
