/**
 * /api/builder/proxy
 *
 * Server-side proxy for the builder's "Execute" button.
 * Forwards GraphQL / REST requests server-side to avoid CORS restrictions.
 *
 * POST body:
 *   { type: "graphql" | "rest", endpoint, method?, headers, body?, query?, variables? }
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json() as {
      type: 'graphql' | 'rest';
      // REST
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      // GraphQL
      endpoint?: string;
      query?: string;
      variables?: unknown;
      credentials?: string;
    };

    let targetUrl: string;
    let fetchInit: RequestInit;

    if (payload.type === 'graphql') {
      targetUrl = payload.endpoint ?? '';
      if (!targetUrl) {
        return NextResponse.json({ error: 'endpoint is required for GraphQL' }, { status: 400 });
      }
      fetchInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(payload.headers ?? {}),
        },
        body: JSON.stringify({
          query: payload.query ?? '',
          variables: payload.variables ?? {},
        }),
      };
    } else {
      targetUrl = payload.url ?? '';
      if (!targetUrl) {
        return NextResponse.json({ error: 'url is required for REST' }, { status: 400 });
      }
      fetchInit = {
        method: (payload.method ?? 'GET').toUpperCase(),
        headers: payload.headers ?? {},
      };
      if (payload.body && fetchInit.method !== 'GET') {
        fetchInit.body = payload.body;
      }
    }

    const t0 = Date.now();
    const upstream = await fetch(targetUrl, fetchInit);
    const ms = Date.now() - t0;

    const text = await upstream.text();

    return NextResponse.json({
      status: upstream.status,
      statusText: upstream.statusText,
      ms,
      body: text,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
