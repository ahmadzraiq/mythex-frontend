/**
 * Semantic validator: check every node.type against COMPONENT_NAMES.
 */

import { COMPONENT_NAMES } from '@/config/component-names';
import type { UiNode, ValidationResult } from './types';

const VALID_TYPES = new Set([...COMPONENT_NAMES]);

function walkNodes(node: UiNode, invalid: string[]): void {
  if (node.type && !VALID_TYPES.has(node.type as (typeof COMPONENT_NAMES)[number])) {
    invalid.push(`Invalid node.type: "${node.type}"`);
  }
  if (node.children) {
    for (const child of node.children) {
      walkNodes(child as UiNode, invalid);
    }
  }
}

/**
 * Validate that all node types exist in the component registry.
 */
export function validateTypes(structure: UiNode): ValidationResult {
  const invalid: string[] = [];
  walkNodes(structure, invalid);

  return {
    pass: invalid.length === 0,
    errors: invalid.length ? invalid : undefined,
  };
}
