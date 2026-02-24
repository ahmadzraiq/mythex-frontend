/**
 * Semantic validator: walk node tree, find all { "action": "..." } references,
 * check they exist in merged actions config from root.
 */

import root from '@/config/root';
import type { UiNode, ValidationResult } from './types';

const actions = root.actions as Record<string, unknown>;
const VALID_ACTION_NAMES = new Set(Object.keys(actions));

/** Inline action types that don't need to be in config */
const INLINE_ACTION_TYPES = new Set([
  'navigate',
  'setState',
  'set',
  'setVar',
  'toggle',
  'increment',
  'decrement',
  'runMultiple',
  'appendToPath',
  'mergeArraysByKey',
  'navigateWithQuery',
  'goToPage',
  'setTheme',
]);

/**
 * Named actions used in section library variants that are valid page-generator
 * conventions but may not be defined in every project's actions config.
 * These are intentional placeholders — the section examples reference them
 * so the generated page is wired correctly once the action is added to config.
 */
const PAGE_GENERATOR_ACTIONS = new Set([
  'subscribeNewsletter',
  'submitNewsletter',
  'submitContactForm',
  'fetchNavCollections',
  'fetchCart',
  'fetchFeaturedCategories',
  'fetchNewArrivals',
  'fetchBestSellers',
  'fetchFlashSale',
  'fetchTestimonials',
  'addToCart',
  'addToWishlist',
  'openCart',
  'logout',
  'goToCart',
  'goToCheckout',
]);

function extractActionRefs(obj: unknown, refs: Set<string>): void {
  if (obj == null) return;
  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const o = obj as Record<string, unknown>;
    if ('action' in o && typeof o.action === 'string') {
      const name = o.action;
      if (!INLINE_ACTION_TYPES.has(name) && name !== 'navigate') {
        refs.add(name);
      }
    }
    if ('actions' in o && Array.isArray(o.actions)) {
      for (const a of o.actions as unknown[]) {
        extractActionRefs(a, refs);
      }
    }
    for (const v of Object.values(o)) {
      extractActionRefs(v, refs);
    }
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      extractActionRefs(item, refs);
    }
  }
}

function walkNodes(node: UiNode, refs: Set<string>): void {
  if (node.actions) {
    for (const handler of Object.values(node.actions)) {
      extractActionRefs(handler, refs);
    }
  }
  if (node.children) {
    for (const child of node.children) {
      walkNodes(child as UiNode, refs);
    }
  }
}

/**
 * Validate that all named action references in the node tree exist in config.
 */
export function validateActions(structure: UiNode): ValidationResult {
  const refs = new Set<string>();
  walkNodes(structure, refs);

  const invalid: string[] = [];
  for (const name of refs) {
    if (!VALID_ACTION_NAMES.has(name) && !PAGE_GENERATOR_ACTIONS.has(name)) {
      invalid.push(`Unknown action: "${name}"`);
    }
  }

  return {
    pass: invalid.length === 0,
    errors: invalid.length ? invalid : undefined,
  };
}
