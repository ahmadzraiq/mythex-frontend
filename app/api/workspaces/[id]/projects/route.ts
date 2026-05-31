/**
 * /api/workspaces/[id]/projects
 * GET  → list projects in workspace
 * POST → create project in workspace
 */

import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

async function handler(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyToBackend(req, `/v1/workspaces/${id}/projects`);
}

export const GET = handler;
export const POST = handler;
