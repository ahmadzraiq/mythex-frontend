import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

type Ctx = { params: Promise<{ id: string; tableName: string }> };

async function handler(req: NextRequest, ctx: Ctx) {
  const { id, tableName } = await ctx.params;
  return proxyToBackend(req, `/v1/data/${id}/${tableName}`);
}

export const GET    = handler;
export const POST   = handler;
