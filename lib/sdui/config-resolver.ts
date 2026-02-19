/**
 * Config Resolver - JSON composition with $ref, $slot, and layouts
 * Enables reusable fragments and layout composition without hardcoding
 */

export type SDUINodeLike = Record<string, unknown> & {
  type?: string;
  $ref?: string;
  $slot?: string;
  children?: SDUINodeLike[];
};

export type FragmentNode = SDUINodeLike;

export type LayoutConfig = {
  structure: SDUINodeLike;
  slots?: Record<string, string>; // slot name -> $ref path
};

export type ConfigRegistry = {
  layouts: Record<string, LayoutConfig>;
  fragments: Record<string, FragmentNode>;
};

/** Resolve $ref - returns the fragment, recursively resolving nested $refs */
function resolveRef(
  refPath: string,
  registry: ConfigRegistry,
  visited: Set<string> = new Set()
): SDUINodeLike | null {
  if (visited.has(refPath)) {
    console.warn('[ConfigResolver] Circular $ref:', refPath);
    return null;
  }
  visited.add(refPath);

  const parts = refPath.split('#');
  const basePath = parts[0];
  const subPath = parts[1];

  let node = registry.fragments[basePath] ?? null;
  if (!node) return null;

  if (subPath) {
    const keys = subPath.split('/');
    for (const k of keys) {
      node = (node as Record<string, unknown>)[k] as SDUINodeLike;
      if (!node) return null;
    }
  }

  return deepResolveNode(JSON.parse(JSON.stringify(node)), registry, visited);
}

/** Deep resolve a node - replace $ref and recurse into children */
function deepResolveNode(
  node: SDUINodeLike,
  registry: ConfigRegistry,
  visited: Set<string>
): SDUINodeLike {
  if (!node || typeof node !== 'object') return node;

  if ('$ref' in node && typeof node.$ref === 'string') {
    const resolved = resolveRef(node.$ref, registry, visited);
    return resolved ?? node;
  }

  const result = { ...node };
  delete (result as Record<string, unknown>).$ref;
  delete (result as Record<string, unknown>).$slot;

  if (Array.isArray(result.children)) {
    result.children = result.children.map((child) =>
      deepResolveNode(child as SDUINodeLike, registry, visited)
    );
  }

  return result;
}

/** Replace $slot placeholders with content (expands array into siblings) */
function injectSlot(
  node: SDUINodeLike,
  slotName: string,
  content: SDUINodeLike | SDUINodeLike[],
  registry: ConfigRegistry,
  visited: Set<string>
): SDUINodeLike | SDUINodeLike[] {
  if (!node || typeof node !== 'object') return node;

  if ('$slot' in node && node.$slot === slotName) {
    const contentArr = Array.isArray(content) ? content : [content];
    return contentArr.map((c) => deepResolveNode(JSON.parse(JSON.stringify(c)) as SDUINodeLike, registry, visited));
  }

  const result = { ...node };
  delete (result as Record<string, unknown>).$slot;

  if (Array.isArray(result.children)) {
    const newChildren: SDUINodeLike[] = [];
    for (const child of result.children) {
      const injected = injectSlot(child as SDUINodeLike, slotName, content, registry, visited);
      if (Array.isArray(injected)) {
        newChildren.push(...injected);
      } else {
        newChildren.push(injected);
      }
    }
    result.children = newChildren;
  }

  return result;
}

/** Resolve a screen config - apply layout, $ref, $slot */
export function resolveScreenConfig(
  screen: Record<string, unknown> & { layout?: string; content?: SDUINodeLike; ui?: SDUINodeLike },
  registry: ConfigRegistry
): Record<string, unknown> {
  const { layout, content, ui, ...rest } = screen;
  const contentNode = content ?? ui;

  if (!contentNode) {
    return screen as Record<string, unknown>;
  }

  if (layout && registry.layouts[layout]) {
    const layoutConfig = registry.layouts[layout];
    const structure = JSON.parse(JSON.stringify(layoutConfig.structure));
    const withSlot = injectSlot(
      structure,
      'content',
      contentNode as SDUINodeLike,
      registry,
      new Set()
    );
    const resolved = deepResolveNode(withSlot, registry, new Set());
    return { ...rest, ui: resolved } as Record<string, unknown>;
  }

  const resolved = deepResolveNode(
    JSON.parse(JSON.stringify(contentNode)) as SDUINodeLike,
    registry,
    new Set()
  );
  return { ...rest, ui: resolved } as Record<string, unknown>;
}
