/**
 * System Component type definitions.
 *
 * A SystemComponentModel is a superset of SharedComponentModel with the
 * following extras:
 *   - `isBuiltIn: true`  — always true for system components; indicates the
 *     definition is shipped with the app in TypeScript under
 *     `lib/builder/system-components/` rather than stored as user data.
 *   - `icon?: string`    — optional glyph/emoji shown on the palette tile.
 *
 * Persistence model:
 *   - Built-in definitions live in code (immutable on disk).
 *   - User edits are captured as "overrides" layered on top of the built-in
 *     defaults and persisted through the existing autosave snapshot pipeline.
 *   - `getSystemComponents()` returns the merged view of defaults + overrides.
 */

import type { SharedComponentModel } from '@/config/shared-component-types';

export type SystemComponentModel = SharedComponentModel & {
  isBuiltIn: true;
  icon?: string;
};
