/**
 * POST /api/generate-palettes
 * AI generates 4 color palettes from design mood and mode.
 * Body: { designMood: string; mode: 'light' | 'dark' | 'both' }
 */

import { NextResponse } from 'next/server';
import { generatePalettes } from '@/lib/ai/generate-palettes';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const designMood = body?.designMood;
    const mode = body?.mode ?? 'both';

    if (typeof designMood !== 'string' || !designMood.trim()) {
      return NextResponse.json(
        { error: 'Missing or invalid designMood' },
        { status: 400 }
      );
    }

    if (!['light', 'dark', 'both'].includes(mode)) {
      return NextResponse.json(
        { error: 'Invalid mode. Use light, dark, or both' },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured' },
        { status: 500 }
      );
    }

    const palettes = await generatePalettes(designMood.trim(), mode);
    return NextResponse.json({ palettes });
  } catch (err) {
    console.error('[generate-palettes]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Palette generation failed' },
      { status: 500 }
    );
  }
}
