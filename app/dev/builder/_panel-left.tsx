'use client';

/**
 * Builder Left Panel — 7 tabs: Layers / Components / Data / Logic / App Triggers / Assets / Theme
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
 *
 * Theme tab:
 *   - Global CSS variable / token editor (ThemePanel)
 *   - Custom colors and font settings
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
import { SearchInput } from './_panel-primitives';
import { CustomVarsSection, VarsWorkflowsSection, VarsFormulasSection, VarsPanel } from './_vars-panel';
import { AssetsTab } from './_assets-tab';
import { TriggersTab } from './_triggers-tab';
import { ThemePanel } from './_theme-panel';


// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _PagesTab_unused() {
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
                borderLeft: isActive ? '2px solid var(--bld-accent)' : '2px solid transparent',
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
                      background: 'var(--bld-bg-input)',
                      border: '1px solid var(--bld-accent)',
                      borderRadius: 3,
                      color: 'var(--bld-text-1)',
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
                      color: isActive ? 'var(--bld-text-1)' : 'var(--bld-text-2)',
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
                    <div style={{ fontSize: 9, color: 'var(--bld-text-disabled)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                    color: 'var(--bld-text-disabled)',
                    cursor: 'pointer',
                    fontSize: 13,
                    lineHeight: 1,
                    padding: '2px 4px',
                    borderRadius: 3,
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--bld-error)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--bld-text-disabled)')}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add page button + route picker */}
      <div style={{ padding: '8px 10px', borderTop: 'none', flexShrink: 0, position: 'relative' }} ref={menuRef}>
        <button
          data-testid="add-page-btn"
          onClick={() => setShowRouteMenu(v => !v)}
          style={{
            width: '100%',
            padding: '7px 0',
            background: showRouteMenu ? 'var(--bld-accent-hover)' : 'var(--bld-bg-input)',
            border: `1px solid ${showRouteMenu ? 'var(--bld-accent)' : 'var(--bld-border-subtle)'}`,
            borderRadius: 5,
            color: 'var(--bld-text-2)',
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
            background: 'var(--bld-bg-input)',
            border: '1px solid var(--bld-border-subtle)',
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
            <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--bld-border-subtle)', flexShrink: 0 }}>
              <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginBottom: 5 }}>CUSTOM ROUTE</div>
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
                    background: 'var(--bld-bg-panel)',
                    border: '1px solid var(--bld-border-subtle)',
                    borderRadius: 4,
                    color: 'var(--bld-text-1)',
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
                    background: customRoute.trim() ? 'var(--bld-accent-hover)' : 'var(--bld-border-subtle)',
                    border: 'none',
                    borderRadius: 4,
                    color: customRoute.trim() ? 'var(--bld-accent-fg)' : 'var(--bld-text-disabled)',
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
              <div style={{ padding: '6px 10px 4px', fontSize: 10, color: 'var(--bld-text-disabled)' }}>
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
                      color: alreadyAdded ? 'var(--bld-border-subtle)' : 'var(--bld-text-2)',
                      fontSize: 11,
                      textAlign: 'left',
                      cursor: alreadyAdded ? 'default' : 'pointer',
                      fontFamily: 'system-ui',
                    }}
                    onMouseEnter={e => { if (!alreadyAdded) e.currentTarget.style.background = 'rgba(59,130,246,0.15)'; }}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <span style={{ fontFamily: 'monospace', fontSize: 10, color: alreadyAdded ? 'var(--bld-border-subtle)' : 'var(--bld-info)', flexShrink: 0 }}>
                      {r.path}
                    </span>
                    <span style={{ opacity: alreadyAdded ? 0.35 : 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.config}
                    </span>
                    {alreadyAdded && <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--bld-text-disabled)', flexShrink: 0 }}>✓</span>}
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
  graphql: 'var(--bld-accent)',
  fetch: 'var(--bld-success)',
  set: 'var(--bld-warning)',
  setVar: 'var(--bld-badge-boolean)',
  validate: 'var(--bld-error)',
  runMultiple: 'var(--bld-accent)',
  navigate: 'var(--bld-accent)',
  appendToPath: 'var(--bld-success)',
  toggle: 'var(--bld-warning)',
  default: 'var(--bld-text-disabled)',
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
          style={{ width: '100%', background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 5, color: 'var(--bld-text-2)', fontSize: 11, padding: '4px 8px', boxSizing: 'border-box' }}
        />
      </div>
      <div style={embedded ? { padding: '4px 0' } : { flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {Object.entries(filteredGroups).map(([group, values]) => (
          <div key={group}>
            <button
              onClick={() => setExpanded(p => ({ ...p, [group]: !p[group] }))}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '4px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--bld-text-2)', fontSize: 11 }}
            >
              <Chevron open={!!expanded[group]} size={10} />
              <span style={{ fontWeight: 600, color: 'var(--bld-text-2)' }}>{group}</span>
              <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginLeft: 'auto' }}>{Object.keys(values).length} key{Object.keys(values).length !== 1 ? 's' : ''}</span>
            </button>
            {expanded[group] && (
              <div style={{ paddingLeft: 20 }}>
                {Object.entries(values).map(([k, v]) => (
                  <div key={k} data-testid={`store-entry-${group}.${k}`} style={{ display: 'flex', gap: 8, padding: '2px 12px 2px 4px', borderBottom: 'none' }}>
                    <span style={{ color: 'var(--bld-text-3)', fontSize: 10, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0, maxWidth: 90 }}>
                      {k === '__value__' ? group : `${group}.${k}`}
                    </span>
                    <span style={{ color: 'var(--bld-success)', fontSize: 10, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                      {JSON.stringify(v).slice(0, 60)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {Object.keys(filteredGroups).length === 0 && (
          <div style={{ color: 'var(--bld-text-disabled)', fontSize: 12, textAlign: 'center', padding: 16 }}>No store data yet</div>
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
          style={{ width: '100%', background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 5, color: 'var(--bld-text-2)', fontSize: 11, padding: '4px 8px', boxSizing: 'border-box' }}
        />
      </div>
      <div style={{ padding: '6px 10px', borderBottom: 'none', fontSize: 10, color: 'var(--bld-text-disabled)', lineHeight: 1.6, flexShrink: 0 }}>
        Use named actions in Interactions → select "namedAction" and type the action name.
        Defined in <code style={{ color: 'var(--bld-accent)' }}>config/actions/</code>.
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {Object.entries(filtered).map(([grp, rows]) => (
          <div key={grp}>
            <div style={{ padding: '3px 12px', fontSize: 10, color: 'var(--bld-text-disabled)', fontWeight: 600, textTransform: 'none', background: 'var(--bld-bg-base)' }}>
              {grp}
            </div>
            {rows.map(([name, def]) => (
              <div key={name}>
                <button
                  data-testid={`action-row-${name}`}
                  onClick={() => setExpanded(p => ({ ...p, [name]: !p[name] }))}
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '4px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, borderBottom: 'none' }}
                >
                  <span style={{ color: 'var(--bld-text-2)', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  <ActionTypeBadge type={def.type} />
                  <Chevron open={!!expanded[name]} size={10} />
                </button>
                {expanded[name] && (
                  <pre style={{ margin: 0, padding: '6px 16px', background: 'var(--bld-bg-base)', color: 'var(--bld-text-3)', fontSize: 10, fontFamily: 'monospace', overflow: 'auto', maxHeight: 120 }}>
                    {JSON.stringify(def, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        ))}
        {Object.keys(filtered).length === 0 && (
          <div style={{ color: 'var(--bld-text-disabled)', fontSize: 12, textAlign: 'center', padding: 24 }}>No actions match</div>
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
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--bld-text-disabled)', fontSize: 12, textAlign: 'center', padding: 24, flexDirection: 'column', gap: 8 }}>
        <div>No graphql / fetch actions defined</div>
        <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', maxWidth: 180 }}>
          Add fetch/graphql actions in <code style={{ color: 'var(--bld-success)' }}>config/actions/</code> then use them in Interactions or Data Source sections.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '6px 10px', borderBottom: 'none', fontSize: 10, color: 'var(--bld-text-disabled)', lineHeight: 1.6, flexShrink: 0 }}>
        Select an element → Logic tab → <span style={{ color: 'var(--bld-success)' }}>Data Source</span> to trigger one of these on mount.
        Use them in Interactions to call on click/submit.
      </div>
    <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
      {sources.map(([name, def]) => (
        <div key={name} style={{ borderBottom: 'none' }}>
          <button
            data-testid={`source-row-${name}`}
            onClick={() => setExpanded(p => ({ ...p, [name]: !p[name] }))}
            style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '6px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--bld-text-2)', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              <ActionTypeBadge type={def.type} />
            </div>
            <div style={{ color: 'var(--bld-text-disabled)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {def.type === 'fetch' ? `${def.method ?? 'GET'} ${def.url ?? ''}` : `${def.endpoint ?? 'convention endpoint'}`}
            </div>
          </button>
          {expanded[name] && def.query && (
            <pre style={{ margin: 0, padding: '6px 16px', background: 'var(--bld-bg-base)', color: 'var(--bld-text-3)', fontSize: 10, fontFamily: 'monospace', overflow: 'auto', maxHeight: 120, whiteSpace: 'pre-wrap' }}>
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
      <div style={{ fontSize: 10, color: 'var(--bld-text-3)', lineHeight: 1.5 }}>
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
          background: 'var(--bld-bg-base)',
          color: 'var(--bld-text-2)',
          border: `1px solid ${error ? 'var(--bld-error)' : 'var(--bld-bg-input)'}`,
          borderRadius: 4,
          fontFamily: 'monospace',
          fontSize: 11,
          padding: '6px 8px',
          outline: 'none',
          minHeight: 180,
        }}
      />
      {error && <div style={{ fontSize: 10, color: 'var(--bld-error)' }}>{error}</div>}
      <button
        data-testid="app-preview-data-apply"
        onClick={handleApply}
        style={{ padding: '5px 10px', background: 'var(--bld-accent)', color: 'var(--bld-accent-fg)', border: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer', alignSelf: 'flex-end' }}
      >
        Apply
      </button>
    </div>
  );
}

// ─── Page Config Slide ────────────────────────────────────────────────────────

const PC_INPUT: React.CSSProperties = {
  width: '100%', background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)',
  borderRadius: 4, color: 'var(--bld-text-1)', fontSize: 11, padding: '5px 8px',
  outline: 'none', boxSizing: 'border-box',
};
const PC_LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: 'var(--bld-text-3)',
  textTransform: 'none',
  display: 'block', marginBottom: 4,
};
const PC_SECTION: React.CSSProperties = {
  padding: '10px 12px', borderBottom: 'none',
  display: 'flex', flexDirection: 'column', gap: 8,
};

export function PageConfigSlidePanelContent({ onClose }: { onClose: () => void }) {
  const { pages, currentPageId, renamePage, removePage, setCurrentPageMeta } = useBuilderStore();
  const currentPage = pages.find(p => p.id === currentPageId);

  const [pageName, setPageName] = useState(currentPage?.name ?? '');
  const [title, setTitle] = useState(currentPage?.meta?.title ?? '');
  const [description, setDescription] = useState(currentPage?.meta?.description ?? '');
  const [ogImage, setOgImage] = useState(currentPage?.meta?.ogImage ?? '');

  const saveMeta = () => {
    const meta: PageMeta = {};
    if (title.trim()) meta.title = title.trim();
    if (description.trim()) meta.description = description.trim();
    if (ogImage.trim()) meta.ogImage = ogImage.trim();
    setCurrentPageMeta(meta);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Page name */}
      <div style={PC_SECTION}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--bld-text-3)', textTransform: 'none' }}>Page</div>
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
            <div style={{ ...PC_INPUT, color: 'var(--bld-text-disabled)', cursor: 'default' }}>{currentPage.route}</div>
          </div>
        )}
      </div>

      {/* SEO / Meta */}
      <div style={PC_SECTION}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--bld-text-3)', textTransform: 'none' }}>SEO / Meta</div>
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

      <div style={{ marginTop: 'auto', padding: '10px 12px', borderTop: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          title="Delete this page"
          onClick={() => { if (currentPageId) { removePage(currentPageId); onClose(); } }}
          style={{ padding: '5px 10px', background: 'none', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-error)', fontSize: 11, cursor: 'pointer', marginRight: 'auto' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.1)'; e.currentTarget.style.borderColor = 'var(--bld-error)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = 'var(--bld-border-subtle)'; }}
        >
          Delete page
        </button>
        <button
          onClick={onClose}
          style={{ padding: '5px 14px', background: 'var(--bld-accent-hover)', border: 'none', borderRadius: 4, color: 'var(--bld-accent-fg)', fontSize: 11, cursor: 'pointer' }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
type LeftTabId = 'layers' | 'components' | 'data' | 'logic' | 'triggers' | 'assets' | 'theme' | 'files';

interface PanelLeftProps {
  activeTab: LeftTabId;
  onTabChange: (t: LeftTabId) => void;
  dataSlideState: DataTabSlideState;
  onSetDataSlide: (s: DataTabSlideState) => void;
  logicSlideState: LogicSlideState;
  onSetLogicSlide: (s: LogicSlideState) => void;
  onWidthChange?: (w: number) => void;
  /** Called by ThemePanel to open the right slide panel for custom color add/edit. */
  onOpenColorSlide?: (state: { kind: 'addColor' } | { kind: 'editColor'; id: string }) => void;
  /** When true, shows the Config Files tab (admin / dev mode only). */
  isDevMode?: boolean;
}

export default function PanelLeft({
  activeTab,
  onTabChange,
  dataSlideState,
  onSetDataSlide,
  logicSlideState,
  onSetLogicSlide,
  onWidthChange,
  onOpenColorSlide,
  isDevMode = false,
}: PanelLeftProps) {
  const tab = activeTab;
  const setTab = onTabChange;
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

  return (
    <div data-testid="panel-left" style={{
      width: 240, height: '100%', display: 'flex', flexDirection: 'column',
      backgroundColor: 'var(--bld-bg-panel)',
      backgroundImage: [
        'radial-gradient(ellipse 120% 40% at 50% 100%, rgba(99,102,241,0.07) 0%, transparent 60%)',
        'radial-gradient(circle, rgba(255,255,255,0.022) 1px, transparent 1px)',
      ].join(', '),
      backgroundSize: 'auto, 22px 22px',
      borderRight: '1px solid var(--bld-bg-input)', overflow: 'hidden',
    }}>
      {/* Tab bar — 4 icon-only tabs, styled to match the right panel */}
      <div style={{ display: 'flex', borderBottom: 'none', flexShrink: 0 }}>
        {([
          {
            id: 'layers' as LeftTabId,
            title: 'Layers',
            icon: (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1.5 5.5L8 2l6.5 3.5L8 9 1.5 5.5z"/>
                <path d="M1.5 9L8 12.5 14.5 9"/>
                <path d="M1.5 12L8 15.5 14.5 12" opacity="0.45"/>
              </svg>
            ),
          },
          {
            id: 'components' as LeftTabId,
            title: 'Components',
            icon: (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor"/>
                <rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor"/>
                <rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor"/>
                <rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor"/>
              </svg>
            ),
          },
          {
            id: 'data' as LeftTabId,
            title: 'Data',
            icon: (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <ellipse cx="7" cy="3.5" rx="4.5" ry="1.6" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                <path d="M2.5 3.5v3c0 .88 2.015 1.6 4.5 1.6s4.5-.72 4.5-1.6v-3" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                <path d="M2.5 6.5v3c0 .88 2.015 1.6 4.5 1.6s4.5-.72 4.5-1.6v-3" stroke="currentColor" strokeWidth="1.2" fill="none"/>
              </svg>
            ),
          },
          {
            id: 'theme' as LeftTabId,
            title: 'Theme',
            icon: (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9.5 2C10.3 1.2 11.5 1.2 12.2 2C12.9 2.7 12.9 3.9 12.2 4.6L5.8 11C5.3 11.5 4.5 11.9 3.5 12C3.5 11 3.9 10.2 4.4 9.7Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" fill="none"/>
                <path d="M3.2 12.2C2.8 12.6 2.5 12.5 2.2 12.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            ),
          },
        ] as const).map(({ id: t, title, icon }) => (
          <button
            key={t}
            data-testid={`tab-${t}`}
            title={title}
            style={{
              flex: 1,
              padding: '9px 0',
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--bld-accent)' : '2px solid transparent',
              color: tab === t ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)',
              cursor: 'pointer',
              marginBottom: -1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={() => setTab(t)}
          >
            {icon}
          </button>
        ))}
      </div>

      {tab === 'layers' && (
        <>
          {/* Search */}
          <div style={{ padding: '6px 8px', flexShrink: 0 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search layers…" />
          </div>

          {/* Empty state */}
          {filteredNodes.length === 0 && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--bld-text-disabled)', fontSize: 12, textAlign: 'center', padding: 16 }}>
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
                <div style={{ padding: '6px 8px 2px', fontSize: 9, color: 'var(--bld-text-disabled)', textTransform: 'none' }}>Canvas</div>
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

      {(tab === 'data' || tab === 'logic') && (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <DataTab onSetSlide={onSetDataSlide} onWidthChange={onWidthChange} merged />
          <LogicTab onSetSlide={onSetLogicSlide} merged />
        </div>
      )}

      {tab === 'triggers' && <TriggersTab />}

      {tab === 'assets' && <AssetsTab />}

      {tab === 'theme' && <ThemePanel onOpenColorSlide={onOpenColorSlide} />}

      {/* 'files' tab is now handled by the FileExplorer SlidePanel in page.tsx */}

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
