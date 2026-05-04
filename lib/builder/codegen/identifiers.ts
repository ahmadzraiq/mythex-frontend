/**
 * Safe JS identifier generation.
 * Converts UUIDs, user-supplied names, and arbitrary strings into
 * camelCase identifiers that are:
 *   - valid JS identifiers
 *   - not JS reserved words
 *   - not colliding with built-in state scope names
 *   - unique within a generated symbol map
 */

const JS_RESERVED = new Set([
  'break','case','catch','class','const','continue','debugger','default',
  'delete','do','else','enum','export','extends','false','finally','for',
  'function','if','import','in','instanceof','let','new','null','return',
  'static','super','switch','this','throw','true','try','typeof','undefined',
  'var','void','while','with','yield','async','await','of',
]);

/** Names already used by the emitted state shape — cannot be reused as variable names */
const RESERVED_STATE_NAMES = new Set([
  'variables','collections','route','auth','local','pages','_workflow',
  'event','theme','globalContext','context','parameters','value',
  'state','store','useStore','router','api','form','popover',
]);

/**
 * Convert an arbitrary string (UUID, user label, dotted path) to a
 * camelCase JS identifier.
 *
 * Examples:
 *   "my-var name"  → "myVarName"
 *   "123abc"       → "n123abc"
 *   "if"           → "ifVar"
 *   "variables"    → "variables_"
 *   "abc0d6f3-..."  → "abc0d6f3..."  (UUID trimmed)
 */
export function toIdent(raw: string): string {
  // Strip UUID dashes to get a compact base
  let s = raw.replace(/-/g, '_').replace(/[^a-zA-Z0-9_$]/g, '_');

  // camelCase: split on underscores, capitalise each segment after the first
  const parts = s.split('_').filter(Boolean);
  if (parts.length === 0) return '_unknown';
  s = parts[0]!.toLowerCase() +
    parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');

  // Must start with a letter or $
  if (!/^[a-zA-Z_$]/.test(s)) s = 'n' + s;

  // Avoid reserved words
  if (JS_RESERVED.has(s)) s = s + 'Value';
  if (RESERVED_STATE_NAMES.has(s)) s = s + 'Var';

  return s;
}

/**
 * Build a SymbolMap entry from a label (preferred) with UUID as fallback key.
 * Deduplicates within a provided `used` set by appending a numeric suffix.
 */
export function uniqueIdent(label: string | undefined, uuid: string, used: Set<string>): string {
  const base = toIdent(label?.trim() || uuid);
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = base + n;
    n++;
  }
  used.add(candidate);
  return candidate;
}

/** Convert a route path to a PascalCase component name.
 *  e.g. "/products/[id]" → "ProductsIdPage"
 *       "/"              → "HomePage"
 */
export function routeToComponentName(route: string): string {
  const clean = route.replace(/^\//, '').replace(/\/$/, '');
  if (!clean) return 'HomePage';
  const parts = clean
    .split('/')
    .map(seg => seg.replace(/[\[\]]/g, '').replace(/[^a-zA-Z0-9]/g, '_'))
    .filter(Boolean)
    .map(seg => seg.charAt(0).toUpperCase() + seg.slice(1));
  return (parts.join('') || 'Home') + 'Page';
}

/** Convert route to a Next.js file system path under app/.
 *  e.g. "/" → "app/page.tsx"
 *       "/about" → "app/about/page.tsx"
 *       "/blog/[slug]" → "app/blog/[slug]/page.tsx"
 */
export function routeToFilePath(route: string, prefix = 'app'): string {
  const clean = route.replace(/^\//, '').replace(/\/$/, '');
  if (!clean) return `${prefix}/page.tsx`;
  return `${prefix}/${clean}/page.tsx`;
}
