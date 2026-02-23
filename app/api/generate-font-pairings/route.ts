/**
 * POST /api/generate-font-pairings
 * AI generates 6 font pairings from design mood.
 * Body: { designMood: string }
 */

import { NextResponse } from 'next/server';
import { generateFontPairings } from '@/lib/ai/generate-font-pairings';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const designMood = body?.designMood;

    if (typeof designMood !== 'string' || !designMood.trim()) {
      return NextResponse.json(
        { error: 'Missing or invalid designMood' },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured' },
        { status: 500 }
      );
    }

    const pairings = await generateFontPairings(designMood.trim());
    return NextResponse.json({ pairings });
  } catch (err) {
    console.error('[generate-font-pairings]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Font pairing generation failed' },
      { status: 500 }
    );
  }
}
