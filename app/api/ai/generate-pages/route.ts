import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { BUSINESS_CATEGORIES, DESIGN_MOODS } from '@/lib/builder/wizard-data';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface AiSection {
  name: string;
  description?: string;
}

export interface AiPage {
  id: string;
  name: string;
  route: string;
  sections: AiSection[];
  required?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const { description, category, mood } = await req.json();

    const categoryInfo = BUSINESS_CATEGORIES.find(c => c.id === category);
    const moodInfo = DESIGN_MOODS.find(m => m.id === mood);

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `You are a web design strategist. Based on this business, generate the ideal page structure for a modern, conversion-focused website.

Business: "${description}"
Category: ${categoryInfo?.label ?? category} — ${categoryInfo?.description ?? ''}
Design mood: ${moodInfo?.label ?? mood}

Rules:
- Generate 3-6 pages appropriate for this business
- Every page must start with section "Navigation" and end with section "Footer"
- Section names must be specific and descriptive (e.g. "Hero — Product Showcase", not just "Hero")
- Homepage: 6-9 sections total. Other pages: 4-6 sections
- For each section, provide a short description (1-2 sentences) explaining what the section contains and its purpose
- Navigation and Footer sections should have no description (they are required)
- Use route "/" for homepage, "/about", "/services", "/contact", "/pricing", etc.
- id must be short kebab-case

Respond with ONLY valid JSON — no markdown, no explanation:
{
  "pages": [
    {
      "id": "homepage",
      "name": "Homepage",
      "route": "/",
      "sections": [
        {"name": "Navigation"},
        {"name": "Hero — Welcome", "description": "Full-screen hero with headline, subtext and primary CTA button."},
        {"name": "Footer"}
      ]
    }
  ]
}`,
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const result = JSON.parse(jsonMatch[0]);

    const pages: AiPage[] = (result.pages ?? []).slice(0, 6).map((p: Record<string, unknown>) => {
      const rawSections = Array.isArray(p.sections) ? p.sections : [];
      const sections: AiSection[] = rawSections.map((s: unknown) => {
        if (typeof s === 'string') return { name: s };
        const sec = s as Record<string, unknown>;
        return {
          name: String(sec.name ?? 'Section'),
          description: sec.description ? String(sec.description) : undefined,
        };
      });
      return {
        id: String(p.id ?? 'page'),
        name: String(p.name ?? 'Page'),
        route: String(p.route ?? '/'),
        sections: sections.length ? sections : [{ name: 'Navigation' }, { name: 'Hero' }, { name: 'Footer' }],
      };
    });

    if (pages.length === 0) throw new Error('No pages returned');

    return NextResponse.json({ pages });
  } catch (err) {
    console.error('[AI generate-pages]', err);
    return NextResponse.json({
      pages: [
        {
          id: 'homepage', name: 'Homepage', route: '/',
          sections: [
            { name: 'Navigation' },
            { name: 'Hero — Welcome', description: 'Full-screen hero section with a bold headline and primary call-to-action button.' },
            { name: 'About Overview', description: 'Brief introduction to the business, its mission, and what sets it apart.' },
            { name: 'Services', description: 'Overview of key offerings presented in a clean card grid layout.' },
            { name: 'Testimonials', description: 'Customer reviews and social proof to build trust with visitors.' },
            { name: 'Contact CTA', description: 'A clear call-to-action section encouraging visitors to get in touch.' },
            { name: 'Footer' },
          ],
        },
        {
          id: 'about', name: 'About', route: '/about',
          sections: [
            { name: 'Navigation' },
            { name: 'Our Story', description: 'The founding story, mission, and vision behind the business.' },
            { name: 'Team', description: 'Headshots and bios of key team members.' },
            { name: 'Mission & Values', description: 'Core principles and values that guide the business.' },
            { name: 'Footer' },
          ],
        },
        {
          id: 'contact', name: 'Contact', route: '/contact',
          sections: [
            { name: 'Navigation' },
            { name: 'Contact Form', description: 'Simple form for visitors to send inquiries directly.' },
            { name: 'Location & Hours', description: 'Address, map embed, and business hours.' },
            { name: 'Footer' },
          ],
        },
      ] as AiPage[],
    });
  }
}
