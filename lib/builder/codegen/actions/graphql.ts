import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

interface GraphQLStep { type: 'graphql'; query?: string; variables?: unknown; storeIn?: string; dataSourceId?: string; collectionName?: string; endpoint?: string; payload?: Record<string, unknown> }

export function emitGraphQL(step: GraphQLStep, symbols: SymbolMap): string {
  const dsId = step.dataSourceId ?? step.collectionName ?? step.payload?.dataSourceId as string ?? '';
  const dsIdent = symbols.collections.get(dsId);

  if (dsIdent) {
    const vars = step.variables ?? step.payload?.variables;
    const varsExpr = vars ? rewritePropValue(vars, symbols) : 'undefined';
    return `{\n  const result = await api.${dsIdent}(${varsExpr});\n  useStore.setState(s => ({ ...s, collections: { ...s.collections, ${dsIdent}: result } }));\n}`;
  }

  // Inline graphql call
  const endpoint = step.endpoint ?? step.payload?.endpoint as string ?? 'process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT!';
  const query = step.query ?? step.payload?.query as string ?? '';
  const vars = step.variables ?? step.payload?.variables;
  const storeIn = step.storeIn ?? step.payload?.storeIn as string ?? '';
  const varsExpr = vars ? rewritePropValue(vars, symbols) : '{}';
  const endpointExpr = endpoint.startsWith('process.env') ? endpoint : JSON.stringify(endpoint);

  let lines = `const gqlRes = await fetch(${endpointExpr}, {`;
  lines += `\n  method: 'POST',`;
  lines += `\n  headers: { 'Content-Type': 'application/json' },`;
  lines += `\n  body: JSON.stringify({ query: ${JSON.stringify(query)}, variables: ${varsExpr} }),`;
  lines += `\n});`;
  lines += `\nconst gqlData = await gqlRes.json();`;
  if (storeIn) {
    const parts = storeIn.split('.').map(p => JSON.stringify(p));
    lines += `\nuseStore.setState(s => setNestedValue(s, [${parts.join(', ')}], gqlData?.data));`;
  }
  return `{\n${lines.split('\n').map(l => '  ' + l).join('\n')}\n}`;
}
