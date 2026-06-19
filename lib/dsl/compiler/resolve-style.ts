/**
 * Shared style-resolver utilities used by both the DSL compiler (compile-page.ts)
 * and the file-agent (agent.ts).
 *
 * Converts SxProps / StyleParams shorthand keys to:
 *   - props.className  — Tailwind utility string for static values
 *   - props.style      — camelCase CSS object for dynamic { formula } values
 */

export type BreakpointKey = 'laptop' | 'tablet' | 'mobile'
export type ResponsiveStyles = Partial<Record<BreakpointKey, Record<string, string>>>

export const RESPONSIVE_BPS: BreakpointKey[] = ['laptop', 'tablet', 'mobile']

export const SHORTHAND_KEYS = new Set([
  'display','direction','items','justify','self','wrap','flex1','flex',
  'gridCols','gridRows','gridFlow','colSpan','colSpanFull','rowSpan',
  'gap','gapX','gapY',
  'w','h','minW','maxW','minH','maxH',
  'p','px','py','pt','pr','pb','pl',
  'm','mx','my','mt','mr','mb','ml',
  'bg','text','weight','leading','tracking','textAlign','textColor',
  'textDecoration','textTransform','textOverflow','whitespace','wordBreak',
  'border','borderStyle','borderColor',
  'radius','radiusTL','radiusTR','radiusBR','radiusBL',
  'position','inset0','top','right','bottom','left','z',
  'overflow','cursor','opacity','objectFit','extra',
])

/** Maps shorthand keys to camelCase CSS for dynamic formula values. */
export const SHORTHAND_FORMULA_CSS_MAP: Record<string, { cssKey: string; wrapExpr?: (e: string) => string }> = {
  bg:           { cssKey: 'backgroundColor' },
  textColor:    { cssKey: 'color' },
  radius:       { cssKey: 'borderRadius',             wrapExpr: e => `(${e}) + 'px'` },
  radiusTL:     { cssKey: 'borderTopLeftRadius',      wrapExpr: e => `(${e}) + 'px'` },
  radiusTR:     { cssKey: 'borderTopRightRadius',     wrapExpr: e => `(${e}) + 'px'` },
  radiusBR:     { cssKey: 'borderBottomRightRadius',  wrapExpr: e => `(${e}) + 'px'` },
  radiusBL:     { cssKey: 'borderBottomLeftRadius',   wrapExpr: e => `(${e}) + 'px'` },
  border:       { cssKey: 'borderWidth',              wrapExpr: e => `(${e}) + 'px'` },
  borderColor:  { cssKey: 'borderColor' },
  opacity:      { cssKey: 'opacity' },
  colSpan:      { cssKey: 'gridColumn',               wrapExpr: e => `'span ' + (${e})` },
  gridCols:     { cssKey: 'gridTemplateColumns',      wrapExpr: e => `'repeat(' + (${e}) + ', minmax(0, 1fr))'` },
  w:            { cssKey: 'width' },
  h:            { cssKey: 'height' },
  minW:         { cssKey: 'minWidth' },
  maxW:         { cssKey: 'maxWidth' },
  minH:         { cssKey: 'minHeight' },
  maxH:         { cssKey: 'maxHeight' },
  text:         { cssKey: 'fontSize',                 wrapExpr: e => `(${e}) + 'px'` },
  top:          { cssKey: 'top',                      wrapExpr: e => `(${e}) + 'px'` },
  right:        { cssKey: 'right',                    wrapExpr: e => `(${e}) + 'px'` },
  bottom:       { cssKey: 'bottom',                   wrapExpr: e => `(${e}) + 'px'` },
  left:         { cssKey: 'left',                     wrapExpr: e => `(${e}) + 'px'` },
  z:            { cssKey: 'zIndex' },
  p:            { cssKey: 'padding',                  wrapExpr: e => `(${e}) + 'px'` },
  px:           { cssKey: 'paddingInline',            wrapExpr: e => `(${e}) + 'px'` },
  py:           { cssKey: 'paddingBlock',             wrapExpr: e => `(${e}) + 'px'` },
  pt:           { cssKey: 'paddingTop',               wrapExpr: e => `(${e}) + 'px'` },
  pr:           { cssKey: 'paddingRight',             wrapExpr: e => `(${e}) + 'px'` },
  pb:           { cssKey: 'paddingBottom',            wrapExpr: e => `(${e}) + 'px'` },
  pl:           { cssKey: 'paddingLeft',              wrapExpr: e => `(${e}) + 'px'` },
  m:            { cssKey: 'margin',                   wrapExpr: e => `(${e}) + 'px'` },
  mx:           { cssKey: 'marginInline',             wrapExpr: e => `(${e}) + 'px'` },
  my:           { cssKey: 'marginBlock',              wrapExpr: e => `(${e}) + 'px'` },
  mt:           { cssKey: 'marginTop',                wrapExpr: e => `(${e}) + 'px'` },
  mr:           { cssKey: 'marginRight',              wrapExpr: e => `(${e}) + 'px'` },
  mb:           { cssKey: 'marginBottom',             wrapExpr: e => `(${e}) + 'px'` },
  ml:           { cssKey: 'marginLeft',               wrapExpr: e => `(${e}) + 'px'` },
  gap:          { cssKey: 'gap',                      wrapExpr: e => `(${e}) + 'px'` },
  gapX:         { cssKey: 'columnGap',                wrapExpr: e => `(${e}) + 'px'` },
  gapY:         { cssKey: 'rowGap',                   wrapExpr: e => `(${e}) + 'px'` },
  overflow:     { cssKey: 'overflow' },
  cursor:       { cssKey: 'cursor' },
  position:     { cssKey: 'position' },
  display:      { cssKey: 'display' },
  direction:    { cssKey: 'flexDirection' },
  items:        { cssKey: 'alignItems' },
  justify:      { cssKey: 'justifyContent' },
  weight:       { cssKey: 'fontWeight' },
  textAlign:    { cssKey: 'textAlign' },
  tracking:     { cssKey: 'letterSpacing' },
  leading:      { cssKey: 'lineHeight' },
}

/** Expand a shorthand key + static value to camelCase CSS properties (used for responsive breakpoints). */
export function styleKeyToCssProps(key: string, val: unknown): Record<string, string> {
  if (val == null) return {}
  const px = (v: unknown) => `${v}px`
  const sizeVal = (v: unknown): string => {
    if (v === 'full') return '100%'
    if (v === 'screen') return (key === 'h' || key === 'minH' || key === 'maxH') ? '100vh' : '100vw'
    if (v === 'fit') return 'fit-content'
    if (v === 'auto') return 'auto'
    if (typeof v === 'string' && /[a-z%]$/i.test(v)) return v
    return `${v}px`
  }
  switch (key) {
    case 'text':      return { fontSize: px(val) }
    case 'w':         return { width: sizeVal(val) }
    case 'h':         return { height: sizeVal(val) }
    case 'minW':      return { minWidth: sizeVal(val) }
    case 'maxW':      return { maxWidth: sizeVal(val) }
    case 'minH':      return { minHeight: sizeVal(val) }
    case 'maxH':      return { maxHeight: sizeVal(val) }
    case 'p':         return { paddingTop: px(val), paddingRight: px(val), paddingBottom: px(val), paddingLeft: px(val) }
    case 'px':        return { paddingLeft: px(val), paddingRight: px(val) }
    case 'py':        return { paddingTop: px(val), paddingBottom: px(val) }
    case 'pt':        return { paddingTop: px(val) }
    case 'pr':        return { paddingRight: px(val) }
    case 'pb':        return { paddingBottom: px(val) }
    case 'pl':        return { paddingLeft: px(val) }
    case 'm':         return { marginTop: px(val), marginRight: px(val), marginBottom: px(val), marginLeft: px(val) }
    case 'mx':        return { marginLeft: px(val), marginRight: px(val) }
    case 'my':        return { marginTop: px(val), marginBottom: px(val) }
    case 'mt':        return { marginTop: px(val) }
    case 'mr':        return { marginRight: px(val) }
    case 'mb':        return { marginBottom: px(val) }
    case 'ml':        return { marginLeft: px(val) }
    case 'gap':       return { gap: px(val) }
    case 'gapX':      return { columnGap: px(val) }
    case 'gapY':      return { rowGap: px(val) }
    case 'display':   return { display: val === 'hidden' ? 'none' : String(val) }
    case 'direction': {
      const v = String(val)
      return { flexDirection: v === 'col' ? 'column' : v === 'col-reverse' ? 'column-reverse' : v }
    }
    case 'items': {
      const v = String(val)
      return { alignItems: v === 'start' ? 'flex-start' : v === 'end' ? 'flex-end' : v }
    }
    case 'justify': {
      const v = String(val)
      const m: Record<string, string> = { start: 'flex-start', end: 'flex-end', between: 'space-between', around: 'space-around', evenly: 'space-evenly' }
      return { justifyContent: m[v] ?? v }
    }
    case 'bg':          return { backgroundColor: String(val) }
    case 'textColor':   return { color: String(val) }
    case 'radius':      return { borderRadius: px(val) }
    case 'border':      return { borderWidth: px(val) }
    case 'borderColor': return { borderColor: String(val) }
    case 'opacity':     return { opacity: String(val) }
    case 'z':           return { zIndex: String(val) }
    case 'top':         return { top: px(val) }
    case 'right':       return { right: px(val) }
    case 'bottom':      return { bottom: px(val) }
    case 'left':        return { left: px(val) }
    case 'gridCols':    return { gridTemplateColumns: `repeat(${val}, minmax(0, 1fr))` }
    case 'position':    return { position: String(val) }
    case 'overflow':    return { overflow: String(val) }
    case 'cursor':      return { cursor: String(val) }
    default:            return {}
  }
}

/**
 * If a value is a responsive object { default?, laptop?, tablet?, mobile? },
 * returns the base value and per-breakpoint overrides.
 * Plain primitives pass through unchanged.
 */
export function unwrapResponsive(val: unknown): { base: unknown; bpOverrides: Partial<Record<BreakpointKey, unknown>> } {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>
    if (RESPONSIVE_BPS.some(k => k in obj) || 'default' in obj) {
      const overrides: Partial<Record<BreakpointKey, unknown>> = {}
      for (const bp of RESPONSIVE_BPS) {
        if (bp in obj) overrides[bp] = obj[bp]
      }
      return { base: 'default' in obj ? obj.default : undefined, bpOverrides: overrides }
    }
  }
  return { base: val, bpOverrides: {} }
}

/**
 * Convert a shorthand style object to a Tailwind className string and optional
 * responsive breakpoint overrides (camelCase CSS per breakpoint).
 *
 * Dynamic values ({ formula } / { js }) are NOT handled here — they must be
 * routed to props.style by the caller via SHORTHAND_FORMULA_CSS_MAP.
 */
export function resolveStyleParams(
  i: Record<string, unknown>,
): { className: string; responsiveStyles: ResponsiveStyles } {
  const tokens: string[] = []
  const responsiveStyles: ResponsiveStyles = {}

  const addBp = (key: string, bpOverrides: Partial<Record<BreakpointKey, unknown>>) => {
    for (const bp of RESPONSIVE_BPS) {
      const v = bpOverrides[bp]
      if (v == null) continue
      const css = styleKeyToCssProps(key, v)
      if (!Object.keys(css).length) continue
      if (!responsiveStyles[bp]) responsiveStyles[bp] = {}
      Object.assign(responsiveStyles[bp]!, css)
    }
  }

  { const { base: v, bpOverrides } = unwrapResponsive(i.display); if (v) tokens.push(String(v)); addBp('display', bpOverrides) }

  { const { base: v, bpOverrides } = unwrapResponsive(i.direction); if (v) tokens.push(`flex-${v}`); addBp('direction', bpOverrides) }
  { const { base: v, bpOverrides } = unwrapResponsive(i.items);     if (v) tokens.push(`items-${v}`); addBp('items', bpOverrides) }
  { const { base: v, bpOverrides } = unwrapResponsive(i.justify);   if (v) tokens.push(`justify-${v}`); addBp('justify', bpOverrides) }
  if (i.self) tokens.push(`self-${i.self}`)
  if (i.wrap) tokens.push(`flex-${i.wrap}`)
  if (i.flex1 || i.flex === 1) tokens.push('flex-1')
  { const { base: v, bpOverrides } = unwrapResponsive(i.gridCols); if (v != null) tokens.push(`grid-cols-${v}`); addBp('gridCols', bpOverrides) }
  if (i.gridRows != null) tokens.push(`grid-rows-${i.gridRows}`)
  if (i.gridFlow) tokens.push(`grid-flow-${i.gridFlow}`)
  if (i.colSpanFull) tokens.push('col-span-full')
  else if (i.colSpan != null) tokens.push(`col-span-${i.colSpan}`)
  if (i.rowSpan != null) tokens.push(`row-span-${i.rowSpan}`)

  { const { base: v, bpOverrides } = unwrapResponsive(i.gap);  if (v != null) tokens.push(`gap-[${v}px]`);   addBp('gap', bpOverrides) }
  { const { base: v, bpOverrides } = unwrapResponsive(i.gapX); if (v != null) tokens.push(`gap-x-[${v}px]`); addBp('gapX', bpOverrides) }
  { const { base: v, bpOverrides } = unwrapResponsive(i.gapY); if (v != null) tokens.push(`gap-y-[${v}px]`); addBp('gapY', bpOverrides) }

  const sizeToken = (prefix: string, val: unknown, cssKey: string) => {
    const { base: v, bpOverrides } = unwrapResponsive(val)
    if (v != null && typeof v !== 'object') {
      if (v === 'full')        tokens.push(`${prefix}-full`)
      else if (v === 'screen') tokens.push(`${prefix}-screen`)
      else if (v === 'fit')    tokens.push(`${prefix}-fit`)
      else if (v === 'auto')   tokens.push(`${prefix}-auto`)
      else if (typeof v === 'string' && /[a-z%]$/i.test(v)) tokens.push(`${prefix}-[${v}]`)
      else tokens.push(`${prefix}-[${v}px]`)
    }
    addBp(cssKey, bpOverrides)
  }
  sizeToken('w', i.w, 'w'); sizeToken('h', i.h, 'h')
  sizeToken('min-w', i.minW, 'minW'); sizeToken('max-w', i.maxW, 'maxW')
  sizeToken('min-h', i.minH, 'minH'); sizeToken('max-h', i.maxH, 'maxH')

  { const { base: v, bpOverrides } = unwrapResponsive(i.p);  if (v != null) tokens.push(`p-[${v}px]`);  addBp('p', bpOverrides) }
  { const { base: v, bpOverrides } = unwrapResponsive(i.px); if (v != null) tokens.push(`px-[${v}px]`); addBp('px', bpOverrides) }
  { const { base: v, bpOverrides } = unwrapResponsive(i.py); if (v != null) tokens.push(`py-[${v}px]`); addBp('py', bpOverrides) }
  { const { base: v, bpOverrides } = unwrapResponsive(i.pt); if (v != null) tokens.push(`pt-[${v}px]`); addBp('pt', bpOverrides) }
  { const { base: v, bpOverrides } = unwrapResponsive(i.pr); if (v != null) tokens.push(`pr-[${v}px]`); addBp('pr', bpOverrides) }
  { const { base: v, bpOverrides } = unwrapResponsive(i.pb); if (v != null) tokens.push(`pb-[${v}px]`); addBp('pb', bpOverrides) }
  { const { base: v, bpOverrides } = unwrapResponsive(i.pl); if (v != null) tokens.push(`pl-[${v}px]`); addBp('pl', bpOverrides) }

  const marginToken = (prefix: string, val: unknown, cssKey: string) => {
    const { base: v, bpOverrides } = unwrapResponsive(val)
    if (v != null) {
      if (v === 'auto') tokens.push(`${prefix}-auto`)
      else tokens.push(`${prefix}-[${v}px]`)
    }
    addBp(cssKey, bpOverrides)
  }
  marginToken('m', i.m, 'm'); marginToken('mx', i.mx, 'mx'); marginToken('my', i.my, 'my')
  marginToken('mt', i.mt, 'mt'); marginToken('mr', i.mr, 'mr'); marginToken('mb', i.mb, 'mb'); marginToken('ml', i.ml, 'ml')

  { const { base: v, bpOverrides } = unwrapResponsive(i.bg); if (v && typeof v !== 'object') tokens.push(`bg-[${v}]`); addBp('bg', bpOverrides) }

  { const { base: v, bpOverrides } = unwrapResponsive(i.text); if (v != null && typeof v !== 'object') tokens.push(`text-[${v}px]`); addBp('text', bpOverrides) }
  if (i.weight && typeof i.weight !== 'object') tokens.push(`font-${i.weight}`)
  if (i.leading && typeof i.leading !== 'object') tokens.push(`leading-${i.leading}`)
  if (i.tracking && typeof i.tracking !== 'object') tokens.push(`tracking-${i.tracking}`)
  if (i.textAlign && typeof i.textAlign !== 'object') tokens.push(`text-${i.textAlign}`)
  { const { base: v, bpOverrides } = unwrapResponsive(i.textColor); if (v && typeof v !== 'object') tokens.push(`!text-[${v}]`); addBp('textColor', bpOverrides) }
  if (i.textDecoration) tokens.push(String(i.textDecoration))
  if (i.textTransform) tokens.push(String(i.textTransform))
  if (i.textOverflow) tokens.push(String(i.textOverflow))
  if (i.whitespace) tokens.push(`whitespace-${i.whitespace}`)
  if (i.wordBreak) tokens.push(`break-${i.wordBreak}`)

  {
    const { base: bv, bpOverrides } = unwrapResponsive(i.border)
    if (bv != null) {
      const bw = Number(bv)
      if (bw === 0) tokens.push('border-0')
      else if ([2, 4, 8].includes(bw)) tokens.push(`border-${bw}`)
      else tokens.push(`border-[${bw}px]`)
    }
    addBp('border', bpOverrides)
  }
  if (i.borderStyle) tokens.push(`border-${i.borderStyle}`)
  { const { base: v, bpOverrides } = unwrapResponsive(i.borderColor); if (v) tokens.push(`border-[${v}]`); addBp('borderColor', bpOverrides) }
  { const { base: v, bpOverrides } = unwrapResponsive(i.radius); if (v != null) tokens.push(`rounded-[${v}px]`); addBp('radius', bpOverrides) }
  if (i.radiusTL != null) tokens.push(`rounded-tl-[${i.radiusTL}px]`)
  if (i.radiusTR != null) tokens.push(`rounded-tr-[${i.radiusTR}px]`)
  if (i.radiusBR != null) tokens.push(`rounded-br-[${i.radiusBR}px]`)
  if (i.radiusBL != null) tokens.push(`rounded-bl-[${i.radiusBL}px]`)

  { const { base: v, bpOverrides } = unwrapResponsive(i.position); if (v) tokens.push(String(v)); addBp('position', bpOverrides) }
  if (i.inset0) tokens.push('inset-0')
  { const { base: v, bpOverrides } = unwrapResponsive(i.top);    if (v != null) tokens.push(`top-[${v}px]`);    addBp('top', bpOverrides) }
  { const { base: v, bpOverrides } = unwrapResponsive(i.right);  if (v != null) tokens.push(`right-[${v}px]`);  addBp('right', bpOverrides) }
  { const { base: v, bpOverrides } = unwrapResponsive(i.bottom); if (v != null) tokens.push(`bottom-[${v}px]`); addBp('bottom', bpOverrides) }
  { const { base: v, bpOverrides } = unwrapResponsive(i.left);   if (v != null) tokens.push(`left-[${v}px]`);   addBp('left', bpOverrides) }
  { const { base: v, bpOverrides } = unwrapResponsive(i.z);      if (v != null) tokens.push(`z-[${v}]`);        addBp('z', bpOverrides) }

  { const { base: v, bpOverrides } = unwrapResponsive(i.overflow); if (v) tokens.push(`overflow-${v}`); addBp('overflow', bpOverrides) }
  if (i.cursor) tokens.push(`cursor-${i.cursor}`)
  { const { base: v, bpOverrides } = unwrapResponsive(i.opacity); if (v != null) tokens.push(`opacity-[${v}]`); addBp('opacity', bpOverrides) }
  if (i.objectFit) tokens.push(`object-${i.objectFit}`)
  if (i.extra) tokens.push(String(i.extra).trim())

  return { className: tokens.filter(Boolean).join(' '), responsiveStyles }
}
