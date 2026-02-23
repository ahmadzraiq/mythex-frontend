/**
 * Semantic validator: extract all {{...}} interpolations and { "var": "..." } references,
 * check top-level keys exist in store.initialData.
 */

import root from '@/config/root';
import type { UiNode, ValidationResult } from './types';

const initialData = (root.store?.initialData as Record<string, unknown>) ?? {};
const TOP_LEVEL_KEYS = new Set(Object.keys(initialData));

/** Map path prefixes that are valid (e.g. screens.x.form.field, route.slug) */
function getTopLevelKey(path: string): string {
  const first = path.split('.')[0];
  if (first === 'screens') return 'screens';
  if (first === '_workflow') return '_workflow';
  return first;
}

function extractPathsFromVar(obj: unknown, paths: Set<string>): void {
  if (obj == null) return;
  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const o = obj as Record<string, unknown>;
    if ('var' in o) {
      const v = o.var;
      if (Array.isArray(v) && typeof v[0] === 'string') {
        paths.add(v[0]);
      } else if (typeof v === 'string') {
        paths.add(v);
      }
    }
    for (const val of Object.values(o)) {
      extractPathsFromVar(val, paths);
    }
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      extractPathsFromVar(item, paths);
    }
  }
}

/** Extract {{path}} patterns from string (simplified - paths are typically path.to.field) */
function extractInterpolationPaths(str: string, paths: Set<string>): void {
  const regex = /\{\{([^}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(str)) !== null) {
    const inner = m[1].trim();
    const path = inner.split(/[.\s]/)[0];
    if (path && !path.startsWith('$')) paths.add(path);
  }
}

function walkNodes(node: UiNode, paths: Set<string>): void {
  if (typeof node.text === 'string') {
    extractInterpolationPaths(node.text, paths);
  }
  if (node.condition) extractPathsFromVar(node.condition, paths);
  if (node.map) paths.add(node.map.split('.')[0]);
  if (node.actions) {
    for (const handler of Object.values(node.actions)) {
      extractPathsFromVar(handler, paths);
    }
  }
  if (node.props) {
    for (const v of Object.values(node.props)) {
      if (typeof v === 'string') extractInterpolationPaths(v, paths);
      else extractPathsFromVar(v, paths);
    }
  }
  if (node.children) {
    for (const child of node.children) {
      walkNodes(child as UiNode, paths);
    }
  }
}

/** Paths that are always valid (map scope, screen-scoped aliases) */
const RESERVED_TOP_LEVEL = new Set([
  '$item',
  '$index',
  '$event',
  'current',
  'accumulator',
  'form',
  'errors',
]);

/**
 * Validate that all state path references have valid top-level keys.
 */
export function validateStatePaths(structure: UiNode): ValidationResult {
  const paths = new Set<string>();
  walkNodes(structure, paths);

  const invalid: string[] = [];
  for (const path of paths) {
    if (RESERVED_TOP_LEVEL.has(path)) continue;
    const top = getTopLevelKey(path);
    if (top !== 'screens' && top !== '_workflow' && !TOP_LEVEL_KEYS.has(top)) {
      invalid.push(`Unknown state path top-level: "${top}" (from "${path}")`);
    }
  }

  return {
    pass: invalid.length === 0,
    errors: invalid.length ? invalid : undefined,
  };
}
