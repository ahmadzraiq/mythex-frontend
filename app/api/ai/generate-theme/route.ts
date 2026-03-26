import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { DESIGN_MOODS, FONT_PAIRINGS, type ColorPalette, type FontPair } from '@/lib/builder/wizard-data';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { description, mood } = await req.json();

    const moodInfo = DESIGN_MOODS.find(m => m.id === mood);
    const fontList = FONT_PAIRINGS.map((f, i) => `${i}: ${f.headingFont} / ${f.bodyFont}`).join('\n');

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: `You are a professional web designer with exceptional taste in color and typography. Generate 4 distinct color palettes and select 4 font pairings for this website.

Business: "${description}"
Design mood: ${moodInfo?.label ?? mood} — ${moodInfo?.description ?? ''}

Generate 4 color palettes. Each palette must have:
- A poetic name (2-3 words)
- A brief evocative description (max 15 words)
- These hex color fields: primary, secondary, accent, bg, textPrimary, textSecondary
- Ensure strong contrast between bg and textPrimary (WCAG AA minimum)
- Colors must match the ${moodInfo?.label ?? mood} mood and the business personality
- CRITICAL: each palette must use a distinctly DIFFERENT background approach — vary them across the 4 palettes:
  * One: very light (near-white, soft warm or cool tint, e.g. #F8F5F0)
  * One: mid-tone (saturated or muted tinted bg, e.g. #E8EDE4 or #EDE8E0)
  * One: deep/dark (rich dark background, e.g. #1A1F1C or #1C1410)
  * One: bold tinted (strong but not black, e.g. #2C3A2E or #3D2B1F)
  Never use the exact same or near-identical bg across palettes.

Available font pairings (select 6 indices, best first):
${fontList}

Respond with ONLY valid JSON:
{
  "palettes": [
    {"name":"...","description":"...","primary":"#...","secondary":"#...","accent":"#...","bg":"#...","textPrimary":"#...","textSecondary":"#..."},
    {"name":"...","description":"...","primary":"#...","secondary":"#...","accent":"#...","bg":"#...","textPrimary":"#...","textSecondary":"#..."},
    {"name":"...","description":"...","primary":"#...","secondary":"#...","accent":"#...","bg":"#...","textPrimary":"#...","textSecondary":"#..."},
    {"name":"...","description":"...","primary":"#...","secondary":"#...","accent":"#...","bg":"#...","textPrimary":"#...","textSecondary":"#..."}
  ],
  "fontIndices": [0, 1, 2, 3, 4, 5]
}`,
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const result = JSON.parse(jsonMatch[0]);

    // Validate palettes
    const palettes: ColorPalette[] = (result.palettes ?? []).slice(0, 4).map((p: Record<string, string>) => ({
      name: String(p.name ?? 'Palette'),
      description: String(p.description ?? ''),
      primary: p.primary?.startsWith('#') ? p.primary : '#2563eb',
      secondary: p.secondary?.startsWith('#') ? p.secondary : '#60a5fa',
      accent: p.accent?.startsWith('#') ? p.accent : '#10b981',
      bg: p.bg?.startsWith('#') ? p.bg : '#ffffff',
      textPrimary: p.textPrimary?.startsWith('#') ? p.textPrimary : '#0f172a',
      textSecondary: p.textSecondary?.startsWith('#') ? p.textSecondary : '#475569',
    }));

    // Validate font indices (now requesting 6)
    const rawIndices: number[] = (result.fontIndices ?? [0, 1, 2, 3, 4, 5]);
    const fonts: FontPair[] = rawIndices
      .slice(0, 6)
      .map((i: number) => FONT_PAIRINGS[i] ?? FONT_PAIRINGS[0])
      .filter(Boolean);

    // Ensure we always have 4 palettes and 6 fonts
    while (palettes.length < 4) palettes.push(palettes[0]);
    while (fonts.length < 6) fonts.push(FONT_PAIRINGS[fonts.length % FONT_PAIRINGS.length]);

    return NextResponse.json({ palettes, fonts });
  } catch (err) {
    console.error('[AI generate-theme]', err);
    // Fallback: return first 4 from defaults
    const { getPalettesForMood } = await import('@/lib/builder/wizard-data');
    return NextResponse.json({
      palettes: getPalettesForMood('professional').slice(0, 4),
      fonts: FONT_PAIRINGS.slice(0, 6),
    });
  }
}
