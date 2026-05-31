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

// ── Backend — Tables ──────────────────────────────────────────────────────────

export interface BackendColumn {
  id: string;
  name: string;
  displayName: string;
  type: string;
  nullable: boolean;
  unique: boolean;
  required: boolean;
  indexed: boolean;
  defaultVal?: string | null;
  enumValues: string[];
  position: number;
}

export interface BackendTable {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  isSystem: boolean;
  autoCrudGenerated: boolean;
  columns: BackendColumn[];
  createdAt: string;
}

export interface BackendView {
  id: string;
  name: string;
  slug: string;
  tableId: string;
  parameters: unknown[];
  filters: unknown[];
  sort: unknown[];
  fields: unknown[];
  security: 'PUBLIC' | 'AUTHENTICATED' | 'ROLE';
  allowedRoles: string[];
  createdAt: string;
}

export interface BackendWorkflow {
  id: string;
  name: string;
  slug: string;
  kind: 'API_ENDPOINT' | 'FUNCTION' | 'MIDDLEWARE' | 'CRON' | 'WEBHOOK_IN' | 'TABLE_HOOK' | 'AUTH_EVENT';
  method?: string | null;
  path?: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  security: 'PUBLIC' | 'AUTHENTICATED' | 'ROLE';
  graph: unknown;
  createdAt: string;
  securityPolicy?: { access: 'public' | 'authenticated'; middlewareIds: string[] };
}

export interface BackendFileObject {
  id: string;
  bucket: string;
  key: string;
  mime: string;
  size: number;
  storage: 'PUBLIC' | 'PRIVATE';
  createdAt: string;
}

export interface ProjectUser {
  id: string;
  email: string;
  name?: string | null;
  email_verified: boolean;
  is_disabled: boolean;
  created_at: string;
}

// Tables API
export const backendTables = {
  list: (projectId: string) =>
    apiFetch<{ tables: BackendTable[] }>(`/api/projects/${projectId}/tables`),

  get: (projectId: string, tableId: string) =>
    apiFetch<{ table: BackendTable }>(`/api/projects/${projectId}/tables/${tableId}`),

  create: (projectId: string, body: {
    name: string; displayName?: string; description?: string;
    createApiActions?: boolean; columns?: Partial<BackendColumn>[];
  }) =>
    apiFetch<{ table: BackendTable }>(`/api/projects/${projectId}/tables`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  update: (projectId: string, tableId: string, body: Partial<BackendTable>) =>
    apiFetch<{ table: BackendTable }>(`/api/projects/${projectId}/tables/${tableId}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),

  delete: (projectId: string, tableId: string) =>
    apiFetch<{ ok: boolean }>(`/api/projects/${projectId}/tables/${tableId}`, { method: 'DELETE' }),

  addColumn: (projectId: string, tableId: string, body: Partial<BackendColumn>) =>
    apiFetch<{ column: BackendColumn }>(`/api/projects/${projectId}/tables/${tableId}/columns`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  updateColumn: (projectId: string, tableId: string, columnId: string, body: Partial<BackendColumn>) =>
    apiFetch<{ column: BackendColumn }>(`/api/projects/${projectId}/tables/${tableId}/columns/${columnId}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),

  deleteColumn: (projectId: string, tableId: string, columnId: string) =>
    apiFetch<{ ok: boolean }>(`/api/projects/${projectId}/tables/${tableId}/columns/${columnId}`, { method: 'DELETE' }),
};

// Views API
export const backendViews = {
  list: (projectId: string) =>
    apiFetch<{ views: BackendView[] }>(`/api/projects/${projectId}/views`),

  create: (projectId: string, body: Partial<BackendView> & { tableId: string }) =>
    apiFetch<{ view: BackendView }>(`/api/projects/${projectId}/views`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  update: (projectId: string, viewId: string, body: Partial<BackendView>) =>
    apiFetch<{ view: BackendView }>(`/api/projects/${projectId}/views/${viewId}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),

  delete: (projectId: string, viewId: string) =>
    apiFetch<{ ok: boolean }>(`/api/projects/${projectId}/views/${viewId}`, { method: 'DELETE' }),
};

// Workflows API
export const backendWorkflows = {
  list: (projectId: string, params?: { kind?: string; status?: string }) => {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return apiFetch<{ workflows: BackendWorkflow[] }>(`/api/projects/${projectId}/workflows${qs}`);
  },

  get: (projectId: string, workflowId: string) =>
    apiFetch<{ workflow: BackendWorkflow }>(`/api/projects/${projectId}/workflows/${workflowId}`),

  create: (projectId: string, body: Partial<BackendWorkflow>) =>
    apiFetch<{ workflow: BackendWorkflow }>(`/api/projects/${projectId}/workflows`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  update: (projectId: string, workflowId: string, body: Partial<BackendWorkflow>) =>
    apiFetch<{ workflow: BackendWorkflow }>(`/api/projects/${projectId}/workflows/${workflowId}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),

  publish: (projectId: string, workflowId: string) =>
    apiFetch<{ workflow: BackendWorkflow }>(`/api/projects/${projectId}/workflows/${workflowId}/publish`, { method: 'POST' }),

  unpublish: (projectId: string, workflowId: string) =>
    apiFetch<{ workflow: BackendWorkflow }>(`/api/projects/${projectId}/workflows/${workflowId}/unpublish`, { method: 'POST' }),

  delete: (projectId: string, workflowId: string) =>
    apiFetch<{ ok: boolean }>(`/api/projects/${projectId}/workflows/${workflowId}`, { method: 'DELETE' }),

  testRun: (projectId: string, workflowId: string, input?: Record<string, unknown>) =>
    apiFetch<{ runId: string; status: string }>(`/api/projects/${projectId}/workflows/${workflowId}/test`, {
      method: 'POST', body: JSON.stringify({ input }),
    }),
};

// Storage API
export const backendStorage = {
  list: (projectId: string, bucket?: string) => {
    const qs = bucket ? `?bucket=${bucket}` : '';
    return apiFetch<{ files: BackendFileObject[] }>(`/api/projects/${projectId}/storage${qs}`);
  },

  presignUpload: (projectId: string, body: { bucket: 'public' | 'private'; key: string; mime: string }) =>
    apiFetch<{ url: string; bucket: string; key: string; expiresIn: number }>(
      `/api/projects/${projectId}/storage/presign-upload`, { method: 'POST', body: JSON.stringify(body) }),

  getPresignedUrl: (projectId: string, fileId: string) =>
    apiFetch<{ url: string; expiresIn: number | null }>(`/api/projects/${projectId}/storage/${fileId}/presigned`),

  delete: (projectId: string, fileId: string) =>
    apiFetch<{ ok: boolean }>(`/api/projects/${projectId}/storage/${fileId}`, { method: 'DELETE' }),
};

// Data Plane (row CRUD) API
export interface RowsListOptions {
  filters?: Array<{ field: string; operator: string; value?: unknown }>;
  sort?: Array<{ field: string; dir: 'asc' | 'desc' }>;
  fields?: string[];
  page?: number;
  pageSize?: number;
}

export const backendRows = {
  list: (projectId: string, tableName: string, opts?: RowsListOptions) => {
    const params: Record<string, string> = {};
    if (opts?.filters?.length)   params.filters  = JSON.stringify(opts.filters);
    if (opts?.sort?.length)      params.sort     = JSON.stringify(opts.sort);
    if (opts?.fields?.length)    params.fields   = opts.fields.join(',');
    if (opts?.page !== undefined) params.page    = String(opts.page);
    if (opts?.pageSize !== undefined) params.pageSize = String(opts.pageSize);
    const qs = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch<{ rows: Record<string, unknown>[]; total: number; page: number; pageSize: number }>(
      `/api/projects/${projectId}/data/${tableName}${qs}`,
    );
  },

  insert: (projectId: string, tableName: string, row: Record<string, unknown>) =>
    apiFetch<{ row: Record<string, unknown> }>(`/api/projects/${projectId}/data/${tableName}`, {
      method: 'POST', body: JSON.stringify(row),
    }),

  update: (projectId: string, tableName: string, rowId: string, patch: Record<string, unknown>) =>
    apiFetch<{ row: Record<string, unknown> }>(`/api/projects/${projectId}/data/${tableName}/${rowId}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),

  delete: (projectId: string, tableName: string, rowId: string) =>
    apiFetch<{ ok: boolean }>(`/api/projects/${projectId}/data/${tableName}/${rowId}`, { method: 'DELETE' }),
};

// Project Auth (end-user management)
export const backendAuth = {
  listUsers: (projectId: string, params?: { q?: string; limit?: string; offset?: string }) => {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return apiFetch<{ users: ProjectUser[]; total: number }>(`/api/data/${projectId}/auth/users${qs}`);
  },

  updateUser: (projectId: string, userId: string, body: { name?: string; is_disabled?: boolean }) =>
    apiFetch<{ user: ProjectUser }>(`/api/data/${projectId}/auth/users/${userId}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),

  resetPassword: (projectId: string, userId: string, newPassword: string) =>
    apiFetch<{ ok: boolean }>(`/api/data/${projectId}/auth/users/${userId}/reset-password`, {
      method: 'POST', body: JSON.stringify({ newPassword }),
    }),
};
