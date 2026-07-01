'use client';

import { useState, createContext, useContext, useCallback } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { auth, workspaces as workspacesApi, type User, type Workspace } from '@/lib/platform/api-client';
import { useAuth } from './_auth-provider';
import AiTokenMeter from './_ai-token-meter';
import PricingModal from './_pricing-modal';

// ── Platform context (UI-layer extras — pricing modal, AI usage refresh) ─────

interface PlatformCtx {
  user: User | null;
  workspaces: Workspace[];
  refetchWorkspaces: () => void;
  showPricing: (feature?: string) => void;
  aiUsageRefreshKey: number;
  bumpAiUsageRefresh: () => void;
}

const PlatformContext = createContext<PlatformCtx>({
  user: null, workspaces: [], refetchWorkspaces: () => {},
  showPricing: () => {}, aiUsageRefreshKey: 0, bumpAiUsageRefresh: () => {},
});
export const usePlatform = () => useContext(PlatformContext);

// ── Icons ────────────────────────────────────────────────────────────────────

function IconPlus() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({
  user,
  workspaces,
  onNewWorkspace,
  onSignOut,
}: {
  user: User;
  workspaces: Workspace[];
  onNewWorkspace: () => void;
  onSignOut: () => void;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const wsMatch = pathname.match(/\/workspaces\/([^/?]+)/);
  const activeWsId = wsMatch?.[1] ?? null;

  return (
    <aside
      style={{
        width: 232, minWidth: 232,
        backgroundColor: 'rgba(24,24,27,0.82)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        backgroundImage: [
          'radial-gradient(ellipse 140% 50% at 50% 100%, rgba(99,102,241,0.07) 0%, transparent 60%)',
          'radial-gradient(circle, rgba(255,255,255,0.02) 1px, transparent 1px)',
        ].join(', '),
        backgroundSize: 'auto, 22px 22px',
        borderRight: '1px solid rgba(63,63,70,0.55)',
        display: 'flex', flexDirection: 'column',
        height: '100vh', overflow: 'hidden',
      }}
    >
      {/* Logo */}
      <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--bld-bg-elevated)', flexShrink: 0 }}>
        <a href="/workspaces" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg, #3b82f6, var(--bld-accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bld-text-1)', letterSpacing: '-0.01em' }}>Builder Platform</span>
        </a>
      </div>

      {/* Workspace list — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 0' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--bld-text-disabled)', letterSpacing: '0.08em', padding: '8px 8px 4px' }}>
          Workspaces
        </div>
        {workspaces.map((ws) => {
          const isActive = ws.id === activeWsId;
          return (
            <div key={ws.id}>
              <button
                onClick={() => navigate(`/workspaces/${ws.id}`)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer', background: isActive ? 'var(--bld-bg-elevated)' : 'transparent', transition: 'background 120ms', textAlign: 'left' }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-elevated)'; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <div style={{ width: 22, height: 22, borderRadius: 5, flexShrink: 0, background: 'linear-gradient(135deg, #3b82f6, var(--bld-accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'white' }}>
                  {ws.name.charAt(0).toUpperCase()}
                </div>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: isActive ? 600 : 500, color: isActive ? 'var(--bld-text-1)' : 'var(--bld-text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {ws.name}
                </span>
                {ws.plan !== 'FREE' && (
                  <span style={{ fontSize: 9, fontWeight: 600, color: ws.plan === 'ENTERPRISE' ? '#fbbf24' : '#a78bfa', background: ws.plan === 'ENTERPRISE' ? '#1c1408' : '#2e1065', borderRadius: 3, padding: '1px 4px', flexShrink: 0 }}>
                    {ws.plan}
                  </span>
                )}
              </button>
            </div>
          );
        })}
        <button
          onClick={onNewWorkspace}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--bld-text-disabled)', fontSize: 12, fontWeight: 500, transition: 'all 100ms', marginTop: 4, textAlign: 'left' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-elevated)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--bld-text-3)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--bld-text-disabled)'; }}
        >
          <span style={{ width: 22, height: 22, borderRadius: 5, border: '1px dashed var(--bld-border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <IconPlus />
          </span>
          New workspace
        </button>
      </div>

      {/* User section */}
      <div style={{ padding: '10px 8px 12px', borderTop: '1px solid var(--bld-bg-elevated)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px' }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg, #3b82f6, var(--bld-accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'white', flexShrink: 0 }}>
            {user.name?.charAt(0).toUpperCase() ?? user.email.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {user.name && (
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
            )}
            <div style={{ fontSize: 11, color: 'var(--bld-text-disabled)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
          </div>
          <button
            onClick={onSignOut}
            title="Sign out"
            style={{ width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--bld-text-disabled)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 100ms, color 100ms' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-elevated)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--bld-text-3)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--bld-text-disabled)'; }}
          >
            <IconLogout />
          </button>
        </div>
      </div>
    </aside>
  );
}

// ── Create workspace modal ───────────────────────────────────────────────────

function CreateWorkspaceModal({ onClose, onCreate, onUpgrade }: { onClose: () => void; onCreate: (ws: Workspace) => void; onUpgrade: () => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const { workspace } = await workspacesApi.create({ name: name.trim() });
      onCreate(workspace);
      navigate(`/workspaces/${workspace.id}?section=projects`);
      onClose();
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'WORKSPACE_LIMIT') { onClose(); onUpgrade(); return; }
      setError(e.message ?? 'Failed to create workspace');
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: '0 16px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: '100%', maxWidth: 380, background: 'var(--bld-bg-panel)', borderRadius: 14, border: '1px solid var(--bld-bg-elevated)', boxShadow: '0 25px 50px rgba(0,0,0,0.5)', padding: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--bld-text-1)', marginBottom: 20 }}>New workspace</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--bld-text-3)', marginBottom: 6 }}>Workspace name</label>
            <input type="text" required autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="My workspace"
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-elevated)', color: 'var(--bld-text-1)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          {error && <p style={{ fontSize: 12, color: '#f87171' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--bld-border-subtle)', background: 'transparent', color: 'var(--bld-text-3)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--bld-accent)', color: 'white', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────────

export default function PlatformLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Auth state comes from the top-level AuthProvider — no auth.me() call here
  const { user, workspaces, refetchWorkspaces, setUser, setWorkspaceList } = useAuth();

  const [showCreateWs, setShowCreateWs] = useState(false);
  const [pricingModal, setPricingModal] = useState<{ open: boolean; feature?: string }>({ open: false });
  const [aiUsageRefreshKey, setAiUsageRefreshKey] = useState(0);

  const fetchWorkspaces = useCallback(() => {
    workspacesApi.list()
      .then(({ workspaces: ws }) => setWorkspaceList(ws))
      .catch(() => {});
  }, [setWorkspaceList]);

  const wsMatch = pathname.match(/\/workspaces\/([^/?]+)/);
  const activeWsId = wsMatch?.[1] ?? null;
  const activeWs = workspaces.find(w => w.id === activeWsId) ?? null;

  const showPricing = (feature?: string) => setPricingModal({ open: true, feature });
  const bumpAiUsageRefresh = () => setAiUsageRefreshKey(k => k + 1);

  // user is guaranteed non-null here because PrivateRoute gates this layout
  if (!user) return null;

  return (
    <PlatformContext.Provider value={{ user, workspaces, refetchWorkspaces: fetchWorkspaces, showPricing, aiUsageRefreshKey, bumpAiUsageRefresh }}>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bld-bg-panel)' }}>
        <Sidebar
          user={user}
          workspaces={workspaces}
          onNewWorkspace={() => {
            const allFree = workspaces.every(ws => ws.plan === 'FREE');
            if (!user.superAdmin && workspaces.length >= 1 && allFree) {
              showPricing('Multiple workspaces');
            } else {
              setShowCreateWs(true);
            }
          }}
          onSignOut={async () => {
            await auth.logout();
            setUser(null);
            setWorkspaceList([]);
            navigate('/login', { replace: true });
          }}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {activeWs && (
            <div style={{ height: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 20px', gap: 12, borderBottom: '1px solid rgba(63,63,70,0.55)', backgroundColor: 'rgba(24,24,27,0.78)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', flexShrink: 0 }}>
              <AiTokenMeter workspaceId={activeWs.id} plan={activeWs.plan as 'FREE' | 'PRO' | 'ENTERPRISE'} refreshKey={aiUsageRefreshKey} superAdmin={user.superAdmin} />
              {activeWs.plan === 'FREE' && !user.superAdmin && (
                <button onClick={() => showPricing()} style={{ padding: '4px 12px', borderRadius: 20, border: '1px solid var(--bld-accent)', background: 'transparent', color: '#818cf8', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
                  Upgrade
                </button>
              )}
            </div>
          )}
          <main style={{ flex: 1, overflowY: 'auto', backgroundColor: 'var(--bld-bg-panel)', backgroundImage: ['radial-gradient(ellipse 80% 50% at 70% 0%, rgba(99,102,241,0.09) 0%, transparent 60%)', 'radial-gradient(ellipse 60% 40% at 10% 90%, rgba(99,102,241,0.06) 0%, transparent 55%)', 'radial-gradient(circle, rgba(255,255,255,0.028) 1px, transparent 1px)'].join(', '), backgroundSize: 'auto, auto, 24px 24px', backgroundAttachment: 'local' }}>
            <Outlet />
          </main>
        </div>
      </div>

      {showCreateWs && (
        <CreateWorkspaceModal
          onClose={() => setShowCreateWs(false)}
          onCreate={ws => setWorkspaceList([...workspaces, ws])}
          onUpgrade={() => showPricing('Multiple workspaces')}
        />
      )}
      {pricingModal.open && activeWs && (
        <PricingModal
          workspaceId={activeWs.id}
          currentPlan={activeWs.plan as 'FREE' | 'PRO' | 'ENTERPRISE'}
          onClose={() => setPricingModal({ open: false })}
          triggerFeature={pricingModal.feature}
        />
      )}
    </PlatformContext.Provider>
  );
}
