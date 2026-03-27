/**
 * Incremental JSON Parser for true token-level streaming.
 *
 * Processes raw text tokens from Anthropic's streaming API and fires callbacks
 * as soon as structural pieces of the JSON are available — no buffering needed.
 *
 * Protocol for section generation (AI outputs a JSON array of root nodes):
 *   - When a root-level object is opened and "children": [ is seen
 *     → emit SHELL event with the partially-accumulated node (children=[])
 *   - When each depth-2 child object closes
 *     → emit CHILD event with the parentId + child JSON
 *   - When no children detected (leaf root node)
 *     → emit NODE event with the full accumulated node
 *
 * Token stream example:
 *   [ { "type":"Box", "name":"Hero", "props":{...}, "children":[ { "type":"Heading",...}, ...] } ]
 *     ↑ depth=1 open                              ↑ shell emitted here   ↑ children emitted one by one
 */

export type ParsedEvent =
  | { type: 'shell'; id: string; node: Record<string, unknown> }
  | { type: 'child'; parentId: string; node: Record<string, unknown> }
  | { type: 'node'; node: Record<string, unknown> }
  | { type: 'progress'; chars: number };

export interface IncrementalParserOptions {
  onEvent: (event: ParsedEvent) => void;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type ParserState =
  | 'outside'       // before the opening [
  | 'between_roots' // between root objects at depth 0-1
  | 'in_root'       // accumulating a root object (depth >= 1)
  | 'in_children'   // inside the children array (depth >= 2)
  | 'in_child'      // accumulating a child object (depth >= 2)
  | 'done';         // after the closing ]

export class IncrementalJsonParser {
  private opts: IncrementalParserOptions;
  private state: ParserState = 'outside';

  // Raw character accumulation
  private rootBuf = '';    // accumulating current root node chars
  private childBuf = '';   // accumulating current child chars

  // Depth tracking
  private depth = 0;       // overall brace/bracket depth
  private childDepth = 0;  // depth when 'in_children' started

  // Current root shell state
  private currentShellId: string | null = null;
  private shellEmitted = false;      // did we already emit the shell?
  private childrenKeyDetected = false; // did we see "children":[ in root?
  private inString = false;
  private escapeNext = false;
  private totalChars = 0;

  // Track children array bracket depth
  private childrenArrayDepth = 0;

  constructor(opts: IncrementalParserOptions) {
    this.opts = opts;
  }

  /**
   * Feed a raw text token from Anthropic's stream.
   * Call this for every text_delta chunk.
   */
  feed(chunk: string): void {
    this.totalChars += chunk.length;

    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      this.processChar(ch);
    }

    this.opts.onEvent({ type: 'progress', chars: this.totalChars });
  }

  /**
   * Call when the stream ends. Flushes any remaining buffered content.
   */
  flush(): void {
    // Try to finalize any remaining root buffer
    if (this.state === 'in_root' && this.rootBuf.trim()) {
      this.tryFinalizeRoot(this.rootBuf);
    }
    if (this.state === 'in_children' || this.state === 'in_child') {
      if (this.childBuf.trim() && this.currentShellId) {
        this.tryFinalizeChild(this.childBuf);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Character-level state machine
  // ---------------------------------------------------------------------------

  private processChar(ch: string): void {
    // String tracking — skip all structure tracking inside strings
    if (this.inString) {
      if (this.escapeNext) {
        this.escapeNext = false;
      } else if (ch === '\\') {
        this.escapeNext = true;
      } else if (ch === '"') {
        this.inString = false;
      }
      this.appendToBuffers(ch);
      return;
    }

    if (ch === '"') {
      this.inString = true;
      this.appendToBuffers(ch);
      return;
    }

    // Structural characters
    switch (this.state) {
      case 'outside':
        if (ch === '[') {
          this.state = 'between_roots';
          this.depth = 1;
        }
        break;

      case 'between_roots':
        if (ch === '{') {
          this.state = 'in_root';
          this.depth = 2;
          this.rootBuf = '{';
          this.shellEmitted = false;
          this.childrenKeyDetected = false;
          this.currentShellId = crypto.randomUUID();
        } else if (ch === ']') {
          this.state = 'done';
        }
        break;

      case 'in_root':
        this.rootBuf += ch;

        if (ch === '{' || ch === '[') {
          this.depth++;

          // Check if we just opened the "children": [ array
          // Look back in rootBuf for "children":[ pattern
          if (!this.childrenKeyDetected && ch === '[' && this.isChildrenArrayOpening()) {
            this.childrenKeyDetected = true;
            this.childrenArrayDepth = this.depth;

            // Build shell from root buffer up to (not including) the '[' we just processed
            // The '[' IS already appended to rootBuf, so we need to cut it
            const shellText = this.buildShellText();
            const shellNode = this.safeParse(shellText);

            if (shellNode && this.currentShellId) {
              // Ensure id is assigned
              if (!shellNode.id) shellNode.id = this.currentShellId;
              else this.currentShellId = String(shellNode.id);

              this.opts.onEvent({
                type: 'shell',
                id: this.currentShellId,
                node: { ...shellNode, children: [] },
              });
              this.shellEmitted = true;
            }

            // Start child accumulation
            this.state = 'in_children';
            this.childDepth = this.depth;
          }
        } else if (ch === '}' || ch === ']') {
          this.depth--;

          if (this.depth === 1) {
            // Root object closed — finalize as a leaf node (no children detected)
            if (!this.shellEmitted) {
              this.tryFinalizeRoot(this.rootBuf);
            }
            this.state = 'between_roots';
            this.rootBuf = '';
            this.currentShellId = null;
          }
        }
        break;

      case 'in_children':
        this.rootBuf += ch;

        if (ch === '{') {
          this.depth++;
          if (this.depth === this.childrenArrayDepth + 1) {
            // Start of a new direct child object
            this.state = 'in_child';
            this.childBuf = '{';
          }
        } else if (ch === ']' || ch === '}') {
          this.depth--;

          if (ch === ']' && this.depth === this.childrenArrayDepth - 1) {
            // Children array closed — root node is also about to close
            this.state = 'in_root';
          } else if (ch === '}' && this.depth === 1) {
            // Root object closed entirely
            this.state = 'between_roots';
            this.rootBuf = '';
            this.currentShellId = null;
            this.shellEmitted = false;
          }
        }
        break;

      case 'in_child':
        this.rootBuf += ch;
        this.childBuf += ch;

        if (ch === '{' || ch === '[') {
          this.depth++;
        } else if (ch === '}' || ch === ']') {
          this.depth--;

          if (ch === '}' && this.depth === this.childrenArrayDepth) {
            // Child object closed
            if (this.currentShellId) {
              this.tryFinalizeChild(this.childBuf);
            }
            this.childBuf = '';
            this.state = 'in_children';
          } else if (ch === ']' && this.depth === this.childrenArrayDepth - 1) {
            // Children array closed immediately (edge case: last child was last '}' above)
            this.childBuf = '';
            this.state = 'in_root';
          } else if (ch === '}' && this.depth === 1) {
            // Root closed (shouldn't happen mid-child, but guard)
            this.state = 'between_roots';
            this.rootBuf = '';
            this.currentShellId = null;
            this.shellEmitted = false;
          }
        }
        break;

      case 'done':
        break;
    }
  }

  private appendToBuffers(ch: string): void {
    if (this.state === 'in_root') {
      this.rootBuf += ch;
    } else if (this.state === 'in_children') {
      this.rootBuf += ch;
    } else if (this.state === 'in_child') {
      this.rootBuf += ch;
      this.childBuf += ch;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Check if the '[' we just added to rootBuf opens a "children": array */
  private isChildrenArrayOpening(): boolean {
    // Look at the 30 chars before the current '[' in rootBuf
    const tail = this.rootBuf.slice(-40).replace(/\s+/g, '');
    return /"children"\s*:\s*\[/.test(tail) || tail.endsWith('"children":[');
  }

  /** Build a partial JSON object string that represents the shell (children=[]) */
  private buildShellText(): string {
    // rootBuf currently ends with [..., "children":[
    // We need to close it as "children":[] }
    const withoutChildrenOpen = this.rootBuf.replace(/"children"\s*:\s*\[$/, '');
    return withoutChildrenOpen.trimEnd() + ',"children":[]}';
  }

  /** Try to JSON.parse a string; return null on failure */
  private safeParse(text: string): Record<string, unknown> | null {
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    // Try as-is first
    try {
      const v = JSON.parse(cleaned);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return v as Record<string, unknown>;
      }
    } catch {
      // ignored
    }

    // Try to repair common issues (trailing comma before })
    const repaired = repairJson(cleaned);
    try {
      const v = JSON.parse(repaired);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return v as Record<string, unknown>;
      }
    } catch {
      // ignored
    }

    return null;
  }

  private tryFinalizeRoot(text: string): void {
    const node = this.safeParse(text);
    if (node) {
      if (!node.id) node.id = this.currentShellId ?? crypto.randomUUID();
      this.opts.onEvent({ type: 'node', node });
    }
  }

  private tryFinalizeChild(text: string): void {
    const node = this.safeParse(text);
    if (node && this.currentShellId) {
      if (!node.id) node.id = crypto.randomUUID();
      this.opts.onEvent({
        type: 'child',
        parentId: this.currentShellId,
        node,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// JSON repair helper — fixes common AI-generated JSON issues
// ---------------------------------------------------------------------------

function repairJson(text: string): string {
  // Remove trailing commas before } or ]
  let out = text.replace(/,(\s*[}\]])/g, '$1');
  // Ensure string ends properly — add closing braces if needed
  const opens = (out.match(/\{/g) ?? []).length;
  const closes = (out.match(/\}/g) ?? []).length;
  const diff = opens - closes;
  if (diff > 0) out += '}'.repeat(diff);
  return out;
}

// ---------------------------------------------------------------------------
// Convenience async generator — wraps Anthropic text delta stream
// ---------------------------------------------------------------------------

export type StreamedSectionEvent =
  | { kind: 'shell'; id: string; node: Record<string, unknown> }
  | { kind: 'child'; parentId: string; node: Record<string, unknown> }
  | { kind: 'node'; node: Record<string, unknown> }
  | { kind: 'progress'; chars: number };

/**
 * Parse an Anthropic streaming response using the incremental parser.
 * Yields events as they become available — no buffering.
 *
 * Usage:
 *   for await (const ev of parseAnthropicStream(anthropicStream)) { ... }
 */
export async function* parseAnthropicStream(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anthropicStream: AsyncIterable<any>,
): AsyncGenerator<StreamedSectionEvent> {
  const queue: StreamedSectionEvent[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  const parser = new IncrementalJsonParser({
    onEvent(ev) {
      if (ev.type === 'shell') {
        queue.push({ kind: 'shell', id: ev.id, node: ev.node });
      } else if (ev.type === 'child') {
        queue.push({ kind: 'child', parentId: ev.parentId, node: ev.node });
      } else if (ev.type === 'node') {
        queue.push({ kind: 'node', node: ev.node });
      } else if (ev.type === 'progress') {
        queue.push({ kind: 'progress', chars: ev.chars });
      }
      resolve?.();
    },
  });

  // Process stream in background
  const processStream = async () => {
    try {
      for await (const event of anthropicStream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta'
        ) {
          parser.feed(event.delta.text);
          if (queue.length > 0) {
            resolve?.();
          }
        }
      }
      parser.flush();
    } finally {
      done = true;
      resolve?.();
    }
  };

  const streamPromise = processStream();

  // Yield from queue as events arrive
  while (!done || queue.length > 0) {
    while (queue.length > 0) {
      yield queue.shift()!;
    }
    if (!done) {
      await new Promise<void>(r => { resolve = r; });
      resolve = null;
    }
  }

  await streamPromise;
}
