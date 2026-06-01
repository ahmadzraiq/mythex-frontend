/**
 * datasources.ts — Emit lib/api.ts with typed fetch/graphql functions per datasource.
 *
 * Sensitive values (endpoints, API keys, auth headers) go into .env.example
 * and are referenced as process.env.* in the emitted code.
 */

import type { CodegenCtx, EmittedFile } from './types';
import type { DataSourceConfig } from '@/app/dev/builder/_store-types';

export function emitApiTs(ctx: CodegenCtx): EmittedFile {
  const { store, symbols } = ctx;
  const datasources = store.pageDataSources ?? [];

  const lines: string[] = [];
  lines.push(`/**`);
  lines.push(` * lib/api.ts — Auto-generated data fetching functions.`);
  lines.push(` * Configure endpoints in .env.local`);
  lines.push(` */`);
  lines.push('');

  // Simple LRU cache
  lines.push(`const _cache = new Map<string, { data: unknown; at: number }>();`);
  lines.push(`const CACHE_TTL = 30_000; // 30 seconds`);
  lines.push('');
  lines.push(`function cacheGet(key: string): unknown | undefined {`);
  lines.push(`  const entry = _cache.get(key);`);
  lines.push(`  if (!entry) return undefined;`);
  lines.push(`  if (Date.now() - entry.at > CACHE_TTL) { _cache.delete(key); return undefined; }`);
  lines.push(`  return entry.data;`);
  lines.push(`}`);
  lines.push('');
  lines.push(`function cacheSet(key: string, data: unknown): void {`);
  lines.push(`  _cache.set(key, { data, at: Date.now() });`);
  lines.push(`}`);
  lines.push('');

  for (const ds of datasources) {
    const fnName = symbols.collections.get(ds.id) ?? ds.name;
    if (!fnName) continue;

    if (ds.type === 'graphql') {
      emitGraphQLFn(lines, ds, fnName);
    } else {
      emitRestFn(lines, ds, fnName);
    }
    lines.push('');
  }

  lines.push(`export const api = {`);
  for (const ds of datasources) {
    const fnName = symbols.collections.get(ds.id) ?? ds.name;
    if (!fnName) continue;
    lines.push(`  ${fnName},`);
  }
  lines.push(`};`);

  return { path: 'lib/api.ts', content: lines.join('\n') };
}

function emitRestFn(lines: string[], ds: DataSourceConfig, fnName: string): void {
  const urlEnvKey = `NEXT_PUBLIC_${fnName.toUpperCase()}_URL`;
  const urlDefault = ds.url ?? '';

  lines.push(`async function ${fnName}(overrides?: RequestInit): Promise<unknown> {`);
  lines.push(`  const url = process.env.${urlEnvKey} ?? ${JSON.stringify(urlDefault)};`);
  lines.push(`  const cacheKey = url;`);
  if (ds.method === 'GET' || !ds.method) {
    lines.push(`  const cached = cacheGet(cacheKey);`);
    lines.push(`  if (cached) return cached;`);
  }
  lines.push(`  const controller = new AbortController();`);
  lines.push(`  const opts: RequestInit = {`);
  lines.push(`    method: ${JSON.stringify(ds.method ?? 'GET')},`);
  if (ds.headers && ds.headers.filter(h => h.enabled !== false).length > 0) {
    const headers: Record<string, string> = {};
    for (const h of ds.headers.filter(hh => hh.enabled !== false)) {
      // auth headers reference env vars
      if (h.value?.startsWith('Bearer ') || h.key.toLowerCase() === 'authorization') {
        headers[h.key] = `\${process.env.NEXT_PUBLIC_${fnName.toUpperCase()}_AUTH_TOKEN ?? ''}`;
      } else {
        headers[h.key] = h.value;
      }
    }
    lines.push(`    headers: ${JSON.stringify(headers)},`);
  }
  if (ds.sendCredentials) lines.push(`    credentials: 'include',`);
  lines.push(`    signal: controller.signal,`);
  lines.push(`    ...overrides,`);
  lines.push(`  };`);
  if (ds.body) {
    lines.push(`  opts.body = ${JSON.stringify(ds.body)};`);
  }
  lines.push(`  const res = await fetch(url, opts);`);
  lines.push(`  if (!res.ok) throw new Error(\`${fnName}: HTTP \${res.status}\`);`);
  lines.push(`  const data = await res.json();`);
  const responsePath = ds.responsePath;
  if (responsePath) {
    const parts = responsePath.split('.').map(p => `['${p}']`).join('');
    lines.push(`  const result = (data as Record<string, unknown>)${parts};`);
    lines.push(`  cacheSet(cacheKey, result);`);
    lines.push(`  return result;`);
  } else {
    lines.push(`  cacheSet(cacheKey, data);`);
    lines.push(`  return data;`);
  }
  lines.push(`}`);
}

function emitGraphQLFn(lines: string[], ds: DataSourceConfig, fnName: string): void {
  const endpointEnvKey = `NEXT_PUBLIC_GRAPHQL_ENDPOINT`;

  // Build static extra headers from the datasource definition (e.g. vendure-token, api-key).
  // These are inlined directly — they are channel/tenant config, not secrets.
  const extraHeaders: Record<string, string> = {};
  const rawHeaders = ds.headers;
  if (Array.isArray(rawHeaders)) {
    for (const h of rawHeaders) {
      if (h.enabled !== false && h.key?.trim()) extraHeaders[h.key] = h.value ?? '';
    }
  } else if (rawHeaders && typeof rawHeaders === 'object') {
    for (const [k, v] of Object.entries(rawHeaders as Record<string, string>)) {
      if (k && v) extraHeaders[k] = v;
    }
  }
  const headersObj = { 'Content-Type': 'application/json', ...extraHeaders };
  // Headers are built at call-time so the stored auth token can be injected dynamically.
  // This ensures authenticated queries (activeCustomer, etc.) work after login.
  const staticHeadersLiteral = JSON.stringify(headersObj);
  const headersLiteral = `(() => { const _t = (typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null); const _h = { ...${staticHeadersLiteral} }; if (_t) { _h['vendure-auth-token'] = _t; } return _h; })()`;

  // Default variables: static-only configs are inlined; formula-based ones use {}
  // because the page component evaluates them at runtime and passes them as the explicit argument.
  function hasFormula(v: unknown): boolean {
    if (!v || typeof v !== 'object') return false;
    if (Array.isArray(v)) return v.some(hasFormula);
    const o = v as Record<string, unknown>;
    if ('formula' in o || 'js' in o || 'var' in o) return true;
    return Object.values(o).some(hasFormula);
  }
  const defaultVars = (ds.variables && typeof ds.variables === 'object' && !Array.isArray(ds.variables) && !hasFormula(ds.variables))
    ? JSON.stringify(ds.variables)
    : '{}';

  lines.push(`async function ${fnName}(variables?: Record<string, unknown>): Promise<unknown> {`);
  lines.push(`  const endpoint = process.env.${endpointEnvKey} ?? ${JSON.stringify(ds.endpoint ?? '')};`);
  lines.push(`  const query = ${JSON.stringify(ds.query ?? '')};`);
  lines.push(`  const cacheKey = endpoint + JSON.stringify(variables);`);
  lines.push(`  const cached = cacheGet(cacheKey);`);
  lines.push(`  if (cached) return cached;`);
  lines.push(`  const res = await fetch(endpoint, {`);
  lines.push(`    method: 'POST',`);
  lines.push(`    credentials: 'include',`);
  lines.push(`    headers: ${headersLiteral},`);
  lines.push(`    body: JSON.stringify({ query, variables: variables ?? ${defaultVars} }),`);
  lines.push(`  });`);
  lines.push(`  if (!res.ok) throw new Error(\`${fnName}: HTTP \${res.status}\`);`);
  lines.push(`  const json = await res.json();`);
  const responsePath = ds.responsePath;
  if (responsePath) {
    const parts = responsePath.split('.').map(p => `['${p}']`).join('');
    lines.push(`  const result = (json as Record<string, unknown>)${parts};`);
    lines.push(`  cacheSet(cacheKey, result);`);
    lines.push(`  return result;`);
  } else {
    // Return the full raw response (including the { data: {...} } GraphQL wrapper).
    // The builder's named-datasource-fetcher stores the raw response at collections.UUID,
    // so formulas like collections.UUID.data.activeOrder work correctly.
    lines.push(`  cacheSet(cacheKey, json);`);
    lines.push(`  return json;`);
  }
  lines.push(`}`);
}

export function emitEnvExample(ctx: CodegenCtx): EmittedFile {
  const { store, symbols } = ctx;
  const lines: string[] = ['# Copy this file to .env.local and fill in values', ''];

  if (ctx.flags.hasGraphQL) {
    lines.push('# GraphQL endpoint');
    lines.push('NEXT_PUBLIC_GRAPHQL_ENDPOINT=');
    lines.push('');
  }

  for (const ds of store.pageDataSources ?? []) {
    const fnName = symbols.collections.get(ds.id) ?? ds.name;
    if (!fnName) continue;
    if (ds.type === 'rest' && ds.url) {
      lines.push(`# ${ds._label ?? ds.name} REST endpoint`);
      lines.push(`NEXT_PUBLIC_${fnName.toUpperCase()}_URL=${ds.url}`);
    }
    const authHeaders = (ds.headers ?? []).filter(h =>
      h.key.toLowerCase() === 'authorization' || h.value?.startsWith('Bearer ')
    );
    if (authHeaders.length > 0) {
      lines.push(`NEXT_PUBLIC_${fnName.toUpperCase()}_AUTH_TOKEN=`);
    }
    lines.push('');
  }

  if (ctx.flags.hasAuth && ctx.store.authConfig) {
    const ac = ctx.store.authConfig;
    if (ac.userEndpoint) lines.push(`NEXT_PUBLIC_AUTH_USER_ENDPOINT=${ac.userEndpoint}`);
    if (ac.refreshEndpoint) lines.push(`NEXT_PUBLIC_AUTH_REFRESH_ENDPOINT=${ac.refreshEndpoint}`);
  }

  return { path: '.env.example', content: lines.join('\n') };
}

/** Next.js API route handlers for datasources with proxy: true */
export function emitProxyRoutes(ctx: CodegenCtx): EmittedFile[] {
  const files: EmittedFile[] = [];

  for (const ds of (ctx.store.pageDataSources ?? []).filter(d => d.proxy)) {
    const fnName = ctx.symbols.collections.get(ds.id) ?? ds.name;
    if (!fnName) continue;

    const routePath = `app/api/${fnName}/route.ts`;
    const content = `import { NextResponse } from 'next/server';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_${fnName.toUpperCase()}_URL ?? '';
  const res = await fetch(url);
  const data = await res.json();
  return NextResponse.json(data);
}
`;
    files.push({ path: routePath, content });
  }

  return files;
}
