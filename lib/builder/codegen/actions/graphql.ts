import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

interface GraphQLStep { type: 'graphql'; query?: string; variables?: unknown; storeIn?: string; dataSourceId?: string; collectionName?: string; endpoint?: string; headers?: Record<string, string>; payload?: Record<string, unknown>; config?: Record<string, unknown> }

export function emitGraphQL(step: GraphQLStep, symbols: SymbolMap, stepId?: string): string {
  const dsId = step.dataSourceId ?? step.collectionName ?? step.payload?.dataSourceId as string ?? '';
  const dsIdent = symbols.collections.get(dsId);

  if (dsIdent) {
    const vars = step.variables ?? step.payload?.variables;
    const varsExpr = vars ? rewritePropValue(vars, symbols) : 'undefined';
    let code = `{\n  const result = await api.${dsIdent}(${varsExpr});\n  useStore.setState(s => ({ ...s, collections: { ...s.collections, ${dsIdent}: result } }));`;
    if (stepId) code += `\n  _results[${JSON.stringify(stepId)}] = { result };`;
    code += `\n}`;
    return code;
  }

  // Inline graphql call
  const endpoint = step.endpoint ?? step.payload?.endpoint as string ?? 'process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT!';
  const query = step.query ?? step.payload?.query as string ?? '';
  const vars = step.variables ?? step.payload?.variables;
  const storeIn = step.storeIn ?? step.payload?.storeIn as string ?? '';
  const varsExpr = vars ? rewritePropValue(vars, symbols) : '{}';
  const endpointExpr = endpoint.startsWith('process.env') ? endpoint : JSON.stringify(endpoint);

  // Merge custom headers from the action definition
  const extraHeaders = step.headers ?? (step.config?.headers as Record<string, string> | undefined) ?? {};
  const headerEntries = Object.entries(extraHeaders)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(', ');
  const baseHeaders = headerEntries
    ? `{ 'Content-Type': 'application/json', ${headerEntries} }`
    : `{ 'Content-Type': 'application/json' }`;

  // Inject stored auth token so authenticated queries (activeCustomer, etc.) work after login.
  // Vendure token-based auth: the token returned in `vendure-auth-token` response header
  // must be sent back as `vendure-auth-token` request header on subsequent requests.
  const headersExpr = `(() => { const _t = (typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null) ?? (useStore.getState().auth?.token as string | null | undefined); const _h = { ...${baseHeaders} }; if (_t) { _h['vendure-auth-token'] = _t; _h['Authorization'] = \`Bearer \${_t}\`; } return _h; })()`;

  let lines = `const gqlRes = await fetch(${endpointExpr}, {`;
  lines += `\n  method: 'POST',`;
  lines += `\n  credentials: 'include',`;
  lines += `\n  headers: ${headersExpr},`;
  lines += `\n  body: JSON.stringify({ query: ${JSON.stringify(query)}, variables: ${varsExpr} }),`;
  lines += `\n});`;
  lines += `\nconst gqlData = await gqlRes.json();`;
  if (storeIn) {
    const parts = storeIn.split('.').map(p => JSON.stringify(p));
    lines += `\nuseStore.setState(s => setNestedValue(s, [${parts.join(', ')}], gqlData?.data));`;
  }
  // Store result: builder engine uses context.workflow[stepId].result.login (the `data` key)
  // and also context.workflow[stepId].result._response for headers/status
  if (stepId) {
    lines += `\n_results[${JSON.stringify(stepId)}] = { result: { ...(gqlData?.data ?? {}), _response: { status: gqlRes.status, headers: Object.fromEntries((gqlRes.headers as any)?.entries?.() ?? []) } } };`;
  }
  // If the query fetches the current user, always persist it into state.auth.user.
  // This ensures callers (AuthSync, restoreSession, etc.) don't need a separate setUser step.
  if (query.includes('activeCustomer')) {
    lines += `\nif (gqlData?.data?.activeCustomer) { useStore.setState(s => ({ ...s, auth: { ...s.auth, user: gqlData.data.activeCustomer } })); }`;
  }
  return `{\n${lines.split('\n').map(l => '  ' + l).join('\n')}\n}`;
}
