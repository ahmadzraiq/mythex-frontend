/**
 * Intent Classifier — Maps user edit requests to EditIntent
 *
 * Classification flow:
 *   1. Rule-based regex patterns → instant, no AI
 *   2. If unclear → tiny AI call (gpt-4o-mini) for structured classification
 *
 * Most common requests (colors, padding, text changes, remove) are
 * handled purely by rules (step 1).
 */

import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { interpretStyleRequest } from './style-interpreter';
import type { StyleRule } from './style-interpreter';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EditTier = 1 | 2 | 3 | 4;

export type EditOperation =
  | 'style'           // Tier 1 — className, text, visibility
  | 'content'         // Tier 1 — change text content
  | 'actions'         // Tier 2 — modify click/change actions
  | 'add-child'       // Tier 2 — add new element inside node
  | 'remove'          // Tier 1 — delete node
  | 'swap-variant'    // Tier 3 — replace entire section with different variant
  | 'add-section'     // Tier 3 — add a new section to the page
  | 'full-regen';     // Tier 4 — full page regeneration

export interface EditIntent {
  tier: EditTier;
  /** What the user described as the target ("the blue button in the hero") */
  targetDescription: string;
  /** Anchor ID if user clicked element or it's unambiguous */
  targetId?: string;
  operation: EditOperation;
  /** Filled for Tier 1 style edits */
  styleRule?: StyleRule;
  /** Filled for Tier 2 — passed directly to EditAgent */
  instruction?: string;
  /** Filled for Tier 3 section swaps */
  variantId?: string;
  /** Raw params for section swap */
  sectionIndex?: number;
  /** Confidence 0-1 */
  confidence: number;
}

// ─── Rule-based classifiers ───────────────────────────────────────────────────

const TIER3_PATTERNS: RegExp[] = [
  /swap\s+(?:the\s+)?(hero|product\s*grid|categories?|newsletter|testimonials?|features?)\s+(?:to|with|variant)/i,
  /change\s+(?:the\s+)?(hero|product\s*grid|categories?|newsletter|testimonials?|features?)\s+(?:layout|style|variant|design)/i,
  /use\s+(?:the\s+)?(\w+)\s+(?:hero|grid|layout|variant)/i,
  /replace\s+(?:the\s+)?\w+\s+(?:section|layout)\s+with/i,
];

const TIER2_PATTERNS: RegExp[] = [
  /add\s+(?:a\s+)?dropdown/i,
  /add\s+(?:a\s+)?(?:new\s+)?button/i,
  /add\s+(?:a\s+)?(?:new\s+)?(?:nav|navigation)\s+(?:item|link)/i,
  /when\s+(?:i\s+|the\s+user\s+)?click/i,
  /add\s+(?:a\s+)?(?:badge|tag|label)/i,
  /change\s+(?:the\s+)?(?:action|click\s+behavior|link)/i,
  /navigate\s+to\s+/i,
  /open\s+in\s+(?:new\s+tab|modal|drawer)/i,
  /add\s+(?:a\s+)?(?:second|another)\s+(?:cta|button|link)/i,
];

const TIER1_STRUCTURAL_PATTERNS: RegExp[] = [
  /^(?:remove|delete|hide)\b/i,
  /^(?:show|unhide|make\s+visible)\b/i,
];

function matchesTier3(text: string): boolean {
  return TIER3_PATTERNS.some(p => p.test(text));
}

function matchesTier2(text: string): boolean {
  return TIER2_PATTERNS.some(p => p.test(text));
}

// ─── Main classifier ──────────────────────────────────────────────────────────

/**
 * Classify a user edit request into an EditIntent.
 *
 * If targetId is provided (user clicked element in UI), it's passed through directly.
 * Otherwise targetDescription is used for node lookup.
 */
export async function classifyEditIntent(
  userText: string,
  options: {
    targetId?: string;
    targetDescription?: string;
    pageJson?: Record<string, unknown>;
  } = {}
): Promise<EditIntent> {
  const text = userText.trim();
  const targetDescription = options.targetDescription ?? text;

  // ── Tier 1: Style check first (fastest, no AI) ────────────────────────────

  const styleResult = interpretStyleRequest(text);
  if (styleResult.isStyleEdit) {
    const op: EditOperation = styleResult.rule.operation === 'remove-node' ? 'remove' : 'style';
    return {
      tier: 1,
      targetDescription,
      targetId: options.targetId,
      operation: op,
      styleRule: styleResult.rule,
      confidence: styleResult.confidence,
    };
  }

  // ── Tier 1: Structural patterns ───────────────────────────────────────────

  for (const pattern of TIER1_STRUCTURAL_PATTERNS) {
    if (pattern.test(text)) {
      return {
        tier: 1,
        targetDescription,
        targetId: options.targetId,
        operation: 'remove',
        styleRule: { operation: 'remove-node' },
        confidence: 0.9,
      };
    }
  }

  // ── Tier 3: Section swap ──────────────────────────────────────────────────

  if (matchesTier3(text)) {
    return {
      tier: 3,
      targetDescription,
      targetId: options.targetId,
      operation: 'swap-variant',
      instruction: text,
      confidence: 0.8,
    };
  }

  // ── Tier 2: Structural change ─────────────────────────────────────────────

  if (matchesTier2(text)) {
    return {
      tier: 2,
      targetDescription,
      targetId: options.targetId,
      operation: 'add-child',
      instruction: text,
      confidence: 0.8,
    };
  }

  // ── AI classification for ambiguous requests ──────────────────────────────

  return classifyWithAI(text, targetDescription, options.targetId);
}

// ─── AI fallback ──────────────────────────────────────────────────────────────

const intentSchema = z.object({
  tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  operation: z.enum(['style', 'content', 'actions', 'add-child', 'remove', 'swap-variant', 'add-section', 'full-regen']),
  instruction: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});

async function classifyWithAI(
  userText: string,
  targetDescription: string,
  targetId?: string,
): Promise<EditIntent> {
  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: intentSchema,
    prompt: `Classify this UI edit request into one of 4 tiers:

Tier 1 (style) — pure className / text change, no structure change: color, padding, margin, font size, hide, remove, change text
Tier 2 (structural) — add/remove/modify specific element structure: add dropdown, add button, change action/navigation, add badge
Tier 3 (swap-variant) — replace entire section with different layout variant: "change hero to split layout", "use horizontal product grid"
Tier 4 (full-regen) — completely new page or section: "add a new hero section", "regenerate the page"

User request: "${userText}"

Return:
- tier: 1, 2, 3, or 4
- operation: the most specific operation type
- instruction: clean restatement of what to do (for Tier 2 EditAgent)
- confidence: 0-1
`,
  });

  return {
    tier: object.tier,
    targetDescription,
    targetId,
    operation: object.operation,
    instruction: object.instruction,
    confidence: object.confidence,
  };
}

// ─── Describe edit for logging ────────────────────────────────────────────────

export function describeIntent(intent: EditIntent): string {
  const target = intent.targetId ? `#${intent.targetId}` : `"${intent.targetDescription}"`;
  return `Tier ${intent.tier} | ${intent.operation} | target: ${target} | confidence: ${(intent.confidence * 100).toFixed(0)}%`;
}
