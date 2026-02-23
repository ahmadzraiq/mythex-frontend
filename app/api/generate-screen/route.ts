/**
 * POST /api/generate-screen
 * AI generates a complete screen config.
 * Body: { prompt: string }
 * Returns: { screen }
 */

import { NextResponse } from 'next/server';
import { generateScreen } from '@/lib/ai/screen-generator';
import { resolveScreenConfig } from '@/lib/sdui/config-resolver';
import { logAiResponse } from '@/lib/ai/response-logger';
import root from '@/config/root';

const registry = {
  layouts: root.layouts,
  fragments: root.fragments,
};

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY not configured' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    const page = typeof body?.page === 'string' ? body.page : 'home';
    const rawScreen = await generateScreen(
      prompt || 'Generate a product listing page with filters and grid'
    );

    const screen = resolveScreenConfig(
      rawScreen as Parameters<typeof resolveScreenConfig>[0],
      registry
    ) as Record<string, unknown>;

    logAiResponse('screen', { prompt: prompt || 'Generate a product listing page with filters and grid' }, { screen }, { source: 'api', page });
    return NextResponse.json({ screen });
  } catch (err) {
    console.error('[generate-screen]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate screen' },
      { status: 500 }
    );
  }
}
