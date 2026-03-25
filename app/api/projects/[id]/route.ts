/**
 * /api/projects/[id]
 * GET    → get project metadata
 * PATCH  → update project name
 * DELETE → delete project
 */

import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

async function handler(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyToBackend(req, `/projects/${id}`);
}

export const GET = handler;
export const PATCH = handler;
export const DELETE = handler;
