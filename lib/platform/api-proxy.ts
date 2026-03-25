/**
 * Thin server-side proxy utilities for forwarding requests to the backend.
 * Used by Next.js API route handlers to avoid CORS issues and forward auth cookies.
 */

import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000';

/**
 * Forward an incoming Next.js request to the backend and return the response.
 * Preserves cookies, headers, and request body.
 */
export async function proxyToBackend(
  req: NextRequest,
  backendPath: string,
): Promise<NextResponse> {
  const url = `${BACKEND_URL}${backendPath}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Forward cookies for auth
  const cookie = req.headers.get('cookie');
  if (cookie) headers['cookie'] = cookie;

  // Forward Authorization header (used by preview subdomain with Bearer token)
  const authHeader = req.headers.get('authorization');
  if (authHeader) headers['authorization'] = authHeader;

  let body: string | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      body = await req.text();
    } catch {
      body = undefined;
    }
  }

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body,
    });

    const text = await upstream.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    const res = NextResponse.json(data, { status: upstream.status });

    // Forward Set-Cookie from backend (auth cookie)
    const setCookie = upstream.headers.get('set-cookie');
    if (setCookie) {
      res.headers.set('set-cookie', setCookie);
    }

    return res;
  } catch (err) {
    console.error(`[proxy] Failed to reach backend at ${url}:`, err);
    return NextResponse.json(
      { error: 'Backend unavailable' },
      { status: 503 },
    );
  }
}
