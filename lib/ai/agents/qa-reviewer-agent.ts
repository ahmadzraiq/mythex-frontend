/**
 * QA Reviewer Agent — gpt-4o + vision
 *
 * Reviews a rendered page screenshot against the DesignSpec.
 * Outputs a structured score (1-10) and issues list.
 * If score < 7 (configurable), ManagerAgent sends issues to
 * StructureAgent for one targeted retry.
 */

import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import * as fs from 'fs';
import type { DesignSpec } from './design-director-agent';
import type { DesignBrief } from './brief-agent';

// ─── Types ────────────────────────────────────────────────────────────────────

export const qaIssueSchema = z.object({
  section: z.string().describe('Section name e.g. "hero", "categories", "product-grid"'),
  severity: z.enum(['critical', 'minor']).catch('minor'),
  description: z.string().describe('What is wrong'),
  fix: z.string().optional().default('').describe('Specific instruction to fix it — must be actionable for the StructureAgent'),
});

export const qaReportSchema = z.object({
  score: z.coerce.number().min(1).max(10).describe('Overall design quality score 1-10'),
  passed: z.coerce.boolean().optional(),
  issues: z.array(qaIssueSchema.passthrough()).optional().default([]),
  strengths: z.array(z.string()).optional().default([]),
  summary: z.string().optional().default('No summary provided'),
});

export type QAIssue = z.infer<typeof qaIssueSchema>;
export type QAReport = z.infer<typeof qaReportSchema>;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior design QA reviewer at a top e-commerce agency. You review rendered pages against design specs.

SCORING CRITERIA (1-10):
- 9-10: Production-ready. All sections render correctly, design matches the spec, professional look.
- 7-8: Good. Minor issues only, overall impression is strong.
- 5-6: Acceptable but needs work. Multiple minor issues or one critical issue.
- 3-4: Poor. Missing sections, broken layout, or design completely mismatches spec.
- 1-2: Broken. White screen, mostly empty, or catastrophic layout failure.

CRITICAL ISSUES (any single one fails):
- Blank/white sections that should have content (empty product grid, invisible categories)
- Broken images that show a placeholder icon
- Text rendered on same-color background (unreadable)
- Section completely missing when it should be there per spec
- Product cards showing "$0.00" or no image (wrong field names)
- CountdownTimer and heading on the same line ("⚡ Flash Sale36 d : 08 h")

MINOR ISSUES:
- Misaligned elements
- Wrong color for a specific element
- Copy doesn't match the brief tone
- Spacing is too tight or too loose
- Section order doesn't match spec

OUTPUT FORMAT: Respond with ONLY a raw JSON object (no markdown fences, no explanation). Schema:
{
  "score": <number 1-10>,
  "passed": <boolean, true if score >= 7>,
  "issues": [{ "section": <string>, "severity": "critical" | "minor", "description": <string>, "fix": <string> }],
  "strengths": [<string>],
  "summary": <string — one paragraph>
}`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export interface QAReviewerOptions {
  screenshotPath?: string;
  screenshotBase64?: string;
  screenConfig?: Record<string, unknown>;
  passThreshold?: number;
}

/**
 * Run the QA Reviewer Agent on a rendered page.
 * Either screenshotPath or screenshotBase64 must be provided.
 */
export async function runQAReviewerAgent(
  spec: DesignSpec,
  brief: DesignBrief,
  options: QAReviewerOptions,
): Promise<QAReport> {
  const { screenshotPath, screenshotBase64, screenConfig, passThreshold = 7 } = options;

  let imageData: string | undefined;

  if (screenshotPath && fs.existsSync(screenshotPath)) {
    imageData = fs.readFileSync(screenshotPath).toString('base64');
  } else if (screenshotBase64) {
    imageData = screenshotBase64;
  }

  const specContext = `DESIGN SPEC:
- Brand: ${brief.brandName} (${brief.industryType})
- Tone: ${brief.brandTone}
- Visual direction: ${spec.visualDirection}
- Layout style: ${spec.layoutStyle}
- Color mood: ${spec.colorMood}
- Brand personality: ${spec.brandPersonality}
- Expected sections (in order): ${brief.sections.join(', ')}
- Competitor references: ${spec.competitorRefs.join(', ')}`;

  const configContext = screenConfig
    ? `\nGENERATED CONFIG SUMMARY:\n${JSON.stringify({ meta: (screenConfig as Record<string, unknown>).meta, sectionsCount: Array.isArray(((screenConfig as Record<string, unknown>).content as Record<string, unknown>)?.children) ? (((screenConfig as Record<string, unknown>).content as Record<string, unknown>).children as unknown[]).length : 'unknown' }, null, 2)}`
    : '';

  const userPrompt = `${specContext}${configContext}

${imageData ? 'Review the attached screenshot of the rendered page.' : 'No screenshot available — review based on config only.'}

Score this page 1-10 and identify all issues that need to be fixed.`;

  // Build messages — image included when screenshot is available.
  // Use generateText + Output.json() (non-strict mode) instead of generateObject
  // so that GPT-4V doesn't trigger a structured refusal when product images are in the screenshot.
  const buildMessages = (withImage: boolean) =>
    withImage && imageData
      ? [
          {
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: userPrompt },
              { type: 'image' as const, image: Buffer.from(imageData, 'base64') },
            ],
          },
        ]
      : [{ role: 'user' as const, content: userPrompt }];

  const runReview = async (withImage: boolean): Promise<QAReport> => {
    const { text } = await generateText({
      model: openai('gpt-4o'),
      system: SYSTEM_PROMPT,
      messages: buildMessages(withImage),
      temperature: 0.2,
    });

    // Strip markdown fences if model wraps response anyway
    const jsonStr = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(jsonStr);
    } catch {
      throw new Error(`QA output not valid JSON: ${text.slice(0, 300)}`);
    }

    const parsed = qaReportSchema.safeParse(rawParsed);
    if (!parsed.success) {
      throw new Error(`QA output schema invalid: ${JSON.stringify(parsed.error.issues, null, 2)}`);
    }
    return { ...parsed.data, passed: parsed.data.score >= passThreshold };
  };

  // Try with screenshot first; fall back to text-only if vision is refused/fails.
  if (imageData) {
    try {
      return await runReview(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[qa-reviewer] Vision call failed, retrying text-only:', msg.slice(0, 120));
      return await runReview(false);
    }
  }

  return await runReview(false);
}
