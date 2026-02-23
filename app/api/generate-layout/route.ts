/**
 * POST /api/generate-layout
 * Ephemeral layout generation - prompt + context or full build context.
 * Body: { prompt?: string; context?: ConversationContext; fullBuildContext?: FullBuildContext }
 * Returns: { screen: Record<string, unknown>; style: string | null; theme: Record<string, unknown> | null }
 */

import { NextResponse } from 'next/server';
import {
  generateLayout,
  type ConversationContext,
  type FullBuildContext,
} from '@/lib/ai/layout-generator';
import { schemaToScreen } from '@/lib/ai/schema-to-screen';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    const context = body?.context as ConversationContext | undefined;
    const fullBuildContext = body?.fullBuildContext as FullBuildContext | undefined;

    const hasFullContext =
      fullBuildContext?.selectedSections?.length &&
      fullBuildContext?.selectedPalette &&
      fullBuildContext?.selectedFontPairing;

    if (
      !hasFullContext &&
      !prompt &&
      (!context || Object.keys(context ?? {}).length === 0)
    ) {
      return NextResponse.json(
        { error: 'Missing prompt, context, or fullBuildContext' },
        { status: 400 }
      );
    }

    if (!hasFullContext && !process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured' },
        { status: 500 }
      );
    }

    const result = await generateLayout(
      prompt || 'Generate an e-commerce homepage.',
      context,
      fullBuildContext
    );

    const screen = schemaToScreen(result.layout);
    const style =
      (result.theme?.designMood as string)?.trim() ||
      (result.theme?.style as string)?.trim() ||
      (result.layout.style as string)?.trim() ||
      null;
    const theme = result.theme ? (result.theme as Record<string, unknown>) : null;

    return NextResponse.json({ screen, style, theme });
  } catch (err) {
    console.error('[generate-layout]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Layout generation failed' },
      { status: 500 }
    );
  }
}
