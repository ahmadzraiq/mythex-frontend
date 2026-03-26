import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { BUSINESS_CATEGORIES, DESIGN_MOODS, SHARED_NAV_SECTION, SHARED_FOOTER_SECTION } from '@/lib/builder/wizard-data';
import { SDUI_COMPONENT_LABELS } from '@/lib/builder/sdui-component-labels';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface AiSectionWithHints {
  name: string;
  description?: string;
  designHints?: {
    /** Labels from PRIMITIVE_COMPONENTS in _components-tab.tsx (e.g. "Grid", "Card", "Btn Solid") */
    components?: string[];
    tone?: string;
    layout?: string;
  };
}

export async function POST(req: NextRequest) {
  try {
    const { pageId, pageName, route, description, category, mood } = await req.json();

    const categoryInfo = BUSINESS_CATEGORIES.find(c => c.id === category);
    const moodInfo = DESIGN_MOODS.find(m => m.id === mood);
    const componentList = SDUI_COMPONENT_LABELS.join(', ');

    const isHomepage = route === '/';
    const sectionCount = isHomepage ? '6-9' : '4-6';

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: `You are a web design strategist. Generate sections for a specific page of a website.

Business: "${description}"
Category: ${categoryInfo?.label ?? category}
Design mood: ${moodInfo?.label ?? mood}
Page: "${pageName}" (route: ${route})

Rules:
- Generate ${sectionCount} content sections for this page (do NOT include Navigation or Footer — those are added automatically)
- CRITICAL: each section is ONE object with the section name AND its details combined — never output a name-only object followed by a separate details object
- Section names must be specific and descriptive (e.g. "Hero — Product Showcase", not just "Hero")
- Every section MUST include description and designHints IN THE SAME object as the name:
  * description: 1-2 sentences explaining purpose and content
  * designHints.components: 3-6 labels from this exact list only: ${componentList}
  * designHints.tone: 2-4 words describing visual tone
  * designHints.layout: brief layout description (e.g. "3-column card grid", "full-width banner with overlay text")

Respond with ONLY valid JSON — one object per section, name + description + designHints always together:
{
  "sections": [
    {
      "name": "Hero — Welcome",
      "description": "Full-screen hero with bold headline and primary CTA.",
      "designHints": {
        "components": ["Box", "Image", "Heading", "Text", "Btn Solid"],
        "tone": "bold, impactful",
        "layout": "full-width image background with centered overlay text"
      }
    },
    {
      "name": "Features — Three Pillars",
      "description": "Three key value propositions with icons and brief descriptions.",
      "designHints": {
        "components": ["Grid", "Card", "Icon", "Heading", "Text"],
        "tone": "clean, structured",
        "layout": "3-column icon card grid"
      }
    }
  ]
}`,
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const result = JSON.parse(jsonMatch[0]);

    const validLabels = new Set(SDUI_COMPONENT_LABELS);
    const rawSections: AiSectionWithHints[] = (result.sections ?? []).map((s: Record<string, unknown>) => {
      const sec: AiSectionWithHints = {
        name: String(s.name ?? 'Section'),
        description: s.description ? String(s.description) : undefined,
      };
      if (s.designHints && typeof s.designHints === 'object') {
        const dh = s.designHints as Record<string, unknown>;
        sec.designHints = {
          components: Array.isArray(dh.components)
            ? (dh.components as unknown[]).map(String).filter(c => validLabels.has(c))
            : undefined,
          tone: dh.tone ? String(dh.tone) : undefined,
          layout: dh.layout ? String(dh.layout) : undefined,
        };
      }
      return sec;
    });

    // Merge pairs where AI still emits a name-only entry followed by a generic "Section" entry with details
    const contentSections: AiSectionWithHints[] = [];
    for (let i = 0; i < rawSections.length; i++) {
      const curr = rawSections[i];
      const next = rawSections[i + 1];
      // Skip if AI accidentally included Navigation or Footer
      if (curr.name === 'Navigation' || curr.name === 'Footer') continue;
      if (
        !curr.description && !curr.designHints &&
        next && next.name === 'Section' && (next.description || next.designHints)
      ) {
        // Merge: use curr's descriptive name + next's description/designHints
        contentSections.push({ name: curr.name, description: next.description, designHints: next.designHints });
        i++; // skip the consumed "Section" entry
      } else {
        contentSections.push(curr);
      }
    }

    // Always wrap with the shared Navigation and Footer (same object across all pages)
    const sections: AiSectionWithHints[] = [SHARED_NAV_SECTION, ...contentSections, SHARED_FOOTER_SECTION];

    void pageId; // used for logging by caller

    return NextResponse.json({ sections });
  } catch (err) {
    console.error('[AI generate-sections]', err);
    return NextResponse.json({
      sections: [
        SHARED_NAV_SECTION,
        {
          name: 'Hero — Welcome',
          description: 'Full-screen hero section with a bold headline and primary call-to-action button.',
          designHints: { components: ['Box', 'Image', 'Heading', 'Text', 'Btn Solid'], tone: 'bold, inviting', layout: 'full-width banner with overlay text' },
        },
        {
          name: 'Features Overview',
          description: 'Key offerings presented in a clean card grid layout.',
          designHints: { components: ['Grid', 'Card', 'Icon', 'Heading', 'Caption'], tone: 'clean, structured', layout: '3-column icon card grid' },
        },
        {
          name: 'Contact CTA',
          description: 'A clear call-to-action section encouraging visitors to get in touch.',
          designHints: { components: ['VStack', 'Heading', 'Text', 'Btn Solid', 'Btn Outline'], tone: 'direct, friendly', layout: 'centered column with CTA buttons' },
        },
        SHARED_FOOTER_SECTION,
      ] as AiSectionWithHints[],
    });
  }
}
