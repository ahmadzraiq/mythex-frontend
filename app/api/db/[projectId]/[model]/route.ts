import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

async function handler(req: NextRequest, ctx: { params: Promise<{ projectId: string; model: string }> }) {
  const { projectId, model } = await ctx.params;
  return proxyToBackend(req, `/v1/db/${projectId}/${encodeURIComponent(model)}`);
}

export const GET  = handler;
export const POST = handler;
