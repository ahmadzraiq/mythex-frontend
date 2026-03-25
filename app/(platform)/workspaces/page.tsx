'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePlatform } from '../layout';

/**
 * /workspaces — landing page once logged in.
 *
 * If the user has at least one workspace we redirect to the first one.
 * Otherwise we show a friendly empty state that prompts to create one
 * (the layout's "New workspace" sidebar button is already there too).
 */
export default function WorkspacesPage() {
  const router = useRouter();
  const { workspaces } = usePlatform();

  // Auto-navigate to first workspace once data is available
  useEffect(() => {
    if (workspaces.length > 0) {
      router.replace(`/workspaces/${workspaces[0].id}`);
    }
  }, [workspaces, router]);

  // Show empty state only when we're sure there are no workspaces
  // (workspaces.length === 0 and layout has finished loading)
  if (workspaces.length > 0) {
    return null; // redirect pending
  }

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', minHeight: '60vh',
        gap: 12, padding: '0 24px', textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Illustration */}
      <div style={{
        width: 56, height: 56, borderRadius: 14, marginBottom: 4,
        background: 'linear-gradient(135deg, #1e3a5f, #1e1b4b)',
        border: '1px solid #1d4ed8',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#f9fafb', margin: 0 }}>
        No workspaces yet
      </h2>
      <p style={{ fontSize: 13, color: '#6b7280', maxWidth: 280, lineHeight: 1.6, margin: 0 }}>
        Create a workspace to organize your projects and collaborate with your team.
      </p>
      <p style={{ fontSize: 12, color: '#4b5563', margin: 0 }}>
        Click <strong style={{ color: '#9ca3af' }}>New workspace</strong> in the sidebar to get started.
      </p>
    </div>
  );
}
