import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { BUSINESS_CATEGORIES, DESIGN_MOODS } from '@/lib/builder/wizard-data';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface AiPageStub {
  id: string;
  name: string;
  route: string;
}

export async function POST(req: NextRequest) {
  try {
    const { description, category, mood } = await req.json();

    const categoryInfo = BUSINESS_CATEGORIES.find(c => c.id === category);
    const moodInfo = DESIGN_MOODS.find(m => m.id === mood);

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `You are a web design strategist. Suggest the ideal pages for this website.

Business: "${description}"
Category: ${categoryInfo?.label ?? category} — ${categoryInfo?.description ?? ''}
Design mood: ${moodInfo?.label ?? mood}

Rules:
- Suggest 3-6 pages appropriate for this business
- Use "/" for homepage, "/about", "/services", "/contact", "/pricing", etc.
- id must be short kebab-case (e.g. "homepage", "about", "contact")
- Only page names and routes — NO sections

Respond with ONLY valid JSON:
{"pages":[{"id":"homepage","name":"Homepage","route":"/"},{"id":"about","name":"About","route":"/about"}]}`,
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const result = JSON.parse(jsonMatch[0]);

    const pages: AiPageStub[] = (result.pages ?? []).slice(0, 6).map((p: Record<string, unknown>) => ({
      id: String(p.id ?? 'page'),
      name: String(p.name ?? 'Page'),
      route: String(p.route ?? '/'),
    }));

    if (pages.length === 0) throw new Error('No pages returned');

    return NextResponse.json({ pages });
  } catch (err) {
    console.error('[AI generate-page-names]', err);
    return NextResponse.json({
      pages: [
        { id: 'homepage', name: 'Homepage', route: '/' },
        { id: 'about', name: 'About', route: '/about' },
        { id: 'contact', name: 'Contact', route: '/contact' },
      ] as AiPageStub[],
    });
  }
}
