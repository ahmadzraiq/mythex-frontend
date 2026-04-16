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

/**
 * Extract `variables['UUID']` and `collections['UUID']` references from plain JS formula
 * strings (not {{template}} syntax). Returns dot-notation paths like "variables.UUID".
 * Used for condition strings and animation watchVar expressions so they auto-subscribe.
 */
function extractFormulaVarPaths(expr: string): string[] {
  if (!expr || typeof expr !== 'string') return [];
  const paths: string[] = [];
  const re = /\b(variables|collections)\s*(?:\?\.)?\s*\[\s*['"]([^'"]+)['"]\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    paths.push(`${m[1]}.${m[2]}`);
  }
  return paths;
}

/** Extract variable paths from objects and strings (e.g. "{{path}}" or formula strings) */
export function extractPathsFromObject(obj: unknown): string[] {
  if (obj == null) return [];
  if (typeof obj === 'string') return extractPathsFromTemplate(obj);
  // Builder formula bindings: { formula: "expression" }
  // The expression may be a simple path (components?.['id']?.value) or a JS expression
  // containing variable/collection references (variables['UUID'] + 'px').
  // Always include the raw formula string (for simple path lookups via getNestedValue)
  // AND extract any variables['UUID'] / collections['UUID'] patterns (for subscriptions).
  if (typeof obj === 'object' && !Array.isArray(obj) && 'formula' in obj) {
    const f = (obj as { formula: unknown }).formula;
    if (typeof f !== 'string' || !f.trim()) return [];
    const paths: string[] = [f.trim()];
    paths.push(...extractFormulaVarPaths(f));
    return paths;
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
export function extractNodeDependencies(node: Pick<SDUINode, 'text' | 'props' | 'condition' | 'map'> | null | undefined): string[] {
  if (node == null) return [];
  const paths: string[] = [];
  if (node.text != null) {
    if (typeof node.text === 'string') paths.push(...extractPathsFromTemplate(node.text));
    else if (typeof node.text === 'object' && 'expr' in node.text) {
      const exprVal = (node.text as { expr: unknown }).expr;
      const exprPaths = extractPathsFromObject(exprVal);
      paths.push(...exprPaths.filter((p) => p !== 'current' && p !== 'accumulator' && !p.startsWith('current.')));
      if (typeof exprVal === 'string') paths.push(...extractFormulaVarPaths(exprVal));
    } else if (typeof node.text === 'object' && 'formula' in node.text) {
      // Builder formula binding: treat the formula expression as the subscription path.
      // getNestedValue now handles bracket-notation (components?.['id']?.['value']).
      const f = (node.text as { formula: unknown }).formula;
      if (typeof f === 'string' && f.trim()) paths.push(f.trim());
    }
  }
  if (node.props) paths.push(...extractPathsFromObject(node.props));
  if (node.condition) {
    paths.push(...extractPathsFromObject(node.condition));
    // Also extract variables['UUID'] / collections['UUID'] from plain JS formula condition strings
    if (typeof node.condition === 'string') {
      paths.push(...extractFormulaVarPaths(node.condition));
    }
  }
  if (node.map) {
    if (typeof node.map === 'string') paths.push(node.map);
    else if (typeof node.map === 'object' && node.map !== null) {
      if ('expr' in node.map) paths.push(...extractPathsFromObject((node.map as { expr: unknown }).expr));
      else if ('formula' in node.map) paths.push(...extractPathsFromObject(node.map as { formula: unknown }));
    }
  }
  // animation.imperativeTrigger.watchVar and animation.states.watchVar are formula expressions
  // (e.g. "variables['UUID']"), not {{template}} strings, so the generic object scan misses them.
  // Extract variable paths so useVariablePaths can subscribe and trigger re-renders on change.
  const animCfg = (node.props as Record<string, unknown> | undefined)?.animation;
  if (animCfg && typeof animCfg === 'object' && !Array.isArray(animCfg)) {
    const it = (animCfg as Record<string, unknown>).imperativeTrigger;
    if (it && typeof it === 'object' && !Array.isArray(it)) {
      const wv = (it as Record<string, unknown>).watchVar;
      if (typeof wv === 'string' && wv.trim()) {
        paths.push(...extractFormulaVarPaths(wv.trim()));
      }
    }
    // State-machine watchVar — same formula expression pattern
    const sm = (animCfg as Record<string, unknown>).states;
    if (sm && typeof sm === 'object' && !Array.isArray(sm)) {
      const wv = (sm as Record<string, unknown>).watchVar;
      if (typeof wv === 'string' && wv.trim()) {
        paths.push(...extractFormulaVarPaths(wv.trim()));
      }
    }
  }
  return [...new Set(paths)].filter((p): p is string => typeof p === 'string');
}

/** Expand computed paths to their source dependencies for subscription */
export function expandComputedDeps(paths: string[], computed?: Record<string, ComputedDef>): string[] {
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
