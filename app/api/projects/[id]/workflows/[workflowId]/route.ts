import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

async function handler(req: NextRequest, ctx: { params: Promise<{ id: string; workflowId: string }> }) {
  const { id, workflowId } = await ctx.params;
  return proxyToBackend(req, `/v1/projects/${id}/workflows/${workflowId}`);
}

export const GET    = handler;
export const PATCH  = handler;
export const DELETE = handler;
