/**
 * resolve.ts — Flatten shared-component instances and resolve responsive overrides.
 *
 * Takes a raw SDUINode tree from the builder and returns a fully-resolved tree
 * where:
 *  - Shared component instances have their per-instance overrides merged into the subtree
 *  - Responsive overrides are merged into the base className / style
 *  - $slot / layout resolution is handled separately in routing.ts (not needed here —
 *    builder state already stores the post-$slot tree)
 */

import type { SDUINode } from '@/lib/sdui/types/node';
import { getSharedComponents } from '@/lib/builder/shared-component-data';

type AnyNode = SDUINode & {
  _shared?: { id: string };
  _overrides?: string[];
  responsive?: Record<string, { className?: string; styles?: Record<string, unknown>; condition?: unknown }>;
  children?: AnyNode[];
};

/** Merge responsive overrides into a node for export (desktop-first cascade) */
function mergeResponsive(node: AnyNode): AnyNode {
  if (!node.responsive) return node;

  // Collect ordered breakpoints from most-specific to least
  const breakpoints: Array<[string, string]> = [
    ['mobile', 'sm'],
    ['tablet', 'md'],
    ['laptop', 'lg'],
  ];

  let extraClasses = '';
  const extraStyles: Record<string, unknown> = {};

  for (const [bpKey, twPrefix] of breakpoints) {
    const bp = node.responsive[bpKey];
    if (!bp) continue;
    if (bp.className) {
      // Prefix every Tailwind class with the breakpoint
      const bpClasses = bp.className.trim().split(/\s+/).map((c: string) => `${twPrefix}:${c}`).join(' ');
      extraClasses += ' ' + bpClasses;
    }
    if (bp.styles) {
      for (const [k, v] of Object.entries(bp.styles)) {
        // Responsive inline styles not directly supported in Tailwind in generated code;
        // kept as a data attribute for developer awareness
        extraStyles[`data-${twPrefix}-${k}`] = v;
      }
    }
  }

  const baseClass = (node.props?.className as string | undefined) ?? '';
  return {
    ...node,
    props: {
      ...node.props,
      className: (baseClass + extraClasses).trim(),
    },
    responsive: undefined,
  };
}

type SCProperty = { name: string; defaultValue: unknown };

/**
 * Substitute {{context.component.props.X}} template strings and
 * context?.component?.props?.X formula expressions with actual prop values.
 */
function substituteComponentProps(node: AnyNode, cProps: Record<string, unknown>): AnyNode {
  if (!node || typeof node !== 'object') return node;

  // Replace in node.text (template strings like {{context.component.props.text}})
  const rawText = (node as Record<string, unknown>).text;
  const newText =
    typeof rawText === 'string'
      ? rawText.replace(/\{\{context\.component\.props\.(\w+)\}\}/g, (_, k) => {
          const v = cProps[k];
          return v !== undefined ? String(v) : '';
        })
      : rawText;

  // Replace in props values
  function substituteValue(v: unknown): unknown {
    if (typeof v === 'string') {
      return v.replace(/\{\{context\.component\.props\.(\w+)\}\}/g, (_, k) => {
        const val = cProps[k];
        return val !== undefined ? String(val) : '';
      });
    }
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      if ('formula' in obj && typeof obj.formula === 'string') {
        return {
          ...obj,
          formula: obj.formula.replace(
            /context\??\.component\??\.props\??\.(\w+)/g,
            (_, k) => {
              const val = cProps[k];
              if (val === undefined) return 'undefined';
              if (typeof val === 'string') return JSON.stringify(val);
              return String(val);
            },
          ),
        };
      }
      if ('js' in obj && typeof obj.js === 'string') {
        return {
          ...obj,
          js: obj.js.replace(
            /context\??\.component\??\.props\??\.(\w+)/g,
            (_, k) => {
              const val = cProps[k];
              if (val === undefined) return 'undefined';
              if (typeof val === 'string') return JSON.stringify(val);
              return String(val);
            },
          ),
        };
      }
      // Plain style object — substitute each value
      const out: Record<string, unknown> = {};
      for (const [sk, sv] of Object.entries(obj)) {
        out[sk] = substituteValue(sv);
      }
      return out;
    }
    return v;
  }

  const newProps: Record<string, unknown> = {};
  for (const [k, v] of Object.entries((node.props as Record<string, unknown>) ?? {})) {
    newProps[k] = substituteValue(v);
  }

  return {
    ...node,
    ...(newText !== rawText ? { text: newText } : {}),
    props: newProps,
    children: (node.children ?? []).map(c => substituteComponentProps(c, cProps)),
  };
}

/** Flatten a shared component instance into its own subtree with overrides applied */
function flattenSharedInstance(node: AnyNode): AnyNode {
  if (!node._shared?.id) return node;

  try {
    const allSCs = getSharedComponents();
    const model = allSCs[node._shared.id];
    if (!model) return { ...node, _shared: undefined };

    const content = (model as unknown as { content?: AnyNode }).content;
    if (!content) return { ...node, _shared: undefined };

    // Build component props map: start with property defaultValues
    const properties = (model as unknown as { properties?: SCProperty[] }).properties ?? [];
    const componentProps: Record<string, unknown> = {};
    for (const p of properties) {
      componentProps[p.name] = p.defaultValue;
    }

    // Apply instance-level overrides (via _overrides list AND any matching prop key)
    if (node.props) {
      const instanceProps = node.props as Record<string, unknown>;
      // First: explicit _overrides list
      for (const key of node._overrides ?? []) {
        if (key in instanceProps) componentProps[key] = instanceProps[key];
      }
      // Second: any prop key that matches a component property name
      for (const p of properties) {
        if (p.name in instanceProps) componentProps[p.name] = instanceProps[p.name];
      }
    }

    // Substitute context.component.props.* throughout the content tree
    const resolved = substituteComponentProps(content, componentProps);

    // Merge per-instance CSS/className overrides to the root node
    const overrides = node._overrides ?? [];
    const merged: AnyNode = { ...resolved };
    if (overrides.length > 0 && node.props) {
      const overriddenProps: Record<string, unknown> = {};
      for (const key of overrides) {
        if (key in ((node.props as Record<string, unknown>) ?? {})) {
          overriddenProps[key] = (node.props as Record<string, unknown>)[key];
        }
      }
      merged.props = { ...merged.props, ...overriddenProps };
    }

    return flattenNode(merged);
  } catch {
    return { ...node, _shared: undefined };
  }
}

function flattenNode(node: AnyNode): AnyNode {
  // 1. Flatten shared instance
  const n1 = flattenSharedInstance(node);
  // 2. Merge responsive
  const n2 = mergeResponsive(n1);
  // 3. Recurse
  return {
    ...n2,
    children: (n2.children ?? []).map(flattenNode),
  };
}

export function resolvePageNodes(nodes: SDUINode[]): SDUINode[] {
  return (nodes as AnyNode[]).map(flattenNode) as SDUINode[];
}
