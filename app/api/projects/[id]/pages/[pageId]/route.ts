import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> },
) {
  const { id, pageId } = await params;
  return proxyToBackend(req, `/projects/${id}/pages/${pageId}`);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> },
) {
  const { id, pageId } = await params;
  return proxyToBackend(req, `/projects/${id}/pages/${pageId}`);
}
