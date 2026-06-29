/**
 * Shared style-resolution utilities used by both the file-agent and the json-agent.
 *
 * Converts flat SxProps (written by the SDK agent like builder.ts) into
 * the className + node.responsive shape the rendering engine expects.
 *
 * Source of truth for the shorthand key set and Tailwind token generation.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type BreakpointKey = 'laptop' | 'tablet' | 'mobile';
type ResponsiveStyles = Partial<Record<BreakpointKey, Record<string, string>>>;

const RESPONSIVE_BPS: BreakpointKey[] = ['laptop', 'tablet', 'mobile'];

/** Maps DSL-facing Tailwind-style names (md/lg/xl) to internal engine keys. */
const DSL_BP_TO_INTERNAL: Record<string, BreakpointKey> = {
  md: 'mobile', lg: 'tablet', xl: 'laptop',
  mobile: 'mobile', tablet: 'tablet', laptop: 'laptop',
};

// ─── Shorthand key set ────────────────────────────────────────────────────────

/** All shorthand keys the resolver knows about. */
export const SHORTHAND_KEYS = new Set([
  'display', 'direction', 'items', 'justify', 'self', 'wrap', 'flex1', 'flex',
  'gridCols', 'gridRows', 'gridFlow', 'colSpan', 'colSpanFull', 'rowSpan',
  'gap', 'gapX', 'gapY',
  'w', 'h', 'minW', 'maxW', 'minH', 'maxH',
  'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl',
  'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml',
  'bg', 'text', 'weight', 'leading', 'tracking', 'textAlign', 'textColor',
  'textDecoration', 'textTransform', 'textOverflow', 'whitespace', 'wordBreak',
  'border', 'borderStyle', 'borderColor',
  'radius', 'radiusTL', 'radiusTR', 'radiusBR', 'radiusBL',
  'position', 'inset0', 'top', 'right', 'bottom', 'left', 'z',
  'overflow', 'cursor', 'opacity', 'objectFit', 'shadow',
]);

/** builder.ts convenience aliases that expand to core SxProps keys. */
const ALIAS_KEYS = new Set([
  'col', 'row', 'grid', 'center', 'absolute', 'relative', 'fixed', 'sticky',
  'size', 'color', 'align', 'uppercase', 'lowercase', 'cols', 'flex1',
]);

// ─── Dynamic { js } routing map ───────────────────────────────────────────────

/** For dynamic `{ js: "..." }` values on shorthand keys: maps to the CSS property
 *  name and an optional expression wrapper, so the renderer can evaluate them. */
export const SHORTHAND_JS_CSS_MAP: Record<string, { cssKey: string; wrapJs?: (expr: string) => string }> = {
  bg:           { cssKey: 'backgroundColor' },
  textColor:    { cssKey: 'color' },
  radius:       { cssKey: 'borderRadius',             wrapJs: e => `(${e}) + 'px'` },
  radiusTL:     { cssKey: 'borderTopLeftRadius',      wrapJs: e => `(${e}) + 'px'` },
  radiusTR:     { cssKey: 'borderTopRightRadius',     wrapJs: e => `(${e}) + 'px'` },
  radiusBR:     { cssKey: 'borderBottomRightRadius',  wrapJs: e => `(${e}) + 'px'` },
  radiusBL:     { cssKey: 'borderBottomLeftRadius',   wrapJs: e => `(${e}) + 'px'` },
  border:       { cssKey: 'borderWidth',              wrapJs: e => `(${e}) + 'px'` },
  borderColor:  { cssKey: 'borderColor' },
  opacity:      { cssKey: 'opacity' },
  colSpan:      { cssKey: 'gridColumn',               wrapJs: e => `'span ' + (${e})` },
  gridCols:     { cssKey: 'gridTemplateColumns',      wrapJs: e => `'repeat(' + (${e}) + ', minmax(0, 1fr))'` },
  w:            { cssKey: 'width' },
  h:            { cssKey: 'height' },
  minW:         { cssKey: 'minWidth' },
  maxW:         { cssKey: 'maxWidth' },
  minH:         { cssKey: 'minHeight' },
  maxH:         { cssKey: 'maxHeight' },
  text:         { cssKey: 'fontSize',                 wrapJs: e => `(${e}) + 'px'` },
  top:          { cssKey: 'top',                      wrapJs: e => `(${e}) + 'px'` },
  right:        { cssKey: 'right',                    wrapJs: e => `(${e}) + 'px'` },
  bottom:       { cssKey: 'bottom',                   wrapJs: e => `(${e}) + 'px'` },
  left:         { cssKey: 'left',                     wrapJs: e => `(${e}) + 'px'` },
  z:            { cssKey: 'zIndex' },
  p:            { cssKey: 'padding',                  wrapJs: e => `(${e}) + 'px'` },
  px:           { cssKey: 'paddingInline',             wrapJs: e => `(${e}) + 'px'` },
  py:           { cssKey: 'paddingBlock',              wrapJs: e => `(${e}) + 'px'` },
  pt:           { cssKey: 'paddingTop',                wrapJs: e => `(${e}) + 'px'` },
  pr:           { cssKey: 'paddingRight',              wrapJs: e => `(${e}) + 'px'` },
  pb:           { cssKey: 'paddingBottom',             wrapJs: e => `(${e}) + 'px'` },
  pl:           { cssKey: 'paddingLeft',               wrapJs: e => `(${e}) + 'px'` },
  m:            { cssKey: 'margin',                   wrapJs: e => `(${e}) + 'px'` },
  mx:           { cssKey: 'marginInline',              wrapJs: e => `(${e}) + 'px'` },
  my:           { cssKey: 'marginBlock',               wrapJs: e => `(${e}) + 'px'` },
  mt:           { cssKey: 'marginTop',                 wrapJs: e => `(${e}) + 'px'` },
  mr:           { cssKey: 'marginRight',               wrapJs: e => `(${e}) + 'px'` },
  mb:           { cssKey: 'marginBottom',              wrapJs: e => `(${e}) + 'px'` },
  ml:           { cssKey: 'marginLeft',                wrapJs: e => `(${e}) + 'px'` },
  gap:          { cssKey: 'gap',                      wrapJs: e => `(${e}) + 'px'` },
  gapX:         { cssKey: 'columnGap',                wrapJs: e => `(${e}) + 'px'` },
  gapY:         { cssKey: 'rowGap',                   wrapJs: e => `(${e}) + 'px'` },
  overflow:     { cssKey: 'overflow' },
  cursor:       { cssKey: 'cursor' },
  position:     { cssKey: 'position' },
  // ── Layout / flex / grid — needed for dynamic { js } bindings ─────────────
  justify:      { cssKey: 'justifyContent' },
  items:        { cssKey: 'alignItems' },
  self:         { cssKey: 'alignSelf' },
  display:      { cssKey: 'display' },
  direction:    { cssKey: 'flexDirection' },
  wrap:         { cssKey: 'flexWrap' },
  shadow:       { cssKey: 'boxShadow' },
  objectFit:    { cssKey: 'objectFit' },
  textAlign:    { cssKey: 'textAlign' },
  gridRows:     { cssKey: 'gridTemplateRows', wrapJs: e => `'repeat(' + (${e}) + ', minmax(0, 1fr))'` },
  gridFlow:     { cssKey: 'gridAutoFlow' },
  rowSpan:      { cssKey: 'gridRow',          wrapJs: e => `'span ' + (${e})` },
  // ── Text styling — needed for dynamic { js } bindings ─────────────────────
  weight:         { cssKey: 'fontWeight' },
  leading:        { cssKey: 'lineHeight' },
  tracking:       { cssKey: 'letterSpacing' },
  textDecoration: { cssKey: 'textDecoration' },
  textTransform:  { cssKey: 'textTransform' },
  borderStyle:    { cssKey: 'borderStyle' },
  whitespace:     { cssKey: 'whiteSpace' },
  wordBreak:      { cssKey: 'wordBreak' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isJsObj = (v: unknown): v is { js: string } =>
  typeof v === 'object' && v !== null && 'js' in (v as object) &&
  typeof (v as Record<string, unknown>).js === 'string';

/**
 * Unwrap a responsive value object `{ default, lg, md, xl }` into base + overrides.
 * Plain primitives (strings/numbers/booleans) pass through unchanged.
 */
function unwrapResponsive(val: unknown): {
  base: unknown;
  bpOverrides: Partial<Record<BreakpointKey, unknown>>;
} {
  if (val && typeof val === 'object' && !Array.isArray(val) && !isJsObj(val)) {
    const obj = val as Record<string, unknown>;
    const dslKeys = Object.keys(DSL_BP_TO_INTERNAL);
    if (dslKeys.some(k => k in obj) || 'default' in obj) {
      const overrides: Partial<Record<BreakpointKey, unknown>> = {};
      for (const [dslKey, internalKey] of Object.entries(DSL_BP_TO_INTERNAL)) {
        if (dslKey in obj) overrides[internalKey] = obj[dslKey];
      }
      return { base: 'default' in obj ? obj.default : undefined, bpOverrides: overrides };
    }
  }
  return { base: val, bpOverrides: {} };
}

/** Expand a single shorthand key + value into camelCase CSS for responsive output. */
export function styleKeyToCssProps(key: string, val: unknown): Record<string, string> {
  if (val == null) return {};
  const px = (v: unknown) => `${v}px`;
  const sizeVal = (v: unknown): string => {
    if (v === 'full')   return '100%';
    if (v === 'screen') return (key === 'h' || key === 'minH' || key === 'maxH') ? '100vh' : '100vw';
    if (v === 'fit')    return 'fit-content';
    if (v === 'auto')   return 'auto';
    if (typeof v === 'string' && /[a-z%]$/i.test(v)) return v;
    return `${v}px`;
  };
  switch (key) {
    case 'text':      return { fontSize: px(val) };
    case 'w':         return { width: sizeVal(val) };
    case 'h':         return { height: sizeVal(val) };
    case 'minW':      return { minWidth: sizeVal(val) };
    case 'maxW':      return { maxWidth: sizeVal(val) };
    case 'minH':      return { minHeight: sizeVal(val) };
    case 'maxH':      return { maxHeight: sizeVal(val) };
    case 'p':         return { paddingTop: px(val), paddingRight: px(val), paddingBottom: px(val), paddingLeft: px(val) };
    case 'px':        return { paddingLeft: px(val), paddingRight: px(val) };
    case 'py':        return { paddingTop: px(val), paddingBottom: px(val) };
    case 'pt':        return { paddingTop: px(val) };
    case 'pr':        return { paddingRight: px(val) };
    case 'pb':        return { paddingBottom: px(val) };
    case 'pl':        return { paddingLeft: px(val) };
    case 'm':         return { marginTop: px(val), marginRight: px(val), marginBottom: px(val), marginLeft: px(val) };
    case 'mx':        return { marginLeft: px(val), marginRight: px(val) };
    case 'my':        return { marginTop: px(val), marginBottom: px(val) };
    case 'mt':        return { marginTop: px(val) };
    case 'mr':        return { marginRight: px(val) };
    case 'mb':        return { marginBottom: px(val) };
    case 'ml':        return { marginLeft: px(val) };
    case 'gap':       return { gap: px(val) };
    case 'gapX':      return { columnGap: px(val) };
    case 'gapY':      return { rowGap: px(val) };
    case 'display':   return { display: val === 'hidden' ? 'none' : String(val) };
    case 'direction': {
      const v = String(val);
      return { flexDirection: v === 'col' ? 'column' : v === 'col-reverse' ? 'column-reverse' : v };
    }
    case 'items': {
      const v = String(val);
      return { alignItems: v === 'start' ? 'flex-start' : v === 'end' ? 'flex-end' : v };
    }
    case 'justify': {
      const v = String(val);
      const m: Record<string, string> = { start: 'flex-start', end: 'flex-end', between: 'space-between', around: 'space-around', evenly: 'space-evenly' };
      return { justifyContent: m[v] ?? v };
    }
    case 'bg':          return { backgroundColor: String(val) };
    case 'textColor':   return { color: String(val) };
    case 'radius':      return { borderRadius: px(val) };
    case 'border':      return { borderWidth: px(val) };
    case 'borderColor': return { borderColor: String(val) };
    case 'opacity':     return { opacity: String(val) };
    case 'z':           return { zIndex: String(val) };
    case 'top':         return { top: px(val) };
    case 'right':       return { right: px(val) };
    case 'bottom':      return { bottom: px(val) };
    case 'left':        return { left: px(val) };
    case 'gridCols':    return { gridTemplateColumns: `repeat(${val}, minmax(0, 1fr))` };
    case 'position':    return { position: String(val) };
    case 'overflow':    return { overflow: String(val) };
    case 'cursor':      return { cursor: String(val) };
    // ── Additional keys missing from the original map ────────────────────────
    case 'self':        return { alignSelf: String(val) };
    case 'wrap':        return { flexWrap: String(val) };
    case 'shadow':      return { boxShadow: String(val) };
    case 'objectFit':   return { objectFit: String(val) };
    case 'textAlign':   return { textAlign: String(val) };
    case 'textDecoration': return { textDecoration: String(val) };
    case 'textTransform':  return { textTransform: String(val) };
    case 'textOverflow':   return { textOverflow: String(val) };
    case 'whitespace':  return { whiteSpace: String(val) };
    case 'wordBreak':   return { wordBreak: String(val) };
    case 'borderStyle': return { borderStyle: String(val) };
    case 'weight':      return { fontWeight: String(val) };
    case 'leading':     return { lineHeight: String(val) };
    case 'tracking':    return { letterSpacing: String(val) };
    case 'radius':      return { borderRadius: px(val) };
    case 'radiusTL':    return { borderTopLeftRadius: px(val) };
    case 'radiusTR':    return { borderTopRightRadius: px(val) };
    case 'radiusBR':    return { borderBottomRightRadius: px(val) };
    case 'radiusBL':    return { borderBottomLeftRadius: px(val) };
    case 'gridRows':    return { gridTemplateRows: `repeat(${val}, minmax(0, 1fr))` };
    case 'gridFlow':    return { gridAutoFlow: String(val) };
    case 'colSpan':     return { gridColumn: `span ${val}` };
    case 'rowSpan':     return { gridRow: `span ${val}` };
    default:            return {};
  }
}

// ─── Alias normalizer ─────────────────────────────────────────────────────────

/**
 * Expand builder.ts convenience aliases into canonical SxProps keys.
 * Modifies `props` in-place and deletes the alias keys.
 */
function normalizeAliases(props: Record<string, unknown>): void {
  if (props.flex === true)      { props.display = props.display ?? 'flex';  delete props.flex; }
  if (props.col === true)       { props.display = props.display ?? 'flex'; props.direction = props.direction ?? 'col';  delete props.col; }
  if (props.row === true)       { props.display = props.display ?? 'flex'; props.direction = props.direction ?? 'row';  delete props.row; }
  if (props.grid === true)      { props.display = props.display ?? 'grid'; delete props.grid; }
  if (props.center === true)    { props.display = props.display ?? 'flex'; props.items = props.items ?? 'center'; props.justify = props.justify ?? 'center'; delete props.center; }
  if (props.absolute === true)  { props.position = 'absolute';  delete props.absolute; }
  if (props.relative === true)  { props.position = 'relative';  delete props.relative; }
  if (props.fixed === true)     { props.position = 'fixed';     delete props.fixed; }
  if (props.sticky === true)    { props.position = 'sticky';    delete props.sticky; }
  if (props.size  != null)      { props.text      = props.size;  delete props.size; }
  if (props.color != null)      { props.textColor = props.color; delete props.color; }
  if (props.align != null)      { props.textAlign = props.align; delete props.align; }
  if (props.uppercase === true) { props.textTransform = 'uppercase'; delete props.uppercase; }
  if (props.lowercase === true) { props.textTransform = 'lowercase'; delete props.lowercase; }
  if (props.cols  != null)      { props.gridCols  = props.cols;  delete props.cols; }
}

// ─── Core resolver ────────────────────────────────────────────────────────────

/**
 * Convert flat SxProps in a node's props object into className + dynamic style.
 *
 * Input:  `props: { p: 20, direction: "col", bg: "#000", textColor: { js: "expr" } }`
 * Output: `props: { className: "p-[20px] flex-col bg-[#000]", style: { color: { js: "expr" } } }`
 *
 * Breakpoint sibling props (`xl/lg/md`) are extracted and returned separately as
 * `responsiveNode[internalBp].styles` — camelCase CSS for the rendering engine.
 *
 * Unrecognised keys (type, src, icon, animation, actions, …) pass through unchanged.
 */
export function resolveNodeProps(rawProps: Record<string, unknown>): {
  props: Record<string, unknown>;
  responsiveNode: Record<string, { styles: Record<string, unknown> }>;
} {
  const props = { ...rawProps };
  normalizeAliases(props);

  const tokens: string[] = [];
  const rawCss: Record<string, unknown> = {};
  const responsiveNode: Record<string, { styles: Record<string, unknown> }> = {};

  // ── Extract xl/lg/md sibling breakpoint props ─────────────────────────────
  // Format: props.lg = { p: 20, bg: "#fff" }  →  responsive['tablet'].styles = { paddingTop: '20px', ... }
  for (const [dslKey, internalBp] of Object.entries(DSL_BP_TO_INTERNAL)) {
    if (!(dslKey in props)) continue;
    const bpVal = props[dslKey];
    delete props[dslKey];
    if (!bpVal || typeof bpVal !== 'object' || Array.isArray(bpVal)) continue;
    const bpStyles = resolveBreakpointSxProps(bpVal as Record<string, unknown>);
    if (Object.keys(bpStyles).length) {
      const existing = responsiveNode[internalBp]?.styles ?? {};
      responsiveNode[internalBp] = { styles: { ...existing, ...bpStyles } };
    }
  }

  // ── Resolve shorthand keys to Tailwind tokens ──────────────────────────────
  for (const key of [...SHORTHAND_KEYS]) {
    if (!(key in props)) continue;
    const val = props[key];
    delete props[key];

    if (isJsObj(val)) {
      // Dynamic { js } binding — route to props.style as a camelCase CSS property
      const mapping = SHORTHAND_JS_CSS_MAP[key];
      if (mapping) {
        const expr = mapping.wrapJs ? mapping.wrapJs(val.js) : val.js;
        rawCss[mapping.cssKey] = { js: expr };
      }
      continue;
    }

    if (val === undefined || val === null) continue;

    switch (key) {
      case 'display':   if (val) tokens.push(val === 'hidden' ? 'hidden' : String(val)); break;
      case 'direction': if (val) tokens.push(`flex-${val}`); break;
      case 'items':     if (val) tokens.push(`items-${val}`); break;
      case 'justify':   if (val) tokens.push(`justify-${val}`); break;
      case 'self':      tokens.push(`self-${val}`); break;
      case 'wrap':      tokens.push(`flex-${val}`); break;
      case 'flex1':     if (val) tokens.push('flex-1'); break;
      case 'flex':      if (val === 1) tokens.push('flex-1'); break;
      case 'gridCols':  tokens.push(`grid-cols-${val}`); break;
      case 'gridRows':  tokens.push(`grid-rows-${val}`); break;
      case 'gridFlow':  tokens.push(`grid-flow-${val}`); break;
      case 'colSpanFull': if (val) tokens.push('col-span-full'); break;
      case 'colSpan':   tokens.push(`col-span-${val}`); break;
      case 'rowSpan':   tokens.push(`row-span-${val}`); break;
      case 'gap':       tokens.push(`gap-[${val}px]`); break;
      case 'gapX':      tokens.push(`gap-x-[${val}px]`); break;
      case 'gapY':      tokens.push(`gap-y-[${val}px]`); break;
      case 'w':         tokens.push(sizeToken('w', val)); break;
      case 'h':         tokens.push(sizeToken('h', val)); break;
      case 'minW':      tokens.push(sizeToken('min-w', val)); break;
      case 'maxW':      tokens.push(sizeToken('max-w', val)); break;
      case 'minH':      tokens.push(sizeToken('min-h', val)); break;
      case 'maxH':      tokens.push(sizeToken('max-h', val)); break;
      case 'p':         tokens.push(`p-[${val}px]`); break;
      case 'px':        tokens.push(`px-[${val}px]`); break;
      case 'py':        tokens.push(`py-[${val}px]`); break;
      case 'pt':        tokens.push(`pt-[${val}px]`); break;
      case 'pr':        tokens.push(`pr-[${val}px]`); break;
      case 'pb':        tokens.push(`pb-[${val}px]`); break;
      case 'pl':        tokens.push(`pl-[${val}px]`); break;
      case 'm':         tokens.push(val === 'auto' ? 'm-auto' : `m-[${val}px]`); break;
      case 'mx':        tokens.push(val === 'auto' ? 'mx-auto' : `mx-[${val}px]`); break;
      case 'my':        tokens.push(val === 'auto' ? 'my-auto' : `my-[${val}px]`); break;
      case 'mt':        tokens.push(`mt-[${val}px]`); break;
      case 'mr':        tokens.push(`mr-[${val}px]`); break;
      case 'mb':        tokens.push(`mb-[${val}px]`); break;
      case 'ml':        tokens.push(`ml-[${val}px]`); break;
      case 'bg':        tokens.push(`bg-[${val}]`); break;
      case 'text':      tokens.push(`text-[${val}px]`); break;
      case 'weight':    tokens.push(`font-${val}`); break;
      case 'leading':   tokens.push(`leading-${val}`); break;
      case 'tracking':  tokens.push(`tracking-${val}`); break;
      case 'textAlign': tokens.push(`text-${val}`); break;
      case 'textColor': tokens.push(`!text-[${val}]`); break;
      case 'textDecoration': tokens.push(String(val)); break;
      case 'textTransform':  tokens.push(String(val)); break;
      case 'textOverflow':   tokens.push(String(val)); break;
      case 'whitespace': tokens.push(`whitespace-${val}`); break;
      case 'wordBreak':  tokens.push(`break-${val}`); break;
      case 'border': {
        const bw = Number(val);
        if (bw === 0)                tokens.push('border-0');
        else if ([2,4,8].includes(bw)) tokens.push(`border-${bw}`);
        else                          tokens.push(`border-[${bw}px]`);
        break;
      }
      case 'borderStyle': tokens.push(`border-${val}`); break;
      case 'borderColor': tokens.push(`border-[${val}]`); break;
      case 'radius':    tokens.push(`rounded-[${val}px]`); break;
      case 'radiusTL':  tokens.push(`rounded-tl-[${val}px]`); break;
      case 'radiusTR':  tokens.push(`rounded-tr-[${val}px]`); break;
      case 'radiusBR':  tokens.push(`rounded-br-[${val}px]`); break;
      case 'radiusBL':  tokens.push(`rounded-bl-[${val}px]`); break;
      case 'position':  if (val) tokens.push(String(val)); break;
      case 'inset0':    if (val) tokens.push('inset-0'); break;
      case 'top':       tokens.push(`top-[${val}px]`); break;
      case 'right':     tokens.push(`right-[${val}px]`); break;
      case 'bottom':    tokens.push(`bottom-[${val}px]`); break;
      case 'left':      tokens.push(`left-[${val}px]`); break;
      case 'z':         tokens.push(`z-[${val}]`); break;
      case 'overflow':  tokens.push(`overflow-${val}`); break;
      case 'cursor':    tokens.push(`cursor-${val}`); break;
      case 'opacity':   tokens.push(`opacity-[${val}]`); break;
      case 'objectFit': tokens.push(`object-${val}`); break;
      case 'shadow':    tokens.push(val === 'none' ? 'shadow-none' : `shadow-${val}`); break;
    }
  }

  // Merge existing className tokens (if any) with resolved tokens
  const existingClassName = typeof props.className === 'string' ? props.className : '';
  delete props.className;
  const finalClassName = [existingClassName, tokens.filter(Boolean).join(' ')].filter(Boolean).join(' ');

  const result: Record<string, unknown> = { ...props };
  if (finalClassName) result.className = finalClassName;
  if (Object.keys(rawCss).length > 0) result.style = rawCss;

  return { props: result, responsiveNode };
}

/**
 * Convert a breakpoint SxProps object to camelCase CSS properties.
 * This is what goes into node.responsive[bp].styles.
 * Mirrors parseBreakpointSx in the DSL compiler.
 */
export function resolveBreakpointSxProps(bpProps: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...bpProps };
  // Apply same alias expansions as normalizeAliases but without mutating booleans to display values
  const aliasMap: Record<string, string> = {
    size: 'text', color: 'textColor', align: 'textAlign', cols: 'gridCols',
  };
  for (const [alias, canonical] of Object.entries(aliasMap)) {
    if (alias in normalized) { normalized[canonical] = normalized[alias]; delete normalized[alias]; }
  }

  const styles: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(normalized)) {
    if (val === undefined || val === null) continue;
    if (isJsObj(val)) {
      const mapping = SHORTHAND_JS_CSS_MAP[key];
      if (mapping) {
        const expr = mapping.wrapJs ? mapping.wrapJs(val.js) : val.js;
        styles[mapping.cssKey] = { js: expr };
      }
      continue;
    }
    const css = styleKeyToCssProps(key, val);
    Object.assign(styles, css);
  }
  return styles;
}

/** Tailwind size token helper. */
function sizeToken(prefix: string, v: unknown): string {
  if (v === 'full')   return `${prefix}-full`;
  if (v === 'screen') return `${prefix}-screen`;
  if (v === 'fit')    return `${prefix}-fit`;
  if (v === 'auto')   return `${prefix}-auto`;
  if (typeof v === 'string' && /[a-z%]$/i.test(v)) return `${prefix}-[${v}]`;
  return `${prefix}-[${v}px]`;
}

// ─── Node-tree resolver ───────────────────────────────────────────────────────

/**
 * Recursively walk a UINode tree, resolve flat SxProps → className on every
 * node, and merge responsive styles into node.responsive[bp].styles.
 *
 * Used in the json-agent PostToolUse hook after validation, before the SSE
 * event is emitted to the client.
 */
export function resolveNodeTree(nodes: unknown[]): unknown[] {
  return nodes.map(resolveNode);
}

function resolveNode(node: unknown): unknown {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
  const n = { ...(node as Record<string, unknown>) };

  // Stamp a stable UUID on any node that the agent left without one.
  // This is the single authoritative place for node ID assignment — the
  // client must never patch IDs after receiving the resolved tree.
  if (!n.id) {
    n.id = crypto.randomUUID();
  }

  if (n.props && typeof n.props === 'object' && !Array.isArray(n.props)) {
    const rawProps = n.props as Record<string, unknown>;

    // Icon nodes use `size` and `color` as direct component props (not SxProps):
    //   size  → sets width/height on the <img> element
    //   color → used in the Iconify CDN URL (?color=hex)
    // Guard them before normalizeAliases maps color→textColor and size→text.
    const isIcon = n.type === 'Icon';
    const iconSize  = isIcon ? rawProps.size  : undefined;
    const iconColor = isIcon ? rawProps.color : undefined;
    if (isIcon) { delete rawProps.size; delete rawProps.color; }

    const { props: resolvedProps, responsiveNode } = resolveNodeProps(rawProps);

    if (isIcon) {
      if (iconSize  !== undefined) resolvedProps.size  = iconSize;
      if (iconColor !== undefined) resolvedProps.color = iconColor;
    }

    // Lift hover/press/scroll shorthand from props into props.animation.
    // AI writes: props.hover.bg = "#4f46e5" (natural CSS-in-JS pattern)
    // Engine reads: props.animation.hover.styles.backgroundColor = "#4f46e5"
    const INTERACTION_PHASES = ['hover', 'press', 'scroll'] as const;
    const ANIM_NATIVE = new Set([
      'scale', 'opacity', 'duration', 'easing', 'y', 'x',
      'type', 'threshold', 'once', 'enabled', 'repeatCount',
    ]);
    for (const phase of INTERACTION_PHASES) {
      const phaseVal = resolvedProps[phase];
      if (!phaseVal || typeof phaseVal !== 'object' || Array.isArray(phaseVal)) continue;
      delete resolvedProps[phase];
      const phaseObj = phaseVal as Record<string, unknown>;
      const animPhase: Record<string, unknown> = {};
      const cssStyles: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(phaseObj)) {
        if (ANIM_NATIVE.has(k)) {
          animPhase[k] = v;
        } else {
          Object.assign(cssStyles, styleKeyToCssProps(k, v));
        }
      }
      if (Object.keys(cssStyles).length) animPhase.styles = cssStyles;
      if (Object.keys(animPhase).length) {
        const existing = (resolvedProps.animation ?? {}) as Record<string, unknown>;
        resolvedProps.animation = {
          ...existing,
          [phase]: { ...((existing[phase] as Record<string, unknown>) ?? {}), ...animPhase },
        };
      }
    }

    n.props = resolvedProps;

    // Merge breakpoint overrides into node.responsive[bp].styles
    if (Object.keys(responsiveNode).length > 0) {
      const existingResponsive = (n.responsive ?? {}) as Record<string, Record<string, unknown>>;
      const merged: Record<string, Record<string, unknown>> = { ...existingResponsive };
      for (const [bp, bpData] of Object.entries(responsiveNode)) {
        const ex = merged[bp] ?? {};
        merged[bp] = { ...ex, styles: { ...(ex.styles as Record<string, unknown> ?? {}), ...bpData.styles } };
      }
      n.responsive = merged;
    }
  }

  // Recurse into children
  if (Array.isArray(n.children)) {
    n.children = n.children.map(resolveNode);
  }

  return n;
}

// ─── resolveStyleParams (re-export for file-agent compat) ────────────────────

/**
 * Convert a SxProps object into { className, responsiveStyles }.
 * Used by the file-agent which reads from props.style (not flat props).
 * For new code, prefer resolveNodeProps which handles flat-in-props format.
 */
export function resolveStyleParams(
  i: Record<string, unknown>,
): { className: string; responsiveStyles: ResponsiveStyles } {
  const { props: resolved, responsiveNode } = resolveNodeProps(i);
  // Convert responsiveNode (bp → { styles: camelCase }) to ResponsiveStyles (bp → camelCase record)
  const responsiveStyles: ResponsiveStyles = {};
  for (const [bp, data] of Object.entries(responsiveNode)) {
    const key = bp as BreakpointKey;
    if (data.styles && typeof data.styles === 'object') {
      responsiveStyles[key] = data.styles as Record<string, string>;
    }
  }
  return {
    className: typeof resolved.className === 'string' ? resolved.className : '',
    responsiveStyles,
  };
}
