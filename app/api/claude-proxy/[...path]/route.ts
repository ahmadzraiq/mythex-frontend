/**
 * /api/claude-proxy/[...path]
 *
 * Transparent streaming proxy to api.anthropic.com.
 * The browser-side @anthropic-ai/sdk points its baseURL here so the real
 * ANTHROPIC_API_KEY never touches the client bundle.
 *
 * Usage (browser SDK):
 *   const client = new Anthropic({ apiKey: 'browser-placeholder', baseURL: '/api/claude-proxy' });
 */

import { NextRequest } from 'next/server';

const ANTHROPIC_BASE = 'https://api.anthropic.com';

async function proxy(req: NextRequest): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Reconstruct the upstream Anthropic URL
  const url = new URL(req.url);
  const upstreamPath = url.pathname.replace(/^\/api\/claude-proxy/, '') || '/';
  const upstreamUrl = `${ANTHROPIC_BASE}${upstreamPath}${url.search}`;

  const forwardHeaders: Record<string, string> = {
    'content-type': req.headers.get('content-type') ?? 'application/json',
    'anthropic-version': req.headers.get('anthropic-version') ?? '2023-06-01',
    'x-api-key': apiKey,
  };

  const beta = req.headers.get('anthropic-beta');
  if (beta) forwardHeaders['anthropic-beta'] = beta;

  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers: forwardHeaders,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
    // @ts-expect-error -- Node 18+ fetch supports duplex for streaming request bodies
    duplex: 'half',
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const PATCH = proxy;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
