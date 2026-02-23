/**
 * Config Resolver - JSON composition with $ref, $slot, and layouts
 * Enables reusable fragments and layout composition without hardcoding
 */

import { getVariantRef, LAYOUT_PART_REF_MAP } from '@/config/section-variants';
import type { NavbarStructure } from '@/config/schema/layout-schema';

/** Deep clone - uses structuredClone when available (faster), falls back to JSON round-trip */
function deepClone<T>(obj: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}

export type SDUINodeLike = Record<string, unknown> & {
  type?: string;
  id?: string;
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

export type LayoutParts = {
  navbar?: { structure?: NavbarStructure };
  footer?: { variant?: string };
};

export type ResolveOptions = {
  layoutParts?: LayoutParts;
};

/** Resolve $ref - returns the fragment, recursively resolving nested $refs */
function resolveRef(
  refPath: string,
  registry: ConfigRegistry,
  visited: Set<string>,
  options?: ResolveOptions
): SDUINodeLike | null {
  if (visited.has(refPath)) {
    console.warn('[ConfigResolver] Circular $ref:', refPath);
    return null;
  }
  visited.add(refPath);

  const refBase = refPath.split('#')[0];
  const partKey = LAYOUT_PART_REF_MAP[refBase];
  const part = partKey && options?.layoutParts?.[partKey as keyof typeof options.layoutParts];

  if (partKey === 'navbar' && part && 'structure' in part && part.structure) {
    return deepResolveNode(deepClone(part.structure) as SDUINodeLike, registry, visited, options);
  }

  let effectivePath = refPath;
  if (partKey === 'navbar') {
    effectivePath = 'fragments/layout/navbar';
    if (refPath.includes('#')) {
      effectivePath = `${effectivePath}#${refPath.split('#')[1]}`;
    }
  } else if (part && partKey) {
    const variantRef = getVariantRef(partKey, (part as { variant?: string }).variant ?? 'default');
    if (variantRef) {
      effectivePath = refPath.includes('#')
        ? `${variantRef}#${refPath.split('#')[1]}`
        : variantRef;
    }
  }

  const parts = effectivePath.split('#');
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

  const resolved = deepClone(node) as SDUINodeLike;
  return deepResolveNode(resolved, registry, visited, options);
}

/** Deep resolve a node - replace $ref and recurse into children */
function deepResolveNode(
  node: SDUINodeLike,
  registry: ConfigRegistry,
  visited: Set<string>,
  options?: ResolveOptions
): SDUINodeLike {
  if (!node || typeof node !== 'object') return node;

  if ('$ref' in node && typeof node.$ref === 'string') {
    const resolved = resolveRef(node.$ref, registry, visited, options);
    return resolved ?? node;
  }

  const result = { ...node };
  delete (result as Record<string, unknown>).$ref;
  delete (result as Record<string, unknown>).$slot;

  if (Array.isArray(result.children)) {
    result.children = result.children.map((child) =>
      deepResolveNode(child as SDUINodeLike, registry, visited, options)
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
  visited: Set<string>,
  options?: ResolveOptions
): SDUINodeLike | SDUINodeLike[] {
  if (!node || typeof node !== 'object') return node;

  if ('$slot' in node && node.$slot === slotName) {
    const contentArr = Array.isArray(content) ? content : [content];
    return contentArr.map((c) =>
      deepResolveNode(deepClone(c) as SDUINodeLike, registry, visited, options)
    );
  }

  const result = { ...node };
  delete (result as Record<string, unknown>).$slot;

  if (Array.isArray(result.children)) {
    const newChildren: SDUINodeLike[] = [];
    for (const child of result.children) {
      const injected = injectSlot(
        child as SDUINodeLike,
        slotName,
        content,
        registry,
        visited,
        options
      );
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
  screen: Record<string, unknown> & {
    layout?: string;
    content?: SDUINodeLike;
    ui?: SDUINodeLike;
    layoutParts?: LayoutParts;
  },
  registry: ConfigRegistry
): Record<string, unknown> {
  const { layout, content, ui, layoutParts, ...rest } = screen;
  const contentNode = content ?? ui;
  const options: ResolveOptions = layoutParts ? { layoutParts } : undefined;

  if (!contentNode) {
    return screen as Record<string, unknown>;
  }

  if (layout && registry.layouts[layout]) {
    const layoutConfig = registry.layouts[layout];
    const structure = deepClone(layoutConfig.structure);
    const withSlot = injectSlot(
      structure,
      'content',
      contentNode as SDUINodeLike,
      registry,
      new Set(),
      options
    );
    const resolved = Array.isArray(withSlot)
      ? deepResolveNode({ type: 'Box', children: withSlot }, registry, new Set(), options)
      : deepResolveNode(withSlot, registry, new Set(), options);
    return { ...rest, ui: resolved } as Record<string, unknown>;
  }

  const resolved = deepResolveNode(
    deepClone(contentNode) as SDUINodeLike,
    registry,
    new Set(),
    options
  );
  return { ...rest, ui: resolved } as Record<string, unknown>;
}
