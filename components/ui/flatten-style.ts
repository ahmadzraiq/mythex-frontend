/**
 * Flattens a React Native style value (which may be a nested array of objects)
 * into a single plain CSSProperties object safe for DOM elements.
 *
 * RNW's View does this internally via StyleSheet.flatten, but our web host
 * components (Box, Text, Heading, etc.) render raw DOM elements that reject
 * style arrays. This utility bridges the gap so createAnimatedComponent can
 * pass style arrays through without crashing the DOM.
 */
export function flattenStyle(
  style: unknown,
): React.CSSProperties | undefined {
  if (style == null) return undefined;
  if (!Array.isArray(style)) return style as React.CSSProperties;
  const out: Record<string, unknown> = {};
  const flatten = (s: unknown) => {
    if (s == null) return;
    if (Array.isArray(s)) { for (const item of s) flatten(item); return; }
    if (typeof s === 'object') Object.assign(out, s);
  };
  flatten(style);
  return out as React.CSSProperties;
}
