import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

async function handler(req: NextRequest, ctx: { params: Promise<{ projectId: string; userId: string }> }) {
  const { projectId, userId } = await ctx.params;
  return proxyToBackend(req, `/v1/data/${projectId}/auth/users/${userId}/reset-password`);
}

export const POST = handler;
