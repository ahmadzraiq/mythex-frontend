import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

async function handler(req: NextRequest, ctx: { params: Promise<{ id: string; tableId: string; columnId: string }> }) {
  const { id, tableId, columnId } = await ctx.params;
  return proxyToBackend(req, `/v1/projects/${id}/tables/${tableId}/columns/${columnId}`);
}

export const PATCH  = handler;
export const DELETE = handler;
