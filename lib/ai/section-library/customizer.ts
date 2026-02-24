/**
 * Section Customizer
 *
 * Applies all edit tiers to a full page JSON:
 *   - Tier 1: Style / content patches (no AI)
 *   - Tier 3: Section variant swaps (no AI)
 *   - Section add / remove
 *
 * Tier 2 edits (structural AI changes) are handled by EditAgent + NodeLocator
 * and applied via applySubtreeEdit().
 */

import { sectionLibrary } from './index';
import type { SectionParams } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EditTier = 1 | 2 | 3 | 4;

export interface StylePatch {
  nodeId: string;
  /** Tailwind classes to add */
  addClass?: string;
  /** Tailwind classes to remove (exact strings) */
  removeClass?: string;
  /** Replace text content */
  text?: string;
  /** Toggle condition */
  hidden?: boolean;
}

export interface SectionSwap {
  /** Index in content.children array */
  sectionIndex: number;
  newVariantId: string;
  params?: SectionParams;
}

export interface SectionAdd {
  variantId: string;
  params?: SectionParams;
  /** Insert before this index (undefined = append) */
  atIndex?: number;
}

export interface SectionRemove {
  sectionIndex: number;
}

export interface SubtreeEdit {
  /** Path to the node in the JSON tree e.g. "content.children[2]" */
  nodePath: string;
  /** The new subtree to splice in (output from EditAgent) */
  updatedSubtree: Record<string, unknown>;
}

// ─── Page JSON helpers ────────────────────────────────────────────────────────

type PageJson = {
  content: { children: Record<string, unknown>[] };
  [key: string]: unknown;
};

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

// ─── Customizer ───────────────────────────────────────────────────────────────

export class SectionCustomizer {
  /**
   * Swap a section at sectionIndex with a new variant.
   * Preserves all sections before and after.
   */
  swapSection(page: PageJson, swap: SectionSwap): PageJson {
    const cloned = deepClone(page);
    const children = cloned.content.children;

    if (swap.sectionIndex < 0 || swap.sectionIndex >= children.length) {
      throw new Error(`SectionCustomizer: sectionIndex ${swap.sectionIndex} out of range (${children.length} sections)`);
    }

    const newNode = sectionLibrary.instantiate(swap.newVariantId, swap.params ?? {});
    children[swap.sectionIndex] = newNode;
    return cloned;
  }

  /** Add a new section to the page */
  addSection(page: PageJson, add: SectionAdd): PageJson {
    const cloned = deepClone(page);
    const newNode = sectionLibrary.instantiate(add.variantId, add.params ?? {});

    if (add.atIndex !== undefined) {
      cloned.content.children.splice(add.atIndex, 0, newNode);
    } else {
      cloned.content.children.push(newNode);
    }
    return cloned;
  }

  /** Remove a section from the page */
  removeSection(page: PageJson, remove: SectionRemove): PageJson {
    const cloned = deepClone(page);
    cloned.content.children.splice(remove.sectionIndex, 1);
    return cloned;
  }

  /**
   * Apply a Tier 2 subtree edit to the page JSON.
   * The updated subtree was produced by EditAgent and validated.
   */
  applySubtreeEdit(page: PageJson, edit: SubtreeEdit): PageJson {
    const cloned = deepClone(page);
    const parts = parsePath(edit.nodePath);
    setAtPath(cloned as Record<string, unknown>, parts, edit.updatedSubtree);
    return cloned;
  }

  /**
   * Apply a style patch to a named node (Tier 1).
   * Walks the tree to find the node by id, then patches className / text / condition.
   */
  applyStylePatch(page: PageJson, patch: StylePatch): PageJson {
    const cloned = deepClone(page);
    const node = findNodeById(cloned as Record<string, unknown>, patch.nodeId);
    if (!node) {
      throw new Error(`SectionCustomizer: Node with id "${patch.nodeId}" not found in page`);
    }

    if (patch.addClass || patch.removeClass) {
      const props = (node.props ?? {}) as Record<string, string>;
      let className = (props.className ?? '') as string;
      if (patch.removeClass) {
        for (const cls of patch.removeClass.split(' ')) {
          className = className.replace(new RegExp(`\\b${cls}\\b`, 'g'), '').trim();
        }
      }
      if (patch.addClass) {
        className = `${className} ${patch.addClass}`.trim();
        // Deduplicate classes
        className = [...new Set(className.split(' ').filter(Boolean))].join(' ');
      }
      (node as Record<string, unknown>).props = { ...props, className };
    }

    if (patch.text !== undefined) {
      (node as Record<string, unknown>).text = patch.text;
    }

    if (patch.hidden !== undefined) {
      (node as Record<string, unknown>).condition = patch.hidden ? false : undefined;
    }

    return cloned;
  }
}

// ─── Path utilities ───────────────────────────────────────────────────────────

function parsePath(path: string): (string | number)[] {
  return path.split('.').flatMap(segment => {
    const match = segment.match(/^(.+?)\[(\d+)\]$/);
    if (match) return [match[1], parseInt(match[2], 10)];
    return [segment];
  });
}

function setAtPath(obj: Record<string, unknown>, parts: (string | number)[], value: unknown): void {
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    current = (current as Record<string | number, unknown>)[key];
    if (current == null) throw new Error(`Path not found at segment "${key}"`);
  }
  const lastKey = parts[parts.length - 1];
  (current as Record<string | number, unknown>)[lastKey] = value;
}

/** DFS walk to find a node by its `id` field */
function findNodeById(
  node: Record<string, unknown>,
  id: string
): Record<string, unknown> | null {
  if (node.id === id) return node;
  const children = node.children as Record<string, unknown>[] | undefined;
  if (children) {
    for (const child of children) {
      const found = findNodeById(child, id);
      if (found) return found;
    }
  }
  return null;
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const sectionCustomizer = new SectionCustomizer();
