/**
 * /api/workspaces  (root — no trailing segments)
 * GET  → list workspaces
 * POST → create workspace
 */

import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

export async function GET(req: NextRequest) {
  return proxyToBackend(req, '/workspaces');
}

export async function POST(req: NextRequest) {
  return proxyToBackend(req, '/workspaces');
}
