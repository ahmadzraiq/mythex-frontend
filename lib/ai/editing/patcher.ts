/**
 * Patcher — Apply edits to the full page JSON
 *
 * Takes a page JSON + an edit operation and returns the updated page JSON.
 * All edits are immutable (deep clone before modification).
 */

import { findNodeById, findNodeByPath } from './node-locator';
import { applyStyleRule } from './style-interpreter';
import type { StyleRule } from './style-interpreter';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RemoveNodePatch {
  type: 'remove';
  nodeId: string;
}

export interface StylePatch {
  type: 'style';
  nodeId: string;
  rule: StyleRule;
}

export interface TextPatch {
  type: 'text';
  nodeId: string;
  text: string;
}

export interface SubtreePatch {
  type: 'subtree';
  /** Dot-path to the node to replace */
  nodePath: string;
  updatedSubtree: Record<string, unknown>;
}

export type Patch = RemoveNodePatch | StylePatch | TextPatch | SubtreePatch;

// ─── Patcher ──────────────────────────────────────────────────────────────────

/**
 * Apply a patch to the page JSON.
 * Returns the updated page JSON (deep clone — original is untouched).
 */
export function applyPatch(
  page: Record<string, unknown>,
  patch: Patch,
): Record<string, unknown> {
  const cloned = deepClone(page);

  switch (patch.type) {
    case 'remove':
      return removeNode(cloned, patch.nodeId);

    case 'style':
      return applyStylePatch(cloned, patch.nodeId, patch.rule);

    case 'text':
      return applyTextPatch(cloned, patch.nodeId, patch.text);

    case 'subtree':
      return applySubtreePatch(cloned, patch.nodePath, patch.updatedSubtree);
  }
}

// ─── Patch implementations ────────────────────────────────────────────────────

function removeNode(page: Record<string, unknown>, nodeId: string): Record<string, unknown> {
  const location = findNodeById(page, nodeId);
  if (!location) {
    console.warn(`Patcher: Node "${nodeId}" not found — skipping remove`);
    return page;
  }

  if (location.parent && location.childIndex !== null) {
    const children = location.parent.children as Record<string, unknown>[];
    children.splice(location.childIndex, 1);
  } else {
    console.warn(`Patcher: Cannot remove root node "${nodeId}"`);
  }
  return page;
}

function applyStylePatch(
  page: Record<string, unknown>,
  nodeId: string,
  rule: StyleRule,
): Record<string, unknown> {
  const location = findNodeById(page, nodeId);
  if (!location) {
    console.warn(`Patcher: Node "${nodeId}" not found — skipping style patch`);
    return page;
  }

  const node = location.node;

  switch (rule.operation) {
    case 'remove-node':
      return removeNode(page, nodeId);

    case 'toggle-hidden':
      node.condition = node.condition === false ? undefined : false;
      break;

    case 'set-text':
      node.text = rule.text;
      break;

    default: {
      const props = (node.props ?? {}) as Record<string, unknown>;
      const currentClassName = (props.className as string) ?? '';
      const { className } = applyStyleRule(currentClassName, rule);
      node.props = { ...props, className };
      break;
    }
  }

  return page;
}

function applyTextPatch(
  page: Record<string, unknown>,
  nodeId: string,
  text: string,
): Record<string, unknown> {
  const location = findNodeById(page, nodeId);
  if (!location) {
    console.warn(`Patcher: Node "${nodeId}" not found — skipping text patch`);
    return page;
  }
  location.node.text = text;
  return page;
}

function applySubtreePatch(
  page: Record<string, unknown>,
  nodePath: string,
  updatedSubtree: Record<string, unknown>,
): Record<string, unknown> {
  const location = findNodeByPath(page, nodePath);
  if (!location) {
    console.warn(`Patcher: Path "${nodePath}" not found — skipping subtree patch`);
    return page;
  }

  if (location.parent && location.childIndex !== null) {
    const children = location.parent.children as Record<string, unknown>[];
    children[location.childIndex] = updatedSubtree;
  } else if (location.parent) {
    // Non-array key — find the key name and update
    for (const [key, val] of Object.entries(location.parent)) {
      if (val === location.node) {
        (location.parent as Record<string, unknown>)[key] = updatedSubtree;
        break;
      }
    }
  } else {
    console.warn(`Patcher: Cannot replace root node at path "${nodePath}"`);
  }

  return page;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}
