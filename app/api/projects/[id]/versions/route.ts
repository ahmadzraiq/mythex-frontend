import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToBackend(req, `/v1/projects/${id}/versions`);
}
