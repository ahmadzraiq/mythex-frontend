/**
 * class-to-props.ts — reverses resolveStyleParams.
 *
 * Converts a Tailwind `className` string back to DSL shorthand props, and strips
 * the JS wrapper from `classFormulas` entries to recover the original formula expression.
 *
 * Output is a map of propName → value (string, number, or arrow function expression).
 */

import { resolveUuidsInExpr, type UuidMap } from './uuid-map'

export type PropValue = string | number | boolean | { formula: string }

/**
 * Parse a Tailwind className string + classFormulas map into DSL shorthand props.
 *
 * @param className  The full className string from the compiled node
 * @param classFormulas  The classFormulas map from the compiled node (raw values per key)
 * @param uuidMap  For resolving variables['uuid'] → varName inside formula strings
 * @param nodeType  'Box' or 'Text' — affects alias selection (size vs text)
 * @returns Record of DSL prop name → value; 'extra' contains any unrecognised tokens
 */
export function classToProps(
  className: string,
  classFormulas: Record<string, unknown> | undefined,
  uuidMap: UuidMap,
  nodeType: string,
): Record<string, PropValue> {
  const props: Record<string, PropValue> = {}
  const tokens = (className ?? '').split(/\s+/).filter(Boolean)
  const remaining: string[] = []

  for (const token of tokens) {
    if (!parseToken(token, props, nodeType)) {
      remaining.push(token)
    }
  }

  if (remaining.length > 0) {
    props.extra = remaining.join(' ')
  }

  // classFormulas: each entry is { js: "rawExpr" } — key is the DSL prop name
  if (classFormulas) {
    for (const [key, fv] of Object.entries(classFormulas)) {
      if (!fv || typeof fv !== 'object') continue
      const obj = fv as Record<string, unknown>
      const expr = String(obj.js ?? obj.formula ?? '')
      if (!expr) continue
      const resolved = resolveUuidsInExpr(expr, uuidMap)
      // Emit as arrow function expression for the DSL
      const propKey = classFormulasKeyToProp(key, nodeType)
      props[propKey] = { formula: resolved }
    }
  }

  return props
}

/** Map classFormulas key → DSL prop name (handling Text aliases) */
function classFormulasKeyToProp(key: string, nodeType: string): string {
  if (nodeType === 'Text') {
    if (key === 'text') return 'size'
    if (key === 'textColor') return 'color'
    if (key === 'textAlign') return 'align'
  }
  return key
}

/** Parse a single Tailwind token into a DSL prop. Returns false if unrecognised. */
function parseToken(token: string, props: Record<string, PropValue>, nodeType: string): boolean {
  // ── Boolean / keyword single-token props ──────────────────────────────────
  if (token === 'flex') { props.display = 'flex'; return true }
  if (token === 'grid') { props.display = 'grid'; return true }
  if (token === 'hidden') { props.display = 'hidden'; return true }
  if (token === 'inline') { props.display = 'inline'; return true }
  if (token === 'block') { props.display = 'block'; return true }
  if (token === 'inline-flex') { props.display = 'inline-flex'; return true }
  if (token === 'contents') { props.display = 'contents'; return true }
  if (token === 'flex-col') { props.direction = 'col'; return true }
  if (token === 'flex-row') { props.direction = 'row'; return true }
  if (token === 'flex-col-reverse') { props.direction = 'col-reverse'; return true }
  if (token === 'flex-row-reverse') { props.direction = 'row-reverse'; return true }
  if (token === 'flex-1') { props.flex1 = true; return true }
  if (token === 'flex-auto') { props.wrap = 'auto'; return true }
  if (token === 'flex-wrap') { props.wrap = 'wrap'; return true }
  if (token === 'flex-nowrap') { props.wrap = 'nowrap'; return true }
  if (token === 'absolute') { props.position = 'absolute'; return true }
  if (token === 'relative') { props.position = 'relative'; return true }
  if (token === 'fixed') { props.position = 'fixed'; return true }
  if (token === 'sticky') { props.position = 'sticky'; return true }
  if (token === 'col-span-full') { props.colSpanFull = true; return true }
  if (token === 'inset-0') { props.inset0 = true; return true }
  if (token === 'uppercase') { props.textTransform = 'uppercase'; return true }
  if (token === 'lowercase') { props.textTransform = 'lowercase'; return true }
  if (token === 'capitalize') { props.textTransform = 'capitalize'; return true }
  if (token === 'truncate') { props.textOverflow = 'truncate'; return true }
  if (token === 'underline') { props.textDecoration = 'underline'; return true }
  if (token === 'line-through') { props.textDecoration = 'line-through'; return true }
  if (token === 'border-solid') { props.borderStyle = 'solid'; return true }
  if (token === 'border-dashed') { props.borderStyle = 'dashed'; return true }
  if (token === 'border-dotted') { props.borderStyle = 'dotted'; return true }
  if (token === 'border-0') { props.border = 0; return true }
  if (token === 'border-2') { props.border = 2; return true }
  if (token === 'border-4') { props.border = 4; return true }
  if (token === 'border-8') { props.border = 8; return true }

  // ── Prefixed keyword props ─────────────────────────────────────────────────
  const m = (re: RegExp) => token.match(re)
  let match: RegExpMatchArray | null = null

  if ((match = m(/^items-(.+)$/))) { props.items = match[1]; return true }
  if ((match = m(/^justify-(.+)$/))) { props.justify = match[1]; return true }
  if ((match = m(/^self-(.+)$/))) { props.self = match[1]; return true }
  if ((match = m(/^overflow-(.+)$/))) { props.overflow = match[1]; return true }
  if ((match = m(/^cursor-(.+)$/))) { props.cursor = match[1]; return true }
  if ((match = m(/^object-(.+)$/))) { props.objectFit = match[1]; return true }
  if ((match = m(/^font-(.+)$/))) { props.weight = match[1]; return true }
  if ((match = m(/^leading-(.+)$/))) { props.leading = match[1]; return true }
  if ((match = m(/^tracking-(.+)$/))) { props.tracking = match[1]; return true }
  if ((match = m(/^whitespace-(.+)$/))) { props.whitespace = match[1]; return true }
  if ((match = m(/^break-(.+)$/))) { props.wordBreak = match[1]; return true }
  if ((match = m(/^grid-cols-(.+)$/))) { props.gridCols = isNaN(Number(match[1])) ? match[1] : Number(match[1]); return true }
  if ((match = m(/^grid-rows-(.+)$/))) { props.gridRows = isNaN(Number(match[1])) ? match[1] : Number(match[1]); return true }
  if ((match = m(/^grid-flow-(.+)$/))) { props.gridFlow = match[1]; return true }
  if ((match = m(/^col-span-(.+)$/))) { props.colSpan = isNaN(Number(match[1])) ? match[1] : Number(match[1]); return true }
  if ((match = m(/^row-span-(.+)$/))) { props.rowSpan = Number(match[1]) || match[1]; return true }
  if ((match = m(/^shadow-(.+)$/))) { props.shadow = match[1]; return true }
  if (token === 'shadow') { props.shadow = 'DEFAULT'; return true }

  // ── text-left/center/right/justify vs text-[size]px ──────────────────────
  if ((match = m(/^text-(left|center|right|justify)$/))) {
    if (nodeType === 'Text') props.align = match[1]; else props.textAlign = match[1]
    return true
  }

  // ── Arbitrary-value tokens ─────────────────────────────────────────────────
  if ((match = m(/^w-\[(\d+(?:\.\d+)?)px\]$/))) { props.w = Number(match[1]); return true }
  if ((match = m(/^w-(full|screen|fit|auto)$/))) { props.w = match[1]; return true }
  if ((match = m(/^h-\[(\d+(?:\.\d+)?)px\]$/))) { props.h = Number(match[1]); return true }
  if ((match = m(/^h-(full|screen|fit|auto)$/))) { props.h = match[1]; return true }
  if ((match = m(/^min-w-\[(.+)\]$/))) { props.minW = stripPx(match[1]); return true }
  if ((match = m(/^max-w-\[(.+)\]$/))) { props.maxW = stripPx(match[1]); return true }
  if ((match = m(/^min-h-\[(.+)\]$/))) { props.minH = stripPx(match[1]); return true }
  if ((match = m(/^max-h-\[(.+)\]$/))) { props.maxH = stripPx(match[1]); return true }
  if ((match = m(/^p-\[(\d+(?:\.\d+)?)px\]$/))) { props.p = Number(match[1]); return true }
  if ((match = m(/^px-\[(\d+(?:\.\d+)?)px\]$/))) { props.px = Number(match[1]); return true }
  if ((match = m(/^py-\[(\d+(?:\.\d+)?)px\]$/))) { props.py = Number(match[1]); return true }
  if ((match = m(/^pt-\[(\d+(?:\.\d+)?)px\]$/))) { props.pt = Number(match[1]); return true }
  if ((match = m(/^pr-\[(\d+(?:\.\d+)?)px\]$/))) { props.pr = Number(match[1]); return true }
  if ((match = m(/^pb-\[(\d+(?:\.\d+)?)px\]$/))) { props.pb = Number(match[1]); return true }
  if ((match = m(/^pl-\[(\d+(?:\.\d+)?)px\]$/))) { props.pl = Number(match[1]); return true }
  if ((match = m(/^m-\[(\d+(?:\.\d+)?)px\]$/))) { props.m = Number(match[1]); return true }
  if ((match = m(/^mx-\[(\d+(?:\.\d+)?)px\]$/))) { props.mx = Number(match[1]); return true }
  if ((match = m(/^my-\[(\d+(?:\.\d+)?)px\]$/))) { props.my = Number(match[1]); return true }
  if ((match = m(/^mt-\[(\d+(?:\.\d+)?)px\]$/))) { props.mt = Number(match[1]); return true }
  if ((match = m(/^mr-\[(\d+(?:\.\d+)?)px\]$/))) { props.mr = Number(match[1]); return true }
  if ((match = m(/^mb-\[(\d+(?:\.\d+)?)px\]$/))) { props.mb = Number(match[1]); return true }
  if ((match = m(/^ml-\[(\d+(?:\.\d+)?)px\]$/))) { props.ml = Number(match[1]); return true }
  if ((match = m(/^m-(auto)$/))) { props.m = 'auto'; return true }
  if ((match = m(/^mx-(auto)$/))) { props.mx = 'auto'; return true }
  if ((match = m(/^my-(auto)$/))) { props.my = 'auto'; return true }
  if ((match = m(/^gap-x-\[(\d+(?:\.\d+)?)px\]$/))) { props.gapX = Number(match[1]); return true }
  if ((match = m(/^gap-y-\[(\d+(?:\.\d+)?)px\]$/))) { props.gapY = Number(match[1]); return true }
  if ((match = m(/^gap-\[(\d+(?:\.\d+)?)px\]$/))) { props.gap = Number(match[1]); return true }
  if ((match = m(/^top-\[(\d+(?:\.\d+)?)px\]$/))) { props.top = Number(match[1]); return true }
  if ((match = m(/^right-\[(\d+(?:\.\d+)?)px\]$/))) { props.right = Number(match[1]); return true }
  if ((match = m(/^bottom-\[(\d+(?:\.\d+)?)px\]$/))) { props.bottom = Number(match[1]); return true }
  if ((match = m(/^left-\[(\d+(?:\.\d+)?)px\]$/))) { props.left = Number(match[1]); return true }
  if ((match = m(/^z-\[(\d+)\]$/))) { props.z = Number(match[1]); return true }
  if ((match = m(/^opacity-\[(.+)\]$/))) { props.opacity = Number(match[1]) || match[1]; return true }
  if ((match = m(/^rounded-\[(\d+(?:\.\d+)?)px\]$/))) { props.radius = Number(match[1]); return true }
  if ((match = m(/^rounded-tl-\[(\d+(?:\.\d+)?)px\]$/))) { props.radiusTL = Number(match[1]); return true }
  if ((match = m(/^rounded-tr-\[(\d+(?:\.\d+)?)px\]$/))) { props.radiusTR = Number(match[1]); return true }
  if ((match = m(/^rounded-br-\[(\d+(?:\.\d+)?)px\]$/))) { props.radiusBR = Number(match[1]); return true }
  if ((match = m(/^rounded-bl-\[(\d+(?:\.\d+)?)px\]$/))) { props.radiusBL = Number(match[1]); return true }
  if ((match = m(/^rounded-(.+)$/))) { props.radius = match[1]; return true }
  if ((match = m(/^border-\[(\d+(?:\.\d+)?)px\]$/))) { props.border = Number(match[1]); return true }
  if ((match = m(/^border-\[(.+)\]$/))) { props.borderColor = match[1]; return true }

  // bg-[value]
  if ((match = m(/^bg-\[(.+)\]$/))) { props.bg = match[1]; return true }

  // text-[px]px (font size) vs !text-[color]
  if ((match = m(/^!text-\[(.+)\]$/))) {
    if (nodeType === 'Text') props.color = match[1]; else props.textColor = match[1]
    return true
  }
  if ((match = m(/^text-\[(\d+(?:\.\d+)?)px\]$/))) {
    if (nodeType === 'Text') props.size = Number(match[1]); else props.text = Number(match[1])
    return true
  }

  return false
}

function stripPx(val: string): string | number {
  if (val.endsWith('px')) {
    const n = Number(val.slice(0, -2))
    if (!isNaN(n)) return n
  }
  return val
}
