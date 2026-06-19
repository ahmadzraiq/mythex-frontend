/**
 * /api/ai/token-usage
 *
 * Thin proxy for workspace AI token accounting.
 *
 * GET  ?workspaceId=xxx  → check quota: { isSuperAdmin, remaining }
 * POST body { workspaceId, projectId, inputTokens, outputTokens, model } → record usage
 */

import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:4000';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const wsId = req.nextUrl.searchParams.get('workspaceId');
  if (!wsId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

  try {
    const res = await fetch(`${BACKEND}/v1/workspaces/${wsId}/usage`, {
      headers: { Cookie: req.headers.get('cookie') ?? '' },
    });
    if (!res.ok) return NextResponse.json({}, { status: res.status });

    const data = await res.json() as {
      isSuperAdmin?: boolean;
      usage?: { aiTokens?: { remaining: number | null } };
    };

    return NextResponse.json({
      isSuperAdmin: data.isSuperAdmin ?? false,
      remaining: data.usage?.aiTokens?.remaining ?? null,
    });
  } catch {
    return NextResponse.json({ isSuperAdmin: false, remaining: null });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { workspaceId?: string; projectId?: string; inputTokens?: number; outputTokens?: number; model?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { workspaceId, projectId, inputTokens = 0, outputTokens = 0, model = 'claude-sonnet-4-5' } = body;
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

  try {
    await fetch(`${BACKEND}/v1/workspaces/${workspaceId}/usage/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') ?? '' },
      body: JSON.stringify({ projectId, inputTokens, outputTokens, model }),
    });
  } catch { /* non-critical */ }

  return NextResponse.json({ ok: true });
}
