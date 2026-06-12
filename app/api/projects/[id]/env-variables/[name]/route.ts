import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

async function handler(req: NextRequest, ctx: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await ctx.params;
  return proxyToBackend(req, `/v1/projects/${id}/env-variables/${name}`);
}

export const PUT    = handler;
export const DELETE = handler;
