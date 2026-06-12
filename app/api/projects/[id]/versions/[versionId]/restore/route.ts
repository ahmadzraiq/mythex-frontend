import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const { id, versionId } = await params;
  return proxyToBackend(req, `/v1/projects/${id}/versions/${versionId}/restore`);
}
