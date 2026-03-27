import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string; threadId: string }> }) {
  const { id, threadId } = await context.params;
  return proxyToBackend(req, `/projects/${id}/chat/threads/${threadId}`);
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string; threadId: string }> }) {
  const { id, threadId } = await context.params;
  return proxyToBackend(req, `/projects/${id}/chat/threads/${threadId}`);
}
