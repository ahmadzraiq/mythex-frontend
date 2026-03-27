import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { BUSINESS_CATEGORIES, DESIGN_MOODS } from '@/lib/builder/wizard-data';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { description } = await req.json();
    if (!description?.trim()) {
      return NextResponse.json({ error: 'description required' }, { status: 400 });
    }

    const categoryList = BUSINESS_CATEGORIES.map(c => `${c.id}: ${c.label} — ${c.description}`).join('\n');
    const moodList = DESIGN_MOODS.map(m => `${m.id}: ${m.label} — ${m.description}`).join('\n');

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 320,
      messages: [{
        role: 'user',
        content: `You are a web design expert. Given a business description, infer a great app/brand name and select the most fitting category, design mood, animation level, and layout structure.

Business description: "${description}"

Available categories (pick one id):
${categoryList}

Available moods (pick one id):
${moodList}

Animation level (0-3): 0=None, 1=Subtle, 2=Balanced, 3=Rich
Layout structure (0-4): 0=Symmetric/Traditional, 1=Mostly Symmetric, 2=Mixed, 3=Mostly Asymmetric, 4=Asymmetric/Dynamic

App name rules:
- 1-3 words maximum, memorable and on-brand
- Title case, no tagline, no generic words like "App" or "Website"
- Examples: "Brew & Co", "Verdure", "Apex Motors", "LexPath"

Respond with ONLY valid JSON — no markdown, no explanation:
{"appName":"<name>","category":"<id>","mood":"<id>","animationLevel":<0-3>,"layoutStructure":<0-4>}`,
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const jsonMatch = text.match(/\{[\s\S]+\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const result = JSON.parse(jsonMatch[0]);

    // Validate fields fall within allowed sets
    const validCategory = BUSINESS_CATEGORIES.some(c => c.id === result.category) ? result.category : BUSINESS_CATEGORIES[0].id;
    const validMood = DESIGN_MOODS.some(m => m.id === result.mood) ? result.mood : 'professional';
    const validAnim = Math.min(3, Math.max(0, Number(result.animationLevel) || 2));
    const validLayout = Math.min(4, Math.max(0, Number(result.layoutStructure) || 0));
    const appName = typeof result.appName === 'string' && result.appName.trim()
      ? result.appName.trim().slice(0, 60)
      : '';

    return NextResponse.json({
      appName,
      category: validCategory,
      mood: validMood,
      animationLevel: validAnim,
      layoutStructure: validLayout,
    });
  } catch (err) {
    console.error('[AI classify]', err);
    return NextResponse.json(
      { category: 'general', mood: 'professional', animationLevel: 2, layoutStructure: 0 },
      { status: 200 },
    );
  }
}
