/**
 * Config Resolver - JSON composition with $slot and layouts
 * Enables layout composition with slot injection.
 */

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
  $slot?: string;
  children?: SDUINodeLike[];
};

export type FragmentNode = SDUINodeLike;

export type LayoutConfig = {
  structure: SDUINodeLike;
};

export type ConfigRegistry = {
  layouts: Record<string, LayoutConfig>;
  fragments: Record<string, FragmentNode>;
};

export type LayoutParts = {
  navbar?: { structure?: NavbarStructure };
  footer?: { structure?: unknown; variant?: string };
};

export type ResolveOptions = {
  layoutParts?: LayoutParts;
};

/** Deep resolve a node - recurse into children */
function deepResolveNode(
  node: SDUINodeLike,
  registry: ConfigRegistry,
  options?: ResolveOptions
): SDUINodeLike {
  if (!node || typeof node !== 'object') return node;

  const result = { ...node };

  if (Array.isArray(result.children)) {
    result.children = result.children.map((child) =>
      deepResolveNode(child as SDUINodeLike, registry, options)
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
  options?: ResolveOptions
): SDUINodeLike | SDUINodeLike[] {
  if (!node || typeof node !== 'object') return node;

  if ('$slot' in node && node.$slot === slotName) {
    const contentArr = Array.isArray(content) ? content : [content];
    return contentArr.map((c) =>
      deepResolveNode(deepClone(c) as SDUINodeLike, registry, options)
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

/** Resolve a screen config - apply layout and $slot injection */
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
      options
    );
    const resolved = Array.isArray(withSlot)
      ? deepResolveNode({ type: 'Box', children: withSlot }, registry, options)
      : deepResolveNode(withSlot, registry, options);
    return { ...rest, ui: resolved } as Record<string, unknown>;
  }

  const resolved = deepResolveNode(
    deepClone(contentNode) as SDUINodeLike,
    registry,
    options
  );
  return { ...rest, ui: resolved } as Record<string, unknown>;
}
