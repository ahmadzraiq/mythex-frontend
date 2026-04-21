/**
 * /api/proxy
 *
 * Generic server-side HTTP proxy for the SDUI engine.
 *
 * WHY THIS EXISTS — When a datasource or workflow action has `proxy: true` /
 * `useProxy: true`, the engine routes the request here instead of making a
 * direct browser-to-API fetch. This solves two common problems:
 *
 *   1. CORS — The Next.js server makes the request server-to-server with no
 *      browser CORS restrictions.
 *   2. Cookie-based auth across origins — Set-Cookie from the upstream API is
 *      forwarded to the browser under the Next.js domain, so session cookies
 *      are stored and sent on subsequent requests.
 *
 * Request body (JSON):
 *   {
 *     endpoint: string;                    // the actual API URL to call
 *     method?:  string;                    // HTTP method (default: POST)
 *     headers?: Record<string, string>;    // extra headers to forward upstream
 *     body?:    string;                    // pre-serialized request body
 *   }
 *
 * The caller is responsible for serializing the body (e.g. JSON.stringify for
 * GraphQL or REST JSON payloads).
 */

import { NextRequest, NextResponse } from 'next/server';

// Platform-internal cookies that must never be forwarded to the user's backend.
// These are set by the platform middleware (middleware.ts) and are meaningless
// — or potentially harmful — to the user's configured API.
const PLATFORM_COOKIES = new Set(['auth_token', 'preview_project_id', 'preview_token']);

function stripPlatformCookies(rawCookieHeader: string): string {
  return rawCookieHeader
    .split(';')
    .map(c => c.trim())
    .filter(c => {
      const name = c.split('=')[0]?.trim();
      return name && !PLATFORM_COOKIES.has(name);
    })
    .join('; ');
}

export async function POST(req: NextRequest) {
  let parsed: {
    endpoint?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };

  try {
    parsed = await req.json() as typeof parsed;
  } catch {
    return NextResponse.json(
      { errors: [{ message: 'Invalid JSON body' }] },
      { status: 400 },
    );
  }

  const { endpoint, method = 'POST', headers: extraHeaders, body } = parsed;

  if (!endpoint) {
    return NextResponse.json(
      { errors: [{ message: '"endpoint" is required in the proxy request body' }] },
      { status: 400 },
    );
  }

  // Build upstream headers — forward client cookies so existing sessions work
  const upstreamHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders ?? {}),
  };
  const clientCookies = req.headers.get('cookie');
  if (clientCookies) {
    const filtered = stripPlatformCookies(clientCookies);
    if (filtered) upstreamHeaders['Cookie'] = filtered;
  }

  try {
    const upstream = await fetch(endpoint, {
      method: method.toUpperCase(),
      headers: upstreamHeaders,
      body: body ?? undefined,
    });

    // Parse response body as text first so we can handle non-JSON safely
    const text = await upstream.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // Non-JSON response — return as plain text wrapped in a compatible shape
      return new NextResponse(text, {
        status: upstream.status,
        headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'text/plain' },
      });
    }

    const res = NextResponse.json(json, { status: upstream.status });

    // Forward ALL Set-Cookie headers from upstream to the browser.
    const setCookies = upstream.headers.getSetCookie?.() ?? [];
    if (setCookies.length > 0) {
      for (const cookie of setCookies) {
        res.headers.append('set-cookie', cookie);
      }
    } else {
      const singleSetCookie = upstream.headers.get('set-cookie');
      if (singleSetCookie) {
        res.headers.set('set-cookie', singleSetCookie);
      }
    }

    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { errors: [{ message: `Proxy upstream error: ${msg}` }] },
      { status: 502 },
    );
  }
}
