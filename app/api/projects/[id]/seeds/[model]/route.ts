import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

async function handler(req: NextRequest, ctx: { params: Promise<{ id: string; model: string }> }) {
  const { id, model } = await ctx.params;
  return proxyToBackend(req, `/v1/projects/${id}/seeds/${encodeURIComponent(model)}`);
}

export const GET    = handler;
export const PUT    = handler;
export const DELETE = handler;
