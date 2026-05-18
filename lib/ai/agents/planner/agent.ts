/**
 * Phase H — Planner runner. Receives the raw user message + pre-resolved context
 * from the Context Agent and produces a ContractManifest via a single Haiku call.
 *
 * The Planner is single-shot — it does NOT search. Context was already gathered by
 * the Context Agent (runContextAgent). ResolvedNodeIds in the manifest are filled
 * directly from contextResult.resolvedNodes.
 *
 * Pipeline:
 *   user message → Context Agent → runPlanner (Haiku) → ContractManifest
 *                                               ↓
 *                               structure step → parallel pool
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ContractManifest } from '../manifest';
import { PLANNER_SYSTEM } from './prompt';
import type { ContextResult } from '../context-agent';

const MODEL = 'claude-haiku-4-5';

export interface PlannerInput {
  /** Raw user message — the planner reads this directly. */
  message: string;
  selectedNodeIds: string[];
  /** Pre-resolved context from the Context Agent. May have empty arrays for BUILD requests. */
  contextResult: ContextResult;
  signal?: AbortSignal;
}

/** Serialise context into a compact block the Planner can use directly */
function buildContextBlock(ctx: ContextResult): string {
  if (ctx.skippedSearch && ctx.resolvedNodes.length === 0 && ctx.resolvedVariables.length === 0) {
    return ''; // Pure BUILD — no context needed
  }

  const parts: string[] = [];

  if (ctx.resolvedNodes.length > 0) {
    parts.push('## Resolved targets (use these UUIDs in resolvedNodeIds — do NOT search again)');
    for (const n of ctx.resolvedNodes) {
      const details = [
        n.name ? `name="${n.name}"` : null,
        n.type ? `type=${n.type}` : null,
        n.pageRoute ? `page=${n.pageRoute}` : null,
        n.parentName ? `parent="${n.parentName}"` : null,
      ].filter(Boolean).join(', ');
      parts.push(`  - UUID: ${n.id} (${details})`);
    }
  }

  if (ctx.resolvedVariables.length > 0) {
    parts.push('\n## Resolved variables');
    for (const v of ctx.resolvedVariables) {
      const shapeStr = v.inferredShape ? ` shape={${Object.entries(v.inferredShape).map(([k, t]) => `${k}:${t}`).join(', ')}}` : '';
      const fieldStr = v.useField ? ` → use field "${v.useField}"` : '';
      parts.push(`  - ${v.name} (id=${v.id}, type=${v.type}${shapeStr}${fieldStr})`);
    }
  }

  if (ctx.resolvedDataSources.length > 0) {
    parts.push('\n## Resolved data sources');
    for (const ds of ctx.resolvedDataSources) {
      const pathStr = ds.relevantPath ? ` at path: ${ds.relevantPath}` : '';
      parts.push(`  - ${ds.label} (id=${ds.id}${pathStr})`);
    }
  }

  if (ctx.resolvedWorkflows.length > 0) {
    parts.push('\n## Resolved workflows');
    for (const wf of ctx.resolvedWorkflows) {
      parts.push(`  - ${wf.name} (id=${wf.id})`);
    }
  }

  return parts.length > 0 ? `\n\n[Context Agent resolved the following targets]\n${parts.join('\n')}` : '';
}

export async function runPlanner(input: PlannerInput): Promise<ContractManifest> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('[planner] ANTHROPIC_API_KEY is not set');

  const client = new Anthropic({ apiKey });

  const contextBlock = buildContextBlock(input.contextResult);

  // Build user content: message + selected nodes + pre-resolved context
  const selectedPart = input.selectedNodeIds.length > 0
    ? `\n\nSelected node IDs: ${input.selectedNodeIds.join(', ')}`
    : '';

  const userContent = `${input.message}${selectedPart}${contextBlock}`;

  const res = (await client.messages.create({
    model: MODEL,
    max_tokens: 5000,
    system: PLANNER_SYSTEM,
    messages: [{ role: 'user', content: userContent }],
    stream: false,
  } as Parameters<typeof client.messages.create>[0], input.signal ? { signal: input.signal } : undefined)) as Anthropic.Messages.Message;

  const textBlock = res.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
  const text = textBlock?.text ?? '';
  const match = /\{[\s\S]*\}/m.exec(text);
  if (!match) throw new Error(`[planner] no JSON in response: ${text.slice(0, 300)}`);

  const manifest = JSON.parse(match[0]) as ContractManifest;

  // Auto-fill resolvedNodeIds from context if Planner left them empty on edit ops
  if (input.contextResult.resolvedNodes.length > 0) {
    for (const op of manifest.operations ?? []) {
      if (op.resolvedNodeIds && op.resolvedNodeIds.length === 0 && !op.agents?.structure) {
        // Edit op with no structure — inject the resolved IDs
        op.resolvedNodeIds = input.contextResult.resolvedNodes
          .filter(n => !op.pageRoute || n.pageRoute === op.pageRoute || !n.pageRoute)
          .map(n => n.id);
      }
    }
  }

  return manifest;
}
