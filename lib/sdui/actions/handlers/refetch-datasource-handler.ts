import type { ActionHandlerContext, ActionDef } from './types';

/**
 * refetchDataSource — clears the cache for a named data source and triggers
 * the engine to re-fetch it with the current state (URL params, etc.).
 *
 * Usage in config/actions/*.json:
 *   "fetchCollection": { "type": "refetchDataSource", "name": "collection" }
 *
 * Used by:
 *   - route.paramChangeAction  (filter/sort/page URL changes)
 *   - screen initActions       (explicit first-load fetch)
 */
export const refetchDataSourceHandler =
  (ctx: ActionHandlerContext) =>
  async (actionDef: ActionDef): Promise<void> => {
    const name = actionDef.name as string | undefined;
    if (!name) {
      console.warn('[SDUI] refetchDataSource: missing "name" field in action definition');
      return;
    }
    ctx.triggerDataSourceRefetch?.(name);
  };
