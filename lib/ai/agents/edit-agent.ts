/**
 * Edit Agent — Micro-AI for Tier 2 Structural Edits
 *
 * Key design principle: the AI ONLY sees the minimal relevant subtree
 * (5-40 lines) — NOT the full 500+ line page JSON.
 *
 * This gives:
 *   - Near-zero syntax errors (less context to corrupt)
 *   - 5-10x faster response (~1-2s instead of 10-15s)
 *   - Lower token cost per edit
 *
 * Input: subtree JSON + instruction
 * Output: patched subtree JSON (validated before applying)
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { extractEditableSubtree } from '@/lib/ai/editing/node-locator';

// ─── Input / Output types ─────────────────────────────────────────────────────

export interface EditAgentInput {
  /** The minimal SDUI subtree to edit (extracted by NodeLocator) */
  targetSubtree: Record<string, unknown>;
  /** The path to this subtree within the full page JSON */
  subtreePath: string;
  /** What the user wants to do */
  instruction: string;
  /** Surrounding context: section type, brand name, etc. */
  context?: string;
}

export interface EditAgentOutput {
  /** The patched subtree — ready to splice back in via Patcher */
  patchedSubtree: Record<string, unknown>;
  /** Human-readable summary of changes made */
  summary: string;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an SDUI JSON edit specialist. You receive a small JSON subtree and modify it per the instruction.

SDUI COMPONENT RULES (critical):
- Box defaults to flex-col. Always add "flex-row" for horizontal layouts.
- Every container with mx-auto must have w-full.
- Pressable/Box cannot have raw text — always wrap in { "type": "Text" } child.
- Button labels: ALWAYS use ButtonText child — NEVER "text" prop directly on Button.
  Example: { "type": "Button", "children": [{ "type": "ButtonText", "text": "Shop Now" }] }
- Icons: { "type": "NavIcon", "props": { "icon": "Search", "size": 20 } } — NEVER Icon with string "as"
- images need relative parent with height: { "type": "Box", "props": { "className": "relative w-full h-52" } }
- actions format: ALWAYS a record { "click": {...} } — NEVER an array
- State paths: use "screens.screenName.form.field" NOT "form.field" in setState
- Map: "map" goes on the ITEM child, not on grid/flex container
- When adding dropdown: use condition: { "var": "nav.menuOpen" } pattern for show/hide

AVAILABLE ACTION TYPES:
- navigate: { "action": "navigate", "payload": { "path": "/..." } }
- navigate dynamic: { "action": "navigate", "payload": { "routeConfig": "product", "slug": { "var": "$item.slug" } } }
- setState: { "action": "setState", "payload": { "path": "screens.home.nav.open", "value": true } }
- toggle: { "action": "toggle", "payload": { "path": "nav.menuOpen" } }
- openDrawer/closeDrawer: { "action": "openDrawer" }

AVAILABLE COMPONENTS:
Box, Heading, Text, Button, ButtonText, Pressable, NavIcon, NextImage, Input, InputField, InputSlot, Badge, Select, SelectTrigger, SelectInput, SelectContent, SelectItem

OUTPUT: Return ONLY the modified JSON subtree. No markdown, no explanation text, no surrounding array.
The output must be valid JSON that can be JSON.parse()d.`;

// ─── Agent ────────────────────────────────────────────────────────────────────

/**
 * Run the Edit Agent on a small subtree.
 * @throws Error if output is invalid JSON
 */
export async function runEditAgent(input: EditAgentInput): Promise<EditAgentOutput> {
  const { targetSubtree, instruction, context } = input;

  const subtreeStr = JSON.stringify(targetSubtree, null, 2);
  const subtreeLines = subtreeStr.split('\n').length;

  const userPrompt = `${context ? `Context: ${context}\n\n` : ''}Instruction: ${instruction}

Current SDUI JSON subtree (${subtreeLines} lines):
${subtreeStr}

Apply the instruction and return the modified subtree as valid JSON.`;

  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    temperature: 0.3,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
  });

  // Extract JSON from response (handle any markdown wrapping)
  const jsonStr = extractJSON(text);

  let patchedSubtree: Record<string, unknown>;
  try {
    patchedSubtree = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    throw new Error(`EditAgent: Output is not valid JSON.\nRaw output:\n${text}`);
  }

  // Basic sanity check — must be an object with at least a "type" field
  if (typeof patchedSubtree !== 'object' || !patchedSubtree.type) {
    throw new Error(`EditAgent: Output missing "type" field — not a valid SDUI node`);
  }

  return {
    patchedSubtree,
    summary: `Applied: "${instruction}" to ${patchedSubtree.type} node`,
  };
}

// ─── Run with full page context ───────────────────────────────────────────────

/**
 * Convenience wrapper: extract subtree from full page, run agent, return patch info.
 */
export async function runEditAgentOnPage(
  pageJson: Record<string, unknown>,
  targetNodeId: string,
  instruction: string,
  context?: string,
): Promise<{ subtreePath: string; patchedSubtree: Record<string, unknown>; summary: string }> {
  const extracted = extractEditableSubtree(pageJson, targetNodeId);
  if (!extracted) {
    throw new Error(`EditAgent: Node with id "${targetNodeId}" not found in page`);
  }

  const output = await runEditAgent({
    targetSubtree: extracted.subtree,
    subtreePath: extracted.subtreePath,
    instruction,
    context,
  });

  return {
    subtreePath: extracted.subtreePath,
    patchedSubtree: output.patchedSubtree,
    summary: output.summary,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractJSON(text: string): string {
  const trimmed = text.trim();

  // Remove markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenceMatch) return fenceMatch[1];

  // Find first { and last }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

// ─── Validator ────────────────────────────────────────────────────────────────

const uiNodeSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    id: z.string().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    text: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    actions: z.record(z.string(), z.unknown()).optional(),
    condition: z.unknown().optional(),
    children: z.array(uiNodeSchema).optional(),
    map: z.string().optional(),
    key: z.string().optional(),
  }).passthrough()
);

/**
 * Validate a patched subtree against the basic SDUI node schema.
 * Returns validation result.
 */
export function validateSubtree(subtree: Record<string, unknown>): { valid: boolean; errors?: string[] } {
  const result = uiNodeSchema.safeParse(subtree);
  if (result.success) return { valid: true };
  return {
    valid: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}
