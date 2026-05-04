import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

interface FetchStep { type: 'fetch'; url?: string; method?: string; body?: unknown; headers?: unknown; storeIn?: string; responsePath?: string; dataSourceId?: string; collectionName?: string; payload?: Record<string, unknown> }

export function emitFetch(step: FetchStep, symbols: SymbolMap): string {
  const dsId = step.dataSourceId ?? step.collectionName ?? step.payload?.dataSourceId as string ?? '';
  const dsIdent = symbols.collections.get(dsId);

  if (dsIdent) {
    // Known datasource — use the generated api function
    return `{\n  const result = await api.${dsIdent}();\n  useStore.setState(s => ({ ...s, collections: { ...s.collections, ${dsIdent}: result } }));\n}`;
  }

  // Inline fetch
  const url = step.url ?? step.payload?.url as string ?? '';
  const method = step.method ?? step.payload?.method as string ?? 'GET';
  const body = step.body ?? step.payload?.body;
  const storeIn = step.storeIn ?? step.payload?.storeIn as string ?? '';
  const urlExpr = url.includes('{{') ? rewritePropValue(url, symbols) : JSON.stringify(url);

  let fetchOpts = `{ method: '${method}'`;
  if (body) fetchOpts += `, body: JSON.stringify(${rewritePropValue(body, symbols)})`;
  fetchOpts += ` }`;

  let lines = `const fetchRes = await fetch(${urlExpr}, ${fetchOpts});`;
  lines += `\nconst fetchData = await fetchRes.json();`;
  if (storeIn) {
    const parts = storeIn.split('.').map(p => JSON.stringify(p));
    lines += `\nuseStore.setState(s => setNestedValue(s, [${parts.join(', ')}], fetchData));`;
  }
  return `{\n${lines.split('\n').map(l => '  ' + l).join('\n')}\n}`;
}
