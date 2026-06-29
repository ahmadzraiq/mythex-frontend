/**
 * Config Resolver - promotes screen `content` to `ui`.
 */

/** Deep clone - uses structuredClone when available (faster), falls back to JSON round-trip */
function deepClone<T>(obj: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}

export type SDUINodeLike = Record<string, unknown> & {
  type?: string;
  id?: string;
  children?: SDUINodeLike[];
};

/** Resolve a screen config - promotes `content` to `ui` */
export function resolveScreenConfig(
  screen: Record<string, unknown> & {
    content?: SDUINodeLike;
    ui?: SDUINodeLike;
  }
): Record<string, unknown> {
  const { content, ui, ...rest } = screen;
  const contentNode = content ?? ui;

  if (!contentNode) {
    return screen as Record<string, unknown>;
  }

  return { ...rest, ui: deepClone(contentNode) } as Record<string, unknown>;
}
