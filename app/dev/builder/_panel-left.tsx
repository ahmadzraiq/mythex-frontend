'use client';

/**
 * Builder Left Panel — two tabs: Layers + Components
 *
 * Layers tab:
 *   - Full node tree with type icons
 *   - Expand/collapse tree
 *   - Visibility + lock toggles per row
 *   - Double-click to rename node ID
 *   - Right-click context menu (copy, paste, duplicate, delete, group, move up/down)
 *   - Keyboard: Delete to remove, Escape to deselect
 *   - SDUI badges: condition | map | actions
 *
 * Components tab:
 *   - All section variants, grouped by type
 *   - Draggable onto canvas via HTML5 drag API
 *   - Thumbnail + variant name
 */

import React, { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react';
import { useBuilderStore, findParentNode, findNode } from './_store';
import type { BuilderStore, BuilderPage, CustomVar, PageMeta } from './_store';
import type { SDUINode } from '@/lib/sdui/types/node';
import routes from '@/config/routes.json';
import { useSduiStore } from '@/store/sdui-store';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';
import app from '@/config/app';
import { ExprBuilder } from './_expr-builder';
import { ActionBuilder } from './_action-builder';
import { DataTab, type DataTabSlideState } from './_data-tab';
import { LogicTab, type LogicSlideState } from './_logic-tab';


// ─── Extracted modules ───────────────────────────────────────────────────────
import { Chevron, NodeIcon, ContextMenu, LayerRow, LayerTree, type LayerRowProps, type ContextMenuProps, type LayerDragState } from './_layers-panel';
import { PRIMITIVE_COMPONENTS, SectionHeader, DraggablePrimitive, ComponentsTab } from './_components-tab';
import { CustomVarsSection, VarsWorkflowsSection, VarsFormulasSection, VarsPanel } from './_vars-panel';
import { AssetsTab } from './_assets-tab';
import { SharedComponentsTab } from './_shared-components-tab';
import { TriggersTab } from './_triggers-tab';


// ─── Pages Tab ────────────────────────────────────────────────────────────────

function PagesTab() {
  const { pages, currentPageId, addPage, navigatePage, renamePage, removePage } = useBuilderStore();
  const [showRouteMenu, setShowRouteMenu] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [customRoute, setCustomRoute] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  // Close route picker on outside click
  useEffect(() => {
    if (!showRouteMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowRouteMenu(false);
        setCustomRoute('');
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [showRouteMenu]);

  const allRoutes = (routes as { routes: Array<{ path: string; config: string }> }).routes;

  const commitRename = useCallback(() => {
    if (renamingId) {
      renamePage(renamingId, renameValue);
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, renamePage]);

  const handleAddCustomRoute = useCallback(() => {
    const r = customRoute.trim();
    if (!r) return;
    const path = r.startsWith('/') ? r : `/${r}`;
    // If this route already exists, navigate to it instead of adding a duplicate
    const existing = pages.find((p: BuilderPage) => p.route === path);
    if (existing) {
      navigatePage(existing.id);
    } else {
      addPage(path, path);
    }
    setCustomRoute('');
    setShowRouteMenu(false);
  }, [customRoute, pages, addPage, navigatePage]);

  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Page list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '6px 0' }}>
        {pages.map((page: BuilderPage) => {
          const isActive = page.id === currentPageId;
          const isRenaming = renamingId === page.id;
          return (
            <div
              key={page.id}
              data-testid={`page-row-${page.id}`}
              onClick={() => !isRenaming && navigatePage(page.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 10px',
                cursor: 'pointer',
                background: isActive ? 'rgba(59,130,246,0.15)' : 'transparent',
                borderLeft: isActive ? '2px solid #3b82f6' : '2px solid transparent',
                borderRadius: 4,
                margin: '1px 6px',
                userSelect: 'none',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
            >
              {/* Page icon */}
              <span style={{ fontSize: 13, flexShrink: 0, opacity: 0.6 }}>📄</span>

              {/* Name / rename input */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
                      e.stopPropagation();
                    }}
                    onClick={e => e.stopPropagation()}
                    style={{
                      width: '100%',
                      background: '#1f2937',
                      border: '1px solid #3b82f6',
                      borderRadius: 3,
                      color: '#f3f4f6',
                      fontSize: 11,
                      padding: '1px 5px',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                ) : (
                  <>
                    <div style={{
                      fontSize: 11,
                      color: isActive ? '#f3f4f6' : '#d1d5db',
                      fontWeight: isActive ? 600 : 400,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    onDoubleClick={e => {
                      e.stopPropagation();
                      setRenamingId(page.id);
                      setRenameValue(page.name);
                    }}
                    >
                      {page.name}
                    </div>
                    {page.route && (
                    <div style={{ fontSize: 9, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {page.route}
                    </div>
                    )}
                  </>
                )}
              </div>

              {/* Delete button */}
              {!isRenaming && (
                <button
                  title="Remove page"
                  onClick={e => { e.stopPropagation(); removePage(page.id); }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#6b7280',
                    cursor: 'pointer',
                    fontSize: 13,
                    lineHeight: 1,
                    padding: '2px 4px',
                    borderRadius: 3,
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add page button + route picker */}
      <div style={{ padding: '8px 10px', borderTop: '1px solid #1f2937', flexShrink: 0, position: 'relative' }} ref={menuRef}>
        <button
          data-testid="add-page-btn"
          onClick={() => setShowRouteMenu(v => !v)}
          style={{
            width: '100%',
            padding: '7px 0',
            background: showRouteMenu ? '#1d4ed8' : '#1f2937',
            border: `1px solid ${showRouteMenu ? '#3b82f6' : '#374151'}`,
            borderRadius: 5,
            color: '#d1d5db',
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
          Add page
        </button>

        {/* Route picker dropdown */}
        {showRouteMenu && (
          <div style={{
            position: 'absolute',
            bottom: '100%',
            left: 10,
            right: 10,
            background: '#1f2937',
            border: '1px solid #374151',
            borderRadius: 6,
            boxShadow: '0 -4px 20px rgba(0,0,0,0.5)',
            zIndex: 9999,
            maxHeight: 300,
            overflow: 'hidden',
            marginBottom: 4,
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Custom route input */}
            <div style={{ padding: '8px 10px', borderBottom: '1px solid #374151', flexShrink: 0 }}>
              <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 5, letterSpacing: '0.04em' }}>CUSTOM ROUTE</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  autoFocus
                  placeholder="/my-page"
                  value={customRoute}
                  onChange={e => setCustomRoute(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleAddCustomRoute();
                    if (e.key === 'Escape') { setShowRouteMenu(false); setCustomRoute(''); }
                    e.stopPropagation();
                  }}
                  style={{
                    flex: 1,
                    background: '#111827',
                    border: '1px solid #374151',
                    borderRadius: 4,
                    color: '#f3f4f6',
                    fontSize: 11,
                    padding: '4px 8px',
                    outline: 'none',
                    fontFamily: 'monospace',
                  }}
                />
                <button
                  onClick={handleAddCustomRoute}
                  disabled={!customRoute.trim()}
                  style={{
                    padding: '4px 10px',
                    background: customRoute.trim() ? '#1d4ed8' : '#374151',
                    border: 'none',
                    borderRadius: 4,
                    color: customRoute.trim() ? '#fff' : '#6b7280',
                    fontSize: 11,
                    cursor: customRoute.trim() ? 'pointer' : 'default',
                    fontFamily: 'system-ui',
                    flexShrink: 0,
                  }}
                >
                  Add
                </button>
              </div>
            </div>

            {/* Predefined routes from routes.json */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <div style={{ padding: '6px 10px 4px', fontSize: 10, color: '#6b7280', letterSpacing: '0.04em' }}>
                APP ROUTES
              </div>
              {allRoutes.map(r => {
                const alreadyAdded = pages.some((p: BuilderPage) => p.route === r.path);
                return (
                  <button
                    key={r.config}
                    disabled={alreadyAdded}
                    onClick={() => {
                      if (alreadyAdded) return;
                      addPage(r.path, r.config);
                      setShowRouteMenu(false);
                    }}
                    style={{
                      display: 'flex',
                      width: '100%',
                      alignItems: 'baseline',
                      gap: 6,
                      padding: '6px 10px',
                      background: 'none',
                      border: 'none',
                      color: alreadyAdded ? '#4b5563' : '#d1d5db',
                      fontSize: 11,
                      textAlign: 'left',
                      cursor: alreadyAdded ? 'default' : 'pointer',
                      fontFamily: 'system-ui',
                    }}
                    onMouseEnter={e => { if (!alreadyAdded) e.currentTarget.style.background = 'rgba(59,130,246,0.15)'; }}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <span style={{ fontFamily: 'monospace', fontSize: 10, color: alreadyAdded ? '#374151' : '#60a5fa', flexShrink: 0 }}>
                      {r.path}
                    </span>
                    <span style={{ opacity: alreadyAdded ? 0.35 : 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.config}
                    </span>
                    {alreadyAdded && <span style={{ marginLeft: 'auto', fontSize: 9, color: '#374151', flexShrink: 0 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

// ─── App Panel (Store / Actions / Sources) ───────────────────────────────────

const ACTION_TYPE_COLORS: Record<string, string> = {
  graphql: '#818cf8',
  fetch: '#34d399',
  set: '#fbbf24',
  setVar: '#f9a8d4',
  validate: '#f87171',
  runMultiple: '#93c5fd',
  navigate: '#a78bfa',
  appendToPath: '#6ee7b7',
  toggle: '#fcd34d',
  default: '#6b7280',
};

function ActionTypeBadge({ type }: { type: string }) {
  const color = ACTION_TYPE_COLORS[type] ?? ACTION_TYPE_COLORS.default;
  return (
    <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: color + '33', color, border: `1px solid ${color}55`, fontFamily: 'monospace', flexShrink: 0 }}>
      {type}
    </span>
  );
}

function StoreTab({ embedded = false }: { embedded?: boolean }) {
  const zustandData = useSduiStore(s => s.data);
  const [vsData, setVsData] = useState<Record<string, unknown>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');

  useEffect(() => {
    const vs = getGlobalVariableStore();
    setVsData(vs.getState().getFullState());
    return vs.subscribe(() => setVsData(vs.getState().getFullState()));
  }, []);

  // Build a merged nested-like snapshot from Zustand flat keys + VS nested
  const snapshot = useMemo(() => {
    const groups: Record<string, Record<string, unknown>> = {};
    // Zustand flat keys → group by top-level prefix
    for (const [k, v] of Object.entries(zustandData)) {
      const dot = k.indexOf('.');
      const group = dot >= 0 ? k.slice(0, dot) : k;
      const sub = dot >= 0 ? k.slice(dot + 1) : '__value__';
      if (!groups[group]) groups[group] = {};
      groups[group][sub] = v;
    }
    // VS nested keys
    for (const [k, v] of Object.entries(vsData)) {
      if (!groups[k]) groups[k] = {};
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        Object.assign(groups[k], v);
      } else {
        groups[k]['__value__'] = v;
      }
    }
    return groups;
  }, [zustandData, vsData]);

  const filteredGroups = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return snapshot;
    return Object.fromEntries(
      Object.entries(snapshot).filter(([k]) => k.toLowerCase().includes(q))
    );
  }, [snapshot, search]);

  const content = (
    <>
      <div style={{ padding: '4px 8px', flexShrink: 0 }}>
        <input
          placeholder="Filter by key…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 5, color: '#d1d5db', fontSize: 11, padding: '4px 8px', boxSizing: 'border-box' }}
        />
      </div>
      <div style={embedded ? { padding: '4px 0' } : { flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {Object.entries(filteredGroups).map(([group, values]) => (
          <div key={group}>
            <button
              onClick={() => setExpanded(p => ({ ...p, [group]: !p[group] }))}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '4px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#d1d5db', fontSize: 11 }}
            >
              <Chevron open={!!expanded[group]} size={10} />
              <span style={{ fontWeight: 600, color: '#e5e7eb' }}>{group}</span>
              <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 'auto' }}>{Object.keys(values).length} key{Object.keys(values).length !== 1 ? 's' : ''}</span>
            </button>
            {expanded[group] && (
              <div style={{ paddingLeft: 20 }}>
                {Object.entries(values).map(([k, v]) => (
                  <div key={k} data-testid={`store-entry-${group}.${k}`} style={{ display: 'flex', gap: 8, padding: '2px 12px 2px 4px', borderBottom: '1px solid #1f293750' }}>
                    <span style={{ color: '#9ca3af', fontSize: 10, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0, maxWidth: 90 }}>
                      {k === '__value__' ? group : `${group}.${k}`}
                    </span>
                    <span style={{ color: '#6ee7b7', fontSize: 10, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                      {JSON.stringify(v).slice(0, 60)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {Object.keys(filteredGroups).length === 0 && (
          <div style={{ color: '#4b5563', fontSize: 12, textAlign: 'center', padding: 16 }}>No store data yet</div>
        )}
      </div>
    </>
  );

  if (embedded) return <div style={{ display: 'flex', flexDirection: 'column' }}>{content}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {content}
    </div>
  );
}

function ActionsTab() {
  const actions = app.actions as unknown as Record<string, { type: string }>;
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Group by detected prefix
  const groups = useMemo(() => {
    const g: Record<string, Array<[string, { type: string }]>> = {};
    for (const [name, def] of Object.entries(actions)) {
      const prefix = name.replace(/([A-Z])/g, ' $1').split(' ')[0].toLowerCase();
      if (!g[prefix]) g[prefix] = [];
      g[prefix].push([name, def]);
    }
    return g;
  }, [actions]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return groups;
    const out: typeof groups = {};
    for (const [grp, rows] of Object.entries(groups)) {
      const matching = rows.filter(([n]) => n.toLowerCase().includes(q));
      if (matching.length) out[grp] = matching;
    }
    return out;
  }, [groups, search]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ padding: '6px 8px', flexShrink: 0 }}>
        <input
          placeholder="Filter actions…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 5, color: '#d1d5db', fontSize: 11, padding: '4px 8px', boxSizing: 'border-box' }}
        />
      </div>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #1f2937', fontSize: 10, color: '#4b5563', lineHeight: 1.6, flexShrink: 0 }}>
        Use named actions in Interactions → select "namedAction" and type the action name.
        Defined in <code style={{ color: '#818cf8' }}>config/actions/</code>.
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {Object.entries(filtered).map(([grp, rows]) => (
          <div key={grp}>
            <div style={{ padding: '3px 12px', fontSize: 10, color: '#6b7280', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', background: '#0f172a' }}>
              {grp}
            </div>
            {rows.map(([name, def]) => (
              <div key={name}>
                <button
                  data-testid={`action-row-${name}`}
                  onClick={() => setExpanded(p => ({ ...p, [name]: !p[name] }))}
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '4px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid #1f2937' }}
                >
                  <span style={{ color: '#d1d5db', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  <ActionTypeBadge type={def.type} />
                  <Chevron open={!!expanded[name]} size={10} />
                </button>
                {expanded[name] && (
                  <pre style={{ margin: 0, padding: '6px 16px', background: '#0f172a', color: '#9ca3af', fontSize: 10, fontFamily: 'monospace', overflow: 'auto', maxHeight: 120 }}>
                    {JSON.stringify(def, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        ))}
        {Object.keys(filtered).length === 0 && (
          <div style={{ color: '#4b5563', fontSize: 12, textAlign: 'center', padding: 24 }}>No actions match</div>
        )}
      </div>
    </div>
  );
}

function SourcesTab() {
  const actions = app.actions as unknown as Record<string, { type: string; url?: string; method?: string; query?: string; endpoint?: string }>;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const sources = useMemo(() =>
    Object.entries(actions).filter(([, def]) => def.type === 'graphql' || def.type === 'fetch'),
    [actions]
  );

  if (sources.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 12, textAlign: 'center', padding: 24, flexDirection: 'column', gap: 8 }}>
        <div>No graphql / fetch actions defined</div>
        <div style={{ fontSize: 10, color: '#374151', maxWidth: 180 }}>
          Add fetch/graphql actions in <code style={{ color: '#34d399' }}>config/actions/</code> then use them in Interactions or Data Source sections.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #1f2937', fontSize: 10, color: '#4b5563', lineHeight: 1.6, flexShrink: 0 }}>
        Select an element → Logic tab → <span style={{ color: '#34d399' }}>Data Source</span> to trigger one of these on mount.
        Use them in Interactions to call on click/submit.
      </div>
    <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
      {sources.map(([name, def]) => (
        <div key={name} style={{ borderBottom: '1px solid #1f2937' }}>
          <button
            data-testid={`source-row-${name}`}
            onClick={() => setExpanded(p => ({ ...p, [name]: !p[name] }))}
            style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '6px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#d1d5db', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              <ActionTypeBadge type={def.type} />
            </div>
            <div style={{ color: '#6b7280', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {def.type === 'fetch' ? `${def.method ?? 'GET'} ${def.url ?? ''}` : `${def.endpoint ?? 'convention endpoint'}`}
            </div>
          </button>
          {expanded[name] && def.query && (
            <pre style={{ margin: 0, padding: '6px 16px', background: '#0f172a', color: '#9ca3af', fontSize: 10, fontFamily: 'monospace', overflow: 'auto', maxHeight: 120, whiteSpace: 'pre-wrap' }}>
              {def.query.slice(0, 400)}{def.query.length > 400 ? '\n…' : ''}
            </pre>
          )}
        </div>
      ))}
    </div>
    </div>
  );
}

function AppPreviewDataEditor() {
  const appPreviewData = useBuilderStore(s => s.appPreviewData);
  const setAppPreviewData = useBuilderStore(s => s.setAppPreviewData);
  const [raw, setRaw] = useState(() => JSON.stringify(appPreviewData, null, 2));
  const [error, setError] = useState<string | null>(null);

  const handleApply = useCallback(() => {
    try {
      const parsed = JSON.parse(raw);
      setAppPreviewData(parsed);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [raw, setAppPreviewData]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: '10px 8px', gap: 8 }}>
      <div style={{ fontSize: 10, color: '#9ca3af', lineHeight: 1.5 }}>
        Global mock data shared across all pages. Per-page data (set when &quot;Data&quot; state is active) overrides these values.
      </div>
      <textarea
        data-testid="app-preview-data-textarea"
        value={raw}
        onChange={e => { setRaw(e.target.value); setError(null); }}
        onBlur={handleApply}
        spellCheck={false}
        style={{
          flex: 1,
          resize: 'none',
          background: '#0f172a',
          color: '#e2e8f0',
          border: `1px solid ${error ? '#ef4444' : '#1f2937'}`,
          borderRadius: 4,
          fontFamily: 'monospace',
          fontSize: 11,
          padding: '6px 8px',
          outline: 'none',
          minHeight: 180,
        }}
      />
      {error && <div style={{ fontSize: 10, color: '#ef4444' }}>{error}</div>}
      <button
        data-testid="app-preview-data-apply"
        onClick={handleApply}
        style={{ padding: '5px 10px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer', alignSelf: 'flex-end' }}
      >
        Apply
      </button>
    </div>
  );
}

// ─── Page Config Slide ────────────────────────────────────────────────────────

const PC_INPUT: React.CSSProperties = {
  width: '100%', background: '#1f2937', border: '1px solid #374151',
  borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '5px 8px',
  outline: 'none', boxSizing: 'border-box',
};
const PC_LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: '#9ca3af',
  textTransform: 'uppercase', letterSpacing: '0.06em',
  display: 'block', marginBottom: 4,
};
const PC_SECTION: React.CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid #1f2937',
  display: 'flex', flexDirection: 'column', gap: 8,
};

export function PageConfigSlidePanelContent({ onClose }: { onClose: () => void }) {
  const { pages, currentPageId, renamePage, removePage, setCurrentPageMeta, setCurrentPageInteractions, pageWorkflows, setCurrentPageAccess } = useBuilderStore();
  const currentPage = pages.find(p => p.id === currentPageId);

  const [pageName, setPageName] = useState(currentPage?.name ?? '');
  const [title, setTitle] = useState(currentPage?.meta?.title ?? '');
  const [description, setDescription] = useState(currentPage?.meta?.description ?? '');
  const [ogImage, setOgImage] = useState(currentPage?.meta?.ogImage ?? '');
  const [mountWorkflow, setMountWorkflow] = useState(currentPage?.pageInteractions?.mount?.workflow ?? '');
  const [pageAccess, setPageAccess] = useState<'everyone' | 'authenticated'>(currentPage?.access ?? 'everyone');
  const [guestOnly, setGuestOnly] = useState(currentPage?.guestOnly ?? false);
  const [accessCondition, setAccessCondition] = useState(currentPage?.accessCondition ?? '');

  const workflowNames = Object.keys(pageWorkflows);

  const saveMeta = () => {
    const meta: PageMeta = {};
    if (title.trim()) meta.title = title.trim();
    if (description.trim()) meta.description = description.trim();
    if (ogImage.trim()) meta.ogImage = ogImage.trim();
    setCurrentPageMeta(meta);
  };

  const saveInteractions = (newMountWorkflow: string) => {
    const interactions: Record<string, { workflow?: string }> = {};
    if (newMountWorkflow.trim()) {
      interactions.mount = { workflow: newMountWorkflow.trim() };
    }
    setCurrentPageInteractions(interactions);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Page name */}
      <div style={PC_SECTION}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Page</div>
        <div>
          <label style={PC_LABEL}>Name</label>
          <input
            data-testid="page-config-name"
            value={pageName}
            onChange={e => setPageName(e.target.value)}
            onBlur={() => { if (currentPageId) renamePage(currentPageId, pageName); }}
            style={PC_INPUT}
          />
        </div>
        {currentPage?.route && (
          <div>
            <label style={PC_LABEL}>Route</label>
            <div style={{ ...PC_INPUT, color: '#6b7280', cursor: 'default' }}>{currentPage.route}</div>
          </div>
        )}
      </div>

      {/* SEO / Meta */}
      <div style={PC_SECTION}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>SEO / Meta</div>
        <div>
          <label style={PC_LABEL}>Page title</label>
          <input
            data-testid="page-config-meta-title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={saveMeta}
            placeholder="My page title"
            style={PC_INPUT}
          />
        </div>
        <div>
          <label style={PC_LABEL}>Description</label>
          <textarea
            data-testid="page-config-meta-description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onBlur={saveMeta}
            placeholder="Short description for search engines…"
            rows={3}
            style={{ ...PC_INPUT, resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>
        <div>
          <label style={PC_LABEL}>OG Image URL</label>
          <input
            value={ogImage}
            onChange={e => setOgImage(e.target.value)}
            onBlur={saveMeta}
            placeholder="https://…"
            style={PC_INPUT}
          />
        </div>
      </div>

      {/* Interactions */}
      <div style={PC_SECTION}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Interactions</div>
        <div>
          <label style={PC_LABEL}>On mount (page load)</label>
          <select
            data-testid="page-config-mount-workflow"
            value={mountWorkflow}
            onChange={e => { setMountWorkflow(e.target.value); saveInteractions(e.target.value); }}
            style={{ ...PC_INPUT, cursor: 'pointer' }}
          >
            <option value="">— none —</option>
            {workflowNames.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
          {mountWorkflow && (
            <button
              onClick={() => { setMountWorkflow(''); saveInteractions(''); }}
              style={{ marginTop: 4, background: 'none', border: 'none', color: '#f87171', fontSize: 10, cursor: 'pointer', padding: 0 }}
            >
              × Clear
            </button>
          )}
        </div>
      </div>

      {/* Private Access */}
      <div style={PC_SECTION}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Access</div>

        {/* Who can access */}
        <div>
          <label style={PC_LABEL}>Who can access this page</label>
          <select
            data-testid="page-config-access"
            value={pageAccess}
            onChange={e => {
              const val = e.target.value as 'everyone' | 'authenticated';
              setPageAccess(val);
              setCurrentPageAccess(val, guestOnly, accessCondition || undefined);
            }}
            style={{ ...PC_INPUT, cursor: 'pointer' }}
          >
            <option value="everyone">Everyone</option>
            <option value="authenticated">Authenticated users</option>
          </select>
        </div>

        {/* Additional formula condition — only shown for authenticated pages */}
        {pageAccess === 'authenticated' && (
          <div>
            <label style={PC_LABEL}>Additional condition (optional)</label>
            <input
              data-testid="page-config-access-condition"
              value={accessCondition}
              onChange={e => setAccessCondition(e.target.value)}
              onBlur={() => setCurrentPageAccess(pageAccess, guestOnly, accessCondition || undefined)}
              placeholder="auth?.user?.role === 'admin'"
              style={PC_INPUT}
            />
            <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>
              If fails → redirect to unauthorized page (set in Auth Settings)
            </div>
          </div>
        )}

        {/* Hide from authenticated users (guestOnly) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
          <label style={{ fontSize: 11, color: '#d1d5db' }}>Hide from authenticated users</label>
          <button
            data-testid="page-config-guest-only"
            onClick={() => {
              const next = !guestOnly;
              setGuestOnly(next);
              setCurrentPageAccess(pageAccess, next, accessCondition || undefined);
            }}
            style={{
              width: 32, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer',
              background: guestOnly ? '#818cf8' : '#374151',
              position: 'relative', flexShrink: 0, transition: 'background 150ms',
            }}
            title="When on, authenticated users are redirected away from this page (e.g. /sign-in)"
          >
            <span style={{
              position: 'absolute', top: 2, left: guestOnly ? 18 : 2,
              width: 12, height: 12, borderRadius: '50%', background: '#fff',
              transition: 'left 150ms',
            }} />
          </button>
        </div>
      </div>

      <div style={{ marginTop: 'auto', padding: '10px 12px', borderTop: '1px solid #1f2937', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          title="Delete this page"
          onClick={() => { if (currentPageId) { removePage(currentPageId); onClose(); } }}
          style={{ padding: '5px 10px', background: 'none', border: '1px solid #374151', borderRadius: 4, color: '#f87171', fontSize: 11, cursor: 'pointer', marginRight: 'auto' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.1)'; e.currentTarget.style.borderColor = '#f87171'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = '#374151'; }}
        >
          Delete page
        </button>
        <button
          onClick={onClose}
          style={{ padding: '5px 14px', background: '#1d4ed8', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, cursor: 'pointer' }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ─── Auth Settings Slide ──────────────────────────────────────────────────────

const A_INPUT: React.CSSProperties = {
  width: '100%', background: '#1f2937', border: '1px solid #374151',
  borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '5px 8px',
  outline: 'none', boxSizing: 'border-box',
};

// Aliases used inside AuthSettingsSlidePanelContent and RolesManagerView
const AUTH_INPUT = A_INPUT;
const AUTH_FIELD_LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: '#9ca3af',
  textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4,
};
const AUTH_SELECT: React.CSSProperties = {
  ...A_INPUT, appearance: 'none', paddingRight: 24, cursor: 'pointer',
};
const AUTH_CARD: React.CSSProperties = {
  background: '#111827', border: '1px solid #1f2937', borderRadius: 8,
  padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10,
};
const AUTH_STEP_NUM: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#e5e7eb',
};
const AUTH_DIVIDER = (
  <div style={{ height: 1, background: '#1f2937', margin: '2px 0' }} />
);
const A_LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: '#9ca3af',
  textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4,
};
const A_SECTION: React.CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid #1f2937',
  display: 'flex', flexDirection: 'column', gap: 8,
};
const A_SECTION_TITLE: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#9ca3af',
  textTransform: 'uppercase', letterSpacing: '0.08em',
};
const A_ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center',
  padding: '6px 12px', borderBottom: '1px solid #111827',
};

type AuthView = 'settings' | 'roles';

export function AuthSettingsSlidePanelContent({ onClose }: { onClose: () => void }) {
  const { authConfig, setAuthConfig, pages } = useBuilderStore();
  const [view, setView] = useState<AuthView>('settings');

  // ── Settings state ──────────────────────────────────────────────────────────
  const [tokenType, setTokenType] = useState<'bearer' | 'basic' | 'custom'>(authConfig?.tokenType ?? 'bearer');
  // Endpoint mode — 'graphql' when a userQuery exists, otherwise 'rest'
  const [endpointType, setEndpointType] = useState<'rest' | 'graphql'>(authConfig?.userQuery ? 'graphql' : 'rest');
  const [userEndpoint, setUserEndpoint] = useState(authConfig?.userEndpoint ?? '');
  const [userQueryEndpoint, setUserQueryEndpoint] = useState(authConfig?.userQueryEndpoint ?? '');
  const [userQuery, setUserQuery] = useState(authConfig?.userQuery ?? '');
  const [unauthenticatedRedirect, setUnauthenticatedRedirect] = useState(authConfig?.unauthenticatedRedirect ?? '');
  const [unauthorizedRedirect, setUnauthorizedRedirect] = useState(authConfig?.unauthorizedRedirect ?? '');
  const [roleProperty, setRoleProperty] = useState(authConfig?.roleProperty ?? 'role');

  const step1Done = endpointType === 'rest'
    ? userEndpoint.trim().length > 0
    : userQueryEndpoint.trim().length > 0 && userQuery.trim().length > 0;

  const save = useCallback(() => {
    setAuthConfig({
      ...(authConfig ?? {}),
      tokenType,
      tokenStorageKey: 'authToken',
      // Write only the fields relevant to the selected endpoint mode; clear the other
      userEndpoint:       endpointType === 'rest'     ? (userEndpoint.trim() || undefined)      : undefined,
      userQueryEndpoint:  endpointType === 'graphql'  ? (userQueryEndpoint.trim() || undefined) : undefined,
      userQuery:          endpointType === 'graphql'  ? (userQuery.trim() || undefined)         : undefined,
      unauthenticatedRedirect: unauthenticatedRedirect.trim() || '/sign-in',
      unauthorizedRedirect: unauthorizedRedirect.trim() || '/',
      authenticatedRedirect: authConfig?.authenticatedRedirect ?? '/',
      roleProperty: roleProperty.trim() || 'role',
    });
  }, [authConfig, setAuthConfig, tokenType, endpointType, userEndpoint, userQueryEndpoint, userQuery, unauthenticatedRedirect, unauthorizedRedirect, roleProperty]);

  const allRoutes = pages.map(p => ({ label: p.name || p.route || p.id, route: p.route ?? '/' }));

  if (view === 'roles') {
    return <RolesManagerView onBack={() => setView('settings')} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '12px', gap: 10 }}>

      {/* Step 1 — Configuration */}
      <div style={AUTH_CARD}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={AUTH_STEP_NUM}>1. Configuration</div>
          {step1Done
            ? <span style={{ color: '#34d399', fontSize: 16 }}>✓</span>
            : <span style={{ fontSize: 11, color: '#6b7280' }}>Fill in to continue</span>}
        </div>
        <div>
          <label style={AUTH_FIELD_LABEL}>Auth type *</label>
          <div style={{ position: 'relative' }}>
            <select value={tokenType} onChange={e => { setTokenType(e.target.value as 'bearer' | 'basic' | 'custom'); }} onBlur={save} style={AUTH_SELECT}>
              <option value="bearer">Auth Bearer Token</option>
              <option value="basic">Auth Basic</option>
              <option value="custom">Custom</option>
            </select>
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#6b7280', fontSize: 10 }}>▼</span>
          </div>
        </div>
        <div>
          <label style={AUTH_FIELD_LABEL}>User endpoint *</label>
          {/* REST / GraphQL mode toggle */}
          <div style={{ display: 'flex', background: '#1f2937', borderRadius: 4, padding: 2, gap: 2, marginBottom: 8 }}>
            {(['rest', 'graphql'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => { setEndpointType(mode); }}
                onBlur={save}
                style={{
                  flex: 1, padding: '4px 0', fontSize: 11, border: 'none', cursor: 'pointer', borderRadius: 3, fontWeight: 500,
                  background: endpointType === mode ? '#374151' : 'transparent',
                  color:      endpointType === mode ? '#f3f4f6'  : '#6b7280',
                }}
              >{mode === 'rest' ? 'REST API' : 'GraphQL'}</button>
            ))}
          </div>

          {endpointType === 'rest' ? (
            <input
              data-testid="auth-config-user-endpoint"
              value={userEndpoint}
              onChange={e => setUserEndpoint(e.target.value)}
              onBlur={save}
              placeholder="https://api-url.com/users/me"
              style={AUTH_INPUT}
            />
          ) : (
            <>
              <input
                data-testid="auth-config-graphql-endpoint"
                value={userQueryEndpoint}
                onChange={e => setUserQueryEndpoint(e.target.value)}
                onBlur={save}
                placeholder="https://api.example.com/graphql"
                style={{ ...AUTH_INPUT, marginBottom: 6 }}
              />
              <label style={{ ...AUTH_FIELD_LABEL, marginTop: 0 }}>User query</label>
              <textarea
                data-testid="auth-config-user-query"
                value={userQuery}
                onChange={e => setUserQuery(e.target.value)}
                onBlur={save}
                placeholder={'{ me { id email firstName lastName } }'}
                rows={4}
                style={{ ...AUTH_INPUT, resize: 'vertical', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.5 }}
              />
            </>
          )}
        </div>
      </div>

      {AUTH_DIVIDER}

      {/* Step 2 — Redirections */}
      <div style={AUTH_CARD}>
        <div style={AUTH_STEP_NUM}>2. Define redirections</div>
        <div>
          <label style={AUTH_FIELD_LABEL}>Page to redirect on unauthenticated access (not signed in)</label>
          <div style={{ position: 'relative' }}>
            <select data-testid="auth-config-unauth-redirect" value={unauthenticatedRedirect} onChange={e => { setUnauthenticatedRedirect(e.target.value); }} onBlur={save} style={AUTH_SELECT}>
              <option value="">None</option>
              {allRoutes.map(r => <option key={r.route} value={r.route}>{r.label}</option>)}
            </select>
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#6b7280', fontSize: 10 }}>▼</span>
          </div>
        </div>
        <div>
          <label style={AUTH_FIELD_LABEL}>Page to redirect on unauthorized access (not matching roles)</label>
          <div style={{ position: 'relative' }}>
            <select data-testid="auth-config-unauth-role-redirect" value={unauthorizedRedirect} onChange={e => { setUnauthorizedRedirect(e.target.value); }} onBlur={save} style={AUTH_SELECT}>
              <option value="">None</option>
              {allRoutes.map(r => <option key={r.route} value={r.route}>{r.label}</option>)}
            </select>
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#6b7280', fontSize: 10 }}>▼</span>
          </div>
        </div>
      </div>

      {AUTH_DIVIDER}

      {/* Step 3 — User role (optional) */}
      <div style={AUTH_CARD}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={AUTH_STEP_NUM}>3. User role configuration <span style={{ fontWeight: 400, fontSize: 11, color: '#6b7280' }}>(optional)</span></div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={AUTH_FIELD_LABEL}>User role property</label>
            <input value={roleProperty} onChange={e => setRoleProperty(e.target.value)} onBlur={save} placeholder="role" style={AUTH_INPUT} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={AUTH_FIELD_LABEL}>Property type</label>
            <div style={{ height: 28, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', background: '#1f2937', border: '1px solid #374151', borderRadius: 4 }}>
              <span style={{ fontSize: 11, color: '#60a5fa', fontWeight: 700 }}>T</span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>Text</span>
            </div>
          </div>
        </div>
      </div>

      {AUTH_DIVIDER}

      {/* Manage roles button */}
      <button
        onClick={() => setView('roles')}
        style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#3b82f6', color: '#fff', fontSize: 12, fontWeight: 600 }}
      >
        Manage roles
      </button>
    </div>
  );
}

// ─── Roles Manager View ───────────────────────────────────────────────────────

const RM = {
  searchRow: {
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
  } as React.CSSProperties,
  searchInput: {
    flex: 1, height: 30, background: '#1f2937', border: '1px solid #374151',
    borderRadius: 6, color: '#e5e7eb', fontSize: 11, padding: '0 10px 0 28px',
    outline: 'none', boxSizing: 'border-box',
  } as React.CSSProperties,
  addBtn: {
    display: 'flex', alignItems: 'center', gap: 4, height: 30,
    padding: '0 10px', background: 'none', border: '1px solid #3b82f6',
    borderRadius: 6, color: '#60a5fa', fontSize: 11, fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
  } as React.CSSProperties,
  tableHead: {
    display: 'flex', alignItems: 'center', padding: '0 10px',
    height: 28, background: '#1a2235',
    borderRadius: '6px 6px 0 0', borderBottom: '1px solid #1f2937',
  } as React.CSSProperties,
  thText: {
    fontSize: 10, fontWeight: 700, color: '#6b7280',
    textTransform: 'uppercase', letterSpacing: '0.05em',
  } as React.CSSProperties,
  row: {
    display: 'flex', alignItems: 'center', padding: '0 10px',
    height: 38, borderBottom: '1px solid #1a2235', cursor: 'default',
  } as React.CSSProperties,
  cellText: { fontSize: 12, color: '#e5e7eb' } as React.CSSProperties,
  timeText: { fontSize: 11, color: '#6b7280' } as React.CSSProperties,
  tag: {
    fontSize: 10, padding: '2px 7px', borderRadius: 12,
    background: '#1e3a5f', color: '#93c5fd', fontWeight: 500,
    border: '1px solid #2563eb44',
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: 12, fontWeight: 700, color: '#f3f4f6', marginBottom: 2,
  } as React.CSSProperties,
  sectionSub: {
    fontSize: 10, color: '#6b7280',
  } as React.CSSProperties,
};

function timeAgo(ts: number) {
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
}

function RolesManagerView({ onBack }: { onBack: () => void }) {
  const { authConfig, setAuthConfig } = useBuilderStore();
  const roles = authConfig?.roles ?? [];
  const userGroups = authConfig?.userGroups ?? [];

  const [roleSearch, setRoleSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [addRoleInput, setAddRoleInput] = useState('');
  const [showAddRole, setShowAddRole] = useState(false);
  const [addGroupPanel, setAddGroupPanel] = useState<{ name: string; roleIds: string[] } | null>(null);

  const persist = (nextRoles: typeof roles, nextGroups: typeof userGroups) =>
    setAuthConfig({ ...(authConfig ?? {}), roles: nextRoles, userGroups: nextGroups });

  const addRole = () => {
    const name = addRoleInput.trim();
    if (!name) return;
    persist([...roles, { id: `role-${Date.now()}`, name, createdAt: Date.now() }], userGroups);
    setAddRoleInput('');
    setShowAddRole(false);
  };

  const deleteRole = (id: string) =>
    persist(roles.filter(r => r.id !== id), userGroups.map(g => ({ ...g, roles: g.roles.filter(rid => rid !== id) })));

  const addGroup = () => {
    if (!addGroupPanel?.name.trim()) return;
    persist(roles, [...userGroups, { id: `grp-${Date.now()}`, name: addGroupPanel.name.trim(), roles: addGroupPanel.roleIds, createdAt: Date.now() }]);
    setAddGroupPanel(null);
  };

  const deleteGroup = (id: string) => persist(roles, userGroups.filter(g => g.id !== id));

  const visibleRoles = roles.filter(r => r.name.toLowerCase().includes(roleSearch.toLowerCase()));
  const visibleGroups = userGroups.filter(g => g.name.toLowerCase().includes(groupSearch.toLowerCase()));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>

      {/* Header */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, background: '#0f172a' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 13, padding: '2px 6px', lineHeight: 1, borderRadius: 4 }}
          onMouseEnter={e => (e.currentTarget.style.background = '#1e3a5f')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >← Back</button>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#f3f4f6' }}>Roles &amp; User Groups</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* ── Roles ── */}
        <section>
          <div style={{ marginBottom: 10 }}>
            <div style={RM.sectionTitle}>Roles</div>
          </div>

          {/* Search + Add */}
          <div style={RM.searchRow}>
            <div style={{ position: 'relative', flex: 1 }}>
              <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#4b5563', pointerEvents: 'none' }}>🔍</span>
              <input value={roleSearch} onChange={e => setRoleSearch(e.target.value)} placeholder="Search by role name" style={RM.searchInput} />
            </div>
            <button onClick={() => { setShowAddRole(v => !v); setAddRoleInput(''); }} style={RM.addBtn}>
              + Add role
            </button>
          </div>

          {/* Inline add input */}
          {showAddRole && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input
                autoFocus
                value={addRoleInput}
                onChange={e => setAddRoleInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addRole(); if (e.key === 'Escape') { setShowAddRole(false); } e.stopPropagation(); }}
                placeholder="Role name (e.g. admin)"
                style={{ ...AUTH_INPUT, flex: 1, height: 32 }}
              />
              <button
                onClick={addRole}
                disabled={!addRoleInput.trim()}
                style={{ height: 32, padding: '0 12px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600, cursor: addRoleInput.trim() ? 'pointer' : 'default', background: addRoleInput.trim() ? '#2563eb' : '#1f2937', color: addRoleInput.trim() ? '#fff' : '#4b5563' }}
              >
                Create
              </button>
            </div>
          )}

          {/* Table */}
          <div style={{ border: '1px solid #1f2937', borderRadius: 6, overflow: 'hidden' }}>
            <div style={RM.tableHead}>
              <span style={{ ...RM.thText, flex: 1 }}>Role name</span>
              <span style={{ ...RM.thText, width: 80 }}>Created at</span>
              <span style={{ width: 28 }} />
            </div>
            {visibleRoles.length === 0 ? (
              <div style={{ padding: '16px 10px', fontSize: 11, color: '#4b5563', textAlign: 'center' }}>
                {roleSearch ? 'No matching roles' : 'No roles yet — add one above'}
              </div>
            ) : visibleRoles.map((role, i) => (
              <div
                key={role.id}
                style={{ ...RM.row, background: i % 2 === 0 ? '#0f172a' : '#111827' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1e3a5f')}
                onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? '#0f172a' : '#111827')}
              >
                <span style={{ ...RM.cellText, flex: 1 }}>{role.name}</span>
                <span style={{ ...RM.timeText, width: 80 }}>{timeAgo(role.createdAt)}</span>
                <button
                  onClick={() => deleteRole(role.id)}
                  style={{ width: 28, background: 'none', border: 'none', color: '#374151', cursor: 'pointer', fontSize: 15, padding: 0, lineHeight: 1, borderRadius: 4 }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.background = 'rgba(248,113,113,0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#374151'; e.currentTarget.style.background = 'none'; }}
                  title="Delete role"
                >×</button>
              </div>
            ))}
          </div>
        </section>

        {/* ── User Groups ── */}
        <section>
          <div style={{ marginBottom: 10 }}>
            <div style={RM.sectionTitle}>User group</div>
            <div style={RM.sectionSub}>Manage page access with user groups</div>
          </div>

          <div style={RM.searchRow}>
            <div style={{ position: 'relative', flex: 1 }}>
              <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#4b5563', pointerEvents: 'none' }}>🔍</span>
              <input value={groupSearch} onChange={e => setGroupSearch(e.target.value)} placeholder="Search by user group name" style={RM.searchInput} />
            </div>
            <button onClick={() => setAddGroupPanel({ name: '', roleIds: [] })} style={RM.addBtn}>
              + Add user group
            </button>
          </div>

          <div style={{ border: '1px solid #1f2937', borderRadius: 6, overflow: 'hidden' }}>
            <div style={RM.tableHead}>
              <span style={{ ...RM.thText, width: 90 }}>Group name</span>
              <span style={{ ...RM.thText, flex: 1, marginLeft: 8 }}>Roles</span>
              <span style={{ ...RM.thText, width: 70 }}>Created at</span>
              <span style={{ width: 28 }} />
            </div>
            {visibleGroups.length === 0 ? (
              <div style={{ padding: '16px 10px', fontSize: 11, color: '#4b5563', textAlign: 'center' }}>
                {groupSearch ? 'No matching groups' : 'No user groups yet — add one above'}
              </div>
            ) : visibleGroups.map((group, i) => (
              <div
                key={group.id}
                style={{ ...RM.row, height: 'auto', minHeight: 38, padding: '6px 10px', alignItems: 'flex-start', background: i % 2 === 0 ? '#0f172a' : '#111827' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1e3a5f')}
                onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? '#0f172a' : '#111827')}
              >
                <span style={{ ...RM.cellText, width: 90, paddingTop: 2, fontWeight: 500 }}>{group.name}</span>
                <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4, marginLeft: 8, paddingTop: 2 }}>
                  {group.roles.map(rid => {
                    const r = roles.find(x => x.id === rid);
                    return r ? <span key={rid} style={RM.tag}>{r.name}</span> : null;
                  })}
                  {group.roles.length === 0 && <span style={{ fontSize: 11, color: '#4b5563' }}>No roles</span>}
                </div>
                <span style={{ ...RM.timeText, width: 70, paddingTop: 2 }}>{timeAgo(group.createdAt)}</span>
                <button
                  onClick={() => deleteGroup(group.id)}
                  style={{ width: 28, background: 'none', border: 'none', color: '#374151', cursor: 'pointer', fontSize: 15, padding: 0, lineHeight: 1, borderRadius: 4, flexShrink: 0 }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.background = 'rgba(248,113,113,0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#374151'; e.currentTarget.style.background = 'none'; }}
                  title="Delete group"
                >×</button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Add user group drawer — slides in from right inside the panel */}
      {addGroupPanel && (
        <>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50 }} onClick={() => setAddGroupPanel(null)} />
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '75%', background: '#0f172a', borderLeft: '1px solid #1f2937', display: 'flex', flexDirection: 'column', zIndex: 51, boxShadow: '-12px 0 32px rgba(0,0,0,0.6)' }}>
            {/* Drawer header */}
            <div style={{ padding: '12px 14px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0f172a' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#f3f4f6' }}>User group</span>
              <button onClick={() => setAddGroupPanel(null)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 0, borderRadius: 4 }}
                onMouseEnter={e => (e.currentTarget.style.color = '#f3f4f6')}
                onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
              >×</button>
            </div>

            {/* Drawer body */}
            <div style={{ flex: 1, padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', display: 'block', marginBottom: 6 }}>Given name *</label>
                <input
                  autoFocus
                  value={addGroupPanel.name}
                  onChange={e => setAddGroupPanel(p => p ? { ...p, name: e.target.value } : p)}
                  onKeyDown={e => { if (e.key === 'Enter') addGroup(); e.stopPropagation(); }}
                  placeholder="Enter a value"
                  style={AUTH_INPUT}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', display: 'block', marginBottom: 8 }}>Roles *</label>
                {roles.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#4b5563', padding: '8px 0' }}>No roles available — go back and add roles first.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {roles.map(role => {
                      const checked = addGroupPanel.roleIds.includes(role.id);
                      return (
                        <label key={role.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', background: checked ? '#1e3a5f' : 'transparent', border: `1px solid ${checked ? '#2563eb' : '#1f2937'}` }}
                          onMouseEnter={e => { if (!checked) e.currentTarget.style.background = '#1a2235'; }}
                          onMouseLeave={e => { if (!checked) e.currentTarget.style.background = 'transparent'; }}
                        >
                          <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${checked ? '#3b82f6' : '#374151'}`, background: checked ? '#3b82f6' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {checked && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
                          </div>
                          <input type="checkbox" checked={checked} onChange={() => setAddGroupPanel(p => p ? { ...p, roleIds: checked ? p.roleIds.filter(id => id !== role.id) : [...p.roleIds, role.id] } : p)} style={{ display: 'none' }} />
                          <span style={{ fontSize: 12, color: '#e5e7eb', fontWeight: checked ? 600 : 400 }}>{role.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Drawer footer */}
            <div style={{ padding: '12px 14px', borderTop: '1px solid #1f2937' }}>
              <button
                onClick={addGroup}
                disabled={!addGroupPanel.name.trim()}
                style={{ width: '100%', padding: '9px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 700, cursor: addGroupPanel.name.trim() ? 'pointer' : 'default', background: addGroupPanel.name.trim() ? '#2563eb' : '#1f2937', color: addGroupPanel.name.trim() ? '#fff' : '#4b5563' }}
              >
                Create
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface PanelLeftProps {
  dataSlideState: DataTabSlideState;
  onSetDataSlide: (s: DataTabSlideState) => void;
  logicSlideState: LogicSlideState;
  onSetLogicSlide: (s: LogicSlideState) => void;
  onOpenPageConfig: () => void;
  onOpenAuthConfig: () => void;
  onWidthChange?: (w: number) => void;
}

export default function PanelLeft({
  dataSlideState,
  onSetDataSlide,
  logicSlideState,
  onSetLogicSlide,
  onOpenPageConfig,
  onOpenAuthConfig,
  onWidthChange,
}: PanelLeftProps) {
  const [tab, setTab] = useState<'layers' | 'components' | 'data' | 'logic' | 'triggers' | 'assets' | 'shared'>('components');
  const [search, setSearch] = useState('');
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [layerDrag, setLayerDrag] = useState<LayerDragState>({ dragId: null, dropTargetId: null, dropPosition: 'above' });

  const store = useBuilderStore();

  // (Removed: no longer auto-switching to layers when entering edit mode)

  // Auto-expand ancestor nodes and scroll to the selected layer when canvas selection changes
  useEffect(() => {
    if (store.selectedIds.length !== 1) return;
    const targetId = store.selectedIds[0];

    // Search page nodes and canvas nodes so both are correctly expanded/scrolled-to when selected.
    const searchRoot = [...(store.pageNodes as SDUINode[]), ...(store.canvasNodes as SDUINode[])];

    // Walk up ancestry and collect IDs to expand
    const idsToExpand: string[] = [];
    let current: SDUINode | null = findNode(searchRoot, targetId) ?? null;
    while (current) {
      const currentId = (current as { id?: string }).id ?? '';
      const parent = currentId ? findParentNode(searchRoot, currentId) : null;
      if (!parent) break;
      const parentId = (parent as { id?: string }).id ?? '';
      if (parentId && !store.expandedIds.has(parentId)) {
        idsToExpand.push(parentId);
      }
      current = parent as SDUINode;
    }

    if (idsToExpand.length > 0) {
      store.setExpandedIds(new Set([...store.expandedIds, ...idsToExpand]));
    }

    // Scroll the selected layer row into view (only if already on the layers tab)
    requestAnimationFrame(() => {
      document.querySelector(`[data-node-id="${CSS.escape(targetId)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.selectedIds]);

  const handleLayerDragStart = useCallback((id: string) => {
    setLayerDrag({ dragId: id, dropTargetId: null, dropPosition: 'above' });
  }, []);

  const handleLayerDragOver = useCallback((hoverId: string, pos: 'above' | 'inside' | 'below') => {
    setLayerDrag(prev => {
      if (!prev.dragId || prev.dragId === hoverId) return prev;
      if (prev.dropTargetId === hoverId && prev.dropPosition === pos) return prev;
      return { ...prev, dropTargetId: hoverId, dropPosition: pos };
    });
  }, []);

  const handleLayerDrop = useCallback(() => {
    const { dragId, dropTargetId, dropPosition } = layerDrag;
    if (dragId && dropTargetId && dragId !== dropTargetId) {
      const { pageNodes, moveNode, moveNodes, selectedIds } = store;

      if (dropPosition === 'inside') {
        // Nest into the target node as its last child
        const targetNode = findNode(pageNodes, dropTargetId);
        const childCount = (targetNode?.children as SDUINode[] | undefined)?.length ?? 0;
        if (selectedIds.includes(dragId) && selectedIds.length > 1) {
          moveNodes(selectedIds, dropTargetId, childCount);
        } else {
          moveNode(dragId, dropTargetId, childCount);
        }
      } else {
        // Insert before or after target in target's parent
        const targetParent = findParentNode(pageNodes, dropTargetId);
        const siblings: SDUINode[] = targetParent
          ? (targetParent.children as SDUINode[])
          : pageNodes;
        const targetIdx = siblings.findIndex(n => (n as { id?: string }).id === dropTargetId);

        if (targetIdx >= 0) {
          const insertIdx = dropPosition === 'above' ? targetIdx : targetIdx + 1;
          const targetParentId = (targetParent as { id?: string } | null)?.id ?? null;

          if (selectedIds.includes(dragId) && selectedIds.length > 1) {
            moveNodes(selectedIds, targetParentId, insertIdx);
          } else {
            moveNode(dragId, targetParentId, insertIdx);
          }
        }
      }
    }
    setLayerDrag({ dragId: null, dropTargetId: null, dropPosition: 'above' });
  }, [layerDrag, store]);

  // Show all pageNodes — in shared-component edit mode this includes both the original page
  // content AND the component root appended at the end, so both are visible in layers.
  const baseNodes = store.pageNodes as SDUINode[];

  const filteredNodes = useMemo(() => {
    if (!search.trim()) return baseNodes;
    const q = search.toLowerCase();
    const filterTree = (nodes: SDUINode[]): SDUINode[] =>
      nodes.reduce<SDUINode[]>((acc, n) => {
        const id = ((n as { id?: string }).id ?? n.type).toLowerCase();
        const childMatch = filterTree(n.children as SDUINode[] ?? []);
        if (id.includes(q) || childMatch.length) {
          acc.push({ ...n, children: childMatch.length ? childMatch : n.children });
        }
        return acc;
      }, []);
    return filterTree(baseNodes);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseNodes, search]);

  const ctxHandlers = useMemo(() => ({
    show: (id: string, x: number, y: number) => setContextMenu({ id, x, y }),
  }), []);

  const pages = useBuilderStore(s => s.pages);
  const currentPageId = useBuilderStore(s => s.currentPageId);
  const currentPageName = pages.find(p => p.id === currentPageId)?.name ?? '';

  return (
    <div data-testid="panel-left" style={{ width: 240, height: '100%', display: 'flex', flexDirection: 'column', background: '#111827', borderRight: '1px solid #1f2937', overflow: 'hidden' }}>
      {/* Page settings bar — only shown when a page exists */}
      {pages.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
          <span style={{ fontSize: 10, opacity: 0.5, flexShrink: 0 }}>📄</span>
          <span style={{ flex: 1, fontSize: 11, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentPageName}
          </span>
          <button
            data-testid="auth-config-btn"
            onClick={onOpenAuthConfig}
            title="Auth settings (token, user endpoint, redirects)"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 12, padding: '2px 4px', borderRadius: 3, flexShrink: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = '#d1d5db')}
            onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
          >
            🔐
          </button>
          <button
            data-testid="page-config-btn"
            onClick={onOpenPageConfig}
            title="Page settings (name, SEO meta, interactions)"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 14, padding: '2px 4px', borderRadius: 3, flexShrink: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = '#d1d5db')}
            onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
          >
            ⚙
          </button>
        </div>
      )}
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        {(['layers', 'components', 'data', 'logic', 'triggers', 'shared', 'assets'] as const).map(t => (
          <button
            key={t}
            data-testid={`tab-${t}`}
            style={{
              flex: 1,
              padding: '9px 0',
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid #3b82f6' : '2px solid transparent',
              color: tab === t ? '#f3f4f6' : '#6b7280',
              fontSize: 10,
              cursor: 'pointer',
              textTransform: 'capitalize',
              marginBottom: -1,
            }}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'layers' && (
        <>
          {/* Search */}
          <div style={{ padding: '6px 8px', flexShrink: 0 }}>
            <input
              placeholder="Search layers…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 5, color: '#d1d5db', fontSize: 11, padding: '4px 8px', boxSizing: 'border-box' }}
            />
          </div>

          {/* Empty state */}
          {filteredNodes.length === 0 && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 12, textAlign: 'center', padding: 16 }}>
              {baseNodes.length === 0
                ? 'Drop a component to get started'
                : 'No layers match your search'}
            </div>
          )}

          {/* Tree */}
          <div
            data-testid="layers-tree"
            style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}
            onClick={e => {
              // Deselect when clicking on empty space (not on a layer row)
              if (!(e.target as HTMLElement).closest('[data-layer-row]')) {
                store.select(null);
              }
            }}
          >
            <LayerTree
              nodes={filteredNodes as SDUINode[]}
              store={store}
              contextMenuHandlers={ctxHandlers}
              dragState={layerDrag}
              onLayerDragStart={handleLayerDragStart}
              onLayerDragOver={handleLayerDragOver}
              onLayerDrop={handleLayerDrop}
            />
            {/* Canvas nodes (freeform nodes outside pages) */}
            {(store.canvasNodes as SDUINode[]).length > 0 && (
              <>
                <div style={{ padding: '6px 8px 2px', fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Canvas</div>
                <LayerTree
                  nodes={store.canvasNodes as SDUINode[]}
                  store={store}
                  contextMenuHandlers={ctxHandlers}
                  dragState={layerDrag}
                  onLayerDragStart={handleLayerDragStart}
                  onLayerDragOver={handleLayerDragOver}
                  onLayerDrop={handleLayerDrop}
                />
              </>
            )}
          </div>
        </>
      )}

      {tab === 'components' && <ComponentsTab />}

      {tab === 'data' && <DataTab onSetSlide={onSetDataSlide} onWidthChange={onWidthChange} />}

      {tab === 'logic' && <LogicTab onSetSlide={onSetLogicSlide} />}

      {tab === 'triggers' && <TriggersTab />}

      {tab === 'shared' && <SharedComponentsTab />}

      {tab === 'assets' && <AssetsTab />}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeId={contextMenu.id}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
