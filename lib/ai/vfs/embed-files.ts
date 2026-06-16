/**
 * Embeddings for the virtual file system.
 *
 * One vector per MEANINGFUL entity (nodes with a name or _group + all resource files).
 * The embedding text is the entity's full theme-expanded blob (same text grep uses).
 *
 * Cache: keyed by entity.key + content hash. Survives restarts via .next/cache/file-embeddings.json.
 * Only re-embeds entities whose blob has changed since last call.
 */

import { openai } from '@ai-sdk/openai';
import { embedMany, embed } from 'ai';
import fs from 'fs';
import path from 'path';
import { extractEntities, parseTheme, type Entity } from './entities';

// Set to false to skip all OpenAI embedding calls (search falls back to lexical only).
const EMBEDDINGS_ENABLED = true;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EntityHit {
  /** Entity key (path#nodePath for nodes, path for resources) */
  key: string;
  path: string;
  line: number;
  name?: string;
  type?: string;
  kind: string;
  score: number;
  snippet: string;
}

// ─── Disk cache ───────────────────────────────────────────────────────────────

const CACHE_FILE = path.join(process.cwd(), '.next', 'cache', 'file-embeddings.json');
type CacheEntry = { hash: string; vector: number[] };
const entityVectorCache = new Map<string, CacheEntry>();
const queryVectorCache = new Map<string, number[]>();

const EMBEDDING_MODEL = openai.embedding('text-embedding-3-small');
const BATCH_SIZE = 50;

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < Math.min(s.length, 4096); i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

(function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    for (const [k, entry] of Object.entries(parsed)) {
      if (entry?.hash && Array.isArray(entry.vector)) {
        entityVectorCache.set(k, entry);
      }
    }
  } catch { /* no cache yet */ }
})();

function saveCache(): void {
  setImmediate(() => {
    try {
      const dir = path.dirname(CACHE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const obj: Record<string, CacheEntry> = {};
      for (const [k, e] of entityVectorCache) obj[k] = e;
      fs.writeFileSync(CACHE_FILE, JSON.stringify(obj), 'utf8');
    } catch { /* non-critical */ }
  });
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Embed all meaningful entities whose blob has changed since last call.
 * Returns Map<entityKey, { vector, entity }> for use in hybridSearch.
 */
export async function embedFiles(
  files: Record<string, string>,
): Promise<Map<string, { vector: number[]; entity: Entity }>> {
  if (!EMBEDDINGS_ENABLED) return new Map();

  const theme = parseTheme(files);
  const allEntities = extractEntities(files, theme);
  const meaningful = allEntities.filter(e => e.meaningful);

  const expectedKeys = new Set(meaningful.map(e => e.key));
  const toEmbed: Array<{ key: string; blob: string; hash: string; entity: Entity }> = [];

  for (const entity of meaningful) {
    const hash = simpleHash(entity.blob);
    const cached = entityVectorCache.get(entity.key);
    if (!cached || cached.hash !== hash) {
      toEmbed.push({ key: entity.key, blob: entity.blob, hash, entity });
    }
  }

  // Remove stale cache entries
  for (const k of entityVectorCache.keys()) {
    if (!expectedKeys.has(k)) entityVectorCache.delete(k);
  }

  if (toEmbed.length > 0) {
    for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + BATCH_SIZE);
      const { embeddings } = await embedMany({
        model: EMBEDDING_MODEL,
        values: batch.map(b => b.blob),
        maxRetries: 1,
      });
      embeddings.forEach((vec, idx) => {
        entityVectorCache.set(batch[idx].key, { hash: batch[idx].hash, vector: vec });
      });
    }
    saveCache();
    console.log(`[embed-files] embedded ${toEmbed.length} new/changed entities (${meaningful.length} total meaningful)`);
  }

  const result = new Map<string, { vector: number[]; entity: Entity }>();
  for (const entity of meaningful) {
    const cached = entityVectorCache.get(entity.key);
    if (cached) result.set(entity.key, { vector: cached.vector, entity });
  }
  return result;
}

/**
 * Hybrid search: runs vector search + lexical blob match in parallel,
 * fuses results with Reciprocal Rank Fusion (RRF, k=60), returns top_k ranked hits.
 */
export async function codebaseSearch(
  query: string,
  entityIndex: Map<string, { vector: number[]; entity: Entity }>,
  _minScore = 0.2,
  topK = 8,
): Promise<EntityHit[]> {
  if (!EMBEDDINGS_ENABLED || entityIndex.size === 0) return [];

  // ── Vector arm ───────────────────────────────────────────────────────────────
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

  const vectorScored: Array<{ key: string; score: number }> = [];
  for (const [key, { vector }] of entityIndex) {
    vectorScored.push({ key, score: cosineSim(queryVec, vector) });
  }
  vectorScored.sort((a, b) => b.score - a.score);

  // ── Lexical arm (simple multi-term match count) ───────────────────────────────
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  const lexicalScored: Array<{ key: string; score: number }> = [];
  for (const [key, { entity }] of entityIndex) {
    const blobLower = entity.blob.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      if (blobLower.includes(term)) score++;
    }
    if (score > 0) lexicalScored.push({ key, score });
  }
  lexicalScored.sort((a, b) => b.score - a.score);

  // ── RRF fusion (k=60) ──────────────────────────────────────────────────────────
  const RRF_K = 60;
  const rrfScores = new Map<string, number>();

  vectorScored.forEach(({ key }, rank) => {
    rrfScores.set(key, (rrfScores.get(key) ?? 0) + 1 / (RRF_K + rank + 1));
  });
  lexicalScored.forEach(({ key }, rank) => {
    rrfScores.set(key, (rrfScores.get(key) ?? 0) + 1 / (RRF_K + rank + 1));
  });

  const sorted = [...rrfScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK);

  console.log(`[codebase_search] query="${query}" → ${sorted.length} hits (${entityIndex.size} indexed)`);

  return sorted.map(([key, score]) => {
    const { entity } = entityIndex.get(key)!;
    const snippet = entity.blob.slice(0, 100).replace(/\s+/g, ' ').trim() + (entity.blob.length > 100 ? '…' : '');
    return {
      key,
      path: entity.path,
      line: entity.line,
      name: entity.name,
      type: entity.type,
      kind: entity.kind,
      score,
      snippet,
    };
  });
}
