import type { SymbolMap } from '../types';

interface RefetchStep { type: 'refetchDataSource'; dataSourceId?: string; collectionName?: string; payload?: Record<string, unknown> }

export function emitRefetch(step: RefetchStep, symbols: SymbolMap): string {
  const dsId = step.dataSourceId ?? step.collectionName ?? step.payload?.dataSourceId as string ?? '';
  const dsIdent = symbols.collections.get(dsId);
  if (dsIdent) {
    return `{\n  const result = await api.${dsIdent}();\n  useStore.setState(s => ({ ...s, collections: { ...s.collections, ${dsIdent}: result } }));\n}`;
  }
  return `/* refetchDataSource: unknown datasource ${dsId} */`;
}
