/**
 * /api/auth/[...path]
 * Proxies all auth requests to the Node.js backend.
 * e.g. POST /api/auth/login → POST http://localhost:4000/auth/login
 */

import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

async function handler(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const backendPath = `/v1/auth/${path.join('/')}`;
  return proxyToBackend(req, backendPath);
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
