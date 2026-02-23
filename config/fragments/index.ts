/**
 * Fragment registry - re-exports from root.ts.
 * Reference with $ref: "fragments/name" in layouts or screens.
 */

import root from '../root';

export const fragments = root.fragments as Record<string, object>;
