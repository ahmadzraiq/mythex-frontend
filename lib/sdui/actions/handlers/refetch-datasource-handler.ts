import type { ActionHandlerContext, ActionDef } from './types';
import { evaluateFormula } from '../../formula-evaluator';

/**
 * refetchDataSource — clears the cache for a named data source and triggers
 * the engine to re-fetch it with the current state (URL params, etc.).
 *
 * Also handles in-memory collection mutations (updateCollection):
 *   updateType "replaceAll" + data  → replace the stored array with new data
 *   updateType "insert"             → insert item at position (default: end)
 *   updateType "update"             → update item found by index or id field
 *   updateType "delete"             → remove item found by index or id field
 *
 * Usage in config/actions/*.json:
 *   "fetchCollection": { "type": "refetchDataSource", "name": "collection" }
 *
 * Used by:
 *   - route.paramChangeAction  (filter/sort/page URL changes)
 *   - on-mount workflows        (trigger: "created" — explicit first-load fetch)
 */
export const refetchDataSourceHandler =
  (ctx: ActionHandlerContext) =>
  async (actionDef: ActionDef): Promise<void> => {
    const name = actionDef.name as string | undefined;
    if (!name) {
      console.warn('[SDUI] refetchDataSource: missing "name" field in action definition');
      return;
    }

    const updateType = actionDef.updateType as string | undefined;

    // No updateType or replaceAll without data → just trigger a re-fetch from the API
    if (!updateType || (updateType === 'replaceAll' && actionDef.data === undefined)) {
      ctx.triggerDataSourceRefetch?.(name);
      return;
    }

    const storeKey = `collections.${name}`;
    // Optional sub-path within the stored value where the array lives.
    // Defaults to "data" so the array sits at collections.UUID.data, keeping
    // collections.UUID as a plain object — this prevents loading/error sibling
    // keys (collections.UUID.loading / .error) from overwriting the array when
    // computeMergedState processes them via setNestedValue.
    const dataPath = (actionDef.dataPath as string | undefined) ?? 'data';
    const arrayStoreKey = `${storeKey}.${dataPath}`;

    /** Resolve the `data` config field: formula object → evaluate; string → try JSON.parse; else use as-is */
    const resolveData = (raw: unknown): unknown => {
      if (raw == null) return raw;
      if (typeof raw === 'object' && 'formula' in (raw as object)) {
        const fullState = ctx.getFullMergedState();
        return evaluateFormula(raw as Record<string, unknown>, fullState);
      }
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if ((trimmed.startsWith('{') || trimmed.startsWith('['))) {
          try { return JSON.parse(trimmed); } catch { /* fall through to raw */ }
        }
        return raw;
      }
      return raw;
    };

    if (updateType === 'replaceAll') {
      ctx.setData(arrayStoreKey, resolveData(actionDef.data));
      return;
    }

    // For insert / update / delete: read the current array from the store
    const currentValue = ctx.get(arrayStoreKey);
    const arr = Array.isArray(currentValue) ? [...currentValue] : [];

    if (updateType === 'insert') {
      const position = typeof actionDef.position === 'number' ? actionDef.position : arr.length;
      arr.splice(position, 0, resolveData(actionDef.data));
      ctx.setData(arrayStoreKey, arr);
      return;
    }

    if (updateType === 'update') {
      const idx = findIndex(arr, actionDef);
      if (idx >= 0) {
        const existing = arr[idx] as Record<string, unknown>;
        const newData = resolveData(actionDef.data) as Record<string, unknown>;
        arr[idx] = actionDef.merge ? { ...existing, ...newData } : newData;
      }
      ctx.setData(arrayStoreKey, arr);
      return;
    }

    if (updateType === 'delete') {
      const idx = findIndex(arr, actionDef);
      if (idx >= 0) arr.splice(idx, 1);
      ctx.setData(arrayStoreKey, arr);
      return;
    }

    // Fallback
    ctx.triggerDataSourceRefetch?.(name);
  };

function findIndex(arr: unknown[], actionDef: ActionDef): number {
  const findBy = actionDef.findBy as string | undefined;
  if (findBy === 'id') {
    const idKey = actionDef.idKey as string | undefined;
    const idValue = actionDef.idValue;
    if (idKey) {
      return arr.findIndex(item => (item as Record<string, unknown>)[idKey] === idValue);
    }
  }
  return typeof actionDef.position === 'number' ? actionDef.position : -1;
}
