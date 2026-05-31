import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

async function handler(req: NextRequest, ctx: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await ctx.params;
  return proxyToBackend(req, `/v1/projects/${id}/storage/${fileId}/presigned`);
}

export const GET = handler;
