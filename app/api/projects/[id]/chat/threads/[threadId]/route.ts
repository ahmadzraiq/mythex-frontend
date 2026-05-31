import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

type Ctx = { params: Promise<{ id: string; threadId: string }> };

async function handler(req: NextRequest, ctx: Ctx) {
  const { id, threadId } = await ctx.params;
  return proxyToBackend(req, `/v1/projects/${id}/chat/threads/${threadId}`);
}

export const GET    = handler;
export const PATCH  = handler;
export const DELETE = handler;
