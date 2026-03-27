import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { buildSectionPrompt } from '@/lib/ai/section-prompt-builder';
import { parseAnthropicStream } from '@/lib/ai/incremental-json-parser';
import type { AiSectionWithHints } from '@/app/api/ai/generate-sections/route';

export const runtime = 'nodejs';
export const maxDuration = 90;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------------------------------------------------------------------------
// SSE event types emitted to the client
// ---------------------------------------------------------------------------
// type: 'shell'         → first event for a root node — layout/container with children: []
// type: 'section_child' → each child of the shell, streamed as they are parsed
// type: 'node'          → root node with no children (leaf section element)
// type: 'progress'      → char count update (non-blocking UI feedback)
// type: 'done'          → stream complete
// type: 'error'         → fatal error

// ---------------------------------------------------------------------------
// POST handler — true token-level streaming via incremental JSON parser
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    section: AiSectionWithHints;
    animationLevel: number;
    mood: string;
    appName: string;
    businessDescription: string;
    category: string;
    pageRoutes: Array<{ name: string; route: string }>;
  };

  const { system, user } = buildSectionPrompt(body);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // client disconnected
        }
      };

      try {
        // Start the Anthropic stream
        const anthropicStream = client.messages.stream({
          model: 'claude-haiku-4-5',
          max_tokens: 4096,
          system,
          messages: [{ role: 'user', content: user }],
        });

        // Process tokens through the incremental parser and emit SSE events in real time
        for await (const ev of parseAnthropicStream(anthropicStream)) {
          switch (ev.kind) {
            case 'shell':
              // Shell arrived — canvas renders section container immediately
              send({ type: 'shell', shellId: ev.id, node: ev.node });
              break;

            case 'child':
              // Child parsed from stream — canvas appends child into shell
              send({ type: 'section_child', parentId: ev.parentId, node: ev.node });
              break;

            case 'node':
              // Root node with no children (e.g. a Divider or standalone element)
              send({ type: 'node', node: ev.node });
              break;

            case 'progress':
              // Emit progress every ~500 chars to give client a heartbeat
              if (ev.chars % 500 < 50) {
                send({ type: 'progress', chars: ev.chars });
              }
              break;
          }
        }

        send({ type: 'done' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
