import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyToBackend(req, `/v1/projects/${id}/export/pay`);
}
