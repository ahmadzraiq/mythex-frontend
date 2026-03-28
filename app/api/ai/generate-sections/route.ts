import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { BUSINESS_CATEGORIES, DESIGN_MOODS, SHARED_NAV_SECTION, SHARED_FOOTER_SECTION } from '@/lib/builder/wizard-data';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface AiSectionWithHints {
  name: string;
  description?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { pageId, pageName, route, description, category, mood } = await req.json();

    const categoryInfo = BUSINESS_CATEGORIES.find(c => c.id === category);
    const moodInfo = DESIGN_MOODS.find(m => m.id === mood);

    const isHomepage = route === '/';
    const sectionCount = isHomepage ? '6-9' : '4-6';

    const prompt = `You are a web design strategist. Generate sections for a specific page of a website.

Business: "${description}"
Category: ${categoryInfo?.label ?? category}
Design mood: ${moodInfo?.label ?? mood}
Page: "${pageName}" (route: ${route})

Rules:
- Generate ${sectionCount} content sections for this page (do NOT include Navigation or Footer — those are added automatically)
- Section names must be specific and descriptive (e.g. "Hero — Product Showcase", not just "Hero")
- Every section MUST have a description: 1-2 sentences explaining its purpose and content

Respond with ONLY valid JSON:
{
  "sections": [
    {
      "name": "Hero — Welcome",
      "description": "Full-screen hero with bold headline and primary CTA."
    }
  ]
}`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const result = JSON.parse(jsonMatch[0]);

    const rawSections: AiSectionWithHints[] = (result.sections ?? []).map((s: Record<string, unknown>) => ({
      name: String(s.name ?? 'Section'),
      description: s.description ? String(s.description) : undefined,
    }));

    // Merge pairs where AI still emits a name-only entry followed by a generic "Section" entry with details
    const contentSections: AiSectionWithHints[] = [];
    for (let i = 0; i < rawSections.length; i++) {
      const curr = rawSections[i];
      const next = rawSections[i + 1];
      // Skip if AI accidentally included Navigation or Footer
      if (curr.name === 'Navigation' || curr.name === 'Footer') continue;
      if (!curr.description && next && next.name === 'Section' && next.description) {
        contentSections.push({ name: curr.name, description: next.description });
        i++;
      } else {
        contentSections.push(curr);
      }
    }

    // Always wrap with the shared Navigation and Footer (same object across all pages)
    const sections: AiSectionWithHints[] = [SHARED_NAV_SECTION, ...contentSections, SHARED_FOOTER_SECTION];

    void pageId;

    return NextResponse.json({ sections });
  } catch (err) {
    console.error('[AI generate-sections]', err);
    return NextResponse.json({
      sections: [
        SHARED_NAV_SECTION,
        {
          name: 'Hero — Welcome',
          description: 'Full-screen hero section with a bold headline and primary call-to-action button.',
        },
        {
          name: 'Features Overview',
          description: 'Key offerings presented in a clean card grid layout.',
        },
        {
          name: 'Contact CTA',
          description: 'A clear call-to-action section encouraging visitors to get in touch.',
        },
        SHARED_FOOTER_SECTION,
      ] as AiSectionWithHints[],
    });
  }
}
