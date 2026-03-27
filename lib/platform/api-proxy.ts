/**
 * Thin server-side proxy utilities for forwarding requests to the backend.
 * Used by Next.js API route handlers to avoid CORS issues and forward auth cookies.
 */

import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000';

export interface PaginatedResponse<T> {
  items: T[];
  hasNextPage: boolean;
}

/** Build shared auth headers from an incoming Next.js request. */
function buildAuthHeaders(req: NextRequest): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const cookie = req.headers.get('cookie');
  if (cookie) headers['cookie'] = cookie;
  const auth = req.headers.get('authorization');
  if (auth) headers['authorization'] = auth;
  return headers;
}

/**
 * Forward an incoming Next.js request to the backend and return the response.
 * Preserves cookies, headers, request body, and query string.
 */
export async function proxyToBackend(
  req: NextRequest,
  backendPath: string,
): Promise<NextResponse> {
  // Forward query params from the original request when the caller doesn't
  // embed them in backendPath (legacy callers pass a bare path).
  const reqUrl = new URL(req.url);
  const qs = reqUrl.searchParams.toString();
  const url = `${BACKEND_URL}${backendPath}${qs ? `?${qs}` : ''}`;

  const headers = buildAuthHeaders(req);

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

/**
 * Like proxyToBackend but implements the n+1 trick to detect hasNextPage
 * without a separate count query. The backend receives `limit+1` items; if it
 * returns more than `limit`, there is a next page. The response shape is always
 * `{ items: T[], hasNextPage: boolean }`.
 *
 * @param req         Incoming Next.js request (auth headers are forwarded).
 * @param backendPath Backend route path, without query string.
 * @param limitParam  Name of the query param that controls page size (default "limit").
 * @param defaultLimit Fallback limit when the param is absent (default 10).
 */
export async function paginatedProxyToBackend<T = unknown>(
  req: NextRequest,
  backendPath: string,
  limitParam = 'limit',
  defaultLimit = 10,
): Promise<NextResponse<PaginatedResponse<T> | { error: string }>> {
  const reqUrl = new URL(req.url);
  const requestedLimit = Number(reqUrl.searchParams.get(limitParam) ?? defaultLimit);

  // Clone params and bump limit by 1 for hasNextPage detection
  const backendParams = new URLSearchParams(reqUrl.searchParams);
  backendParams.set(limitParam, String(requestedLimit + 1));

  const url = `${BACKEND_URL}${backendPath}?${backendParams.toString()}`;
  const headers = buildAuthHeaders(req);

  try {
    const upstream = await fetch(url, { method: 'GET', headers });
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Backend error' }, { status: upstream.status });
    }
    const raw = await upstream.json() as T[];
    const hasNextPage = raw.length > requestedLimit;
    return NextResponse.json({ items: raw.slice(0, requestedLimit), hasNextPage });
  } catch (err) {
    console.error(`[proxy] Failed to reach backend at ${url}:`, err);
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
  }
}
