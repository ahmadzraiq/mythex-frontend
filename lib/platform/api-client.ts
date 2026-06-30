/**
 * Client-side API helpers for the platform (workspaces, projects, auth).
 * All calls go directly to the Fastify backend at NEXT_PUBLIC_BACKEND_URL.
 */

const BACKEND_BASE = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4000';

/**
 * Resolve a path to the Fastify backend.
 * /api/auth/login       → {BACKEND_BASE}/v1/auth/login
 * /api/projects/:id     → {BACKEND_BASE}/v1/projects/:id
 * /api/db/...           → {BACKEND_BASE}/v1/db/...
 * Anything not starting with /api/ is passed through unchanged.
 */
function backendUrl(path: string): string {
  if (path.startsWith('/api/')) {
    return `${BACKEND_BASE}/v1/${path.slice('/api/'.length)}`;
  }
  return path;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  superAdmin?: boolean;
  emailVerified?: boolean;
  googleId?: string | null;
  createdAt: string;
}

export interface PlanLimits {
  projects: number;
  members: number;
  aiAccess: boolean;
  exports: boolean;
  aiTokensPerMonth: number;
  storageMb: number;
  apiCallsPerMonth: number;
}

export interface Workspace {
  id: string;
  name: string;
  plan: 'FREE' | 'PRO' | 'ENTERPRISE';
  ownerId: string;
  myRole: 'OWNER' | 'MEMBER' | 'EDITOR' | 'VIEWER';
  /** @deprecated use myRole */
  role?: 'OWNER' | 'MEMBER' | 'EDITOR' | 'VIEWER';
  projectCount: number;
  memberCount: number;
  limits?: PlanLimits;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceInvitation {
  id: string;
  email: string;
  projectIds: string[];
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
  invitedBy?: { id: string; name: string; email: string };
}

interface UsageMeterEntry {
  used: number;
  limit: number;
  remaining: number | null;
}

export interface WorkspaceUsage {
  period: string;
  plan: 'FREE' | 'PRO' | 'ENTERPRISE';
  usage: {
    aiTokens:        UsageMeterEntry;
    apiCalls:        UsageMeterEntry;
    storageMb:       UsageMeterEntry;
    bandwidthMb:     UsageMeterEntry;
    storageRequests: UsageMeterEntry;
    dbReads:         UsageMeterEntry;
    dbWrites:        UsageMeterEntry;
    wsMinutes:       UsageMeterEntry;
  };
  limits: PlanLimits;
}

export interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  role: 'OWNER' | 'MEMBER' | 'EDITOR' | 'VIEWER';
  joinedAt: string;
}

/** Raw shape the backend actually returns — user fields nested under `user` */
interface RawWorkspaceMember {
  userId: string;
  workspaceId: string;
  role: 'OWNER' | 'MEMBER' | 'EDITOR' | 'VIEWER';
  joinedAt: string;
  user?: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
  };
}

function normalizeMember(raw: RawWorkspaceMember): WorkspaceMember {
  return {
    id:        raw.user?.id ?? raw.userId,
    name:      raw.user?.name ?? '',
    email:     raw.user?.email ?? '',
    avatarUrl: raw.user?.avatarUrl,
    role:      raw.role,
    joinedAt:  raw.joinedAt,
  };
}

export interface Project {
  id: string;
  name: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  published?: boolean;
  customDomain?: string | null;
  customDomainVerified?: boolean;
}

export type ApiError = { error: string; code?: string };

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(backendUrl(path), {
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

  verifyEmail: (email: string, code: string) =>
    apiFetch<{ ok: boolean }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),

  resendVerification: (email: string) =>
    apiFetch<{ ok: boolean }>('/api/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  forgotPassword: (email: string) =>
    apiFetch<{ ok: boolean }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, newPassword: string) =>
    apiFetch<{ ok: boolean }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
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
    apiFetch<void>(`/api/workspaces/${id}`, { method: 'DELETE' }),

  listMembers: async (id: string) => {
    const res = await apiFetch<{ members: RawWorkspaceMember[] }>(`/api/workspaces/${id}/members`);
    return { members: res.members.map(normalizeMember) };
  },

  updateMemberProjects: (wsId: string, userId: string, projectIds: string[]) =>
    apiFetch<{ ok: boolean; projectIds: string[] }>(`/api/workspaces/${wsId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ projectIds }),
    }),

  getMemberProjects: (wsId: string, userId: string) =>
    apiFetch<{ projectIds: string[]; projects: { id: string; name: string }[]; allProjects: boolean }>(
      `/api/workspaces/${wsId}/members/${userId}/projects`,
    ),

  removeMember: (wsId: string, userId: string) =>
    apiFetch<void>(`/api/workspaces/${wsId}/members/${userId}`, { method: 'DELETE' }),

  leaveWorkspace: (wsId: string) =>
    apiFetch<{ ok: boolean }>(`/api/workspaces/${wsId}/leave`, { method: 'POST' }),

  // ── Invitations ────────────────────────────────────────────────────────────

  listInvitations: (wsId: string) =>
    apiFetch<{ invitations: WorkspaceInvitation[] }>(`/api/workspaces/${wsId}/invitations`),

  sendInvitation: (wsId: string, body: { email: string; projectIds: string[] }) =>
    apiFetch<{ ok: boolean; message: string }>(`/api/workspaces/${wsId}/invitations`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  revokeInvitation: (wsId: string, invitationId: string) =>
    apiFetch<void>(`/api/workspaces/${wsId}/invitations/${invitationId}`, { method: 'DELETE' }),

  previewInvitation: (token: string) =>
    apiFetch<{ email: string; role: string; workspaceName: string; workspaceId: string; inviterName: string; expiresAt: string; hasAccount: boolean }>(
      `/api/workspaces/invitations/preview?token=${encodeURIComponent(token)}`,
    ),

  acceptInvitation: (token: string) =>
    apiFetch<{ ok: boolean; workspaceId: string; role: string }>(
      `/api/workspaces/invitations/accept?token=${encodeURIComponent(token)}`,
      { method: 'POST' },
    ),

  // ── Usage ──────────────────────────────────────────────────────────────────

  getUsage: (wsId: string) =>
    apiFetch<WorkspaceUsage>(`/api/workspaces/${wsId}/usage`),

  reportAiUsage: (wsId: string, body: { inputTokens: number; outputTokens: number; projectId?: string; model?: string }) =>
    apiFetch<{ used: number; limit: number; remaining: number }>(`/api/workspaces/${wsId}/usage/ai`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ── Billing ────────────────────────────────────────────────────────────────

  getBilling: (wsId: string) =>
    apiFetch<{ plan: string; subscription: unknown; limits: PlanLimits }>(`/api/workspaces/${wsId}/billing`),

  startCheckout: (wsId: string) =>
    apiFetch<{ url: string }>(`/api/workspaces/${wsId}/billing/checkout`, { method: 'POST' }),

  openPortal: (wsId: string) =>
    apiFetch<{ url: string }>(`/api/workspaces/${wsId}/billing/portal`, { method: 'POST' }),
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

  authoriseExport: (id: string) =>
    apiFetch<{ approved: boolean; price: number; message: string }>(`/api/projects/${id}/export/pay`, { method: 'POST' }),

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

  publish: (id: string) =>
    apiFetch<{ ok: boolean; published: boolean }>(`/api/projects/${id}/publish`, { method: 'POST' }),

  unpublish: (id: string) =>
    apiFetch<{ ok: boolean; published: boolean }>(`/api/projects/${id}/unpublish`, { method: 'POST' }),

  setCustomDomain: (id: string, domain: string) =>
    apiFetch<{ ok: boolean; customDomain: string | null; verified: boolean }>(`/api/projects/${id}/custom-domain`, {
      method: 'POST',
      body: JSON.stringify({ domain }),
    }),

  verifyCustomDomain: (id: string) =>
    apiFetch<{ ok: boolean; verified: boolean; customDomain: string; expectedCname: string; message: string }>(`/api/projects/${id}/custom-domain/verify`, { method: 'POST' }),

  removeCustomDomain: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/projects/${id}/custom-domain`, { method: 'DELETE' }),
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

export interface BackendWorkflow {
  id: string;
  name: string;
  slug: string;
  kind: 'API_ENDPOINT' | 'FUNCTION' | 'MIDDLEWARE' | 'CRON' | 'WEBHOOK_IN' | 'TABLE_HOOK' | 'AUTH_EVENT';
  method?: string | null;
  path?: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  security: 'PUBLIC' | 'AUTHENTICATED' | 'ROLE';
  middlewareIds?: string[];
  graph: unknown;
  inputSchema?: Array<import('../config/types').WorkflowParam>;
  createdAt: string;
  folder?: string | null;
  autoGroupTableId?: string | null;
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

  deleteAll: (projectId: string) =>
    apiFetch<{ deleted: number }>(`/api/projects/${projectId}/tables/all`, { method: 'DELETE' }),
};

// ── Backend — Models (model-first source of truth) ─────────────────────────────

/** The authored model definition JSON (see lib/backend-vfs for the shape). */
export type ModelFieldType =
  | 'text' | 'int' | 'bigint' | 'decimal' | 'float' | 'bool' | 'boolean'
  | 'json' | 'uuid' | 'timestamp' | 'datetime' | 'date' | 'file' | 'enum' | 'money' | 'relation';

export type ModelRelationKind = 'manyToOne' | 'oneToMany' | 'oneToOne' | 'manyToMany';

export interface ModelRelationJson {
  to: string;
  kind: ModelRelationKind;
  onDelete?: 'cascade' | 'setNull' | 'restrict' | 'noAction';
  field?: string;
  through?: string;
}

export interface ModelComputedJson {
  expr: string;
  persisted?: boolean;
}

export interface ModelFieldJson {
  id: string;
  name: string;
  type: ModelFieldType;
  required?: boolean;
  unique?: boolean;
  indexed?: boolean;
  default?: string;
  description?: string;
  enum?: string;
  relation?: ModelRelationJson;
  computed?: ModelComputedJson;
  searchable?: boolean;
}

export interface ModelIndexJson { fields: string[]; unique?: boolean }

export interface ModelDefinitionJson {
  id: string;
  name: string;
  table: string;
  folder?: string;
  timestamps?: boolean;
  softDelete?: boolean;
  actorTracking?: boolean;
  fields: ModelFieldJson[];
  indexes?: ModelIndexJson[];
  search?: string[];
  validations?: Record<string, string>;
  hooks?: Record<string, string>;
  events?: Record<string, string>;
  access?: Record<string, string[]>;
  [key: string]: unknown;
}

export interface ModelEnumJson { id?: string; name: string; values: string[]; folder?: string }

export const backendModels = {
  list: (projectId: string) =>
    apiFetch<{ models: ModelDefinitionJson[] }>(`/api/projects/${projectId}/models`),

  get: (projectId: string, name: string) =>
    apiFetch<{ model: ModelDefinitionJson }>(`/api/projects/${projectId}/models/${encodeURIComponent(name)}`),

  upsert: (projectId: string, definition: ModelDefinitionJson, confirmDestructive = false) =>
    apiFetch<{ model: ModelDefinitionJson; migration: { ddl: string[]; warnings: string[] } }>(
      `/api/projects/${projectId}/models`,
      { method: 'POST', body: JSON.stringify({ definition, confirmDestructive }) },
    ),

  delete: (projectId: string, name: string, confirmDestructive = true) =>
    apiFetch<{ ok: boolean }>(`/api/projects/${projectId}/models/${encodeURIComponent(name)}?confirmDestructive=${confirmDestructive}`, { method: 'DELETE' }),
};

export const backendEnums = {
  list: (projectId: string) =>
    apiFetch<{ enums: ModelEnumJson[] }>(`/api/projects/${projectId}/enums`),

  upsert: (projectId: string, body: ModelEnumJson) =>
    apiFetch<{ enum: ModelEnumJson }>(`/api/projects/${projectId}/enums`, { method: 'POST', body: JSON.stringify(body) }),

  delete: (projectId: string, name: string) =>
    apiFetch<{ ok: boolean }>(`/api/projects/${projectId}/enums/${encodeURIComponent(name)}`, { method: 'DELETE' }),
};

export const backendSeeds = {
  list: (projectId: string) =>
    apiFetch<{ seeds: Array<{ model: string; rows: Record<string, unknown>[] }> }>(`/api/projects/${projectId}/seeds`),

  set: (projectId: string, model: string, rows: Record<string, unknown>[]) =>
    apiFetch<{ seed: { model: string; rows: Record<string, unknown>[] } }>(`/api/projects/${projectId}/seeds/${encodeURIComponent(model)}`, { method: 'PUT', body: JSON.stringify({ rows }) }),

  apply: (projectId: string, model: string) =>
    apiFetch<{ applied: number; errors: string[] }>(`/api/projects/${projectId}/seeds/${encodeURIComponent(model)}/apply`, { method: 'POST', body: JSON.stringify({}) }),

  delete: (projectId: string, model: string) =>
    apiFetch<{ ok: boolean }>(`/api/projects/${projectId}/seeds/${encodeURIComponent(model)}`, { method: 'DELETE' }),
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

  deleteAll: (projectId: string) =>
    apiFetch<{ deleted: number }>(`/api/projects/${projectId}/workflows/all`, { method: 'DELETE' }),

  testRun: (projectId: string, workflowId: string, input?: Record<string, unknown>) =>
    apiFetch<{ runId: string; status: string }>(`/api/projects/${projectId}/workflows/${workflowId}/test`, {
      method: 'POST', body: JSON.stringify({ input }),
    }),
};

// Unified backend config — single call returning models + enums + workflows + seeds.
export interface BackendConfigSnapshot {
  models:    ModelDefinitionJson[];
  enums:     ModelEnumJson[];
  workflows: BackendWorkflow[];
  seeds:     Array<{ id: string; model: string; rows: Record<string, unknown>[] }>;
}

export const backendConfig = {
  getAll: (projectId: string) =>
    apiFetch<BackendConfigSnapshot>(`/api/projects/${projectId}/backend-config`),
};

// Storage API
export const backendStorage = {
  list: (projectId: string, bucket?: string) => {
    const qs = bucket ? `?bucket=${bucket}` : '';
    return apiFetch<{ files: BackendFileObject[] }>(`/api/projects/${projectId}/storage${qs}`);
  },

  presignUpload: (projectId: string, body: { bucket: 'public' | 'private'; key: string; mime: string; sizeMb?: number }) =>
    apiFetch<{ url: string; bucket: string; key: string; expiresIn: number }>(
      `/api/projects/${projectId}/storage/presign-upload`, { method: 'POST', body: JSON.stringify(body) }),

  register: (projectId: string, body: { bucket: 'public' | 'private'; key: string; mime: string; size: number; sha256?: string }) =>
    apiFetch<{ file: BackendFileObject }>(`/api/projects/${projectId}/storage/register`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  getPresignedUrl: (projectId: string, fileId: string) =>
    apiFetch<{ url: string; expiresIn: number | null }>(`/api/projects/${projectId}/storage/${fileId}/presigned`),

  delete: (projectId: string, fileId: string) =>
    apiFetch<{ ok: boolean }>(`/api/projects/${projectId}/storage/${fileId}`, { method: 'DELETE' }),
};


// ── Model data plane (generic CRUD over /v1/db, model = source of truth) ───────
export interface DbListOptions {
  where?: unknown;
  orderBy?: unknown;
  include?: unknown;
  select?: unknown;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface DbListResult {
  data: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const backendDb = {
  list: (projectId: string, model: string, opts?: DbListOptions) => {
    const params: Record<string, string> = {};
    if (opts?.where !== undefined)   params.where   = JSON.stringify(opts.where);
    if (opts?.orderBy !== undefined) params.orderBy = JSON.stringify(opts.orderBy);
    if (opts?.include !== undefined) params.include = JSON.stringify(opts.include);
    if (opts?.select !== undefined)  params.select  = JSON.stringify(opts.select);
    if (opts?.search)                params.search  = opts.search;
    if (opts?.page !== undefined)    params.page    = String(opts.page);
    if (opts?.pageSize !== undefined) params.pageSize = String(opts.pageSize);
    const qs = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch<DbListResult>(`/api/db/${projectId}/${encodeURIComponent(model)}${qs}`);
  },

  get: (projectId: string, model: string, id: string) =>
    apiFetch<Record<string, unknown>>(`/api/db/${projectId}/${encodeURIComponent(model)}/${id}`),

  create: (projectId: string, model: string, data: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/api/db/${projectId}/${encodeURIComponent(model)}`, {
      method: 'POST', body: JSON.stringify({ data }),
    }),

  update: (projectId: string, model: string, id: string, data: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/api/db/${projectId}/${encodeURIComponent(model)}/${id}`, {
      method: 'PATCH', body: JSON.stringify({ data }),
    }),

  delete: (projectId: string, model: string, id: string) =>
    apiFetch<{ deleted: boolean; id: string }>(`/api/db/${projectId}/${encodeURIComponent(model)}/${id}`, { method: 'DELETE' }),
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

// ── Environment Variables API ─────────────────────────────────────────────────

export interface EnvVariable {
  id: string;
  projectId: string;
  name: string;
  devValue: string;
  prodValue: string;
  createdAt: string;
  updatedAt: string;
}

export const envVariables = {
  list: (projectId: string) =>
    apiFetch<{ envVariables: EnvVariable[] }>(`/api/projects/${projectId}/env-variables`),

  upsert: (projectId: string, name: string, body: { devValue: string; prodValue: string }) =>
    apiFetch<{ envVariable: EnvVariable }>(`/api/projects/${projectId}/env-variables/${name}`, {
      method: 'PUT', body: JSON.stringify(body),
    }),

  delete: (projectId: string, name: string) =>
    apiFetch<{ ok: boolean }>(`/api/projects/${projectId}/env-variables/${name}`, { method: 'DELETE' }),
};
