/**
 * POST /api/generate-navbar
 * Generates full app: custom navbar + layout (hero, product-grid, feature-grid, footer) + theme.
 * Preview replaces the whole app.
 * Body: { prompt: string }
 * Returns: { screen, style, theme }
 */

import { NextResponse } from 'next/server';
import { generateNavbarStructure } from '@/lib/ai/generate-navbar-structure';
import { pickRandomNavbarTheme } from '@/lib/ai/navbar-theme-picker';
import { schemaToScreen } from '@/lib/ai/schema-to-screen';
import { logAiResponse } from '@/lib/ai/response-logger';
import type { LayoutSchema } from '@/config/schema/layout-schema';

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
    const { structure } = await generateNavbarStructure(
      prompt || 'Create a minimal e-commerce navbar',
      { skipLog: true }
    );
    const themePick = pickRandomNavbarTheme();

    const layout: LayoutSchema = {
      pageType: 'homepage',
      style: themePick.style,
      sections: [
        { type: 'navbar' },
        { type: 'hero' },
        { type: 'product-grid', columns: 4, source: 'featured' },
        { type: 'feature-grid', items: 3 },
        { type: 'footer' },
      ],
      layoutParts: { navbar: { structure } },
    };

    const screen = schemaToScreen(layout);
    const style = themePick.style;
    const theme = { ...themePick, fonts: themePick.fonts };

    const result = { screen, style, theme };
    logAiResponse('navbar', { prompt: prompt || 'Create a minimal e-commerce navbar' }, result, { source: 'api' });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[generate-navbar]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate navbar' },
      { status: 500 }
    );
  }
}
