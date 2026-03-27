/**
 * AI-readable component schemas keyed by the builder's PRIMITIVE_COMPONENTS label.
 * Auto-derived from ALL_PRIMITIVES — single source of truth is lib/builder/primitive-components.ts.
 *
 * When the AI calls add_component("Card"), the tool executor looks up COMPONENT_SCHEMA["Card"]
 * and inserts the same rich defaultNode the user gets when dragging from the palette.
 */

import { ALL_PRIMITIVES } from '@/lib/builder/primitive-components';

// ---------------------------------------------------------------------------
// Auto-derived component templates — same defaultNode as the drag palette
// ---------------------------------------------------------------------------

export const COMPONENT_SCHEMA: Record<string, string> = Object.fromEntries(
  ALL_PRIMITIVES.map(c => [c.label, JSON.stringify(c.defaultNode)])
);

