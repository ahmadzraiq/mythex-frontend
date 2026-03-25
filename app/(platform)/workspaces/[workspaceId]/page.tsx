'use client';

import { useState, useEffect, use, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  workspaces as workspacesApi,
  projects as projectsApi,
  type Workspace,
  type WorkspaceMember,
  type Project,
} from '@/lib/platform/api-client';
import CreateAiProjectWizard from './_create-ai-project-wizard';

type Tab = 'projects' | 'members' | 'settings';

// ── Helpers ───────────────────────────────────────────────────────────────────

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.28, flexShrink: 0,
      background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 700, color: 'white',
    }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// ── Project card ─────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  onOpen,
  onDelete,
  canDelete,
  deleting = false,
}: {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
  canDelete: boolean;
  deleting?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div style={{
      borderRadius: 10, border: '1px solid #1f2937', background: '#111827',
      transition: 'border-color 150ms, box-shadow 150ms',
      position: 'relative', opacity: deleting ? 0.6 : 1,
    }}
      onMouseEnter={e => { if (!deleting) { (e.currentTarget as HTMLDivElement).style.borderColor = '#2563eb'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 0 1px #2563eb22'; }}}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#1f2937'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
    >
      {/* Deleting overlay */}
      {deleting && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10, borderRadius: 10,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8,
        }}>
          <div style={{
            width: 16, height: 16, borderRadius: '50%',
            border: '2px solid #f87171', borderTopColor: 'transparent',
            animation: 'spin 0.7s linear infinite',
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <span style={{ fontSize: 11.5, color: '#f87171', fontWeight: 600 }}>Deleting…</span>
        </div>
      )}
      {/* Thumbnail — overflow:hidden scoped here so the dropdown is not clipped */}
      <button
        onClick={onOpen}
        style={{
          display: 'block', width: '100%', aspectRatio: '16/9',
          background: 'linear-gradient(135deg, #1a2535 0%, #1e293b 100%)',
          border: 'none', cursor: 'pointer', padding: 0,
          borderRadius: '10px 10px 0 0', overflow: 'hidden',
        }}
      >
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </div>
      </button>

      {/* Footer */}
      <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={onOpen}
          style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12.5, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {project.name}
        </button>

        <div style={{ position: 'relative' }}>
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
            style={{
              width: 26, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer',
              background: 'transparent', color: '#4b5563', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 100ms',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#1f2937'}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
          </button>

          {menuOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setMenuOpen(false)} />
              <div style={{
                position: 'absolute', right: 0, top: 30, zIndex: 20, width: 150,
                background: '#1f2937', border: '1px solid #374151', borderRadius: 8,
                boxShadow: '0 10px 25px rgba(0,0,0,0.4)', overflow: 'hidden',
              }}>
                <button onClick={() => { setMenuOpen(false); onOpen(); }} style={{ width: '100%', padding: '8px 12px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: '#e2e8f0' }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#374151'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}
                >
                  Open editor
                </button>
                {canDelete && (
                  <button onClick={() => { setMenuOpen(false); onDelete(); }} style={{ width: '100%', padding: '8px 12px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: '#f87171' }}
                    onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#374151'}
                    onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}
                  >
                    Delete project
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Section: Projects ─────────────────────────────────────────────────────────

function ProjectsSection({
  workspaceId,
  workspace,
  projectList,
  setProjectList,
  isOwner,
}: {
  workspaceId: string;
  workspace: Workspace;
  projectList: Project[];
  setProjectList: React.Dispatch<React.SetStateAction<Project[]>>;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [showAiWizard, setShowAiWizard] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const { project } = await projectsApi.create(workspaceId, { name: newName.trim() });
      setProjectList(prev => [project, ...prev]);
      setShowCreate(false);
      setNewName('');
      router.push(`/builder/${project.id}`);
    } catch (err) {
      const e = err as Error & { code?: string };
      setCreateError(
        e.code === 'FREE_PLAN_LIMIT'
          ? 'Free plan allows only 1 project. Upgrade to Pro for unlimited projects.'
          : (e.message ?? 'Failed to create project')
      );
      setCreating(false);
    }
  }

  async function handleDelete(projectId: string) {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    setDeletingId(projectId);
    try {
      await projectsApi.delete(projectId);
      setProjectList(prev => prev.filter(p => p.id !== projectId));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Projects</h2>
          <p style={{ fontSize: 12, color: '#4b5563', margin: '3px 0 0' }}>
            {projectList.length} {projectList.length === 1 ? 'project' : 'projects'}
            {workspace.plan === 'FREE' && ' · Free plan: 1 project max'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setShowAiWizard(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8, border: 'none',
              background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
              color: 'white', fontSize: 12.5, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ✦ Create AI Project
          </button>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8, border: 'none',
              background: '#2563eb', color: 'white', fontSize: 12.5, fontWeight: 600,
              cursor: 'pointer', transition: 'background 100ms',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#1d4ed8'}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = '#2563eb'}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
            New project
          </button>
        </div>
      </div>

      {/* Grid */}
      {projectList.length === 0 ? (
        <div style={{
          border: '2px dashed #1f2937', borderRadius: 12, padding: '48px 24px',
          textAlign: 'center', fontFamily: 'system-ui, sans-serif',
        }}>
          <p style={{ fontSize: 13, color: '#4b5563', marginBottom: 10 }}>No projects yet</p>
          <button onClick={() => setShowCreate(true)} style={{ fontSize: 12.5, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>
            Create your first project →
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {projectList.map(p => (
            <ProjectCard
              key={p.id}
              project={p}
              onOpen={() => router.push(`/builder/${p.id}`)}
              onDelete={() => handleDelete(p.id)}
              canDelete={isOwner}
              deleting={deletingId === p.id}
            />
          ))}
        </div>
      )}

      {/* Free plan upgrade nudge */}
      {workspace.plan === 'FREE' && projectList.length >= 1 && (
        <div style={{
          marginTop: 20, borderRadius: 10, border: '1px solid #3b1d8a',
          background: '#1e1040', padding: '14px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: '#c4b5fd', margin: 0 }}>Upgrade for unlimited projects</p>
            <p style={{ fontSize: 11.5, color: '#7c3aed', margin: '3px 0 0' }}>Pro plan unlocks unlimited projects and collaboration.</p>
          </div>
          <button style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: '#7c3aed', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
            See plans
          </button>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: '0 16px' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowCreate(false); setCreateError(''); } }}
        >
          <div style={{ width: '100%', maxWidth: 380, background: '#111827', borderRadius: 14, border: '1px solid #1f2937', boxShadow: '0 25px 50px rgba(0,0,0,0.5)', padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#f9fafb', marginBottom: 20 }}>New project</h2>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#9ca3af', marginBottom: 6 }}>Project name</label>
                <input
                  type="text" required autoFocus value={newName}
                  onChange={e => setNewName(e.target.value)} placeholder="My project"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #374151', background: '#1f2937', color: '#f9fafb', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              {createError && <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{createError}</p>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => { setShowCreate(false); setCreateError(''); }} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #374151', background: 'transparent', color: '#9ca3af', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={creating} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#2563eb', color: 'white', fontSize: 13, fontWeight: 600, cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.7 : 1 }}>
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Project Wizard */}
      {showAiWizard && (
        <CreateAiProjectWizard
          workspaceId={workspaceId}
          onClose={() => setShowAiWizard(false)}
        />
      )}
    </div>
  );
}

// ── Section: Members ──────────────────────────────────────────────────────────

function MembersSection({
  workspaceId,
  members,
  setMembers,
  isOwner,
  currentUserId,
}: {
  workspaceId: string;
  members: WorkspaceMember[];
  setMembers: React.Dispatch<React.SetStateAction<WorkspaceMember[]>>;
  isOwner: boolean;
  currentUserId?: string;
}) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'EDITOR' | 'VIEWER'>('VIEWER');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError('');
    try {
      const { member } = await workspacesApi.inviteMember(workspaceId, { email: inviteEmail.trim(), role: inviteRole });
      setMembers(prev => [...prev, member]);
      setInviteEmail('');
    } catch (err) {
      setInviteError((err as Error).message ?? 'Failed to invite member');
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(userId: string, role: 'EDITOR' | 'VIEWER') {
    await workspacesApi.updateMemberRole(workspaceId, userId, role);
    setMembers(prev => prev.map(m => m.id === userId ? { ...m, role } : m));
  }

  async function handleRemove(userId: string) {
    if (!confirm('Remove this member?')) return;
    await workspacesApi.removeMember(workspaceId, userId);
    setMembers(prev => prev.filter(m => m.id !== userId));
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Members</h2>
        <p style={{ fontSize: 12, color: '#4b5563', margin: '3px 0 0' }}>{members.length} {members.length === 1 ? 'member' : 'members'}</p>
      </div>

      {/* Invite form */}
      {isOwner && (
        <form onSubmit={handleInvite} style={{ marginBottom: 20, background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 16 }}>
          <p style={{ fontSize: 12.5, fontWeight: 600, color: '#e2e8f0', marginBottom: 12 }}>Invite a member</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="email" required placeholder="colleague@example.com" value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              style={{ flex: '1 1 200px', padding: '8px 12px', borderRadius: 8, border: '1px solid #374151', background: '#1f2937', color: '#f9fafb', fontSize: 12.5, outline: 'none' }}
            />
            <select
              value={inviteRole} onChange={e => setInviteRole(e.target.value as 'EDITOR' | 'VIEWER')}
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #374151', background: '#1f2937', color: '#d1d5db', fontSize: 12.5, outline: 'none' }}
            >
              <option value="EDITOR">Editor</option>
              <option value="VIEWER">Viewer</option>
            </select>
            <button
              type="submit" disabled={inviting}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#2563eb', color: 'white', fontSize: 12.5, fontWeight: 600, cursor: inviting ? 'not-allowed' : 'pointer', opacity: inviting ? 0.7 : 1 }}
            >
              {inviting ? '…' : 'Invite'}
            </button>
          </div>
          {inviteError && <p style={{ fontSize: 11.5, color: '#f87171', marginTop: 8 }}>{inviteError}</p>}
        </form>
      )}

      {/* Member list */}
      <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, overflow: 'hidden' }}>
        {members.map((member, i) => {
          const isSelf = member.id === currentUserId;
          const isOwnerRow = member.role === 'OWNER';
          return (
            <div
              key={member.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
                borderBottom: i < members.length - 1 ? '1px solid #1f2937' : 'none',
              }}
            >
              <Avatar name={member.name} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {member.name}
                  {isSelf && <span style={{ marginLeft: 6, fontSize: 11, color: '#4b5563', fontWeight: 400 }}>(you)</span>}
                </div>
                <div style={{ fontSize: 11.5, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.email}</div>
              </div>

              {isOwnerRow ? (
                <span style={{ fontSize: 10.5, fontWeight: 600, color: '#6b7280', background: '#1f2937', borderRadius: 4, padding: '2px 8px' }}>Owner</span>
              ) : isOwner && !isSelf ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select
                    value={member.role}
                    onChange={e => handleRoleChange(member.id, e.target.value as 'EDITOR' | 'VIEWER')}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #374151', background: '#1f2937', color: '#d1d5db', fontSize: 11.5, outline: 'none' }}
                  >
                    <option value="EDITOR">Editor</option>
                    <option value="VIEWER">Viewer</option>
                  </select>
                  <button
                    onClick={() => handleRemove(member.id)}
                    style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #7f1d1d', background: 'transparent', color: '#f87171', fontSize: 11.5, cursor: 'pointer' }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <span style={{ fontSize: 10.5, fontWeight: 600, color: '#6b7280', background: '#1f2937', borderRadius: 4, padding: '2px 8px', textTransform: 'capitalize' }}>
                  {member.role.toLowerCase()}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Section: Settings ─────────────────────────────────────────────────────────

function SettingsSection({
  workspaceId,
  workspace,
  setWorkspace,
}: {
  workspaceId: string;
  workspace: Workspace;
  setWorkspace: React.Dispatch<React.SetStateAction<Workspace | null>>;
}) {
  const router = useRouter();
  const [wsName, setWsName] = useState(workspace.name);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!wsName.trim() || wsName === workspace.name) return;
    setSaving(true);
    const { workspace: updated } = await workspacesApi.update(workspaceId, { name: wsName.trim() });
    setWorkspace(prev => prev ? { ...prev, name: updated.name } : prev);
    setSaving(false);
  }

  async function handleDelete() {
    if (deleteConfirm !== workspace.name) return;
    await workspacesApi.delete(workspaceId);
    router.push('/workspaces');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: 0, marginBottom: 4 }}>Settings</h2>

      {/* Rename */}
      <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 20 }}>
        <p style={{ fontSize: 12.5, fontWeight: 600, color: '#e2e8f0', marginBottom: 12 }}>Workspace name</p>
        <form onSubmit={handleSave} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text" required value={wsName} onChange={e => setWsName(e.target.value)}
            style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #374151', background: '#1f2937', color: '#f9fafb', fontSize: 13, outline: 'none' }}
          />
          <button
            type="submit" disabled={saving || wsName === workspace.name}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#2563eb', color: 'white', fontSize: 12.5, fontWeight: 600, cursor: (saving || wsName === workspace.name) ? 'not-allowed' : 'pointer', opacity: (saving || wsName === workspace.name) ? 0.5 : 1 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      </div>

      {/* Danger zone */}
      <div style={{ background: '#111827', border: '1px solid #7f1d1d', borderRadius: 10, padding: 20 }}>
        <p style={{ fontSize: 12.5, fontWeight: 600, color: '#f87171', marginBottom: 4 }}>Danger zone</p>
        <p style={{ fontSize: 11.5, color: '#6b7280', marginBottom: 16 }}>
          Permanently delete this workspace and all its projects. This cannot be undone.
        </p>
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>
            Type <span style={{ fontFamily: 'monospace', color: '#f87171' }}>{workspace.name}</span> to confirm
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text" placeholder={workspace.name} value={deleteConfirm}
              onChange={e => setDeleteConfirm(e.target.value)}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #7f1d1d', background: '#1f2937', color: '#f9fafb', fontSize: 13, outline: 'none' }}
            />
            <button
              onClick={handleDelete} disabled={deleteConfirm !== workspace.name}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#dc2626', color: 'white', fontSize: 12.5, fontWeight: 600, cursor: deleteConfirm !== workspace.name ? 'not-allowed' : 'pointer', opacity: deleteConfirm !== workspace.name ? 0.4 : 1 }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WorkspaceDetailPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = use(params);
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('projects');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setTab('projects'); // reset tab when workspace changes
    Promise.all([
      workspacesApi.get(workspaceId),
      projectsApi.list(workspaceId),
      workspacesApi.listMembers(workspaceId),
    ])
      .then(([wsRes, projRes, membersRes]) => {
        setWorkspace(wsRes.workspace);
        setProjectList(projRes.projects);
        setMembers(membersRes.members);
      })
      .catch(() => router.push('/workspaces'))
      .finally(() => setLoading(false));
  }, [workspaceId, router]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ width: 24, height: 24, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!workspace) return null;

  const isOwner = workspace.role === 'OWNER';
  const ownerMember = members.find(m => m.role === 'OWNER');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'projects', label: 'Projects' },
    { id: 'members', label: `Members${members.length > 0 ? ` (${members.length})` : ''}` },
    ...(isOwner ? [{ id: 'settings' as Tab, label: 'Settings' }] : []),
  ];

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900, margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <Avatar name={workspace.name} size={36} />
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: 17, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>{workspace.name}</h1>
            <span style={{
              fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
              color: workspace.plan === 'PRO' ? '#a78bfa' : '#6b7280',
              background: workspace.plan === 'PRO' ? '#2e1065' : '#1f2937',
              letterSpacing: '0.05em',
            }}>
              {workspace.plan}
            </span>
          </div>
          <p style={{ fontSize: 11.5, color: '#4b5563', margin: '2px 0 0' }}>
            {members.length} {members.length === 1 ? 'member' : 'members'} · {projectList.length} {projectList.length === 1 ? 'project' : 'projects'}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 2, borderBottom: '1px solid #1f2937', marginBottom: 24,
      }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 14px', border: 'none', cursor: 'pointer',
              background: 'transparent', fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? '#f1f5f9' : '#6b7280',
              borderBottom: tab === t.id ? '2px solid #3b82f6' : '2px solid transparent',
              marginBottom: -1, transition: 'color 120ms',
            }}
            onMouseEnter={e => { if (tab !== t.id) (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af'; }}
            onMouseLeave={e => { if (tab !== t.id) (e.currentTarget as HTMLButtonElement).style.color = '#6b7280'; }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'projects' && (
        <ProjectsSection
          workspaceId={workspaceId}
          workspace={workspace}
          projectList={projectList}
          setProjectList={setProjectList}
          isOwner={isOwner}
        />
      )}
      {tab === 'members' && (
        <MembersSection
          workspaceId={workspaceId}
          members={members}
          setMembers={setMembers}
          isOwner={isOwner}
          currentUserId={ownerMember?.id}
        />
      )}
      {tab === 'settings' && isOwner && (
        <SettingsSection
          workspaceId={workspaceId}
          workspace={workspace}
          setWorkspace={setWorkspace}
        />
      )}
    </div>
  );
}
