/**
 * Node Locator
 *
 * Finds a node in the full page JSON tree by:
 *   1. Anchor ID (direct O(n) scan — instant)
 *   2. Structural path string e.g. "content.children[2].children[0]"
 *
 * Returns the node + its path for use by Patcher/Customizer.
 * Natural language → anchor ID resolution is handled by EditAgent.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NodeLocation {
  /** The found SDUI node */
  node: Record<string, unknown>;
  /** Dot-notation path to this node e.g. "content.children[2].children[0]" */
  path: string;
  /** Parent node */
  parent: Record<string, unknown> | null;
  /** Index within parent's children array, or null */
  childIndex: number | null;
}

// ─── Find by ID ───────────────────────────────────────────────────────────────

/**
 * Walk the JSON tree and find the node with the given id.
 * Uses DFS — fast for typical page sizes (~200-400 nodes).
 */
export function findNodeById(
  root: Record<string, unknown>,
  targetId: string,
  _currentPath = 'root',
  _parent: Record<string, unknown> | null = null,
  _childIndex: number | null = null,
): NodeLocation | null {
  if (root.id === targetId) {
    return {
      node: root,
      path: _currentPath,
      parent: _parent,
      childIndex: _childIndex,
    };
  }

  const children = root.children as Record<string, unknown>[] | undefined;
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child && typeof child === 'object') {
        const found = findNodeById(
          child as Record<string, unknown>,
          targetId,
          `${_currentPath}.children[${i}]`,
          root,
          i,
        );
        if (found) return found;
      }
    }
  }

  // Also check layoutParts.navbar and layoutParts.footer
  const layoutParts = root.layoutParts as Record<string, Record<string, unknown>> | undefined;
  if (layoutParts) {
    for (const [partName, part] of Object.entries(layoutParts)) {
      if (part?.structure) {
        const found = findNodeById(
          part.structure as Record<string, unknown>,
          targetId,
          `layoutParts.${partName}.structure`,
          part as Record<string, unknown>,
          null,
        );
        if (found) return found;
      }
    }
  }

  return null;
}

// ─── Find by path ─────────────────────────────────────────────────────────────

/**
 * Resolve a dot-path like "content.children[2].children[0]" to the node.
 */
export function findNodeByPath(
  root: Record<string, unknown>,
  path: string,
): NodeLocation | null {
  const parts = parsePath(path);
  let current: unknown = root;
  let parent: Record<string, unknown> | null = null;
  let childIndex: number | null = null;

  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    parent = typeof current === 'object' && current !== null ? (current as Record<string, unknown>) : null;

    if (typeof key === 'number') {
      const arr = current as unknown[];
      childIndex = key;
      current = arr[key];
    } else {
      childIndex = null;
      current = (current as Record<string, unknown>)[key];
    }

    if (current === undefined || current === null) return null;
  }

  return {
    node: current as Record<string, unknown>,
    path,
    parent,
    childIndex,
  };
}

// ─── Extract subtree ─────────────────────────────────────────────────────────

/**
 * Get the smallest useful subtree for AI editing.
 * Returns the node itself for small nodes, or the parent section for larger ones.
 *
 * Rule:
 *   - If the node has fewer than 5 children deep, return itself
 *   - Otherwise, return the nearest ancestor that IS a section-level node (has id ending in "-section")
 */
export function extractEditableSubtree(
  pageJson: Record<string, unknown>,
  nodeId: string,
): { subtree: Record<string, unknown>; subtreePath: string } | null {
  const location = findNodeById(pageJson, nodeId);
  if (!location) return null;

  // Count descendants
  const nodeSize = countNodes(location.node);

  // If small node, just return itself
  if (nodeSize <= 20) {
    return { subtree: location.node, subtreePath: location.path };
  }

  // Otherwise find nearest section ancestor
  const sectionLocation = findNearestSection(pageJson, nodeId);
  if (sectionLocation) {
    return { subtree: sectionLocation.node, subtreePath: sectionLocation.path };
  }

  return { subtree: location.node, subtreePath: location.path };
}

// ─── All anchor IDs ───────────────────────────────────────────────────────────

/**
 * Walk the tree and collect all id attributes.
 * Used by EditAgent to understand what IDs are available.
 */
export function collectAllIds(root: Record<string, unknown>): string[] {
  const ids: string[] = [];
  collectIdsRecursive(root, ids);
  return ids;
}

function collectIdsRecursive(node: Record<string, unknown>, ids: string[]): void {
  if (node.id && typeof node.id === 'string') {
    ids.push(node.id);
  }
  const children = node.children as Record<string, unknown>[] | undefined;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === 'object') {
        collectIdsRecursive(child as Record<string, unknown>, ids);
      }
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countNodes(node: Record<string, unknown>): number {
  let count = 1;
  const children = node.children as Record<string, unknown>[] | undefined;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === 'object') {
        count += countNodes(child as Record<string, unknown>);
      }
    }
  }
  return count;
}

function findNearestSection(
  root: Record<string, unknown>,
  targetId: string,
): NodeLocation | null {
  return findNearestSectionHelper(root, targetId, 'root', null, null);
}

function findNearestSectionHelper(
  node: Record<string, unknown>,
  targetId: string,
  path: string,
  parent: Record<string, unknown> | null,
  childIndex: number | null,
): NodeLocation | null {
  if (node.id === targetId) {
    // Found target — return nearest section ancestor (tracked via recursion)
    return null; // Caller will handle
  }

  const isSection = typeof node.id === 'string' && (
    (node.id as string).endsWith('-section') ||
    (node.id as string) === 'navbar-root' ||
    (node.id as string) === 'footer-root'
  );

  const children = node.children as Record<string, unknown>[] | undefined;
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child || typeof child !== 'object') continue;

      const found = containsId(child as Record<string, unknown>, targetId);
      if (found) {
        if (isSection) {
          return { node, path, parent, childIndex };
        }
        return findNearestSectionHelper(
          child as Record<string, unknown>,
          targetId,
          `${path}.children[${i}]`,
          node,
          i,
        );
      }
    }
  }

  return null;
}

function containsId(node: Record<string, unknown>, targetId: string): boolean {
  if (node.id === targetId) return true;
  const children = node.children as Record<string, unknown>[] | undefined;
  if (Array.isArray(children)) {
    return children.some(c => c && typeof c === 'object' && containsId(c as Record<string, unknown>, targetId));
  }
  return false;
}

function parsePath(path: string): (string | number)[] {
  return path.split('.').flatMap(segment => {
    const arrayMatch = segment.match(/^(.+?)\[(\d+)\]$/);
    if (arrayMatch) return [arrayMatch[1], parseInt(arrayMatch[2], 10)];
    return [segment];
  });
}
