/**
 * POST /api/dsl/compile-all
 *
 * Compiles ALL DSL source files in one shot using the unified 2-pass compiler
 * and returns every event needed to update the builder canvas.
 *
 * Body:     { sources: Record<string, string>; projectId?: string }
 * Response: { events: CompiledEvent[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { compileAllSources, type CompiledEvent } from '@/lib/dsl/compiler/compile-file';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { sources?: Record<string, string>; projectId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sources = {}, projectId = 'dsl' } = body;

  try {
    const events: CompiledEvent[] = compileAllSources(sources, projectId);
    return NextResponse.json({ events });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
