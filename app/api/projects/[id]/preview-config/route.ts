/**
 * /api/projects/[id]/preview-config
 * GET — public endpoint, no auth required.
 * Returns the project config blob for the subdomain preview.
 * The UUID acts as the access token (read-only, hard to guess).
 */

import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyToBackend(req, `/projects/${id}/preview-config`);
}
