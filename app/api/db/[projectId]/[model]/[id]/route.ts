import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

async function handler(req: NextRequest, ctx: { params: Promise<{ projectId: string; model: string; id: string }> }) {
  const { projectId, model, id } = await ctx.params;
  return proxyToBackend(req, `/v1/db/${projectId}/${encodeURIComponent(model)}/${id}`);
}

export const GET    = handler;
export const PATCH  = handler;
export const DELETE = handler;
