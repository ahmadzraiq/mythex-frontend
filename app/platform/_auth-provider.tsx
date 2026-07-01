'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { auth, workspaces as workspacesApi, type User, type Workspace } from '@/lib/platform/api-client';

// ── Context ──────────────────────────────────────────────────────────────────

interface AuthCtx {
  user: User | null;
  workspaces: Workspace[];
  setUser: (u: User | null) => void;
  setWorkspaceList: (ws: Workspace[]) => void;
  refetchWorkspaces: () => void;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  workspaces: [],
  setUser: () => {},
  setWorkspaceList: () => {},
  refetchWorkspaces: () => {},
});

export const useAuth = () => useContext(AuthContext);

// ── Global loader ─────────────────────────────────────────────────────────────

function GlobalLoader() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bld-bg-panel, #09090b)',
    }}>
      <div style={{
        width: 24, height: 24,
        border: '2px solid #3b82f6', borderTopColor: 'transparent',
        borderRadius: '50%', animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [workspaceList, setWorkspaceList] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);

  const refetchWorkspaces = useCallback(() => {
    workspacesApi.list()
      .then(({ workspaces: ws }) => setWorkspaceList(ws))
      .catch(() => {});
  }, []);

  useEffect(() => {
    auth.me()
      .then(({ user: u }) => {
        setUser(u);
        // Workspace fetch is independent — failure must not affect auth state
        workspacesApi.list()
          .then(({ workspaces: ws }) => setWorkspaceList(ws))
          .catch(() => {})
          .finally(() => setLoading(false));
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
      });
  }, []);

  if (loading) return <GlobalLoader />;

  return (
    <AuthContext.Provider value={{
      user,
      workspaces: workspaceList,
      setUser,
      setWorkspaceList,
      refetchWorkspaces,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
