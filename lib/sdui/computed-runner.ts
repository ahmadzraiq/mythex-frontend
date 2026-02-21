/**
 * JSON Logic–based computed state runner.
 * Uses json-logic-js for generic, standards-based expressions.
 * No app-specific reduce types—all logic expressed as JSON Logic.
 */

import jsonLogic from 'json-logic-js';
import { setNestedValue } from './nested-utils';

/** Extract data paths from JSON Logic expr (excludes reduce scope: current, accumulator) */
function extractPathsFromExpr(obj: unknown): string[] {
  if (obj == null) return [];
  if (typeof obj === 'object' && !Array.isArray(obj) && 'var' in obj) {
    const v = (obj as { var: string | [string, unknown] }).var;
    const path = Array.isArray(v) ? String(v[0]) : String(v);
    if (path === 'current' || path === 'accumulator' || path.startsWith('current.')) return [];
    return [path];
  }
  if (typeof obj === 'object') {
    return (Array.isArray(obj) ? obj : Object.values(obj)).flatMap(extractPathsFromExpr);
  }
  return [];
}

/** Root paths that computed reads from (excludes outputs of other computed) */
export function getComputedDeps(computed: ComputedDef[]): string[] {
  const outputs = new Set(computed.map((d) => d.output));
  const allPaths = computed.flatMap((d) => extractPathsFromExpr(d.expr));
  return [...new Set(allPaths.filter((p) => !outputs.has(p)))];
}

// Custom ops for formatting and math (json-logic has no built-in ceil/floor)
jsonLogic.add_operation('ceil', (n: unknown) => Math.ceil(Number(n) || 0));
jsonLogic.add_operation('floor', (n: unknown) => Math.floor(Number(n) || 0));

// Custom ops for formatting (json-logic has no built-in round/format)
jsonLogic.add_operation('formatCurrency', (num: unknown, currency: unknown) => {
  const n = Number(num) || 0;
  const c = String(currency ?? 'USD').trim();
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD' }).format(n);
  } catch {
    return c ? `${c} ${n}` : String(n);
  }
});

// Maps route.sort string to Vendure SearchResultSortParameter (avoids returning {name:"ASC"} which json-logic parses as logic)
const SORT_MAP: Record<string, { name?: 'ASC' | 'DESC'; price?: 'ASC' | 'DESC' }> = {
  'name-asc': { name: 'ASC' },
  'name-desc': { name: 'DESC' },
  'price-asc': { price: 'ASC' },
  'price-desc': { price: 'DESC' },
};
jsonLogic.add_operation('sortInputFromRoute', (routeSort: unknown) => {
  const key = String(routeSort ?? 'name-asc');
  return SORT_MAP[key] ?? SORT_MAP['name-asc'];
});

// Get item at index from array (for product.assets[product.imageIndex])
jsonLogic.add_operation('at', (arr: unknown, index: unknown) => {
  const a = (arr as unknown[]) ?? [];
  const i = Math.max(0, Math.min(Math.floor(Number(index) ?? 0), a.length - 1));
  return a[i];
});

// Get primary collection slug (prefer one with parent, else first). For related products fetch.
jsonLogic.add_operation('primaryCollectionSlug', (collections: unknown) => {
  const arr = (collections as Array<{ slug?: string; parent?: { id?: string } }>) ?? [];
  const withParent = arr.find((c) => c.parent?.id);
  return (withParent ?? arr[0])?.slug ?? '';
});

// Filter items where productId !== currentId, then slice to limit. For related products.
jsonLogic.add_operation('filterRelatedProducts', (items: unknown, currentId: unknown, limit: unknown) => {
  const arr = (items as Array<{ productId?: string }>) ?? [];
  const id = String(currentId ?? '');
  const max = Number(limit ?? 12);
  return arr.filter((i) => i.productId !== id).slice(0, max);
});

// Get selected option id for a group from selectedOptions object.
jsonLogic.add_operation('selectedOptionForGroup', (selectedOptions: unknown, groupId: unknown) => {
  const sel = (selectedOptions as Record<string, string>) ?? {};
  return sel[String(groupId ?? '')] ?? null;
});

// Find variant by id. Returns variant object or null.
jsonLogic.add_operation('findVariantById', (variants: unknown, id: unknown) => {
  const v = (variants as Array<{ id: string; [k: string]: unknown }>) ?? [];
  const target = String(id ?? '');
  return v.find((x) => x.id === target) ?? null;
});

// Find variant whose options match selectedOptions (groupId -> optionId). Returns variant.id or null.
jsonLogic.add_operation('findMatchingVariantId', (variants: unknown, optionGroups: unknown, selectedOptions: unknown) => {
  const v = (variants as Array<{ id: string; options: Array<{ id: string }> }>) ?? [];
  const groups = (optionGroups as Array<{ id: string }>) ?? [];
  const sel = (selectedOptions as Record<string, string>) ?? {};
  if (v.length === 1) return v[0]?.id ?? null;
  const selectedIds = groups.map((g) => sel[g.id]).filter(Boolean);
  if (selectedIds.length !== groups.length) return null;
  const match = v.find((variant) => {
    const variantOptIds = (variant.options ?? []).map((o) => o.id);
    return selectedIds.every((id) => variantOptIds.includes(id));
  });
  return match?.id ?? null;
});

// Returns page numbers to display with ellipsis: [1, 2, 3, "...", 10] (delta=2 around current)
jsonLogic.add_operation('paginationPages', (totalItems: unknown, collectionSkip: unknown, pageSize: unknown) => {
  const total = Number(totalItems ?? 0);
  const skip = Number(collectionSkip ?? 0);
  const size = Math.max(1, Number(pageSize ?? 12));
  const totalPages = Math.max(1, Math.ceil(total / size));
  const currentPage = Math.min(totalPages, Math.floor(skip / size) + 1);
  const delta = 2;
  const range: number[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - delta && i <= currentPage + delta)) {
      range.push(i);
    }
  }
  const rangeWithDots: (number | string)[] = [];
  let prev = 0;
  for (const i of range) {
    if (prev && i - prev > 1) rangeWithDots.push('...');
    rangeWithDots.push(i);
    prev = i;
  }
  return rangeWithDots;
});

export type ComputedDef = {
  output: string;
  expr: object; // JSON Logic expression; data = merged state
};

export function runComputed(
  merged: Record<string, unknown>,
  computed: ComputedDef[],
  _config: Record<string, unknown>
): Record<string, unknown> {
  let result = merged;
  for (const def of computed) {
    try {
      const value = jsonLogic.apply(def.expr as object, result);
      result = setNestedValue(result, def.output, value);
    } catch (err) {
      console.error('[SDUI] computed error:', def, err);
    }
  }
  return result;
}
