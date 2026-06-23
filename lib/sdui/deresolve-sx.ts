/**
 * De-resolver: converts resolved node trees (className tokens + props.style +
 * node.responsive breakpoint styles) back to flat SxProps — the format the AI
 * agent writes and reads.
 *
 * This is the lossless inverse of lib/ai/agents/shared/resolve-style.ts.
 * Called in resolveStoreSlice / resolveComponentSlice before serializing VFS
 * files to send to the json-agent, so the AI always sees exactly what it wrote.
 *
 * Nothing changes in the PostToolUse hook, renderer, or Zustand store.
 */

// ─── Internal ↔ DSL breakpoint key map ───────────────────────────────────────

/** Reverses DSL_BP_TO_INTERNAL: internal engine bp key → canonical DSL key for the AI. */
const INTERNAL_BP_TO_DSL: Record<string, string> = {
  mobile: 'md',
  tablet: 'lg',
  laptop: 'xl',
};

// ─── CSS property → SxProp key map (reverses SHORTHAND_JS_CSS_MAP) ──────────

/**
 * Maps camelCase CSS property names back to SxProp keys.
 * Used for:
 *   1. props.style { js } dynamic bindings  →  SxProp { js } values
 *   2. node.responsive[bp].styles           →  breakpoint SxProp objects
 *
 * For entries with a wrapJs wrapper `(expr) + 'px'`, the CSS value in
 * responsive.styles is a plain string like "8px" — unwrap with parsePx().
 * For { js } bindings the wrapper is stripped from the expression string.
 */
const CSS_KEY_TO_SX: Record<string, string> = {
  backgroundColor:      'bg',
  color:                'textColor',
  borderRadius:         'radius',
  borderTopLeftRadius:  'radiusTL',
  borderTopRightRadius: 'radiusTR',
  borderBottomRightRadius: 'radiusBR',
  borderBottomLeftRadius:  'radiusBL',
  borderWidth:          'border',
  borderColor:          'borderColor',
  opacity:              'opacity',
  gridColumn:           'colSpan',
  gridTemplateColumns:  'gridCols',
  width:                'w',
  height:               'h',
  minWidth:             'minW',
  maxWidth:             'maxW',
  minHeight:            'minH',
  maxHeight:            'maxH',
  fontSize:             'text',
  top:                  'top',
  right:                'right',
  bottom:               'bottom',
  left:                 'left',
  zIndex:               'z',
  padding:              'p',
  paddingInline:        'px',
  paddingBlock:         'py',
  paddingTop:           'pt',
  paddingRight:         'pr',
  paddingBottom:        'pb',
  paddingLeft:          'pl',
  margin:               'm',
  marginInline:         'mx',
  marginBlock:          'my',
  marginTop:            'mt',
  marginRight:          'mr',
  marginBottom:         'mb',
  marginLeft:           'ml',
  gap:                  'gap',
  columnGap:            'gapX',
  rowGap:               'gapY',
  overflow:             'overflow',
  cursor:               'cursor',
  position:             'position',
  // ── Layout / flex / grid ─────────────────────────────────────────────────────
  justifyContent:       'justify',
  alignItems:           'items',
  alignSelf:            'self',
  display:              'display',
  flexDirection:        'direction',
  flexWrap:             'wrap',
  boxShadow:            'shadow',
  objectFit:            'objectFit',
  textAlign:            'textAlign',
  gridTemplateRows:     'gridRows',
  gridAutoFlow:         'gridFlow',
  gridRow:              'rowSpan',
  // ── Text styling ─────────────────────────────────────────────────────────────
  fontWeight:           'weight',
  lineHeight:           'leading',
  letterSpacing:        'tracking',
  textDecoration:       'textDecoration',
  textTransform:        'textTransform',
  borderStyle:          'borderStyle',
  whiteSpace:           'whitespace',
  wordBreak:            'wordBreak',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse "Npx" → N (number). Returns the original string if it doesn't match. */
function parsePx(val: string): number | string {
  const m = val.match(/^(-?[\d.]+)px$/);
  return m ? parseFloat(m[1]) : val;
}

/** Parse a size token value: "full" | "screen" | "fit" | "auto" | "Npx" | arbitrary */
function parseSizeValue(val: string): string | number {
  if (val === 'full' || val === 'screen' || val === 'fit' || val === 'auto') return val;
  const px = parsePx(val);
  if (typeof px === 'number') return px;
  // Arbitrary non-px string (e.g. "50%") — strip surrounding brackets if present
  return val.replace(/^\[(.+)\]$/, '$1');
}

/**
 * Unwrap the `wrapJs` expression wrapper added by the resolver.
 * `(expr) + 'px'`           → expr
 * `'span ' + (expr)`        → expr
 * `'repeat(' + (expr) + ', minmax(0, 1fr))'` → expr
 * Plain expression (no wrapper) → returned as-is.
 */
function unwrapJsExpr(cssKey: string, expr: string): string {
  // (expr) + 'px'
  const pxMatch = expr.match(/^\((.+)\) \+ 'px'$/s);
  if (pxMatch) return pxMatch[1];
  // 'span ' + (expr)
  const spanMatch = expr.match(/^'span ' \+ \((.+)\)$/s);
  if (spanMatch) return spanMatch[1];
  // 'repeat(' + (expr) + ', minmax(0, 1fr))'
  const repeatMatch = expr.match(/^'repeat\(' \+ \((.+)\) \+ ', minmax\(0, 1fr\)\)'$/s);
  if (repeatMatch) return repeatMatch[1];
  return expr;
}

const isJsObj = (v: unknown): v is { js: string } =>
  typeof v === 'object' && v !== null && 'js' in (v as object) &&
  typeof (v as Record<string, unknown>).js === 'string';

// ─── className token → SxProp ─────────────────────────────────────────────────

/**
 * Parse a single Tailwind token (as generated by resolve-style.ts) back to a
 * [sxKey, value] pair. Returns null for unrecognised tokens.
 */
function tokenToSxProp(token: string): [string, unknown] | null {
  // bg-[VALUE]
  const bg = token.match(/^bg-\[(.+)\]$/);
  if (bg) return ['bg', bg[1]];

  // !text-[VALUE] (textColor uses !important prefix)
  const tc = token.match(/^!text-\[(.+)\]$/);
  if (tc) return ['textColor', tc[1]];

  // text-[Npx] (font size)
  const ts = token.match(/^text-\[(\d+(?:\.\d+)?)px\]$/);
  if (ts) return ['text', parseFloat(ts[1])];

  // text-left|center|right|justify (textAlign)
  const ta = token.match(/^text-(left|center|right|justify)$/);
  if (ta) return ['textAlign', ta[1]];

  // font-weight
  const fw = token.match(/^font-(thin|light|normal|medium|semibold|bold|extrabold|black)$/);
  if (fw) return ['weight', fw[1]];

  // leading-VALUE
  const lead = token.match(/^leading-(.+)$/);
  if (lead) return ['leading', lead[1]];

  // tracking-VALUE
  const track = token.match(/^tracking-(.+)$/);
  if (track) return ['tracking', track[1]];

  // Layout display tokens
  if (token === 'flex')    return ['_flex', true];   // handled in post-process
  if (token === 'hidden')  return ['display', 'hidden'];
  if (token === 'grid')    return ['grid', true];
  if (token === 'flex-1')  return ['flex1', true];

  // flex-col / flex-row / flex-wrap / flex-nowrap / flex-wrap-reverse
  const flexDir = token.match(/^flex-(col|row|col-reverse|row-reverse)$/);
  if (flexDir) return ['direction', flexDir[1]];

  const flexWrap = token.match(/^flex-(wrap|nowrap|wrap-reverse)$/);
  if (flexWrap) return ['wrap', flexWrap[1]];

  // items-VALUE
  const items = token.match(/^items-(.+)$/);
  if (items) return ['items', items[1]];

  // justify-VALUE
  const justify = token.match(/^justify-(.+)$/);
  if (justify) return ['justify', justify[1]];

  // self-VALUE
  const self = token.match(/^self-(.+)$/);
  if (self) return ['self', self[1]];

  // grid-cols-N, grid-rows-N, grid-flow-VALUE
  const gridCols = token.match(/^grid-cols-(\d+)$/);
  if (gridCols) return ['gridCols', parseInt(gridCols[1])];

  const gridRows = token.match(/^grid-rows-(\d+)$/);
  if (gridRows) return ['gridRows', parseInt(gridRows[1])];

  const gridFlow = token.match(/^grid-flow-(.+)$/);
  if (gridFlow) return ['gridFlow', gridFlow[1]];

  // col-span-full, col-span-N, row-span-N
  if (token === 'col-span-full') return ['colSpanFull', true];

  const colSpan = token.match(/^col-span-(\d+)$/);
  if (colSpan) return ['colSpan', parseInt(colSpan[1])];

  const rowSpan = token.match(/^row-span-(\d+)$/);
  if (rowSpan) return ['rowSpan', parseInt(rowSpan[1])];

  // gap-[Npx], gap-x-[Npx], gap-y-[Npx]
  const gap = token.match(/^gap-\[(\d+(?:\.\d+)?)px\]$/);
  if (gap) return ['gap', parseFloat(gap[1])];

  const gapX = token.match(/^gap-x-\[(\d+(?:\.\d+)?)px\]$/);
  if (gapX) return ['gapX', parseFloat(gapX[1])];

  const gapY = token.match(/^gap-y-\[(\d+(?:\.\d+)?)px\]$/);
  if (gapY) return ['gapY', parseFloat(gapY[1])];

  // Size tokens: w, h, min-w, max-w, min-h, max-h
  const sizeMap: Array<[RegExp, string]> = [
    [/^w-(.+)$/, 'w'],
    [/^h-(.+)$/, 'h'],
    [/^min-w-(.+)$/, 'minW'],
    [/^max-w-(.+)$/, 'maxW'],
    [/^min-h-(.+)$/, 'minH'],
    [/^max-h-(.+)$/, 'maxH'],
  ];
  for (const [rx, key] of sizeMap) {
    const m = token.match(rx);
    if (m) {
      const raw = m[1];
      // strip brackets for arbitrary values: w-[200px] → 200px
      const stripped = raw.replace(/^\[(.+)\]$/, '$1');
      return [key, parseSizeValue(stripped)];
    }
  }

  // Spacing: p-[Npx], px-[Npx], etc.
  const spacingMap: Array<[RegExp, string]> = [
    [/^p-\[(\d+(?:\.\d+)?)px\]$/, 'p'],
    [/^px-\[(\d+(?:\.\d+)?)px\]$/, 'px'],
    [/^py-\[(\d+(?:\.\d+)?)px\]$/, 'py'],
    [/^pt-\[(\d+(?:\.\d+)?)px\]$/, 'pt'],
    [/^pr-\[(\d+(?:\.\d+)?)px\]$/, 'pr'],
    [/^pb-\[(\d+(?:\.\d+)?)px\]$/, 'pb'],
    [/^pl-\[(\d+(?:\.\d+)?)px\]$/, 'pl'],
    [/^m-\[(\d+(?:\.\d+)?)px\]$/, 'm'],
    [/^mx-\[(\d+(?:\.\d+)?)px\]$/, 'mx'],
    [/^my-\[(\d+(?:\.\d+)?)px\]$/, 'my'],
    [/^mt-\[(\d+(?:\.\d+)?)px\]$/, 'mt'],
    [/^mr-\[(\d+(?:\.\d+)?)px\]$/, 'mr'],
    [/^mb-\[(\d+(?:\.\d+)?)px\]$/, 'mb'],
    [/^ml-\[(\d+(?:\.\d+)?)px\]$/, 'ml'],
  ];
  for (const [rx, key] of spacingMap) {
    const m = token.match(rx);
    if (m) return [key, parseFloat(m[1])];
  }

  // m-auto, mx-auto, my-auto
  if (token === 'm-auto')  return ['m', 'auto'];
  if (token === 'mx-auto') return ['mx', 'auto'];
  if (token === 'my-auto') return ['my', 'auto'];

  // Border: border-0, border-2, border-4, border-8, border-[Npx], border-[COLOR]
  if (token === 'border-0') return ['border', 0];
  const borderFixed = token.match(/^border-(2|4|8)$/);
  if (borderFixed) return ['border', parseInt(borderFixed[1])];

  const borderPx = token.match(/^border-\[(\d+(?:\.\d+)?)px\]$/);
  if (borderPx) return ['border', parseFloat(borderPx[1])];

  // border-[COLOR] — color value (not a px number)
  const borderColor = token.match(/^border-\[([^\]]+)\]$/);
  if (borderColor && !borderColor[1].endsWith('px')) return ['borderColor', borderColor[1]];

  // border-solid|dashed|dotted|double|none
  const borderStyle = token.match(/^border-(solid|dashed|dotted|double|none)$/);
  if (borderStyle) return ['borderStyle', borderStyle[1]];

  // rounded-[Npx], rounded-tl/tr/br/bl-[Npx]
  const radius = token.match(/^rounded-\[(\d+(?:\.\d+)?)px\]$/);
  if (radius) return ['radius', parseFloat(radius[1])];

  const radiusTL = token.match(/^rounded-tl-\[(\d+(?:\.\d+)?)px\]$/);
  if (radiusTL) return ['radiusTL', parseFloat(radiusTL[1])];

  const radiusTR = token.match(/^rounded-tr-\[(\d+(?:\.\d+)?)px\]$/);
  if (radiusTR) return ['radiusTR', parseFloat(radiusTR[1])];

  const radiusBR = token.match(/^rounded-br-\[(\d+(?:\.\d+)?)px\]$/);
  if (radiusBR) return ['radiusBR', parseFloat(radiusBR[1])];

  const radiusBL = token.match(/^rounded-bl-\[(\d+(?:\.\d+)?)px\]$/);
  if (radiusBL) return ['radiusBL', parseFloat(radiusBL[1])];

  // Position
  if (token === 'absolute') return ['position', 'absolute'];
  if (token === 'relative')  return ['position', 'relative'];
  if (token === 'fixed')     return ['position', 'fixed'];
  if (token === 'sticky')    return ['position', 'sticky'];
  if (token === 'inset-0')   return ['inset0', true];

  // top/right/bottom/left-[Npx]
  const posDir = token.match(/^(top|right|bottom|left)-\[(\d+(?:\.\d+)?)px\]$/);
  if (posDir) return [posDir[1], parseFloat(posDir[2])];

  // z-[VALUE]
  const z = token.match(/^z-\[(\d+)\]$/);
  if (z) return ['z', parseInt(z[1])];

  // overflow-VALUE
  const overflow = token.match(/^overflow-(.+)$/);
  if (overflow) return ['overflow', overflow[1]];

  // cursor-VALUE
  const cursor = token.match(/^cursor-(.+)$/);
  if (cursor) return ['cursor', cursor[1]];

  // opacity-[VALUE]
  const opacity = token.match(/^opacity-\[([^\]]+)\]$/);
  if (opacity) return ['opacity', parseFloat(opacity[1])];

  // object-VALUE (objectFit)
  const objectFit = token.match(/^object-(.+)$/);
  if (objectFit) return ['objectFit', objectFit[1]];

  // shadow-none, shadow-VALUE
  if (token === 'shadow-none') return ['shadow', 'none'];
  const shadow = token.match(/^shadow-(.+)$/);
  if (shadow) return ['shadow', shadow[1]];

  // Text transforms / decorations
  if (token === 'uppercase')    return ['textTransform', 'uppercase'];
  if (token === 'lowercase')    return ['textTransform', 'lowercase'];
  if (token === 'capitalize')   return ['textTransform', 'capitalize'];
  if (token === 'underline')    return ['textDecoration', 'underline'];
  if (token === 'line-through') return ['textDecoration', 'line-through'];
  if (token === 'no-underline') return ['textDecoration', 'no-underline'];
  if (token === 'truncate')     return ['textOverflow', 'truncate'];

  // whitespace-VALUE
  const ws = token.match(/^whitespace-(.+)$/);
  if (ws) return ['whitespace', ws[1]];

  // break-VALUE (wordBreak)
  const wb = token.match(/^break-(.+)$/);
  if (wb) return ['wordBreak', wb[1]];

  return null;
}

// ─── className string → SxProps ──────────────────────────────────────────────

function classNameToSxProps(className: string): Record<string, unknown> {
  const tokens = className.split(/\s+/).filter(Boolean);
  const raw: Record<string, unknown> = {};

  for (const token of tokens) {
    const pair = tokenToSxProp(token);
    if (pair) {
      const [key, val] = pair;
      raw[key] = val;
    }
  }

  // Post-process: combine _flex + direction aliases back into col/row
  const hasFlex = '_flex' in raw;
  const dir = raw['direction'];
  if (hasFlex && dir === 'col') {
    delete raw['_flex'];
    delete raw['direction'];
    raw['col'] = true;
  } else if (hasFlex && dir === 'row') {
    delete raw['_flex'];
    delete raw['direction'];
    raw['row'] = true;
  } else if (hasFlex) {
    delete raw['_flex'];
    raw['flex'] = true;
  }

  return raw;
}

// ─── props.style { js } → SxProp { js } ──────────────────────────────────────

function styleToSxProps(style: Record<string, unknown>): Record<string, unknown> {
  const sx: Record<string, unknown> = {};
  const remaining: Record<string, unknown> = {};

  for (const [cssKey, val] of Object.entries(style)) {
    const sxKey = CSS_KEY_TO_SX[cssKey];
    if (!sxKey) {
      remaining[cssKey] = val;
      continue;
    }

    if (isJsObj(val)) {
      // Unwrap expression wrappers added by resolve-style.ts
      const unwrapped = unwrapJsExpr(cssKey, val.js);
      sx[sxKey] = { js: unwrapped };
    } else {
      // Static CSS value — convert back to SxProp primitive
      if (typeof val === 'string') {
        const numericKeys = new Set([
          'radius','radiusTL','radiusTR','radiusBR','radiusBL',
          'border','text','top','right','bottom','left',
          'p','px','py','pt','pr','pb','pl','m','mx','my','mt','mr','mb','ml',
          'gap','gapX','gapY',
        ]);
        if (numericKeys.has(sxKey)) {
          const n = parsePx(val);
          sx[sxKey] = n;
        } else {
          sx[sxKey] = val;
        }
      } else {
        sx[sxKey] = val;
      }
    }
  }

  return Object.keys(remaining).length > 0
    ? { ...sx, _styleRemainder: remaining }
    : sx;
}

// ─── node.responsive[bp].styles → breakpoint SxProp objects ─────────────────

/**
 * Convert camelCase CSS style values back to SxProp key-value pairs.
 * Used for node.responsive[bp].styles entries.
 */
function responsiveStylesToSxProps(styles: Record<string, unknown>): Record<string, unknown> {
  const sx: Record<string, unknown> = {};

  for (const [cssKey, val] of Object.entries(styles)) {
    const sxKey = CSS_KEY_TO_SX[cssKey];
    if (!sxKey) continue;

    if (typeof val === 'string') {
      const numericKeys = new Set([
        'radius','radiusTL','radiusTR','radiusBR','radiusBL',
        'border','text','top','right','bottom','left',
        'p','px','py','pt','pr','pb','pl','m','mx','my','mt','mr','mb','ml',
        'gap','gapX','gapY','w','h','minW','maxW','minH','maxH',
      ]);
      if (numericKeys.has(sxKey)) {
        sx[sxKey] = parsePx(val);
      } else {
        sx[sxKey] = val;
      }
    } else if (isJsObj(val)) {
      const unwrapped = unwrapJsExpr(cssKey, val.js);
      sx[sxKey] = { js: unwrapped };
    } else {
      sx[sxKey] = val;
    }
  }

  return sx;
}

// ─── Node de-resolver ─────────────────────────────────────────────────────────

function deResolveNode(node: unknown): unknown {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
  const n = { ...(node as Record<string, unknown>) };

  // ── Props: className + style → SxProps ──
  if (n.props && typeof n.props === 'object' && !Array.isArray(n.props)) {
    const props = { ...(n.props as Record<string, unknown>) };
    let sx: Record<string, unknown> = {};

    // Convert className tokens → SxProps
    if (typeof props.className === 'string' && props.className) {
      sx = { ...sx, ...classNameToSxProps(props.className) };
      delete props.className;
    }

    // Convert props.style { js } bindings → SxProp { js } values
    if (props.style && typeof props.style === 'object' && !Array.isArray(props.style)) {
      const styleSx = styleToSxProps(props.style as Record<string, unknown>);
      // _styleRemainder holds CSS props with no SxProp mapping — keep as style
      const { _styleRemainder, ...restSx } = styleSx as Record<string, unknown>;
      sx = { ...sx, ...restSx };
      if (_styleRemainder && Object.keys(_styleRemainder as object).length > 0) {
        props.style = _styleRemainder;
      } else {
        delete props.style;
      }
    }

    n.props = { ...sx, ...props };
  }

  // ── Responsive: node.responsive[bp].styles → DSL breakpoint keys on props ──
  if (n.responsive && typeof n.responsive === 'object' && !Array.isArray(n.responsive)) {
    const responsive = n.responsive as Record<string, Record<string, unknown>>;
    const bpSx: Record<string, unknown> = {};

    for (const [internalBp, bpData] of Object.entries(responsive)) {
      const dslKey = INTERNAL_BP_TO_DSL[internalBp];
      if (!dslKey) continue;
      if (!bpData?.styles || typeof bpData.styles !== 'object') continue;
      const sx = responsiveStylesToSxProps(bpData.styles as Record<string, unknown>);
      if (Object.keys(sx).length > 0) bpSx[dslKey] = sx;
    }

    if (Object.keys(bpSx).length > 0) {
      n.props = { ...(n.props as Record<string, unknown> ?? {}), ...bpSx };
    }
    delete n.responsive;
  }

  // ── Icon nodes: rename de-resolved text→size and textColor→color ─────────────
  // The resolver guards size/color for Icon nodes, but any node saved before
  // that fix may still have className "text-[20px] !text-[#ffffff]" which the
  // de-resolver above converts to { text: 20, textColor: "#hex" }. Rename them
  // back to the props that IconifyIcon actually consumes.
  if (n.type === 'Icon' && n.props && typeof n.props === 'object' && !Array.isArray(n.props)) {
    const p = n.props as Record<string, unknown>;
    if ('text'      in p) { p.size  = p.text;      delete p.text; }
    if ('textColor' in p) { p.color = p.textColor; delete p.textColor; }
  }

  // ── Recurse into children ──
  if (Array.isArray(n.children)) {
    n.children = n.children.map(deResolveNode);
  }

  return n;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Walk a UINode tree and convert all resolved className/style/responsive data
 * back to flat SxProps — the format the AI agent writes and reads.
 *
 * Used in resolveStoreSlice (pages) and resolveComponentSlice (components)
 * before serializing VFS files to send to the json-agent.
 */
export function deResolveNodeTree(nodes: unknown[]): unknown[] {
  return nodes.map(deResolveNode);
}
