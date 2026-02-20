# Legacy / Unused Files

These files are kept for reference or backward compatibility but are not used by the main app.

## config/app.json

**Status:** Legacy, unused.

**Reason:** The app uses `config/app.ts` which merges `routes.json`, individual screen JSON files from `config/screens/`, and action files from `config/actions/`. The single-file `app.json` format was an earlier approach and is no longer used.

**Action:** Safe to remove if you no longer need the reference. Otherwise keep for documentation.

## lib/sdui/engine.tsx

**Status:** Legacy, unused.

**Reason:** A simpler SDUI engine variant. The main app uses `sdui-engine.tsx` which has full support for actions, Zustand integration, variable store, and config-driven behavior. It is exported as `SimpleSDUIEngine` from `lib/sdui/index.ts` but nothing imports it.

**Action:** Safe to remove if you do not need the simpler engine. Update `lib/sdui/index.ts` to remove the export.
