/**
 * Layout registry - re-exports from root.ts.
 * Use with layout: "store" | "account" | "checkoutMinimal" in screen config.
 */

import root from '../root';

export const layouts = root.layouts as Record<string, { structure: object }>;
