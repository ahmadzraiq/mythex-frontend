/**
 * Shared component type definitions.
 * Used by config/root.ts and lib/sdui/components/SharedComponentNode.tsx.
 */

export type SharedComponentPropertyType = 'text' | 'number' | 'boolean' | 'color' | 'any';

export interface SharedComponentProperty {
  id: string;
  name: string;
  type: SharedComponentPropertyType;
  defaultValue?: unknown;
}

export interface SharedComponentModel {
  id: string;
  name: string;
  properties: SharedComponentProperty[];
  content: Record<string, unknown>;
}
