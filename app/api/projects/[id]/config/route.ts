/**
 * /api/projects/[id]/config
 * GET  → load project config from backend
 * PATCH → autosave project config to backend
 */

import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyToBackend(req, `/v1/projects/${id}/config`);
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyToBackend(req, `/v1/projects/${id}/config`);
}
