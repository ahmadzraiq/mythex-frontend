/**
 * Custom JSX factory for the builder DSL.
 *
 * Used automatically via "jsxImportSource": "builder" in src/tsconfig.json.
 * Converts JSX into plain data objects that the compiler can read as JSON.
 * No React, no DOM, no virtual DOM.
 */

export type SduiNode = {
  type: string
  props: Record<string, unknown>
  children: SduiNode[]
}

type JsxType = string | ((...args: unknown[]) => unknown)

function toNode(type: JsxType, props: Record<string, unknown> | null): SduiNode {
  const { children: propsChildren, ...rest } = props ?? {}
  const allChildren: SduiNode[] = Array.isArray(propsChildren)
    ? propsChildren.flat()
    : propsChildren != null
    ? [propsChildren as SduiNode]
    : []
  const resolvedType =
    typeof type === 'string'
      ? type
      : (type as Record<string, unknown>).__sdui_type
        ? String((type as Record<string, unknown>).__sdui_type)
        : 'Unknown'
  return { type: resolvedType, props: rest, children: allChildren }
}

export function jsx(type: JsxType, props: Record<string, unknown> | null): SduiNode {
  return toNode(type, props)
}

export function jsxs(type: JsxType, props: Record<string, unknown> | null): SduiNode {
  return toNode(type, props)
}

export const Fragment = '__fragment__'

/** TypeScript JSX types — allows any element name with any props in src/ files */
export declare namespace JSX {
  interface Element extends SduiNode {}
  interface ElementClass {
    render(): Element
  }
  interface ElementAttributesProperty {
    props: object
  }
  interface ElementChildrenAttribute {
    children: object
  }
  // Permissive: every PascalCase tag and every prop is valid
  // This avoids needing typed prop interfaces for every SDUI element
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type IntrinsicElements = Record<string, any>
}
