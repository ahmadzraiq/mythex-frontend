/**
 * Semantic search for builder nodes using vector embeddings.
 *
 * Architecture:
 *  - Each node's blob is embedded with text-embedding-3-small
 *  - Embeddings are cached per-node by blob content (incremental: only changed blobs re-embed)
 *  - On semantic_search, the query is embedded and cosine similarity ranks all nodes
 *  - Results are returned as NodeHit[] sorted by score descending
 *
 * Cache persistence:
 *  - On module load the cache is restored from .next/cache/node-embeddings.json (survives restarts)
 *  - After each embedNodes() call the cache is written back to disk (fire-and-forget)
 */

import { openai } from '@ai-sdk/openai';
import { embedMany, embed } from 'ai';
import fs from 'fs';
import path from 'path';

// Set to true to skip all OpenAI embedding calls (autosave pre-warming + semantic search).
// Semantic search will return 0 hits and the context agent falls back to text search.
export const EMBEDDINGS_ENABLED = true;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NodeForEmbedding {
  id: string;
  name?: string;
  type?: string;
  blob: string;
  path: string;
  parentId?: string;
  parentName?: string;
  pageRoute?: string;
}

export interface SemanticHit {
  kind: 'node';
  id: string;
  name?: string;
  type?: string;
  pageRoute: string;
  path: string;
  parentId?: string;
  parentName?: string;
  /** Cosine similarity score 0-1 */
  score: number;
}

// ─── Persistent file cache ────────────────────────────────────────────────────

// Disk location: .next/cache/node-embeddings.json
// Written after each embedNodes() call; read once on module load.
// Survives server restarts — avoids cold-cache penalty on process restart.
const CACHE_FILE = path.join(process.cwd(), '.next', 'cache', 'node-embeddings.json');

type DiskCacheEntry = { blob: string; vector: number[] };
type DiskCache = Record<string, DiskCacheEntry>;

function loadCacheFromDisk(): void {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as DiskCache;
    let loaded = 0;
    for (const [id, entry] of Object.entries(parsed)) {
      if (entry?.blob && Array.isArray(entry.vector)) {
        nodeVectorCache.set(id, { blob: entry.blob, vector: entry.vector });
        loaded++;
      }
    }
    if (loaded > 0) {
      console.log(`[semantic-search] loaded ${loaded} embeddings from disk cache`);
    }
  } catch {
    // File doesn't exist yet or is corrupt — start with empty cache
  }
}

function saveCacheToDisk(): void {
  // Non-blocking: schedule write on next tick so the hot path is never delayed
  setImmediate(() => {
    try {
      const dir = path.dirname(CACHE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const obj: DiskCache = {};
      for (const [id, entry] of nodeVectorCache) {
        obj[id] = entry;
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify(obj), 'utf8');
    } catch (err) {
      console.warn('[semantic-search] failed to write disk cache:', err instanceof Error ? err.message : err);
    }
  });
}

// ─── Module-level incremental cache ──────────────────────────────────────────

// Map from nodeId → { blob (content key), vector }
// Persists across requests within the same server process.
// Only nodes whose blob changed are re-embedded.
const nodeVectorCache = new Map<string, { blob: string; vector: number[] }>();

// Map from query string → embedding vector.
// Avoids redundant embed() API calls (~0.5s each) for repeated query strings
// within the same server process (e.g. "red button", "hero section").
const queryVectorCache = new Map<string, number[]>();

// Restore from disk on module load (runs once when the route first compiles)
loadCacheFromDisk();

// ─── Cosine similarity ────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Embedding model ──────────────────────────────────────────────────────────

const EMBEDDING_MODEL = openai.embedding('text-embedding-3-small');
// Truncate blob to keep token count reasonable (~350 tokens per 1400 chars)
const BLOB_MAX_CHARS = 1400;
// Batch size for embedMany calls
const BATCH_SIZE = 100;

// ─── Public: embed nodes (incremental) ───────────────────────────────────────

/**
 * Embeds all nodes whose blob has changed since the last call.
 * Returns the live cache map (nodeId → vector) for use in runSemanticSearch.
 * Modifies nodeVectorCache in place.
 */
export async function embedNodes(
  nodes: NodeForEmbedding[],
  options: { upsertOnly?: boolean } = {},
): Promise<Map<string, number[]>> {
  if (!EMBEDDINGS_ENABLED) return new Map();

  // 1. Find nodes that need (re-)embedding: new nodes or blob changed
  const toEmbed: Array<{ id: string; blob: string }> = [];
  for (const n of nodes) {
    const cached = nodeVectorCache.get(n.id);
    const truncated = n.blob.slice(0, BLOB_MAX_CHARS);
    if (!cached || cached.blob !== truncated) {
      toEmbed.push({ id: n.id, blob: truncated });
    }
  }

  // 2. Remove stale entries — only when NOT in upsertOnly mode.
  // upsertOnly: true is used by ensure-index (pre-warming per save) so it doesn't
  // wipe other pages' embeddings. dispatch.ts passes ALL pages so cleanup is correct.
  if (!options.upsertOnly) {
    const liveIds = new Set(nodes.map(n => n.id));
    for (const id of nodeVectorCache.keys()) {
      if (!liveIds.has(id)) nodeVectorCache.delete(id);
    }
  }

  // 3. Batch-embed changed nodes
  if (toEmbed.length > 0) {
    // Split into batches of BATCH_SIZE to stay within API limits
    for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + BATCH_SIZE);
      const { embeddings } = await embedMany({
        model: EMBEDDING_MODEL,
        values: batch.map(n => n.blob),
        maxRetries: 1,
      });
      embeddings.forEach((vec, idx) => {
        nodeVectorCache.set(batch[idx].id, { blob: batch[idx].blob, vector: vec });
      });
    }
    // Persist updated cache to disk — fire-and-forget via setImmediate so the hot path
    // is never blocked. Survives server restarts; eliminates cold-cache penalty.
    saveCacheToDisk();
  }

  // 4. Return flat id → vector map for this request
  const result = new Map<string, number[]>();
  for (const n of nodes) {
    const cached = nodeVectorCache.get(n.id);
    if (cached) result.set(n.id, cached.vector);
  }
  return result;
}

// ─── Public: read from cache without embedding ───────────────────────────────

/**
 * Returns cached embedding vectors for the given node IDs without any API calls.
 * Used by dispatch.ts — the cache is pre-warmed by /api/ai/retrieval/ensure-index on save.
 * Returns an empty map for nodes not in cache (semantic_search gracefully returns no results).
 */
export function getCachedEmbeddings(nodeIds: string[]): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const id of nodeIds) {
    const cached = nodeVectorCache.get(id);
    if (cached) result.set(id, cached.vector);
  }
  return result;
}

// ─── Public: run semantic search ─────────────────────────────────────────────

/**
 * Embeds the query and returns nodes ranked by cosine similarity.
 * nodeEmbeddings is the map returned by embedNodes().
 */
export async function runSemanticSearch(
  query: string,
  nodeEmbeddings: Map<string, number[]>,
  nodes: NodeForEmbedding[],
  minScore = 0.30,
): Promise<SemanticHit[]> {
  if (!EMBEDDINGS_ENABLED) return [];
  if (nodeEmbeddings.size === 0) return [];

  // Embed the query — use cache to avoid repeated API calls for the same text
  let queryVec = queryVectorCache.get(query);
  if (!queryVec) {
    const { embedding } = await embed({
      model: EMBEDDING_MODEL,
      value: query,
      maxRetries: 1,
    });
    queryVec = embedding;
    queryVectorCache.set(query, queryVec);
  }

  // Score all nodes — return every node above the threshold (no fixed cap)
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const scored: Array<{ id: string; score: number }> = [];

  for (const [id, vec] of nodeEmbeddings) {
    const score = cosineSimilarity(queryVec, vec);
    if (score >= minScore) scored.push({ id, score });
  }

  // Sort descending — return all nodes above minScore, no cap.
  // The caller decides how many to use; minScore is the only principled filter.
  scored.sort((a, b) => b.score - a.score);
  const top = scored;

  return top.map(({ id, score }) => {
    const n = nodeMap.get(id);
    return {
      kind: 'node' as const,
      id,
      name: n?.name,
      type: n?.type,
      pageRoute: n?.pageRoute ?? '/',
      path: n?.path ?? id,
      parentId: n?.parentId,
      parentName: n?.parentName,
      score,
    };
  });
}
