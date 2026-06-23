/**
 * decompile-node.ts — converts a compiled SDUI JSON node tree to JSX string.
 *
 * Handles:
 *   - Box / Text / Image / Input / SC instances
 *   - className + classFormulas → DSL shorthand props
 *   - text: {js: expr} → children expression
 *   - actions (onClick / onChange / onSubmit / SC triggers)
 *   - children (recursive)
 *   - REPEAT (map field)
 *   - condition field
 *   - animation field (re-emitted verbatim)
 *   - responsive field
 */

import { classToProps, type PropValue } from './class-to-props'
import { resolveUuidsInExpr, type UuidMap } from './uuid-map'

interface SduiNode {
  type: string
  id?: string
  props?: Record<string, unknown>
  children?: SduiNode[]
  text?: unknown
  map?: string | { js?: string; as?: string; key?: string; formula?: string; keyField?: string }
  key?: unknown
  condition?: unknown
  locals?: Array<{ name: string; js: string }>
  actions?: Array<{ trigger?: string; workflowId?: string; action?: string; params?: Record<string, unknown> }>
  responsive?: Record<string, { className?: string; styles?: Record<string, unknown> }>
  animation?: unknown
  _shared?: { id: string; name: string }
  [key: string]: unknown
}

/**
 * Convert a node tree to JSX string.
 * @param node    Compiled SDUI node
 * @param uuidMap For resolving variable/workflow UUIDs to names
 * @param depth   Current indent depth
 * @param knownScNames  Set of known shared-component names for recognising SC instances
 */
export function nodeToJsx(
  node: SduiNode,
  uuidMap: UuidMap,
  depth = 0,
  knownScNames?: Set<string>,
): string {
  const pad = '  '.repeat(depth)
  const childPad = '  '.repeat(depth + 1)

  // Determine the JSX tag name
  const scName = node._shared?.name ?? (knownScNames?.has(node.type) ? node.type : null)
  const tagName = scName ?? node.type

  // Collect all props
  const jsxProps: string[] = []

  if (node._shared) {
    // SC instance node: only emit the instance-level override props (from _overrides list).
    // The node's className/classFormulas are model internals — skip them entirely.
    const instancePropKeys = new Set<string>((node._overrides as string[] | undefined) ?? [])
    if (node.props) {
      for (const [key, val] of Object.entries(node.props)) {
        if (!instancePropKeys.has(key)) continue
        if (val === undefined || val === null) continue
        jsxProps.push(formatProp(key, val as PropValue))
      }
    }
  } else {
    // Regular node: className + classFormulas → DSL shorthand props
    const className = String(node.props?.className ?? '')
    const classFormulas = node.props?.classFormulas as Record<string, unknown> | undefined
    const styleProps = classToProps(className, classFormulas, uuidMap, node.type)

    for (const [key, val] of Object.entries(styleProps)) {
      jsxProps.push(formatProp(key, val))
    }

    // Static style (shouldn't be present after Phase 0, but handle gracefully)
    const style = node.props?.style as Record<string, unknown> | undefined
    if (style && Object.keys(style).length > 0) {
      jsxProps.push(`style={${JSON.stringify(style)}}`)
    }

    // Other props (src, alt, placeholder, type, value, etc.)
    const SKIP_PROPS = new Set(['className', 'classFormulas', 'style', 'animation'])
    if (node.props) {
      for (const [key, val] of Object.entries(node.props)) {
        if (SKIP_PROPS.has(key)) continue
        if (val === undefined || val === null) continue
        if (typeof val === 'boolean' && val) {
          jsxProps.push(key)
        } else if (typeof val === 'boolean') {
          jsxProps.push(`${key}={false}`)
        } else if (typeof val === 'number') {
          jsxProps.push(`${key}={${val}}`)
        } else if (typeof val === 'string') {
          jsxProps.push(`${key}=${JSON.stringify(val)}`)
        } else if (typeof val === 'object') {
          const obj = val as Record<string, unknown>
          if ('js' in obj) {
            const expr = resolveUuidsInExpr(String(obj.js), uuidMap)
            jsxProps.push(`${key}={() => ${expr}}`)
          } else {
            jsxProps.push(`${key}={${JSON.stringify(val)}}`)
          }
        }
      }
    }
  }

  // condition — do NOT emit as prop here; handled below via <Show> wrapper

  // key
  if (node.key != null) {
    const keyVal = String(node.key)
    jsxProps.push(`key={${resolveUuidsInExpr(keyVal, uuidMap)}}`)
  }

  // actions → onClick / onChange / onSubmit using new Action factories (run/set/when)
  if (Array.isArray(node.actions)) {
    for (const action of node.actions) {
      const trigger = action.trigger ?? 'click'
      const wfId = action.workflowId ?? action.action ?? ''
      const wfName = uuidMap.workflows.get(wfId) ?? wfId
      const params = action.params as Record<string, unknown> | undefined
      const propName = triggerToPropName(trigger, tagName)

      if (params && Object.keys(params).length > 0) {
        const argEntries = Object.entries(params).map(([k, v]) => {
          if (typeof v === 'object' && v !== null && 'js' in (v as object)) {
            const jsStr = resolveUuidsInExpr(String((v as Record<string, unknown>).js), uuidMap)
            return `${k}: () => ${jsStr}`
          }
          return `${k}: ${JSON.stringify(v)}`
        }).join(', ')
        jsxProps.push(`${propName}={run(${wfName}, { ${argEntries} })}`)
      } else {
        jsxProps.push(`${propName}={run(${wfName})}`)
      }
    }
  }

  // animation (re-emit verbatim)
  if (node.animation != null) {
    jsxProps.push(`animation={${JSON.stringify(node.animation)}}`)
  }

  // responsive breakpoints
  if (node.responsive) {
    for (const [bp, bpVal] of Object.entries(node.responsive)) {
      const dslBp = internalBpToDsl(bp)
      if (bpVal.styles && Object.keys(bpVal.styles).length > 0) {
        jsxProps.push(`${dslBp}={${JSON.stringify(bpVal.styles)}}`)
      }
    }
  }

  // Handle REPEAT/map field → <For each={() => arr}>{(item) => <JSX/>}</For>
  if (node.map != null) {
    const mapCfg = node.map
    let arrExpr: string
    let asName: string
    let keyField: string | undefined

    if (typeof mapCfg === 'string') {
      arrExpr = resolveUuidsInExpr(mapCfg, uuidMap)
      asName = 'item'
    } else {
      const js = mapCfg.js ?? mapCfg.formula ?? ''
      arrExpr = resolveUuidsInExpr(js, uuidMap)
      asName = mapCfg.as ?? 'item'
      keyField = mapCfg.key ?? mapCfg.keyField
    }

    // Strip the map from the inner node
    const innerNode = { ...node }
    delete (innerNode as { map?: unknown }).map
    delete (innerNode as { key?: unknown }).key

    const innerJsx = nodeToJsx(innerNode, uuidMap, depth + 2, knownScNames)
    const keyAttr = keyField ? ` key="${keyField}"` : ''

    return [
      `${pad}<For each={() => ${arrExpr}}${keyAttr}>`,
      `${childPad}{(${asName}) => (`,
      innerJsx,
      `${childPad})}`,
      `${pad}</For>`,
    ].join('\n')
  }

  // Build children
  const children: string[] = []

  // Text content
  if (node.text != null) {
    if (typeof node.text === 'string') {
      children.push(node.text)
    } else if (typeof node.text === 'object') {
      const obj = node.text as Record<string, unknown>
      if ('js' in obj) {
        const expr = resolveUuidsInExpr(String(obj.js), uuidMap)
        // Simple var reference: just emit {varName}
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(expr.trim())) {
          children.push(`{${expr}}`)
        } else {
          children.push(`{() => ${expr}}`)
        }
      }
    }
  }

  // Child nodes
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      children.push(nodeToJsx(child, uuidMap, depth + 1, knownScNames))
    }
  }

  // Render the element JSX
  const propsStr = jsxProps.length > 0 ? ' ' + jsxProps.join(' ') : ''

  let elementJsx: string
  if (children.length === 0) {
    elementJsx = `${pad}<${tagName}${propsStr} />`
  } else if (children.length === 1 && !children[0].includes('\n') && children[0].length < 80) {
    const child = children[0].trim()
    elementJsx = `${pad}<${tagName}${propsStr}>${child}</${tagName}>`
  } else {
    const childrenStr = children.map(c => {
      if (c.startsWith(childPad) || c.startsWith('{')) return c
      return childPad + c.trim()
    }).join('\n')
    elementJsx = `${pad}<${tagName}${propsStr}>\n${childrenStr}\n${pad}</${tagName}>`
  }

  // Wrap with <Show> if node has a condition
  if (node.condition != null) {
    const cond = typeof node.condition === 'object' && node.condition !== null && 'js' in (node.condition as object)
      ? resolveUuidsInExpr(String((node.condition as Record<string, unknown>).js), uuidMap)
      : resolveUuidsInExpr(String(node.condition), uuidMap)
    const innerIndented = elementJsx.split('\n').map(l => '  ' + l).join('\n')
    elementJsx = `${pad}<Show when={() => ${cond}}>\n${innerIndented}\n${pad}</Show>`
  }

  // Prepend locals[] as const declarations if present
  if (Array.isArray(node.locals) && node.locals.length > 0) {
    const localsStr = node.locals.map(({ name, js }: { name: string; js: string }) =>
      `${pad}const ${name} = ${resolveUuidsInExpr(js, uuidMap)}`
    ).join('\n')
    return `${localsStr}\n${elementJsx}`
  }

  return elementJsx
}

function formatProp(key: string, val: PropValue): string {
  if (typeof val === 'boolean' && val) return key
  if (typeof val === 'boolean') return `${key}={false}`
  if (typeof val === 'number') return `${key}={${val}}`
  if (typeof val === 'string') return `${key}=${JSON.stringify(val)}`
  if (typeof val === 'object' && 'formula' in val) {
    const expr = val.formula
    // Single-expression arrow function
    return `${key}={() => ${expr}}`
  }
  return `${key}={${JSON.stringify(val)}}`
}

function triggerToPropName(trigger: string, tagName: string): string {
  // SC trigger names that use onPress
  if (trigger === 'press' || (trigger === 'click' && tagName !== 'Box' && tagName !== 'Text' && tagName !== 'Image')) {
    return 'onPress'
  }
  const map: Record<string, string> = {
    click: 'onClick',
    change: 'onChange',
    submit: 'onSubmit',
    keyDown: 'onKeyDown',
    blur: 'onBlur',
    focus: 'onFocus',
    press: 'onPress',
  }
  return map[trigger] ?? `on${trigger.charAt(0).toUpperCase()}${trigger.slice(1)}`
}

function internalBpToDsl(bp: string): string {
  const map: Record<string, string> = { laptop: 'xl', tablet: 'lg', mobile: 'md' }
  return map[bp] ?? bp
}
