/**
 * POST /api/ai/retrieval/ensure-index
 *
 * Warms the server-side node embedding cache so that AI messages can do
 * semantic_search instantly without blocking on OpenAI API calls.
 *
 * Called fire-and-forget by autosave whenever builder nodes change.
 * Returns immediately (200) — embedding runs in the background.
 */

import { NextRequest } from 'next/server';
import { embedNodes, EMBEDDINGS_ENABLED } from '@/lib/ai/tools/semantic-search';

// ─── Inline node flattening ───────────────────────────────────────────────────
// Mirrors the blob construction in _use-ai-chat.ts flattenNodes so that
// the embedding cache uses identical content keys.

interface RawNode {
  id: string;
  name?: string;
  type?: string;
  text?: unknown;
  props?: Record<string, unknown>;
  styles?: Record<string, unknown>;
  map?: Record<string, unknown>;
  actions?: unknown[];
  condition?: unknown;
  children?: RawNode[];
}

type FlatNode = {
  id: string;
  name?: string;
  type?: string;
  blob: string;
  path: string;
  parentId?: string;
  pageRoute: string;
};

function flattenNodesForEmbedding(
  nodes: RawNode[],
  pageRoute: string,
  path = '',
  parentId?: string,
): FlatNode[] {
  const result: FlatNode[] = [];
  for (const n of nodes) {
    if (!n.id) continue;
    const nodeName = n.name ?? n.type ?? 'Node';
    const nodePath = path ? `${path} > ${nodeName}` : nodeName;
    const textVal = typeof n.text === 'string' ? n.text : n.text != null ? JSON.stringify(n.text) : null;
    const childrenText = (n.children ?? [])
      .map(c => (typeof c.text === 'string' ? c.text : null))
      .filter(Boolean)
      .join(' ');
    const blob = [
      n.name, n.type, n.id,
      textVal,
      childrenText,
      JSON.stringify(n.props ?? {}),
      JSON.stringify(n.styles ?? {}),
      JSON.stringify(n.map ?? {}),
      JSON.stringify(n.actions ?? []),
      JSON.stringify(n.condition ?? ''),
    ].filter(Boolean).join(' ');
    result.push({ id: n.id, name: n.name, type: n.type, blob, path: nodePath, parentId, pageRoute });
    if (n.children?.length) {
      result.push(...flattenNodesForEmbedding(n.children, pageRoute, nodePath, n.id));
    }
  }
  return result;
}

function expandThemeTokens(blob: string, theme: Record<string, string>): string {
  return blob.replace(/var\(--theme-([^)]+)\)/g, (match, key: string) => {
    const hex = theme[key];
    return hex ? `${match} /* ${key} ${hex} */` : match;
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────
//
// Accepts all pages at once so every page's nodes are indexed on each save —
// not just the active page. Uses upsertOnly so other pages already in cache
// are preserved (dispatch.ts is responsible for full-set cleanup).

export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ ok: true, skipped: 'no OPENAI_API_KEY' });
  }
  // Mirror the EMBEDDINGS_ENABLED flag in semantic-search.ts — skip early if disabled.
  if (!EMBEDDINGS_ENABLED) {
    return Response.json({ ok: true, skipped: 'embeddings disabled' });
  }

  let body: { pages?: unknown; theme?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  const { pages, theme = {} } = body;

  if (!Array.isArray(pages) || pages.length === 0) {
    return Response.json({ ok: true, skipped: 'no pages' });
  }

  const themeMap = theme as Record<string, string>;

  const nodesForEmbedding = (pages as Array<{ pageRoute?: unknown; nodes?: unknown }>).flatMap(p => {
    const pageRoute = String(p.pageRoute ?? '/');
    if (!Array.isArray(p.nodes) || p.nodes.length === 0) return [];
    return flattenNodesForEmbedding(p.nodes as RawNode[], pageRoute).map(n => ({
      ...n,
      blob: expandThemeTokens(n.blob, themeMap),
    }));
  });

  if (nodesForEmbedding.length === 0) {
    return Response.json({ ok: true, skipped: 'no nodes across pages' });
  }

  // upsertOnly: true — add/update these pages' nodes without wiping other pages from cache.
  // dispatch.ts always passes ALL pages and handles full-set cleanup on each AI request.
  embedNodes(nodesForEmbedding, { upsertOnly: true }).catch(err => {
    console.warn('[ensure-index] embedNodes error:', err instanceof Error ? err.message : err);
  });

  return Response.json({ ok: true, nodeCount: nodesForEmbedding.length, pageCount: pages.length });
}
