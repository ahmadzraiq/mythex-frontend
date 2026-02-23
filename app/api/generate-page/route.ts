/**
 * POST /api/generate-page
 * Free-form full-page generation from a user description.
 * Body: { prompt: string; palette?: Palette; fontPairing?: FontPairing; pageName?: string }
 * Returns: { screen: PageGeneratorOutput; style: string | null; theme: Record<string, unknown> | null }
 */

import { NextResponse } from 'next/server';
import { generatePage } from '@/lib/ai/page-generator';
import type { Palette } from '@/lib/ai/palette-schema';
import type { FontPairing } from '@/lib/ai/font-pairing-schema';

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
    }

    const body = await request.json();
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    const palette = body?.palette as Palette | undefined;
    const fontPairing = body?.fontPairing as FontPairing | undefined;
    const pageName = typeof body?.pageName === 'string' ? body.pageName : 'home';

    if (!prompt) {
      return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
    }

    const result = await generatePage(prompt, { palette, fontPairing, pageName });

    const style =
      (result.themeHint?.designMood as string)?.trim() ||
      null;

    const theme = result.themeHint
      ? {
          designMood: result.themeHint.designMood,
          colors: result.themeHint.palette
            ? { light: result.themeHint.palette.light, dark: result.themeHint.palette.dark }
            : undefined,
          fonts: result.themeHint.fonts,
        }
      : null;

    return NextResponse.json({ screen: result, style, theme });
  } catch (err) {
    console.error('[generate-page]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Page generation failed' },
      { status: 500 }
    );
  }
}
