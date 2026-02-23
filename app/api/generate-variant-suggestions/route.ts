/**
 * POST /api/generate-variant-suggestions
 * AI suggests section variants based on design mood.
 * Body: { designMood: string }
 * Returns: { suggestions: Record<string, string> }
 */

import { NextResponse } from 'next/server';
import { generateVariantSuggestions } from '@/lib/ai/generate-variant-suggestions';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const designMood = typeof body?.designMood === 'string' ? body.designMood.trim() : '';
    if (!designMood) {
      return NextResponse.json(
        { error: 'designMood is required' },
        { status: 400 }
      );
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured' },
        { status: 500 }
      );
    }
    const suggestions = await generateVariantSuggestions(designMood);
    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error('[generate-variant-suggestions]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate suggestions' },
      { status: 500 }
    );
  }
}
