'use client';

import { useEffect, useState, createContext, useContext, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { auth, workspaces as workspacesApi, type User, type Workspace } from '@/lib/platform/api-client';
import AiTokenMeter from './_ai-token-meter';
import PricingModal from './_pricing-modal';

// ── Context so children can trigger workspace refetches ─────────────────────

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
  const pathname = usePathname();
  const router = useRouter();

    // Extract active workspaceId from path
  const wsMatch = pathname.match(/\/workspaces\/([^/?]+)/);
  const activeWsId = wsMatch?.[1] ?? null;

  return (
    <aside
      style={{
        width: 232,
        minWidth: 232,
        background: '#111827',
        borderRight: '1px solid #1f2937',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      {/* Logo */}
      <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <a
          href="/workspaces"
          style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}
        >
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#f9fafb', letterSpacing: '-0.01em' }}>
            Builder Platform
          </span>
        </a>
      </div>

      {/* Workspace list — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 0' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#4b5563', letterSpacing: '0.08em', padding: '8px 8px 4px', textTransform: 'uppercase' }}>
          Workspaces
        </div>

        {workspaces.map((ws) => {
          const isActive = ws.id === activeWsId;

          return (
            <div key={ws.id}>
              {/* Workspace row — clicking navigates to workspace (tabs handle sections) */}
              <button
                onClick={() => router.push(`/workspaces/${ws.id}`)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer',
                  background: isActive ? '#1d2937' : 'transparent',
                  transition: 'background 120ms', textAlign: 'left',
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = '#1a2230'; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: 5, flexShrink: 0,
                  background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: 'white',
                }}>
                  {ws.name.charAt(0).toUpperCase()}
                </div>
                <span style={{
                  flex: 1, fontSize: 12.5, fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#f3f4f6' : '#9ca3af',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {ws.name}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 600,
                  color: ws.plan === 'FREE' ? '#4b5563' : ws.plan === 'ENTERPRISE' ? '#fbbf24' : '#a78bfa',
                  background: ws.plan === 'FREE' ? '#1f2937' : ws.plan === 'ENTERPRISE' ? '#1c1408' : '#2e1065',
                  borderRadius: 3, padding: '1px 4px', flexShrink: 0,
                }}>
                  {ws.plan}
                </span>
              </button>
            </div>
          );
        })}

        {/* New workspace button */}
        <button
          onClick={onNewWorkspace}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer',
            background: 'transparent', color: '#4b5563',
            fontSize: 12, fontWeight: 500, transition: 'all 100ms', marginTop: 4,
            textAlign: 'left',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#1a2230'; (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#4b5563'; }}
        >
          <span style={{ width: 22, height: 22, borderRadius: 5, border: '1px dashed #374151', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <IconPlus />
          </span>
          New workspace
        </button>
      </div>

      {/* User section */}
      <div style={{ padding: '10px 8px 12px', borderTop: '1px solid #1f2937', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px' }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: 'white', flexShrink: 0,
          }}>
            {user.name?.charAt(0).toUpperCase() ?? user.email.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {user.name && (
              <div style={{ fontSize: 12, fontWeight: 600, color: '#f3f4f6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user.name}
              </div>
            )}
            <div style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.email}
            </div>
          </div>
          <button
            onClick={onSignOut}
            title="Sign out"
            style={{
              width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer',
              background: 'transparent', color: '#4b5563', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 100ms, color 100ms',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#1f2937'; (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#4b5563'; }}
          >
            <IconLogout />
          </button>
        </div>
      </div>
    </aside>
  );
}

// ── Create workspace modal ───────────────────────────────────────────────────

function CreateWorkspaceModal({
  onClose,
  onCreate,
  onUpgrade,
}: {
  onClose: () => void;
  onCreate: (ws: Workspace) => void;
  onUpgrade: () => void;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const { workspace } = await workspacesApi.create({ name: name.trim() });
      onCreate(workspace);
      router.push(`/workspaces/${workspace.id}?section=projects`);
      onClose();
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'WORKSPACE_LIMIT') {
        onClose();
        onUpgrade();
        return;
      }
      setError(e.message ?? 'Failed to create workspace');
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: '0 16px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: '100%', maxWidth: 380, background: '#111827', borderRadius: 14, border: '1px solid #1f2937', boxShadow: '0 25px 50px rgba(0,0,0,0.5)', padding: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#f9fafb', marginBottom: 20 }}>New workspace</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#9ca3af', marginBottom: 6 }}>
              Workspace name
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="My workspace"
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 8,
                border: '1px solid #374151', background: '#1f2937',
                color: '#f9fafb', fontSize: 13, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          {error && <p style={{ fontSize: 12, color: '#f87171' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #374151', background: 'transparent', color: '#9ca3af', fontSize: 13, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#2563eb', color: 'white', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────────

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [workspaceList, setWorkspaceList] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateWs, setShowCreateWs] = useState(false);
  const [pricingModal, setPricingModal] = useState<{ open: boolean; feature?: string }>({ open: false });
  const [aiUsageRefreshKey, setAiUsageRefreshKey] = useState(0);

  const publicPaths = ['/login', '/signup'];
  const isPublic = publicPaths.some(p => pathname.endsWith(p));

  const fetchWorkspaces = useCallback(() => {
    workspacesApi.list()
      .then(({ workspaces }) => setWorkspaceList(workspaces))
      .catch(() => {});
  }, []);

  useEffect(() => {
    auth.me()
      .then(({ user: u }) => {
        setUser(u);
        return workspacesApi.list();
      })
      .then(({ workspaces }) => setWorkspaceList(workspaces))
      .catch(() => {
        setUser(null);
        if (!isPublic) router.replace('/login');
      })
      .finally(() => setLoading(false));
  }, [pathname, isPublic, router]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b1120' }}>
        <div style={{ width: 24, height: 24, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Public pages (login/signup) — no sidebar
  if (isPublic || !user) {
    return (
      <div style={{ minHeight: '100vh', background: '#0b1120' }}>
        {children}
      </div>
    );
  }

  // Extract active workspaceId from path for the token meter
  const wsMatch = pathname.match(/\/workspaces\/([^/?]+)/);
  const activeWsId = wsMatch?.[1] ?? null;
  const activeWs = workspaceList.find(w => w.id === activeWsId) ?? null;

  const showPricing = (feature?: string) => setPricingModal({ open: true, feature });
  const bumpAiUsageRefresh = () => setAiUsageRefreshKey(k => k + 1);

  return (
    <PlatformContext.Provider value={{ user, workspaces: workspaceList, refetchWorkspaces: fetchWorkspaces, showPricing, aiUsageRefreshKey, bumpAiUsageRefresh }}>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0f172a' }}>
        <Sidebar
          user={user}
          workspaces={workspaceList}
          onNewWorkspace={() => {
            const allFree = workspaceList.every(ws => ws.plan === 'FREE');
            if (!user.superAdmin && workspaceList.length >= 1 && allFree) {
              showPricing('Multiple workspaces');
            } else {
              setShowCreateWs(true);
            }
          }}
          onSignOut={async () => {
            await auth.logout();
            router.push('/login');
          }}
        />

        {/* Main content area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Top bar with AI token meter */}
          {activeWs && (
            <div style={{
              height: 44, minHeight: 44,
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              padding: '0 20px', gap: 12,
              borderBottom: '1px solid #1f2937',
              background: '#0b1120',
              flexShrink: 0,
            }}>
              <AiTokenMeter
                workspaceId={activeWs.id}
                plan={activeWs.plan as 'FREE' | 'PRO' | 'ENTERPRISE'}
                refreshKey={aiUsageRefreshKey}
                superAdmin={user.superAdmin}
              />
              {activeWs.plan === 'FREE' && !user.superAdmin && (
                <button
                  onClick={() => showPricing()}
                  style={{
                    padding: '4px 12px', borderRadius: 20,
                    border: '1px solid #6366f1', background: 'transparent',
                    color: '#818cf8', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Upgrade
                </button>
              )}
            </div>
          )}
          <main style={{ flex: 1, overflowY: 'auto', background: '#0f172a' }}>
            {children}
          </main>
        </div>
      </div>

      {showCreateWs && (
        <CreateWorkspaceModal
          onClose={() => setShowCreateWs(false)}
          onCreate={ws => setWorkspaceList(prev => [...prev, ws])}
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
