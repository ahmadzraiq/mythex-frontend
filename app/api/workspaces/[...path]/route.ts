/**
 * /api/workspaces/[...path]
 * Proxies all workspace requests to the Node.js backend.
 * e.g. GET /api/workspaces → GET http://localhost:4000/workspaces
 * e.g. POST /api/workspaces/abc/members → POST http://localhost:4000/workspaces/abc/members
 */

import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

async function handler(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const backendPath = `/v1/workspaces/${path.join('/')}`;
  return proxyToBackend(req, backendPath);
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
