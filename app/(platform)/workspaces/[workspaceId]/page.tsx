'use client';

import { useState, useEffect, useRef, use, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  workspaces as workspacesApi,
  projects as projectsApi,
  type Workspace,
  type WorkspaceMember,
  type Project,
  type WorkspaceUsage,
} from '@/lib/platform/api-client';
import { BUSINESS_CATEGORIES, DESIGN_MOODS } from '@/lib/builder/wizard-data';
import CreateAiProjectWizard from './_create-ai-project-wizard';
import { usePlatform } from '@/app/(platform)/layout';

type Tab = 'projects' | 'members' | 'settings' | 'usage';

// ── Helpers ───────────────────────────────────────────────────────────────────

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.28, flexShrink: 0,
      background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 700, color: 'white',
    }}>
      {(name ?? '?').charAt(0).toUpperCase()}
    </div>
  );
}

// ── Edit App Modal ────────────────────────────────────────────────────────────

interface ProjectMeta {
  appName?: string;
  description?: string;
  category?: string;
  mood?: string;
  animationLevel?: number;
  layoutStructure?: number;
}

function EditAppModal({
  project,
  onClose,
  onSaved,
}: {
  project: Project;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(project.name);
  const [meta, setMeta] = useState<ProjectMeta>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void projectsApi.getConfig(project.id).then(({ config }) => {
      const pm = (config.projectMeta ?? {}) as ProjectMeta;
      setMeta({
        appName: pm.appName ?? project.name,
        description: pm.description ?? '',
        category: pm.category ?? '',
        mood: pm.mood ?? '',
        animationLevel: pm.animationLevel ?? 2,
        layoutStructure: pm.layoutStructure ?? 2,
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [project.id, project.name]);

  const patchMeta = (patch: Partial<ProjectMeta>) => setMeta(prev => ({ ...prev, ...patch }));

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #374151',
    background: '#1f2937', color: '#f9fafb', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11.5, fontWeight: 500, color: '#9ca3af', marginBottom: 5,
  };
  const selectStyle: React.CSSProperties = { ...inputStyle };

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      if (name.trim() !== project.name) {
        await projectsApi.update(project.id, { name: name.trim() });
      }
      await projectsApi.updateMeta(project.id, {
        projectMeta: {
          appName: meta.appName ?? name.trim(),
          description: meta.description,
          category: meta.category,
          mood: meta.mood,
          animationLevel: meta.animationLevel,
          layoutStructure: meta.layoutStructure,
        },
      });
      onSaved(name.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message ?? 'Failed to save');
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', padding: '16px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: '100%', maxWidth: 480, background: '#111827', borderRadius: 14, border: '1px solid #1f2937', boxShadow: '0 25px 50px rgba(0,0,0,0.5)', padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f9fafb', margin: 0 }}>Edit app</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#6b7280', fontSize: 13 }}>Loading…</div>
        ) : (
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* App Name */}
            <div>
              <label style={labelStyle}>App name</label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)} required autoFocus
                style={inputStyle}
              />
            </div>

            {/* Description */}
            <div>
              <label style={labelStyle}>Business description</label>
              <textarea
                value={meta.description ?? ''} onChange={e => patchMeta({ description: e.target.value })}
                rows={3} placeholder="Describe your business or app…"
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            {/* Category */}
            <div>
              <label style={labelStyle}>Category</label>
              <select value={meta.category ?? ''} onChange={e => patchMeta({ category: e.target.value })} style={selectStyle}>
                <option value="">— Select category —</option>
                {BUSINESS_CATEGORIES.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>

            {/* Mood */}
            <div>
              <label style={labelStyle}>Design mood</label>
              <select value={meta.mood ?? ''} onChange={e => patchMeta({ mood: e.target.value })} style={selectStyle}>
                <option value="">— Select mood —</option>
                {DESIGN_MOODS.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>

            {/* Animation Level */}
            <div>
              <label style={labelStyle}>Animation level — {meta.animationLevel ?? 2} / 3</label>
              <input
                type="range" min={0} max={3} step={1} value={meta.animationLevel ?? 2}
                onChange={e => patchMeta({ animationLevel: Number(e.target.value) })}
                style={{ width: '100%', accentColor: '#3b82f6' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#6b7280', marginTop: 2 }}>
                <span>None</span><span>Subtle</span><span>Moderate</span><span>Rich</span>
              </div>
            </div>

            {/* Structure Level */}
            <div>
              <label style={labelStyle}>Layout structure — {meta.layoutStructure ?? 2} / 4</label>
              <input
                type="range" min={0} max={4} step={1} value={meta.layoutStructure ?? 2}
                onChange={e => patchMeta({ layoutStructure: Number(e.target.value) })}
                style={{ width: '100%', accentColor: '#3b82f6' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#6b7280', marginTop: 2 }}>
                <span>Minimal</span><span>Simple</span><span>Standard</span><span>Rich</span><span>Complex</span>
              </div>
            </div>

            {error && <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" onClick={onClose} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #374151', background: 'transparent', color: '#9ca3af', fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="submit" disabled={saving} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#2563eb', color: 'white', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Project card ─────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  onOpen,
  onEdit,
  onDelete,
  canDelete,
  deleting = false,
}: {
  project: Project;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canDelete: boolean;
  deleting?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isLive = project.published === true;

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

      {/* Live badge overlay on thumbnail */}
      {isLive && (
        <div style={{
          position: 'absolute', top: 8, left: 8, zIndex: 5,
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 10, fontWeight: 700, color: '#4ade80', padding: '2px 7px',
          background: 'rgba(5, 46, 22, 0.9)', borderRadius: 4,
          border: '1px solid #16a34a',
          backdropFilter: 'blur(4px)',
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#4ade80', display: 'inline-block', boxShadow: '0 0 4px #4ade80' }} />
          Live
        </div>
      )}

      {/* Thumbnail */}
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
                <button onClick={() => { setMenuOpen(false); onEdit(); }} style={{ width: '100%', padding: '8px 12px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: '#e2e8f0' }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#374151'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}
                >
                  Edit app info
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
  isSuperAdmin = false,
}: {
  workspaceId: string;
  workspace: Workspace;
  projectList: Project[];
  setProjectList: React.Dispatch<React.SetStateAction<Project[]>>;
  isOwner: boolean;
  isSuperAdmin?: boolean;
}) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [showAiWizard, setShowAiWizard] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newMood, setNewMood] = useState('');
  const [newAnimationLevel, setNewAnimationLevel] = useState(2);
  const [newLayoutStructure, setNewLayoutStructure] = useState(2);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  function resetCreateForm() {
    setNewName(''); setNewDescription(''); setNewCategory('');
    setNewMood(''); setNewAnimationLevel(2); setNewLayoutStructure(2);
    setCreateError('');
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const { project } = await projectsApi.create(workspaceId, { name: newName.trim() });
      // Save app context metadata if any fields were filled in
      if (newDescription || newCategory || newMood) {
        await projectsApi.updateMeta(project.id, {
          projectMeta: {
            appName: newName.trim(),
            description: newDescription || undefined,
            category: newCategory || undefined,
            mood: newMood || undefined,
            animationLevel: newAnimationLevel,
            layoutStructure: newLayoutStructure,
          },
        });
      }
      setProjectList(prev => [project, ...prev]);
      setShowCreate(false);
      resetCreateForm();
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
            {workspace.plan === 'FREE' && !isSuperAdmin && ' · Free plan: 1 project max'}
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
              onEdit={() => setEditingProject(p)}
              onDelete={() => handleDelete(p.id)}
              canDelete={isOwner}
              deleting={deletingId === p.id}
            />
          ))}
        </div>
      )}

      {/* Free plan upgrade nudge */}
      {workspace.plan === 'FREE' && !isSuperAdmin && projectList.length >= 1 && (
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
          style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: '16px' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowCreate(false); resetCreateForm(); } }}
        >
          <div style={{ width: '100%', maxWidth: 460, background: '#111827', borderRadius: 14, border: '1px solid #1f2937', boxShadow: '0 25px 50px rgba(0,0,0,0.5)', padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f9fafb', margin: 0 }}>New project</h2>
              <button onClick={() => { setShowCreate(false); resetCreateForm(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
            </div>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Required */}
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: '#9ca3af', marginBottom: 5 }}>App name <span style={{ color: '#f87171' }}>*</span></label>
                <input
                  type="text" required autoFocus value={newName}
                  onChange={e => setNewName(e.target.value)} placeholder="My project"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #374151', background: '#1f2937', color: '#f9fafb', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              {/* Optional context */}
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: '#9ca3af', marginBottom: 5 }}>Business description <span style={{ color: '#4b5563', fontWeight: 400 }}>(optional)</span></label>
                <textarea
                  value={newDescription} onChange={e => setNewDescription(e.target.value)}
                  rows={2} placeholder="Describe your business or app…"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #374151', background: '#1f2937', color: '#f9fafb', fontSize: 13, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: '#9ca3af', marginBottom: 5 }}>Category</label>
                  <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #374151', background: '#1f2937', color: newCategory ? '#f9fafb' : '#6b7280', fontSize: 13, outline: 'none' }}>
                    <option value="">— Select —</option>
                    {BUSINESS_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: '#9ca3af', marginBottom: 5 }}>Design mood</label>
                  <select value={newMood} onChange={e => setNewMood(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #374151', background: '#1f2937', color: newMood ? '#f9fafb' : '#6b7280', fontSize: 13, outline: 'none' }}>
                    <option value="">— Select —</option>
                    {DESIGN_MOODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: '#9ca3af', marginBottom: 5 }}>Animation — {newAnimationLevel}/3</label>
                  <input type="range" min={0} max={3} step={1} value={newAnimationLevel} onChange={e => setNewAnimationLevel(Number(e.target.value))} style={{ width: '100%', accentColor: '#3b82f6' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#4b5563', marginTop: 1 }}><span>None</span><span>Rich</span></div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: '#9ca3af', marginBottom: 5 }}>Structure — {newLayoutStructure}/4</label>
                  <input type="range" min={0} max={4} step={1} value={newLayoutStructure} onChange={e => setNewLayoutStructure(Number(e.target.value))} style={{ width: '100%', accentColor: '#3b82f6' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#4b5563', marginTop: 1 }}><span>Minimal</span><span>Complex</span></div>
                </div>
              </div>

              {createError && <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{createError}</p>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
                <button type="button" onClick={() => { setShowCreate(false); resetCreateForm(); }} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #374151', background: 'transparent', color: '#9ca3af', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
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

      {/* Edit App Modal */}
      {editingProject && (
        <EditAppModal
          project={editingProject}
          onClose={() => setEditingProject(null)}
          onSaved={(newName) => {
            setProjectList(prev => prev.map(p =>
              p.id === editingProject.id ? { ...p, name: newName } : p
            ));
          }}
        />
      )}
    </div>
  );
}

// ── Project multi-select dropdown ────────────────────────────────────────────

function ProjectDropdown({
  projects,
  selectedIds,
  onChange,
  placeholder = 'Select projects…',
}: {
  projects: Project[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const allSelected = selectedIds.length === projects.length && projects.length > 0;
  const selectedNames = projects.filter(p => selectedIds.includes(p.id)).map(p => p.name);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  }

  function toggleAll() {
    onChange(allSelected ? [] : projects.map(p => p.id));
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', borderRadius: 8, border: '1px solid #374151',
          background: '#1f2937', color: selectedIds.length ? '#f9fafb' : '#6b7280',
          fontSize: 12.5, cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {selectedIds.length === 0
            ? placeholder
            : allSelected
              ? 'All projects'
              : selectedNames.join(', ')}
        </span>
        <span style={{ marginLeft: 8, fontSize: 10, color: '#6b7280', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: '#1f2937', border: '1px solid #374151', borderRadius: 8,
          marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden',
        }}>
          {projects.length === 0 ? (
            <div style={{ padding: '10px 14px', fontSize: 12, color: '#6b7280' }}>
              No projects in this workspace yet.
            </div>
          ) : (
            <>
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid #374151',
                  background: allSelected ? '#1e2d4a' : 'transparent',
                }}
                onClick={toggleAll}
              >
                <span style={{
                  width: 14, height: 14, borderRadius: 3, border: `2px solid ${allSelected ? '#3b82f6' : '#4b5563'}`,
                  background: allSelected ? '#3b82f6' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {allSelected && <span style={{ color: 'white', fontSize: 9, lineHeight: 1 }}>✓</span>}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af' }}>All projects</span>
              </label>
              {projects.map(p => {
                const checked = selectedIds.includes(p.id);
                return (
                  <label
                    key={p.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 14px', cursor: 'pointer',
                      background: checked ? '#1e2d4a' : 'transparent',
                    }}
                    onClick={() => toggle(p.id)}
                  >
                    <span style={{
                      width: 14, height: 14, borderRadius: 3, border: `2px solid ${checked ? '#3b82f6' : '#4b5563'}`,
                      background: checked ? '#3b82f6' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {checked && <span style={{ color: 'white', fontSize: 9, lineHeight: 1 }}>✓</span>}
                    </span>
                    <span style={{ fontSize: 12, color: checked ? '#93c5fd' : '#d1d5db' }}>{p.name}</span>
                  </label>
                );
              })}
            </>
          )}
        </div>
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
  projects,
}: {
  workspaceId: string;
  members: WorkspaceMember[];
  setMembers: React.Dispatch<React.SetStateAction<WorkspaceMember[]>>;
  isOwner: boolean;
  currentUserId?: string;
  projects: Project[];
}) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteProjectIds, setInviteProjectIds] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');

  // Per-member project access editing state
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [memberProjects, setMemberProjects] = useState<Record<string, { id: string; name: string }[]>>({});
  const [editingProjectIds, setEditingProjectIds] = useState<string[]>([]);
  const [savingProjects, setSavingProjects] = useState(false);


  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError('');
    setInviteSuccess('');
    try {
      const res = await workspacesApi.sendInvitation(workspaceId, {
        email: inviteEmail.trim(),
        projectIds: inviteProjectIds,
      });
      setInviteSuccess(res.message);
      setInviteEmail('');
      setInviteProjectIds([]);
    } catch (err) {
      setInviteError((err as Error).message ?? 'Failed to send invitation');
    } finally {
      setInviting(false);
    }
  }

  async function handleExpandMember(userId: string) {
    if (expandedMember === userId) {
      setExpandedMember(null);
      return;
    }
    setExpandedMember(userId);
    if (!memberProjects[userId]) {
      try {
        const res = await workspacesApi.getMemberProjects(workspaceId, userId);
        setMemberProjects(prev => ({ ...prev, [userId]: res.projects }));
        setEditingProjectIds(res.projectIds);
      } catch {
        setMemberProjects(prev => ({ ...prev, [userId]: [] }));
        setEditingProjectIds([]);
      }
    } else {
      setEditingProjectIds(memberProjects[userId].map(p => p.id));
    }
  }

  async function handleSaveProjectAccess(userId: string) {
    setSavingProjects(true);
    try {
      await workspacesApi.updateMemberProjects(workspaceId, userId, editingProjectIds);
      const updatedProjects = projects.filter(p => editingProjectIds.includes(p.id));
      setMemberProjects(prev => ({ ...prev, [userId]: updatedProjects }));
      setExpandedMember(null);
    } catch (err) {
      alert((err as Error).message ?? 'Failed to update project access');
    } finally {
      setSavingProjects(false);
    }
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
        <p style={{ fontSize: 12, color: '#4b5563', margin: '3px 0 0' }}>
          {members.length} {members.length === 1 ? 'member' : 'members'}
        </p>
      </div>

      {/* Invite form */}
      {isOwner && (
        <form onSubmit={handleInvite} style={{ marginBottom: 20, background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 16 }}>
          <p style={{ fontSize: 12.5, fontWeight: 600, color: '#e2e8f0', marginBottom: 12 }}>Invite a member</p>

          <input
            type="email" required placeholder="colleague@example.com" value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 8, border: '1px solid #374151', background: '#1f2937', color: '#f9fafb', fontSize: 12.5, outline: 'none', marginBottom: 12 }}
          />

          {/* Project access dropdown */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#9ca3af', marginBottom: 6 }}>
              Project access
            </label>
            <ProjectDropdown
              projects={projects}
              selectedIds={inviteProjectIds}
              onChange={setInviteProjectIds}
              placeholder="No projects selected — grant access later"
            />
          </div>

          <button
            type="submit" disabled={inviting}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#2563eb', color: 'white', fontSize: 12.5, fontWeight: 600, cursor: inviting ? 'not-allowed' : 'pointer', opacity: inviting ? 0.7 : 1 }}
          >
            {inviting ? 'Sending…' : 'Send invitation'}
          </button>

          {inviteError && <p style={{ fontSize: 11.5, color: '#f87171', marginTop: 8 }}>{inviteError}</p>}
          {inviteSuccess && <p style={{ fontSize: 11.5, color: '#6ee7b7', marginTop: 8 }}>✓ {inviteSuccess}</p>}
        </form>
      )}

      {/* Member list */}
      <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, overflow: 'hidden' }}>
        {members.map((member, i) => {
          const isSelf = member.id === currentUserId;
          const isOwnerRow = member.role === 'OWNER';
          const isExpanded = expandedMember === member.id;
          const accessProjects = memberProjects[member.id];

          return (
            <div
              key={member.id ?? member.email ?? i}
              style={{ borderBottom: i < members.length - 1 ? '1px solid #1f2937' : 'none' }}
            >
              {/* Main row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px' }}>
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
                ) : isOwner ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      onClick={() => handleExpandMember(member.id)}
                      style={{
                        padding: '4px 10px', borderRadius: 6, border: '1px solid #374151',
                        background: isExpanded ? '#1e3a5f' : 'transparent',
                        color: isExpanded ? '#93c5fd' : '#9ca3af',
                        fontSize: 11.5, cursor: 'pointer',
                      }}
                    >
                      {isExpanded ? 'Close' : 'Edit access'}
                    </button>
                    <button
                      onClick={() => handleRemove(member.id)}
                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #7f1d1d', background: 'transparent', color: '#f87171', fontSize: 11.5, cursor: 'pointer' }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  // Non-owner sees project chips (read-only)
                  accessProjects ? (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 200 }}>
                      {accessProjects.length === 0
                        ? <span style={{ fontSize: 10.5, color: '#6b7280' }}>No access</span>
                        : accessProjects.map(p => (
                          <span key={p.id} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#1e3a5f', color: '#93c5fd', border: '1px solid #1d4ed8' }}>
                            {p.name}
                          </span>
                        ))
                      }
                    </div>
                  ) : (
                    <span style={{ fontSize: 10.5, color: '#6b7280', background: '#1f2937', borderRadius: 4, padding: '2px 8px' }}>Member</span>
                  )
                )}
              </div>

              {/* Expanded project access panel */}
              {isExpanded && isOwner && (
                <div style={{ padding: '12px 16px 16px', background: '#0f172a', borderTop: '1px solid #1f2937' }}>
                  <p style={{ fontSize: 11.5, fontWeight: 600, color: '#9ca3af', marginBottom: 10 }}>
                    Project access for {member.name}
                  </p>
                  <div style={{ marginBottom: 12 }}>
                    <ProjectDropdown
                      projects={projects}
                      selectedIds={editingProjectIds}
                      onChange={setEditingProjectIds}
                      placeholder="No project access"
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => handleSaveProjectAccess(member.id)}
                      disabled={savingProjects}
                      style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#2563eb', color: 'white', fontSize: 12, fontWeight: 600, cursor: savingProjects ? 'not-allowed' : 'pointer', opacity: savingProjects ? 0.7 : 1 }}
                    >
                      {savingProjects ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setExpandedMember(null)}
                      style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #374151', background: 'transparent', color: '#9ca3af', fontSize: 12, cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
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

// ── Usage Section ─────────────────────────────────────────────────────────────

function UsageBar({ label, used, limit, color = '#3b82f6', unit = '' }: {
  label: string;
  used: number;
  limit: number | null;
  color?: string;
  unit?: string;
}) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  const isUnlimited = !limit || limit === Infinity;
  const usedStr = unit === 'MB' ? (used >= 1024 ? `${(used / 1024).toFixed(1)} GB` : `${used.toFixed(1)} MB`) : used.toLocaleString() + (unit ? ` ${unit}` : '');
  const limitStr = isUnlimited ? '∞' : (unit === 'MB' ? (limit! >= 1024 ? `${(limit! / 1024).toFixed(0)} GB` : `${limit} MB`) : limit!.toLocaleString() + (unit ? ` ${unit}` : ''));

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#9ca3af' }}>{label}</span>
        <span style={{ fontSize: 11.5, color: '#6b7280' }}>{usedStr} / {limitStr}</span>
      </div>
      <div style={{ height: 5, borderRadius: 99, background: '#1f2937', overflow: 'hidden' }}>
        {!isUnlimited && (
          <div style={{
            height: '100%', width: `${pct}%`, borderRadius: 99,
            background: pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : color,
            transition: 'width 400ms ease',
          }} />
        )}
        {isUnlimited && (
          <div style={{ height: '100%', width: '30%', borderRadius: 99, background: color, opacity: 0.4 }} />
        )}
      </div>
    </div>
  );
}

function UsageSection({ workspaceId }: { workspaceId: string }) {
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    workspacesApi.getUsage(workspaceId)
      .then(setUsage)
      .catch(() => setError('Failed to load usage data'))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
        <div style={{ width: 20, height: 20, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }

  if (error || !usage) {
    return <p style={{ color: '#f87171', fontSize: 13 }}>{error || 'No data'}</p>;
  }

  const u = usage.usage;

  const sectionStyle: React.CSSProperties = {
    background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: '16px 18px', marginBottom: 16,
  };
  const sectionTitle: React.CSSProperties = {
    fontSize: 11.5, fontWeight: 600, color: '#6b7280', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14,
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', margin: 0 }}>Usage — {usage.period}</h3>
        <span style={{ fontSize: 11, color: '#4b5563' }}>Plan: {usage.plan}</span>
      </div>

      <div style={sectionStyle}>
        <p style={sectionTitle}>AI</p>
        <UsageBar label="AI tokens" used={u.aiTokens.used} limit={u.aiTokens.limit} color="#8b5cf6" />
      </div>

      <div style={sectionStyle}>
        <p style={sectionTitle}>Database</p>
        <UsageBar label="DB reads" used={u.dbReads.used} limit={u.dbReads.limit} color="#06b6d4" />
        <UsageBar label="DB writes" used={u.dbWrites.used} limit={u.dbWrites.limit} color="#0ea5e9" />
      </div>

      <div style={sectionStyle}>
        <p style={sectionTitle}>Storage</p>
        <UsageBar label="Capacity used" used={u.storageMb.used} limit={u.storageMb.limit} unit="MB" color="#10b981" />
        <UsageBar label="Bandwidth" used={u.bandwidthMb.used} limit={u.bandwidthMb.limit} unit="MB" color="#34d399" />
        <UsageBar label="Storage requests" used={u.storageRequests.used} limit={u.storageRequests.limit} color="#6ee7b7" />
      </div>

      <div style={sectionStyle}>
        <p style={sectionTitle}>API & Network</p>
        <UsageBar label="API calls" used={u.apiCalls.used} limit={u.apiCalls.limit} color="#f59e0b" />
      </div>

      <div style={sectionStyle}>
        <p style={sectionTitle}>Realtime</p>
        <UsageBar label="WebSocket minutes" used={u.wsMinutes.used} limit={u.wsMinutes.limit} unit="min" color="#a78bfa" />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WorkspaceDetailPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = use(params);
  const router = useRouter();
  const { user } = usePlatform();
  const isSuperAdmin = user?.superAdmin ?? false;

  const [tab, setTab] = useState<Tab>('projects');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [loading, setLoading] = useState(true);

  // Initial load: only workspace + projects — no members yet
  useEffect(() => {
    setLoading(true);
    setTab('projects');
    setMembersLoaded(false);
    Promise.all([
      workspacesApi.get(workspaceId),
      projectsApi.list(workspaceId),
    ])
      .then(([wsRes, projRes]) => {
        setWorkspace(wsRes.workspace);
        setProjectList(projRes.projects);
      })
      .catch(() => router.push('/workspaces'))
      .finally(() => setLoading(false));
  }, [workspaceId, router]);

  // Lazy-load members only when the Members tab is first opened
  useEffect(() => {
    if (tab !== 'members' || membersLoaded) return;
    workspacesApi.listMembers(workspaceId)
      .then(res => {
        setMembers(res.members);
        setMembersLoaded(true);
      })
      .catch(() => setMembersLoaded(true));
  }, [tab, membersLoaded, workspaceId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ width: 24, height: 24, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!workspace) return null;

  const myRole = workspace.myRole ?? workspace.role;
  const isOwner = myRole === 'OWNER';
  const canEdit = myRole === 'OWNER' || myRole === 'EDITOR';

  const tabs: { id: Tab; label: string }[] = [
    { id: 'projects', label: 'Projects' },
    { id: 'members', label: `Members${workspace.memberCount > 0 ? ` (${workspace.memberCount})` : ''}` },
    { id: 'usage', label: 'Usage' },
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
            {!isSuperAdmin && (
              <span style={{
                fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                color: workspace.plan === 'PRO' ? '#a78bfa' : '#6b7280',
                background: workspace.plan === 'PRO' ? '#2e1065' : '#1f2937',
                letterSpacing: '0.05em',
              }}>
                {workspace.plan}
              </span>
            )}
            {isSuperAdmin && (
              <span style={{
                fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                color: '#a5b4fc', background: '#1e1b4b', letterSpacing: '0.05em',
              }}>
                ADMIN
              </span>
            )}
          </div>
          <p style={{ fontSize: 11.5, color: '#4b5563', margin: '2px 0 0' }}>
            {workspace.memberCount} {workspace.memberCount === 1 ? 'member' : 'members'} · {projectList.length} {projectList.length === 1 ? 'project' : 'projects'}
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
          isSuperAdmin={isSuperAdmin}
        />
      )}
      {tab === 'members' && (
        <MembersSection
          workspaceId={workspaceId}
          members={members}
          setMembers={setMembers}
          isOwner={isOwner}
          currentUserId={isOwner ? workspace.ownerId : undefined}
          projects={projectList}
        />
      )}
      {tab === 'usage' && (
        <UsageSection workspaceId={workspaceId} />
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
