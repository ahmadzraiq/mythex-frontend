/**
 * Dependency extraction for SDUI variable paths
 * Extracts paths from templates, objects, and nodes for selective subscription
 */

import type { SDUINode } from './types';
import type { ComputedDef } from './variable-store';

/** Extract variable paths from {{path}} in strings */
export function extractPathsFromTemplate(template: string): string[] {
  if (!template || typeof template !== 'string') return [];
  return [...(template.matchAll(/\{\{([^}]+)\}\}/g) ?? [])].map((m) => m[1].trim());
}

/** Extract variable paths from objects (e.g. { var: "path" }) and strings (e.g. "{{path}}") */
export function extractPathsFromObject(obj: unknown): string[] {
  if (obj == null) return [];
  if (typeof obj === 'string') return extractPathsFromTemplate(obj);
  if (typeof obj === 'object' && !Array.isArray(obj) && 'var' in obj) {
    const v = (obj as { var: string | [string, unknown] }).var;
    return [Array.isArray(v) ? String(v[0]) : String(v)];
  }
  if (typeof obj === 'object') {
    return Object.values(obj).flatMap(extractPathsFromObject);
  }
  return [];
}

/**
 * Extracts all variable paths used by a node for selective subscription.
 * Scans: text (string templates, expr), props (nested), condition (JSON Logic), map.
 * Returns unique paths; filters out reduce internals (current, accumulator).
 */
export function extractNodeDependencies(node: Pick<SDUINode, 'text' | 'props' | 'condition' | 'map'>): string[] {
  const paths: string[] = [];
  if (node.text != null) {
    if (typeof node.text === 'string') paths.push(...extractPathsFromTemplate(node.text));
    else if (typeof node.text === 'object' && 'expr' in node.text) {
      const exprPaths = extractPathsFromObject((node.text as { expr: unknown }).expr);
      paths.push(...exprPaths.filter((p) => p !== 'current' && p !== 'accumulator' && !p.startsWith('current.')));
    }
  }
  if (node.props) paths.push(...extractPathsFromObject(node.props));
  if (node.condition) paths.push(...extractPathsFromObject(node.condition));
  if (node.map) {
    if (typeof node.map === 'string') paths.push(node.map);
    else if (typeof node.map === 'object' && node.map !== null && 'expr' in node.map)
      paths.push(...extractPathsFromObject((node.map as { expr: unknown }).expr));
  }
  return [...new Set(paths)].filter((p): p is string => typeof p === 'string');
}

/** Expand computed paths to their source dependencies for subscription */
export function expandComputedDeps(paths: string[], computed?: Record<string, ComputedDefLike>): string[] {
  if (!computed) return paths;
  const expanded = new Set(paths);
  for (const p of paths) {
    const def = computed[p];
    if (def?.type === 'reduce' && def.source) {
      expanded.add(def.source);
    }
  }
  return [...expanded];
}
