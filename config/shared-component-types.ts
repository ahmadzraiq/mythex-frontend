/**
 * Shared component type definitions.
 * Used by config/root.ts and lib/sdui/components/SharedComponentNode.tsx.
 */

export interface SharedComponentProperty {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  defaultValue?: unknown;
}

export interface SharedComponentModel {
  id: string;
  name: string;
  properties: SharedComponentProperty[];
  content: Record<string, unknown>;
}
