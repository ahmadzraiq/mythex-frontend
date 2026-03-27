import { NextRequest } from 'next/server';
import { proxyToBackend, paginatedProxyToBackend } from '@/lib/platform/api-proxy';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return paginatedProxyToBackend(req, `/projects/${id}/chat/threads`, 'limit', 10);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyToBackend(req, `/projects/${id}/chat/threads`);
}
