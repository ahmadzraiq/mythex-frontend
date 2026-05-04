/**
 * Dependency extraction for SDUI variable paths
 * Extracts paths from templates, objects, and nodes for selective subscription
 */

import type { SDUINode } from './types';
import type { ComputedDef } from './variable-store';
import { getVariableUuidByName, getCollectionUuidByName } from './variable-name-registry';

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
  const re = /\b(variables|collections)(?:\?\.?|\.?)?\s*\[\s*['"]([^'"]+)['"]\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    paths.push(`${m[1]}.${m[2]}`);
  }
  // Extract globalContext paths (e.g. globalContext?.browser?.query?.sort → globalContext.browser.query.sort)
  const gcRe = /\bglobalContext(?:\?\.|\.)(\w+(?:(?:\?\.|\.)?\w+)*)/g;
  let gc: RegExpExecArray | null;
  while ((gc = gcRe.exec(expr)) !== null) {
    paths.push(`globalContext.${gc[1].replace(/\?\./g, '.')}`);
  }
  // Extract `theme` references so formulas like
  //   theme?.['colors']?.['brand']
  //   theme.colors.primary
  //   theme['fonts'].body
  // re-render when patchThemeColors() replaces merged.theme. We subscribe to the
  // entire theme object (single key in merged state) — getNestedValue stringifies
  // it for snapshot comparison so per-color changes are detected without needing
  // to enumerate every individual color path.
  const themeRe = /\btheme\s*(?:\?\.|\.|\?\.\[|\[)/;
  if (themeRe.test(expr)) {
    paths.push('theme');
  }
  // Extract `local.data.form.*` paths so formulas like
  //   JSON.stringify(local?.data?.form?.formData ?? {})
  //   local?.data?.form?.fields?.x?.isValid
  // subscribe to FormContainer state changes and re-render live.
  // Captures the deepest matched segment (e.g. "local.data.form.formData") so
  // formMappedDeps can remap it to the per-container isolated store path.
  const localFormRe = /\blocal\s*(?:\?\.)?\s*data\s*(?:\?\.)?\s*form\b((?:\s*(?:\?\.|\.)[\w$]+)*)/g;
  let lf: RegExpExecArray | null;
  while ((lf = localFormRe.exec(expr)) !== null) {
    const suffix = lf[1].replace(/\?\./g, '.').replace(/^\./,'');
    const dep = suffix ? `local.data.form.${suffix}` : 'local.data.form';
    if (!paths.includes(dep)) paths.push(dep);
  }

  // Extract shared-component instance variable references so formulas/text
  // templates re-render when the underlying variable changes:
  //   context?.component?.variables?.['UUID']   → context.component.variables.UUID
  //   context.component.variables.UUID           → context.component.variables.UUID
  // The renderer later rewrites context.component.variables.UUID → _componentInstances.{instanceId}.UUID
  const compBracket = /\bcontext\s*(?:\?\.|\.)\s*component\s*(?:\?\.|\.)\s*variables\s*(?:\?\.)?\s*\[\s*['"]([^'"]+)['"]\s*\]/g;
  let cb: RegExpExecArray | null;
  while ((cb = compBracket.exec(expr)) !== null) {
    paths.push(`context.component.variables.${cb[1]}`);
  }
  const compDot = /\bcontext\s*(?:\?\.|\.)\s*component\s*(?:\?\.|\.)\s*variables\s*(?:\?\.|\.)\s*([A-Za-z0-9_-]+)/g;
  let cd: RegExpExecArray | null;
  while ((cd = compDot.exec(expr)) !== null) {
    // Avoid double-adding when bracket form already matched
    const p = `context.component.variables.${cd[1]}`;
    if (!paths.includes(p)) paths.push(p);
  }
  return paths;
}

/**
 * Extract `variables.<name>` / `variables['<name>']` / `collections.<name>` references
 * from a `{ js: "..." }` binding body and resolve each name to a UUID via the
 * variable-name-registry. Returns dot-notation paths like "variables.<UUID>" so
 * the renderer's path-based subscription system re-evaluates JS bindings when the
 * underlying variables change. Names that aren't registered yet are skipped.
 */
function extractJsBindingPaths(code: string): string[] {
  if (!code || typeof code !== 'string') return [];
  const paths: string[] = [];
  const pushVar = (name: string | undefined) => {
    if (!name) return;
    const uuid = getVariableUuidByName(name);
    paths.push(`variables.${uuid ?? name}`);
  };
  const pushCol = (name: string | undefined) => {
    if (!name) return;
    const uuid = getCollectionUuidByName(name);
    paths.push(`collections.${uuid ?? name}`);
  };
  // variables.foo / variables?.foo / variables['foo'] / variables?.['foo']
  const varDot = /\bvariables\s*(?:\?\.)?\s*\.?\s*([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = varDot.exec(code)) !== null) pushVar(m[1]);
  const varBracket = /\bvariables\s*(?:\?\.)?\s*\[\s*['"`]([^'"`]+)['"`]\s*\]/g;
  while ((m = varBracket.exec(code)) !== null) pushVar(m[1]);
  const colDot = /\bcollections\s*(?:\?\.)?\s*\.?\s*([A-Za-z_$][\w$]*)/g;
  while ((m = colDot.exec(code)) !== null) pushCol(m[1]);
  const colBracket = /\bcollections\s*(?:\?\.)?\s*\[\s*['"`]([^'"`]+)['"`]\s*\]/g;
  while ((m = colBracket.exec(code)) !== null) pushCol(m[1]);
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
  // JavaScript bindings: { js: "<body>" }
  if (typeof obj === 'object' && !Array.isArray(obj) && 'js' in obj) {
    const j = (obj as { js: unknown }).js;
    if (typeof j !== 'string' || !j.trim()) return [];
    return extractJsBindingPaths(j);
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
    else if (typeof node.text === 'object' && 'formula' in node.text) {
      const formulaVal = (node.text as { formula: unknown }).formula;
      const formulaPaths = extractPathsFromObject(formulaVal);
      paths.push(...formulaPaths.filter((p) => p !== 'current' && p !== 'accumulator' && !p.startsWith('current.')));
      if (typeof formulaVal === 'string') {
        paths.push(formulaVal.trim());
        paths.push(...extractFormulaVarPaths(formulaVal));
      }
    } else if (typeof node.text === 'object' && 'js' in node.text) {
      paths.push(...extractPathsFromObject(node.text));
    }
  }
  if (node.props) paths.push(...extractPathsFromObject(node.props));
  if (node.condition) {
    paths.push(...extractPathsFromObject(node.condition));
    // Condition strings are plain JS expressions (not {{template}} syntax), so
    // extractPathsFromObject returns [] for them. Add the string itself as a dep
    // path so getNestedValue can navigate it (after stripping ?.) and useVariablePaths
    // re-renders the node when local.data.form.fields.* or variables['UUID'] change.
    if (typeof node.condition === 'string') {
      paths.push(node.condition.trim());
      paths.push(...extractFormulaVarPaths(node.condition));
    }
  }
  if (node.map) {
    if (typeof node.map === 'string') paths.push(node.map);
    else if (typeof node.map === 'object' && node.map !== null) {
      if ('formula' in node.map) paths.push(...extractPathsFromObject(node.map as { formula: unknown }));
      else if ('js' in node.map) paths.push(...extractPathsFromObject(node.map as { js: unknown }));
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
  // _initialValue may be a formula binding (e.g. context.component.variables['sw-on']).
  // Scanning it ensures the node subscribes to its deps and re-renders when they change —
  // critical for controlled SC instances that mirror their internal variable to instanceId-value.
  const nodeAny = node as Record<string, unknown>;
  const initVal = nodeAny._initialValue;
  if (initVal != null && typeof initVal === 'object' && 'formula' in (initVal as object)) {
    const f = (initVal as { formula: unknown }).formula;
    paths.push(...extractPathsFromObject(initVal as { formula: unknown }));
    if (typeof f === 'string') paths.push(...extractFormulaVarPaths(f));
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
