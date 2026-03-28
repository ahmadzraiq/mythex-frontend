/**
 * Client-side API helpers for the platform (workspaces, projects, auth).
 * All calls go through Next.js /api/* proxy routes which forward to the backend.
 */

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  plan: 'FREE' | 'PRO';
  ownerId: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  projectCount: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  joinedAt: string;
}

export interface Project {
  id: string;
  name: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export type ApiError = { error: string; code?: string };

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    credentials: 'include',
  });

  const data = await res.json() as T | ApiError;
  if (!res.ok) {
    const err = data as ApiError;
    throw Object.assign(new Error(err.error ?? 'Request failed'), { code: err.code, status: res.status });
  }
  return data as T;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const auth = {
  register: (body: { name: string; email: string; password: string }) =>
    apiFetch<{ user: User; defaultWorkspaceId: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  login: (body: { email: string; password: string }) =>
    apiFetch<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  logout: () =>
    apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () =>
    apiFetch<{ user: User }>('/api/auth/me'),

  updateProfile: (body: { name?: string; avatarUrl?: string | null }) =>
    apiFetch<{ user: User }>('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};

// ── Workspaces ────────────────────────────────────────────────────────────────

export const workspaces = {
  list: () =>
    apiFetch<{ workspaces: Workspace[] }>('/api/workspaces'),

  create: (body: { name: string }) =>
    apiFetch<{ workspace: Workspace }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  get: (id: string) =>
    apiFetch<{ workspace: Workspace }>(`/api/workspaces/${id}`),

  update: (id: string, body: { name?: string }) =>
    apiFetch<{ workspace: Workspace }>(`/api/workspaces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  delete: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/workspaces/${id}`, { method: 'DELETE' }),

  listMembers: (id: string) =>
    apiFetch<{ members: WorkspaceMember[] }>(`/api/workspaces/${id}/members`),

  inviteMember: (id: string, body: { email: string; role?: 'EDITOR' | 'VIEWER' }) =>
    apiFetch<{ member: WorkspaceMember }>(`/api/workspaces/${id}/members`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateMemberRole: (wsId: string, userId: string, role: 'EDITOR' | 'VIEWER') =>
    apiFetch<{ ok: boolean }>(`/api/workspaces/${wsId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  removeMember: (wsId: string, userId: string) =>
    apiFetch<{ ok: boolean }>(`/api/workspaces/${wsId}/members/${userId}`, {
      method: 'DELETE',
    }),
};

// ── Projects ──────────────────────────────────────────────────────────────────

export const projects = {
  list: (workspaceId: string) =>
    apiFetch<{ projects: Project[] }>(`/api/workspaces/${workspaceId}/projects`),

  create: (workspaceId: string, body: { name: string }) =>
    apiFetch<{ project: Project }>(`/api/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  get: (id: string) =>
    apiFetch<{ project: Project }>(`/api/projects/${id}`),

  update: (id: string, body: { name?: string }) =>
    apiFetch<{ project: Project }>(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  delete: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),

  getConfig: (id: string) =>
    apiFetch<{ config: Record<string, unknown>; updatedAt: string }>(`/api/projects/${id}/config`),

  saveConfig: (id: string, config: Record<string, unknown>) =>
    apiFetch<{ ok: boolean; updatedAt: string }>(`/api/projects/${id}/config`, {
      method: 'PATCH',
      body: JSON.stringify(config),
    }),

  updateMeta: (id: string, meta: Record<string, unknown>) =>
    apiFetch<{ ok: boolean }>(`/api/projects/${id}/config/meta`, {
      method: 'PATCH',
      body: JSON.stringify(meta),
    }),
};
