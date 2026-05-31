import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/platform/api-proxy';

type Ctx = { params: Promise<{ id: string; tableName: string; rowId: string }> };

async function handler(req: NextRequest, ctx: Ctx) {
  const { id, tableName, rowId } = await ctx.params;
  return proxyToBackend(req, `/v1/data/${id}/${tableName}/${rowId}`);
}

export const GET    = handler;
export const PATCH  = handler;
export const DELETE = handler;
