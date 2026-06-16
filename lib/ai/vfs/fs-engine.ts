/**
 * FsEngine — Server-side in-memory virtual file system for the file-based builder agent.
 *
 * Initialised with a snapshot of all VFS files (Record<path, jsonString>).
 * The agent's read tools query the engine; write tools mutate it and append
 * to pendingOps so the agentic loop can stream each write to the client.
 *
 * Path convention: no .json extension, no leading "config/" prefix.
 * e.g. "pages/home/page", "store/cartCount", "workflows/addToCart"
 */

import { extractEntities, parseTheme, type Entity } from './entities';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type FsPendingOp =
  | { kind: 'write'; path: string; content: string }
  | { kind: 'delete'; path: string };

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

// ─── Engine ────────────────────────────────────────────────────────────────────

export class FsEngine {
  /** Current in-memory state of all files. */
  private files: Map<string, string>;

  /** Ordered list of write/delete operations emitted since construction. */
  readonly pendingOps: FsPendingOp[] = [];

  /** Cached entity extraction — invalidated on any write/delete. */
  private _entityCache: { version: number; entities: Entity[]; theme: Record<string, string> } | null = null;
  private _version = 0;

  constructor(initialFiles: Record<string, string>) {
    this.files = new Map(Object.entries(initialFiles));
  }

  /** Return cached entities, rebuilding only when files have changed since last call. */
  private getEntities(): { entities: Entity[]; theme: Record<string, string> } {
    if (this._entityCache && this._entityCache.version === this._version) {
      return { entities: this._entityCache.entities, theme: this._entityCache.theme };
    }
    const snapshot = Object.fromEntries(this.files);
    const theme = parseTheme(snapshot);
    const entities = extractEntities(snapshot, theme);
    this._entityCache = { version: this._version, entities, theme };
    return { entities, theme };
  }

  private invalidateCache(): void {
    this._version++;
  }

  // ── Read tools ────────────────────────────────────────────────────────────

  /**
   * List the immediate children (files and virtual sub-folders) under a prefix.
   * Returns FULL paths (e.g. "pages/home/groups/Hero"), not bare segment names.
   * Passing "" or "/" returns top-level entries.
   */
  listDir(prefix: string): string[] {
    const normalised = prefix.replace(/^\/+|\/+$/g, '');
    const seen = new Set<string>();

    for (const p of this.files.keys()) {
      if (normalised === '' || p === normalised || p.startsWith(normalised + '/')) {
        const rest = normalised === '' ? p : p.slice(normalised.length + 1);
        const first = rest.split('/')[0];
        if (first) {
          const fullPath = normalised === '' ? first : `${normalised}/${first}`;
          seen.add(fullPath);
        }
      }
    }

    return [...seen].sort();
  }

  /**
   * Return a file's content as a line-numbered string.
   * Optional start_line/end_line slice (both inclusive, 1-based).
   */
  readFile(path: string, startLine?: number, endLine?: number): string {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: "${path}"`);

    const lines = content.split('\n');

    const from = startLine != null ? Math.max(1, startLine) - 1 : 0;
    const to   = endLine   != null ? Math.min(lines.length, endLine) : lines.length;

    const slice = lines.slice(from, to);
    const width = String(to).length;
    return slice
      .map((l, i) => `${String(from + i + 1).padStart(width)}|${l}`)
      .join('\n');
  }

  /**
   * Return raw file content without line numbers. Used internally by edit executors
   * that need to JSON.parse the file — NOT for returning content to the AI.
   */
  readRaw(path: string): string {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: "${path}"`);
    return content;
  }

  /**
   * Search all entities (nodes + resources) by matching a regex against each entity's
   * full theme-expanded blob. One hit per matching entity, not per line.
   *
   * For node entities: returns path:line: <type> name="..." — <snippet>
   * For resource entities: returns path — <snippet>
   *
   * Case-insensitive. Invalid regex throws an error.
   */
  grep(pattern: string, opts: { pathPrefix?: string; limit?: number } = {}): GrepMatch[] {
    const re = new RegExp(pattern, 'i');
    const { pathPrefix, limit = 50 } = opts;
    const results: GrepMatch[] = [];

    const { entities } = this.getEntities();

    for (const entity of entities) {
      if (pathPrefix && !entity.path.startsWith(pathPrefix)) continue;
      if (!re.test(entity.blob)) continue;

      // Build a readable snippet from the blob (first ~120 chars around match)
      const match = re.exec(entity.blob);
      let snippet = entity.blob.slice(0, 120).replace(/\s+/g, ' ').trim();
      if (match && match.index > 0) {
        const start = Math.max(0, match.index - 30);
        snippet = entity.blob.slice(start, start + 120).replace(/\s+/g, ' ').trim();
      }
      if (entity.blob.length > 120) snippet += '…';

      // Format: for nodes include type + name; for resources just the path
      let text: string;
      if (entity.kind === 'node') {
        const typePart = entity.type ? entity.type : '';
        const namePart = entity.name ? ` name="${entity.name}"` : '';
        text = `${typePart}${namePart} — ${snippet}`;
      } else {
        text = `[${entity.kind}] ${snippet}`;
      }

      results.push({ path: entity.path, line: entity.line, text });
      if (results.length >= limit) break;
    }

    return results;
  }

  // ── Write tools ───────────────────────────────────────────────────────────

  /**
   * Create or fully replace a file. Content must be valid JSON.
   */
  writeFile(path: string, content: string): void {
    // Validate JSON
    try {
      JSON.parse(content);
    } catch (e) {
      throw new Error(`Invalid JSON for "${path}": ${e instanceof Error ? e.message : String(e)}`);
    }

    this.files.set(path, content);
    this.invalidateCache();
    this.pendingOps.push({ kind: 'write', path, content });
  }

  /**
   * Surgical string replacement inside a file (like StrReplace / Cursor edit).
   * old_string must appear exactly once. Result must be valid JSON.
   */
  editFile(path: string, oldString: string, newString: string): void {
    const existing = this.files.get(path);
    if (existing === undefined) throw new Error(`File not found: "${path}"`);

    const count = existing.split(oldString).length - 1;
    if (count === 0) throw new Error(`old_string not found in "${path}"`);
    if (count > 1)  throw new Error(`old_string appears ${count} times in "${path}" — make it more unique by including more surrounding context`);

    const updated = existing.replace(oldString, newString);

    // Validate JSON
    try {
      JSON.parse(updated);
    } catch (e) {
      throw new Error(`Edit would produce invalid JSON for "${path}": ${e instanceof Error ? e.message : String(e)}`);
    }

    this.files.set(path, updated);
    this.invalidateCache();
    this.pendingOps.push({ kind: 'write', path, content: updated });
  }

  /**
   * Delete a file from the engine.
   */
  deleteFile(path: string): void {
    if (!this.files.has(path)) throw new Error(`File not found: "${path}"`);
    this.files.delete(path);
    this.invalidateCache();
    this.pendingOps.push({ kind: 'delete', path });
  }

  /** Snapshot of all current file paths (for diagnostics). */
  get allPaths(): string[] {
    return [...this.files.keys()].sort();
  }
}
