/**
 * Backend Virtual File System projection.
 *
 * Mirrors app/dev/builder/_virtual-files.ts but for the BACKEND: it fetches
 * backend entities (models, enums, apis, middleware, functions, jobs, seeds)
 * and projects them under a `server/` namespace so the unified agent snapshot
 * is unambiguous. Writes to `server/*` route to backend API calls.
 *
 *   server/models/<folder?>/<Name>
 *   server/enums/<folder?>/<Name>
 *   server/apis/<folder?>/<slug>
 *   server/middleware/<folder?>/<name>
 *   server/functions/<folder?>/<name>
 *   server/jobs/<name>
 *   server/seeds/<model>
 *
 * `folder` is presentation-only metadata — it never affects the DB schema,
 * route/path, or endpoint URL.
 */

import {
  backendModels,
  backendEnums,
  backendSeeds,
  backendWorkflows,
  backendConfig,
  type ModelDefinitionJson,
  type ModelEnumJson,
  type BackendWorkflow,
} from '@/lib/platform/api-client';
import type { VirtualEntry, VirtualFolder, VirtualFile } from '@/app/dev/builder/_virtual-files';

export interface ServerApplyResult {
  ok: boolean;
  error?: string;
}

const KIND_BY_CATEGORY: Record<string, BackendWorkflow['kind']> = {
  apis: 'API_ENDPOINT',
  middleware: 'MIDDLEWARE',
  functions: 'FUNCTION',
  jobs: 'CRON',
};
const CATEGORY_BY_KIND: Record<string, string> = {
  API_ENDPOINT: 'apis',
  MIDDLEWARE: 'middleware',
  FUNCTION: 'functions',
  CRON: 'jobs',
};

function withFolder(base: string, folder: string | undefined, name: string): string {
  return folder ? `${base}/${folder}/${name}` : `${base}/${name}`;
}

// ── Fetch + project ───────────────────────────────────────────────────────────

export async function fetchServerFiles(projectId: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const json = (v: unknown) => JSON.stringify(v, null, 2);

  const snap = await backendConfig.getAll(projectId).catch(() => ({
    models: [] as ModelDefinitionJson[], enums: [] as ModelEnumJson[],
    workflows: [] as BackendWorkflow[], seeds: [] as Array<{ model: string; rows: Record<string, unknown>[] }>,
  }));

  for (const m of snap.models ?? []) {
    files[withFolder('server/models', m.folder as string | undefined, m.name)] = json(m);
  }
  for (const e of snap.enums ?? []) {
    files[withFolder('server/enums', e.folder, e.name)] = json({ name: e.name, values: e.values, ...(e.folder ? { folder: e.folder } : {}) });
  }
  for (const w of snap.workflows ?? []) {
    const category = CATEGORY_BY_KIND[w.kind];
    if (!category) continue;
    const folder = (w as unknown as { folder?: string }).folder;
    const name = w.slug || w.name;
    files[withFolder(`server/${category}`, folder, name)] = json(w);
  }
  for (const s of snap.seeds ?? []) {
    files[`server/seeds/${s.model}`] = json({ model: s.model, rows: s.rows });
  }

  return files;
}

// ── Apply (write) ─────────────────────────────────────────────────────────────

export async function applyServerFile(projectId: string, vfsPath: string, jsonText: string): Promise<ServerApplyResult> {
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText); } catch (e) { return { ok: false, error: `JSON parse error: ${(e as Error).message}` }; }
  const parts = vfsPath.split('/'); // server/<category>/.../<name>
  if (parts[0] !== 'server') return { ok: false, error: `Not a server path: ${vfsPath}` };
  const category = parts[1];
  const folder = parts.length > 3 ? parts.slice(2, -1).join('/') : undefined;

  try {
    switch (category) {
      case 'models': {
        const def = parsed as ModelDefinitionJson;
        if (folder && !def.folder) def.folder = folder;
        await backendModels.upsert(projectId, def);
        return { ok: true };
      }
      case 'enums': {
        const e = parsed as ModelEnumJson;
        await backendEnums.upsert(projectId, { name: e.name, values: e.values, folder: e.folder ?? folder });
        return { ok: true };
      }
      case 'seeds': {
        const s = parsed as { model: string; rows: Record<string, unknown>[] };
        await backendSeeds.set(projectId, s.model, s.rows ?? []);
        return { ok: true };
      }
      case 'apis':
      case 'middleware':
      case 'functions':
      case 'jobs': {
        const kind = KIND_BY_CATEGORY[category];
        const wf = parsed as Partial<BackendWorkflow> & { slug?: string; folder?: string };
        wf.kind = kind;
        if (folder && !wf.folder) (wf as { folder?: string }).folder = folder;
        const existing = await backendConfig.getAll(projectId).catch(() => ({ workflows: [] as BackendWorkflow[] }));
        const match = (existing.workflows as BackendWorkflow[]).filter(w => w.kind === kind).find((w) => w.slug === wf.slug || w.name === wf.name);
        if (match) await backendWorkflows.update(projectId, match.id, wf);
        else await backendWorkflows.create(projectId, wf);
        return { ok: true };
      }
      default:
        return { ok: false, error: `Unknown server category: ${category}` };
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteServerFile(projectId: string, vfsPath: string): Promise<ServerApplyResult> {
  const parts = vfsPath.split('/');
  if (parts[0] !== 'server') return { ok: false, error: `Not a server path: ${vfsPath}` };
  const category = parts[1];
  const name = parts[parts.length - 1];
  try {
    switch (category) {
      case 'models': await backendModels.delete(projectId, name); return { ok: true };
      case 'enums': await backendEnums.delete(projectId, name); return { ok: true };
      case 'seeds': await backendSeeds.delete(projectId, name); return { ok: true };
      case 'apis': case 'middleware': case 'functions': case 'jobs': {
        const kind = KIND_BY_CATEGORY[category];
        const existing = await backendConfig.getAll(projectId).catch(() => ({ workflows: [] as BackendWorkflow[] }));
        const match = (existing.workflows as BackendWorkflow[]).filter(w => w.kind === kind).find((w) => w.slug === name || w.name === name);
        if (match) await backendWorkflows.delete(projectId, match.id);
        return { ok: true };
      }
      default: return { ok: false, error: `Cannot delete server category: ${category}` };
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Tree (for the Files overlay) ───────────────────────────────────────────────

export function buildServerTree(files: Record<string, string>): VirtualFolder {
  const root: VirtualFolder = { kind: 'folder', name: 'server', path: 'server', children: [] };
  const folderMap = new Map<string, VirtualFolder>([['server', root]]);

  const ensureFolder = (segments: string[]): VirtualFolder => {
    let cur = root;
    let acc = 'server';
    for (const seg of segments) {
      acc = `${acc}/${seg}`;
      let next = folderMap.get(acc);
      if (!next) {
        next = { kind: 'folder', name: seg, path: acc, children: [] };
        folderMap.set(acc, next);
        cur.children.push(next);
      }
      cur = next;
    }
    return cur;
  };

  const iconFor = (category: string): VirtualFile['icon'] => {
    switch (category) {
      case 'models': return 'data';
      case 'enums': return 'variable';
      case 'apis': case 'middleware': case 'functions': case 'jobs': return 'workflow';
      case 'seeds': return 'formula';
      default: return 'data';
    }
  };

  for (const path of Object.keys(files).sort()) {
    const segs = path.split('/'); // server/<category>/<...>/<name>
    const dir = segs.slice(1, -1);
    const name = segs[segs.length - 1];
    const folder = ensureFolder(dir);
    const file: VirtualFile = { kind: 'file', name: `${name}.json`, path, icon: iconFor(segs[1]) };
    folder.children.push(file);
  }
  return root;
}

export type { VirtualEntry };
