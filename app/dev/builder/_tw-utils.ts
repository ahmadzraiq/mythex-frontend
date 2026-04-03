/**
 * Tailwind class utilities for the visual builder.
 *
 * All token arrays use EXPLICIT string literals so Tailwind JIT can scan
 * this file and compile every class we might dynamically apply.
 */

// ─── Style properties that styleToClassName can encode as Tailwind classes ───
// Any style key in this set should NOT be persisted in props.style — it belongs
// in props.className as an arbitrary-value class (e.g. w-[317px], pt-[8px]).
// `transform` is intentionally absent: rotation stays inline by design.
export const STYLE_TO_CLASS_KEYS = new Set([
  'backgroundColor', 'color', 'borderColor',
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'paddingBlock', 'paddingInline',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'gap', 'opacity',
  'top', 'right', 'bottom', 'left',
  // Numeric properties stored as arbitrary Tailwind classes (e.g. rounded-[8px], z-[10])
  'borderRadius',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
  'zIndex',
  'borderWidth',
  'fontSize',
]);

// ─── Token tables (JIT-scannable) ────────────────────────────────────────────

export const SPACING_SCALE = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96] as const;
export const SPACING_PX: Record<number, number> = { 0:0, 0.5:2, 1:4, 1.5:6, 2:8, 2.5:10, 3:12, 3.5:14, 4:16, 5:20, 6:24, 7:28, 8:32, 9:36, 10:40, 11:44, 12:48, 14:56, 16:64, 20:80, 24:96, 28:112, 32:128, 36:144, 40:160, 44:176, 48:192, 52:208, 56:224, 60:240, 64:256, 72:288, 80:320, 96:384 };

// Padding
export const P_TOKENS  = ['p-0','p-0.5','p-1','p-1.5','p-2','p-2.5','p-3','p-3.5','p-4','p-5','p-6','p-7','p-8','p-9','p-10','p-11','p-12','p-14','p-16','p-20','p-24','p-28','p-32','p-36','p-40','p-44','p-48','p-52','p-56','p-60','p-64','p-72','p-80','p-96'];
export const PX_TOKENS = ['px-0','px-0.5','px-1','px-1.5','px-2','px-2.5','px-3','px-3.5','px-4','px-5','px-6','px-7','px-8','px-9','px-10','px-11','px-12','px-14','px-16','px-20','px-24','px-28','px-32','px-36','px-40','px-44','px-48'];
export const PY_TOKENS = ['py-0','py-0.5','py-1','py-1.5','py-2','py-2.5','py-3','py-3.5','py-4','py-5','py-6','py-7','py-8','py-9','py-10','py-11','py-12','py-14','py-16','py-20','py-24','py-28','py-32','py-36','py-40','py-44','py-48'];
export const PT_TOKENS = ['pt-0','pt-1','pt-2','pt-3','pt-4','pt-5','pt-6','pt-8','pt-10','pt-12','pt-14','pt-16','pt-20','pt-24','pt-32','pt-48'];
export const PR_TOKENS = ['pr-0','pr-1','pr-2','pr-3','pr-4','pr-5','pr-6','pr-8','pr-10','pr-12','pr-14','pr-16','pr-20','pr-24','pr-32','pr-48'];
export const PB_TOKENS = ['pb-0','pb-1','pb-2','pb-3','pb-4','pb-5','pb-6','pb-8','pb-10','pb-12','pb-14','pb-16','pb-20','pb-24','pb-32','pb-48'];
export const PL_TOKENS = ['pl-0','pl-1','pl-2','pl-3','pl-4','pl-5','pl-6','pl-8','pl-10','pl-12','pl-14','pl-16','pl-20','pl-24','pl-32','pl-48'];

// Margin (includes 0.5/1.5/2.5/3.5 half-step variants so NativeWind content scanning compiles them)
export const M_TOKENS  = ['m-0','m-0.5','m-1','m-1.5','m-2','m-2.5','m-3','m-3.5','m-4','m-5','m-6','m-7','m-8','m-9','m-10','m-11','m-12','m-14','m-16','m-20','m-24','m-auto'];
export const MX_TOKENS = ['mx-0','mx-0.5','mx-1','mx-1.5','mx-2','mx-2.5','mx-3','mx-3.5','mx-4','mx-5','mx-6','mx-7','mx-8','mx-10','mx-12','mx-16','mx-auto'];
export const MY_TOKENS = ['my-0','my-0.5','my-1','my-1.5','my-2','my-2.5','my-3','my-3.5','my-4','my-5','my-6','my-7','my-8','my-10','my-12','my-16','my-auto'];
export const MT_TOKENS = ['mt-0','mt-0.5','mt-1','mt-1.5','mt-2','mt-2.5','mt-3','mt-3.5','mt-4','mt-5','mt-6','mt-7','mt-8','mt-10','mt-12','mt-16','mt-20','mt-24'];
export const MR_TOKENS = ['mr-0','mr-0.5','mr-1','mr-1.5','mr-2','mr-2.5','mr-3','mr-3.5','mr-4','mr-5','mr-6','mr-7','mr-8','mr-10','mr-12','mr-16','mr-20','mr-24'];
export const MB_TOKENS = ['mb-0','mb-0.5','mb-1','mb-1.5','mb-2','mb-2.5','mb-3','mb-3.5','mb-4','mb-5','mb-6','mb-7','mb-8','mb-10','mb-12','mb-16','mb-20','mb-24'];
export const ML_TOKENS = ['ml-0','ml-0.5','ml-1','ml-1.5','ml-2','ml-2.5','ml-3','ml-3.5','ml-4','ml-5','ml-6','ml-7','ml-8','ml-10','ml-12','ml-16','ml-20','ml-24'];

// Gap
export const GAP_TOKENS  = ['gap-0','gap-1','gap-2','gap-3','gap-4','gap-5','gap-6','gap-7','gap-8','gap-9','gap-10','gap-12','gap-14','gap-16','gap-20','gap-24','gap-32'];
export const GAP_X_TOKENS = ['gap-x-0','gap-x-1','gap-x-2','gap-x-3','gap-x-4','gap-x-5','gap-x-6','gap-x-8','gap-x-10','gap-x-12','gap-x-16','gap-x-24'];
export const GAP_Y_TOKENS = ['gap-y-0','gap-y-1','gap-y-2','gap-y-3','gap-y-4','gap-y-5','gap-y-6','gap-y-8','gap-y-10','gap-y-12','gap-y-16','gap-y-24'];

// Width / Height
export const W_TOKENS = ['w-0','w-1','w-2','w-4','w-8','w-12','w-16','w-20','w-24','w-32','w-40','w-48','w-56','w-64','w-72','w-80','w-96','w-auto','w-full','w-screen','w-1/2','w-1/3','w-2/3','w-1/4','w-3/4','w-fit','w-max','w-min'];
export const H_TOKENS = ['h-0','h-1','h-2','h-4','h-8','h-12','h-16','h-20','h-24','h-32','h-40','h-48','h-56','h-64','h-72','h-80','h-96','h-auto','h-full','h-screen','h-fit','h-max','h-min'];
export const MAX_W_TOKENS = ['max-w-xs','max-w-sm','max-w-md','max-w-lg','max-w-xl','max-w-2xl','max-w-3xl','max-w-4xl','max-w-5xl','max-w-6xl','max-w-7xl','max-w-full','max-w-screen-sm','max-w-screen-md','max-w-screen-lg','max-w-screen-xl'];

// Border radius
export const ROUNDED_TOKENS = ['rounded-none','rounded-sm','rounded','rounded-md','rounded-lg','rounded-xl','rounded-2xl','rounded-3xl','rounded-full'];
export const ROUNDED_TL_TOKENS = ['rounded-tl-none','rounded-tl-sm','rounded-tl','rounded-tl-md','rounded-tl-lg','rounded-tl-xl','rounded-tl-2xl','rounded-tl-3xl','rounded-tl-full'];
export const ROUNDED_TR_TOKENS = ['rounded-tr-none','rounded-tr-sm','rounded-tr','rounded-tr-md','rounded-tr-lg','rounded-tr-xl','rounded-tr-2xl','rounded-tr-3xl','rounded-tr-full'];
export const ROUNDED_BR_TOKENS = ['rounded-br-none','rounded-br-sm','rounded-br','rounded-br-md','rounded-br-lg','rounded-br-xl','rounded-br-2xl','rounded-br-3xl','rounded-br-full'];
export const ROUNDED_BL_TOKENS = ['rounded-bl-none','rounded-bl-sm','rounded-bl','rounded-bl-md','rounded-bl-lg','rounded-bl-xl','rounded-bl-2xl','rounded-bl-3xl','rounded-bl-full'];

// Text size
export const TEXT_SIZE_TOKENS = ['text-xs','text-sm','text-base','text-lg','text-xl','text-2xl','text-3xl','text-4xl','text-5xl','text-6xl','text-7xl','text-8xl','text-9xl'];

// Font weight
export const FONT_WEIGHT_TOKENS = ['font-thin','font-extralight','font-light','font-normal','font-medium','font-semibold','font-bold','font-extrabold','font-black'];

// Leading / line height
export const LEADING_TOKENS = ['leading-none','leading-tight','leading-snug','leading-normal','leading-relaxed','leading-loose','leading-3','leading-4','leading-5','leading-6','leading-7','leading-8','leading-9','leading-10'];

// Tracking / letter spacing
export const TRACKING_TOKENS = ['tracking-tighter','tracking-tight','tracking-normal','tracking-wide','tracking-wider','tracking-widest'];

// Flex
export const FLEX_DIR_TOKENS  = ['flex-row','flex-col','flex-row-reverse','flex-col-reverse'];
export const ITEMS_TOKENS     = ['items-start','items-center','items-end','items-stretch','items-baseline'];
export const JUSTIFY_TOKENS   = ['justify-start','justify-center','justify-end','justify-between','justify-around','justify-evenly'];
export const FLEX_WRAP_TOKENS = ['flex-wrap','flex-nowrap','flex-wrap-reverse'];

// Opacity
export const OPACITY_TOKENS = ['opacity-0','opacity-5','opacity-10','opacity-20','opacity-25','opacity-30','opacity-40','opacity-50','opacity-60','opacity-70','opacity-75','opacity-80','opacity-90','opacity-95','opacity-100'];

// Shadow
export const SHADOW_TOKENS = ['shadow-none','shadow-sm','shadow','shadow-md','shadow-lg','shadow-xl','shadow-2xl','shadow-inner'];

// Border width
export const BORDER_WIDTH_TOKENS = ['border-0','border','border-2','border-4','border-8'];

// Border style
export const BORDER_STYLE_TOKENS = ['border-solid','border-dashed','border-dotted','border-double','border-none'];

// Rotate
export const ROTATE_TOKENS = [
  'rotate-0','rotate-1','rotate-2','rotate-3','rotate-6','rotate-12','rotate-45','rotate-90','rotate-180',
  '-rotate-1','-rotate-2','-rotate-3','-rotate-6','-rotate-12','-rotate-45','-rotate-90','-rotate-180',
];

// Scale (for flip)
export const SCALE_X_TOKENS = ['scale-x-100','-scale-x-100','scale-x-0','scale-x-50','scale-x-75'];
export const SCALE_Y_TOKENS = ['scale-y-100','-scale-y-100','scale-y-0','scale-y-50','scale-y-75'];

// Self-alignment (how a node positions itself within its parent flex container)
export const SELF_TOKENS = ['self-auto','self-start','self-center','self-end','self-stretch','self-baseline'];

// Text alignment
export const TEXT_ALIGN_TOKENS = ['text-left','text-center','text-right','text-justify'];

// Text decoration
export const TEXT_DECORATION_TOKENS = ['no-underline','underline','line-through','overline'];

// Text transform
export const TEXT_TRANSFORM_TOKENS = ['normal-case','uppercase','lowercase','capitalize'];

// Position
export const POSITION_TOKENS = ['static','relative','absolute','fixed','sticky'];

// Z-index
export const Z_INDEX_TOKENS = ['z-0','z-10','z-20','z-30','z-40','z-50','z-auto'];

// Cursor
export const CURSOR_TOKENS = ['cursor-auto','cursor-default','cursor-pointer','cursor-not-allowed','cursor-grab','cursor-move','cursor-text','cursor-crosshair'];

// Display / visibility
export const DISPLAY_TOKENS = ['block','inline-block','inline','flex','inline-flex','grid','hidden'];

// Overflow
export const OVERFLOW_TOKENS = ['overflow-auto','overflow-hidden','overflow-visible','overflow-scroll','overflow-x-auto','overflow-y-auto'];

// Grid columns / rows (JIT-scannable so NativeWind compiles them)
export const GRID_COLS_TOKENS = ['grid-cols-1','grid-cols-2','grid-cols-3','grid-cols-4','grid-cols-5','grid-cols-6','grid-cols-7','grid-cols-8','grid-cols-9','grid-cols-10','grid-cols-11','grid-cols-12'] as const;
export const GRID_ROWS_TOKENS = ['grid-rows-1','grid-rows-2','grid-rows-3','grid-rows-4','grid-rows-5','grid-rows-6'] as const;
export const COL_SPAN_TOKENS  = ['col-span-1','col-span-2','col-span-3','col-span-4','col-span-6','col-span-full'] as const;

// ─── Core utilities ───────────────────────────────────────────────────────────

/**
 * Replace the first Tailwind token matching a prefix pattern in a className string.
 * e.g. replaceTwToken("flex flex-col gap-4 p-6", "gap-", "gap-8") → "flex flex-col gap-8 p-6"
 * If no existing token found, appends the new token.
 */
export function replaceTwToken(className: string, prefix: string, newToken: string): string {
  // Escape special regex chars in prefix
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\s)${escaped}\\S*`, 'g');
  const found = re.test(className);
  if (found) {
    return className.replace(new RegExp(`(?:^|\\s)${escaped}\\S*`), m =>
      m.startsWith(' ') ? ` ${newToken}` : newToken
    ).trim();
  }
  return `${className} ${newToken}`.trim();
}

/**
 * Remove all tokens matching a prefix from className.
 * Always anchors to start-of-string or whitespace so single-letter prefixes
 * like 'w-' and 'h-' do NOT match inside compound tokens like 'min-w-0', 'max-h-full'.
 * (Using \b was wrong: the '-' before 'w' in 'min-w-' is a non-word char so \b
 * fires there, stripping 'w-0' and leaving a stray 'min-'.)
 */
export function removeTwToken(className: string, prefix: string): string {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return className
    .replace(new RegExp(`(?:^|(?<=\\s))${escaped}\\S*`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract the first token matching a prefix, returns null if not found.
 * e.g. parseTwToken("p-6 text-sm", "p-") → "p-6"
 * Anchors to start-of-string or whitespace to avoid matching partial tokens
 * e.g. parseTwToken("min-h-0", "h-") must return null, not "h-0".
 */
export function parseTwToken(className: string, prefix: string): string | null {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = className.match(new RegExp(`(?:^|(?<=\\s))(${escaped}\\S*)`));
  return match ? match[1] : null;
}

/**
 * Convert a px value to the nearest Tailwind spacing token.
 * e.g. pxToTw(16) → 4   (4 × 4px = 16px)
 */
export function pxToSpacingScale(px: number): number {
  const pxToScale: Record<number, number> = {};
  for (const [scale, pxVal] of Object.entries(SPACING_PX)) {
    pxToScale[pxVal] = Number(scale);
  }
  // Find nearest px value in the scale, rounding UP on ties.
  // e.g. px=1 ties between 0px and 2px → rounds UP to 2px (scale 0.5) so at least some margin shows.
  const closest = Object.keys(pxToScale)
    .map(Number)
    .reduce((a, b) => Math.abs(b - px) <= Math.abs(a - px) ? b : a);
  return pxToScale[closest] ?? 0;
}

/**
 * Convert px value to a Tailwind class with the given prefix.
 * e.g. pxToTw(16, 'p') → 'p-4'
 */
export function pxToTw(px: number, prefix: string): string {
  const scale = pxToSpacingScale(px);
  return `${prefix}-${scale}`;
}

/**
 * Convert a Tailwind spacing token to px.
 * Handles both named scale tokens (pt-4 → 16) and arbitrary tokens (pt-[13px] → 13).
 */
export function twToPx(token: string): number {
  // Arbitrary value: pt-[13px] or pt-[13.5px]
  const arb = token.match(/\[(\d+(?:\.\d+)?)px\]/);
  if (arb) return parseFloat(arb[1]);
  // Named scale: pt-4 → scale 4 → 16px
  const match = token.match(/-([\d.]+)$/);
  if (!match) return 0;
  const scale = parseFloat(match[1]);
  return SPACING_PX[scale] ?? 0;
}

/**
 * Named border-radius token → px value lookup (Tailwind v3 defaults).
 * e.g. 'rounded-md' → 6, 'rounded-lg' → 8
 */
const ROUNDED_TOKEN_PX: Record<string, number> = {
  'rounded-none': 0,
  'rounded-sm':   2,
  'rounded':      4,
  'rounded-md':   6,
  'rounded-lg':   8,
  'rounded-xl':   12,
  'rounded-2xl':  16,
  'rounded-3xl':  24,
  'rounded-full': 9999,
};

/**
 * Read the px value of a named rounded token in a className string.
 * Checks corner tokens (prefix = 'rounded-tl-' etc.) and global tokens.
 * Returns undefined when neither an arbitrary nor a named token is found.
 * e.g. parseRoundedNamedTokenPx('rounded-md', 'rounded-') → 6
 *      parseRoundedNamedTokenPx('rounded-tl-lg', 'rounded-tl-') → 8
 *      parseRoundedNamedTokenPx('rounded', 'rounded-') → 4
 */
export function parseRoundedNamedTokenPx(className: string, prefix: string): number | undefined {
  // Special case: plain 'rounded' token (no suffix) when looking for the global 'rounded-' prefix.
  // The standard regex below requires at least one char after the dash, so 'rounded' alone won't match.
  if (prefix === 'rounded-') {
    const plainMatch = className.match(/(?:^|(?<=\s))(rounded)(?!\S)/);
    if (plainMatch) return ROUNDED_TOKEN_PX['rounded']; // 4px
  }
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = className.match(new RegExp(`(?:^|(?<=\\s))(${escaped}\\S*)`));
  if (!match) return undefined;
  const token = match[1];
  // For corner tokens (e.g. 'rounded-tl-lg'), map to the global equivalent
  const global = token.startsWith('rounded-tl-') ? 'rounded' + token.slice('rounded-tl'.length)
    : token.startsWith('rounded-tr-') ? 'rounded' + token.slice('rounded-tr'.length)
    : token.startsWith('rounded-br-') ? 'rounded' + token.slice('rounded-br'.length)
    : token.startsWith('rounded-bl-') ? 'rounded' + token.slice('rounded-bl'.length)
    : token;
  return ROUNDED_TOKEN_PX[global];
}

/**
 * Extract the numeric px value from an arbitrary-value Tailwind token.
 * e.g. parseTwArbitrary("flex w-[320px] h-[180px]", "w-") → 320
 * Also handles % values: parseTwArbitrary("w-[50%]", "w-") → 50
 * Returns null if the token is not present or is not an arbitrary value.
 */
export function parseTwArbitrary(className: string, prefix: string): number | null {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match px, %, vh, and vw units
  const match = className.match(new RegExp(`\\b${escaped}\\[(\\d+(?:\\.\\d+)?)(px|%|vh|vw)\\]`));
  return match ? parseFloat(match[1]) : null;
}

/**
 * Extract the numeric value and unit from an arbitrary-value Tailwind token.
 * e.g. parseTwArbitraryWithUnit("w-[50%]", "w-") → {value: 50, unit: '%'}
 * e.g. parseTwArbitraryWithUnit("w-[320px]", "w-") → {value: 320, unit: 'px'}
 * Returns null if not found.
 */
export function parseTwArbitraryWithUnit(className: string, prefix: string): { value: number; unit: string } | null {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = className.match(new RegExp(`\\b${escaped}\\[(\\d+(?:\\.\\d+)?)(px|%|vh|vw)\\]`));
  if (match) return { value: parseFloat(match[1]), unit: match[2] };
  return null;
}

/**
 * Extract the px number from an arbitrary-value class with a px unit.
 * e.g. parseTwArbitraryPx("rounded-[8px] border-[2px]", "rounded-") → 8
 * Returns undefined if not found. Used by the design panel to read stored values.
 */
export function parseTwArbitraryPx(className: string, prefix: string): number | undefined {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = className.match(new RegExp(`\\b${escaped}\\[(\\d+(?:\\.\\d+)?)px\\]`));
  return m ? parseFloat(m[1]) : undefined;
}

/**
 * Extract the unitless number from an arbitrary-value class (no px).
 * e.g. parseTwArbitraryNum("z-[10] opacity-[0.5]", "z-") → 10
 * Returns undefined if not found. Used by the design panel to read stored values.
 */
export function parseTwArbitraryNum(className: string, prefix: string): number | undefined {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = className.match(new RegExp(`\\b${escaped}\\[(\\d+(?:\\.\\d+)?)\\]`));
  return m ? parseFloat(m[1]) : undefined;
}

/**
 * Convert a flat `props.style` dict into Tailwind arbitrary-value className tokens,
 * merged into the existing className string.
 *
 * Only handles the properties produced by patchStyle(); other style keys are ignored.
 * Removes any existing token for the same property before appending the new one,
 * so repeated edits never accumulate duplicate tokens.
 */
export function styleToClassName(
  style: Record<string, string>,
  existingCls: string,
): string {
  let cls = existingCls;

  const set = (prefix: string, value: string) => {
    if (!value && value !== '0') return;
    // Remove all existing tokens for this prefix (both scale and arbitrary)
    cls = removeTwToken(cls, prefix);
    cls = `${cls} ${prefix}[${value}]`.trim();
  };

  const px = (v: string) => {
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : `${n}px`;
  };

  // ── Colors ──────────────────────────────────────────────────────────────────
  if (style.backgroundColor) {
    cls = removeTwToken(cls, 'bg-');
    // Keep non-arbitrary bg tokens (e.g. bg-primary) but replace arbitrary hex
    cls = cls.replace(/\bbg-\[#[0-9a-fA-F]{3,8}\]/g, '').replace(/\s+/g, ' ').trim();
    cls = `${cls} bg-[${style.backgroundColor}]`.trim();
  }
  if (style.color) {
    // Remove existing arbitrary color tokens (hex or color functions like rgba/rgb)
    cls = cls.replace(/\btext-\[(?:#[0-9a-fA-F]{3,8}|rgba?\([^\]]*\))\]/g, '').replace(/\s+/g, ' ').trim();
    cls = `${cls} text-[${style.color}]`.trim();
  }
  if (style.borderColor) {
    cls = cls.replace(/\bborder-\[(?:#[0-9a-fA-F]{3,8}|rgba?\([^\]]*\))\]/g, '').replace(/\s+/g, ' ').trim();
    cls = `${cls} border-[${style.borderColor}]`.trim();
  }

  // ── Dimensions ──────────────────────────────────────────────────────────────
  if (style.width !== undefined && style.width !== '') {
    cls = removeTwToken(cls, 'w-');
    if (style.width) cls = `${cls} w-[${style.width}]`.trim();
  }
  if (style.height !== undefined && style.height !== '') {
    cls = removeTwToken(cls, 'h-');
    if (style.height) cls = `${cls} h-[${style.height}]`.trim();
  }

  if (style.minWidth !== undefined) {
    cls = removeTwToken(cls, 'min-w-');
    if (style.minWidth === '0') cls = `${cls} min-w-0`.trim();
    else if (style.minWidth) cls = `${cls} min-w-[${style.minWidth}]`.trim();
  }
  if (style.maxWidth !== undefined) {
    cls = removeTwToken(cls, 'max-w-');
    if (style.maxWidth) cls = `${cls} max-w-[${style.maxWidth}]`.trim();
  }
  if (style.minHeight !== undefined) {
    cls = removeTwToken(cls, 'min-h-');
    if (style.minHeight) cls = `${cls} min-h-[${style.minHeight}]`.trim();
  }
  if (style.maxHeight !== undefined) {
    cls = removeTwToken(cls, 'max-h-');
    if (style.maxHeight) cls = `${cls} max-h-[${style.maxHeight}]`.trim();
  }

  // ── Padding ──────────────────────────────────────────────────────────────────
  const padMap: [string, string][] = [
    ['paddingTop',    'pt-'],
    ['paddingRight',  'pr-'],
    ['paddingBottom', 'pb-'],
    ['paddingLeft',   'pl-'],
    ['paddingBlock',  'py-'],
    ['paddingInline', 'px-'],
  ];
  for (const [key, pfx] of padMap) {
    if (style[key] !== undefined) {
      cls = removeTwToken(cls, pfx);
      const p = px(style[key]);
      if (p) cls = `${cls} ${pfx}[${p}]`.trim();
    }
  }

  // ── Margin ───────────────────────────────────────────────────────────────────
  const marMap: [string, string][] = [
    ['marginTop',    'mt-'],
    ['marginRight',  'mr-'],
    ['marginBottom', 'mb-'],
    ['marginLeft',   'ml-'],
  ];
  for (const [key, pfx] of marMap) {
    if (style[key] !== undefined) {
      cls = removeTwToken(cls, pfx);
      const p = px(style[key]);
      if (p) cls = `${cls} ${pfx}[${p}]`.trim();
    }
  }

  // ── Gap ──────────────────────────────────────────────────────────────────────
  if (style.gap !== undefined) {
    cls = removeTwToken(cls, 'gap-');
    const p = px(style.gap);
    if (p) cls = `${cls} gap-[${p}]`.trim();
  }

  // ── Opacity ──────────────────────────────────────────────────────────────────
  if (style.opacity !== undefined) {
    cls = removeTwToken(cls, 'opacity-');
    const o = parseFloat(style.opacity);
    if (!Number.isNaN(o)) {
      // Store as opacity-[0.5] (arbitrary) so round-trips are lossless
      cls = `${cls} opacity-[${o}]`.trim();
    }
  }

  // ── Transform (rotation) ─────────────────────────────────────────────────────
  // Rotation is stored exclusively in props.style.transform — never synced back
  // to className. Remove any stale rotate-[...] token if style.transform is set.
  if (style.transform !== undefined) {
    cls = removeTwToken(cls, 'rotate-');
    cls = removeTwToken(cls, '-rotate-');
  }

  // ── Inset (top / right / bottom / left) ──────────────────────────────────────
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (style[side] !== undefined) {
      cls = removeTwToken(cls, `${side}-`);
      const p = px(style[side]);
      if (p) cls = `${cls} ${side}-[${p}]`.trim();
    }
  }

  // ── Border radius (uniform) ───────────────────────────────────────────────────
  // Removes ALL rounded tokens (global + per-corner) so a uniform radius wins.
  if (style.borderRadius !== undefined) {
    cls = cls
      .replace(/\brounded-(?:tl|tr|br|bl)-\S+/g, '')
      .replace(/\brounded-(?:tl|tr|br|bl)\b/g, '')
      .replace(/\brounded-\S+/g, '')
      .replace(/\brounded\b/g, '')
      .replace(/\s+/g, ' ').trim();
    const p = px(style.borderRadius);
    if (p) cls = `${cls} rounded-[${p}]`.trim();
  }

  // ── Border radius (per-corner) ────────────────────────────────────────────────
  const cornerRadiusMap: [string, string][] = [
    ['borderTopLeftRadius',     'rounded-tl-'],
    ['borderTopRightRadius',    'rounded-tr-'],
    ['borderBottomRightRadius', 'rounded-br-'],
    ['borderBottomLeftRadius',  'rounded-bl-'],
  ];
  for (const [key, cornerPrefix] of cornerRadiusMap) {
    if (style[key] !== undefined) {
      cls = removeTwToken(cls, cornerPrefix);
      const p = px(style[key]);
      if (p) cls = `${cls} ${cornerPrefix}[${p}]`.trim();
    }
  }

  // ── Z-index ───────────────────────────────────────────────────────────────────
  if (style.zIndex !== undefined) {
    cls = removeTwToken(cls, 'z-');
    const z = parseInt(style.zIndex);
    if (!Number.isNaN(z)) cls = `${cls} z-[${z}]`.trim();
  }

  // ── Border width ──────────────────────────────────────────────────────────────
  // Only removes border-width tokens (0/2/4/8 scale and arbitrary px).
  // Does NOT remove border-style (border-solid), border-color, or inset-border tokens.
  if (style.borderWidth !== undefined) {
    cls = cls
      .replace(/\bborder-(?:0|2|4|8)\b/g, '')
      .replace(/\bborder-\[\d+(?:\.\d+)?px\]/g, '')
      .replace(/(?:^| )border(?= |$)/g, ' ')
      .replace(/\s+/g, ' ').trim();
    const p = px(style.borderWidth);
    if (p) cls = `${cls} border-[${p}]`.trim();
  }

  // ── Font size ─────────────────────────────────────────────────────────────────
  // Only removes text-size tokens. Does NOT remove text-color (text-[#hex], text-gray-*)
  // or text-alignment (text-left, text-center, etc.) tokens.
  if (style.fontSize !== undefined) {
    cls = cls
      .replace(/\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/g, '')
      .replace(/\btext-\[\d+(?:\.\d+)?px\]/g, '')
      .replace(/\s+/g, ' ').trim();
    const p = px(style.fontSize);
    if (p) cls = `${cls} text-[${p}]`.trim();
  }

  return cls.replace(/\s+/g, ' ').trim();
}

// ─── Four-sided spacing helpers ───────────────────────────────────────────────

export interface FourSides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Expand a className's padding tokens into four px values.
 * Handles p-*, px-*, py-*, pt-*, pr-*, pb-*, pl-* in priority order.
 */
export function expandPadding(className: string): FourSides {
  const p   = twToPx(parseTwToken(className, 'p-')  ?? 'p-0');
  const px  = parseTwToken(className, 'px-');
  const py  = parseTwToken(className, 'py-');
  const pt  = parseTwToken(className, 'pt-');
  const pr  = parseTwToken(className, 'pr-');
  const pb  = parseTwToken(className, 'pb-');
  const pl  = parseTwToken(className, 'pl-');

  return {
    top:    pt ? twToPx(pt) : py ? twToPx(py) : p,
    right:  pr ? twToPx(pr) : px ? twToPx(px) : p,
    bottom: pb ? twToPx(pb) : py ? twToPx(py) : p,
    left:   pl ? twToPx(pl) : px ? twToPx(px) : p,
  };
}

/**
 * Collapse four px padding values back into the minimal Tailwind className fragment.
 */
export function collapsePadding(sides: FourSides): string {
  const { top, right, bottom, left } = sides;
  if (top === right && right === bottom && bottom === left) {
    return `p-${pxToSpacingScale(top)}`;
  }
  if (top === bottom && left === right) {
    return `py-${pxToSpacingScale(top)} px-${pxToSpacingScale(left)}`;
  }
  return `pt-${pxToSpacingScale(top)} pr-${pxToSpacingScale(right)} pb-${pxToSpacingScale(bottom)} pl-${pxToSpacingScale(left)}`;
}

/**
 * Apply new padding to an existing className string (replaces all padding tokens).
 */
export function applyPadding(className: string, sides: FourSides): string {
  let cls = className;
  for (const prefix of ['p-', 'px-', 'py-', 'pt-', 'pr-', 'pb-', 'pl-']) {
    cls = removeTwToken(cls, prefix);
  }
  return `${cls} ${collapsePadding(sides)}`.trim();
}

// ─── Margin helpers (mirrors padding) ─────────────────────────────────────────

/**
 * Expand a className's margin tokens into four px values.
 * Handles m-*, mx-*, my-*, mt-*, mr-*, mb-*, ml-* in priority order.
 */
export function expandMargin(className: string): FourSides {
  const m   = twToPx(parseTwToken(className, 'm-')  ?? 'm-0');
  const mx  = parseTwToken(className, 'mx-');
  const my  = parseTwToken(className, 'my-');
  const mt  = parseTwToken(className, 'mt-');
  const mr  = parseTwToken(className, 'mr-');
  const mb  = parseTwToken(className, 'mb-');
  const ml  = parseTwToken(className, 'ml-');

  return {
    top:    mt ? twToPx(mt) : my ? twToPx(my) : m,
    right:  mr ? twToPx(mr) : mx ? twToPx(mx) : m,
    bottom: mb ? twToPx(mb) : my ? twToPx(my) : m,
    left:   ml ? twToPx(ml) : mx ? twToPx(mx) : m,
  };
}

function collapseMargin(sides: FourSides): string {
  const { top, right, bottom, left } = sides;
  if (top === right && right === bottom && bottom === left) {
    return `m-${pxToSpacingScale(top)}`;
  }
  if (top === bottom && left === right) {
    return `my-${pxToSpacingScale(top)} mx-${pxToSpacingScale(left)}`;
  }
  return `mt-${pxToSpacingScale(top)} mr-${pxToSpacingScale(right)} mb-${pxToSpacingScale(bottom)} ml-${pxToSpacingScale(left)}`;
}

export function applyMargin(className: string, sides: FourSides): string {
  let cls = className;
  for (const prefix of ['m-', 'mx-', 'my-', 'mt-', 'mr-', 'mb-', 'ml-']) {
    cls = removeTwToken(cls, prefix);
  }
  return `${cls} ${collapseMargin(sides)}`.trim();
}

// ─── Border radius helpers ────────────────────────────────────────────────────

export interface FourCorners {
  tl: string;
  tr: string;
  br: string;
  bl: string;
}

/**
 * Convert a global rounded token to a per-corner token.
 * e.g. globalToCornerToken('rounded-lg', 'tl') → 'rounded-tl-lg'
 *      globalToCornerToken('rounded-none', 'br') → 'rounded-br-none'
 *      globalToCornerToken('rounded', 'tr') → 'rounded-tr'
 */
function globalToCornerToken(global: string, corner: 'tl' | 'tr' | 'br' | 'bl'): string {
  const suffix = global.slice('rounded'.length); // '-lg', '-none', '', etc.
  return `rounded-${corner}${suffix}`;
}

/**
 * Convert a per-corner token back to the equivalent global token (for select display).
 * e.g. 'rounded-tl-lg' → 'rounded-lg'
 *      'rounded-tr-none' → 'rounded-none'
 *      'rounded-tl' → 'rounded'
 */
function cornerToGlobalToken(cornerToken: string, corner: 'tl' | 'tr' | 'br' | 'bl'): string {
  const suffix = cornerToken.slice(`rounded-${corner}`.length); // '-lg', '-none', '', etc.
  return `rounded${suffix}`;
}

export function expandBorderRadius(className: string): FourCorners {
  // Match per-corner tokens: rounded-{tl|tr|br|bl} optionally followed by -size
  const tlMatch = className.match(/\brounded-tl(?:-\S+)?/)?.[0];
  const trMatch = className.match(/\brounded-tr(?:-\S+)?/)?.[0];
  const brMatch = className.match(/\brounded-br(?:-\S+)?/)?.[0];
  const blMatch = className.match(/\brounded-bl(?:-\S+)?/)?.[0];

  // Match global token: 'rounded' NOT followed by a corner identifier (tl|tr|br|bl)
  const globalMatch = className.match(/\brounded(?!-(?:tl|tr|br|bl)\b)(?:-\S+)?/)?.[0] ?? 'rounded-none';

  return {
    tl: tlMatch ? cornerToGlobalToken(tlMatch, 'tl') : globalMatch,
    tr: trMatch ? cornerToGlobalToken(trMatch, 'tr') : globalMatch,
    br: brMatch ? cornerToGlobalToken(brMatch, 'br') : globalMatch,
    bl: blMatch ? cornerToGlobalToken(blMatch, 'bl') : globalMatch,
  };
}

export function applyBorderRadius(className: string, corners: FourCorners): string {
  // Remove ALL existing rounded tokens (per-corner first, then global)
  let cls = className
    .replace(/\brounded-(?:tl|tr|br|bl)(?:-\S+)?/g, '')
    .replace(/\brounded(?:-\S+)?/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const { tl, tr, br, bl } = corners;
  if (tl === tr && tr === br && br === bl) {
    // All corners equal — use a single global token
    return `${cls} ${tl}`.trim();
  }
  // Corners differ — use explicit per-corner tokens to avoid CSS order ambiguity
  return `${cls} ${globalToCornerToken(tl, 'tl')} ${globalToCornerToken(tr, 'tr')} ${globalToCornerToken(br, 'br')} ${globalToCornerToken(bl, 'bl')}`.trim();
}

// ─── Flex alignment ───────────────────────────────────────────────────────────

/**
 * Build the 9-cell alignment map for a flex container.
 *
 * Visual grid rows = vertical axis (top → bottom)
 * Visual grid cols = horizontal axis (left → right)
 *
 * flex-row  cross axis = vertical   → items-*   driven by row
 *           main  axis = horizontal → justify-* driven by col
 *
 * flex-col  main  axis = vertical   → justify-* driven by row
 *           cross axis = horizontal → items-*   driven by col
 */
function buildAlignCells(isRow: boolean): { items: string; justify: string }[] {
  const POS = ['start', 'center', 'end'] as const;
  return Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    if (isRow) {
      return { items: `items-${POS[row]}`, justify: `justify-${POS[col]}` };
    } else {
      // flex-col: rows drive justify (vertical main-axis), cols drive items (horizontal cross-axis)
      return { items: `items-${POS[col]}`, justify: `justify-${POS[row]}` };
    }
  });
}

export function getAlignCellIndex(className: string, isRow = false): number {
  const items   = parseTwToken(className, 'items-')   ?? 'items-start';
  const justify = parseTwToken(className, 'justify-') ?? 'justify-start';
  const idx = buildAlignCells(isRow).findIndex(c => c.items === items && c.justify === justify);
  return idx >= 0 ? idx : 0;
}

export function applyAlignment(className: string, cellIdx: number, isRow = false): string {
  const cell = buildAlignCells(isRow)[cellIdx];
  if (!cell) return className;
  const cls = removeTwToken(removeTwToken(className, 'items-'), 'justify-');
  return `${cls} ${cell.items} ${cell.justify}`.trim();
}

// ─── Color extraction ─────────────────────────────────────────────────────────

/**
 * Recursively extract all unique hex colors referenced in Tailwind arbitrary
 * value classes (bg-[#...], text-[#...], border-[#...]) from a node tree.
 */
export function extractColors(node: { props?: unknown; children?: unknown }): string[] {
  const found = new Set<string>();
  const hex = /#[0-9a-fA-F]{3,8}/g;

  function walk(n: { props?: unknown; children?: unknown }) {
    const rawCls = (n.props as { className?: unknown } | undefined)?.className ?? '';
    const cls = typeof rawCls === 'string' ? rawCls : '';
    const matches: string[] = cls.match(hex) ?? [];
    matches.forEach(m => found.add(m.toLowerCase()));
    const kids = n.children;
    if (Array.isArray(kids)) kids.forEach(k => walk(k as { props?: unknown; children?: unknown }));
  }

  walk(node);
  return Array.from(found);
}
