import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string; threadId: string }> }) {
  const { id, threadId } = await context.params;
  return proxyToBackend(req, `/v1/projects/${id}/chat/threads/${threadId}/messages`);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string; threadId: string }> }) {
  const { id, threadId } = await context.params;
  return proxyToBackend(req, `/v1/projects/${id}/chat/threads/${threadId}/messages`);
}
