/**
 * Path utilities - shared across engine, renderer, variable-store
 */

/** Check if path is screen-scoped (form, errors, etc.) per engineConventions.screenScopedAliases */
export function isScreenScopedPath(path: string, aliases: string[]): boolean {
  return aliases.some((a) => path === a || path.startsWith(`${a}.`));
}

/** Check if path is a scope variable ($item, $index, $parent, or context.*) - not a store path */
export function isScopeVariable(path: string): boolean {
  return (
    path === '$item' ||
    path === '$index' ||
    path === '$parent' ||
    path.startsWith('$item.') ||
    path.startsWith('$index.') ||
    path.startsWith('$parent.') ||
    // context.* scope variables (weWeb-style)
    // Covers: context.item, context.item.data.*, context.item.parent.*,
    //         context.item.index, context.item.repeatIndex, context.item.isACopy,
    //         context.item.repeatedItems, context.index, context.parent.*
    path === 'context' ||
    path.startsWith('context.')
  );
}
