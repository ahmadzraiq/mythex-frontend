/**
 * Smart Planner — Sonnet agentic loop.
 *
 * Absorbs the former Context Agent, Structure Agent, and Structure Step into a
 * single reasoning loop.  The planner can:
 *   - search / semantic_search / read  (understand existing page context)
 *   - generate_structure               (build the DOM tree + inline variables)
 *   - add_variable                     (create standalone variables)
 *   - create_shared_component          (declare reusable SC shells)
 *   - emit_plan                        (output manifest + summary — terminates the loop)
 *
 * Extended thinking (budget 8 192 tokens) runs before each tool call so the
 * model can reason about layout, variable design, and interactions without
 * burning extra API rounds.
 *
 * The loop has NO prescribed ordering.  The planner decides when to search,
 * when to build structure, when to declare variables, and when to call
 * emit_plan.  A safety ceiling of MAX_PLANNER_ROUNDS prevents infinite loops.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ContractManifest } from '../manifest';
import { SMART_PLANNER_SYSTEM } from './prompt';
import { runSearch, runRead, type ReadContext } from '@/lib/ai/tools/read-tools';
import {
  processStructureTree,
  type CollectedTree,
  type ToolEvent,
  type Marker,
} from '@/lib/ai/tools/process-structure-tree';

// ─── Constants ────────────────────────────────────────────────────────────────

const PLANNER_MODEL = 'claude-haiku-4-5';
const PLANNER_SUPPORTS_THINKING = false;
const MAX_PLANNER_ROUNDS = 20;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SmartPlannerInput {
  message: string;
  /** Last N compact turn summaries from previous planner calls */
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  readContext: ReadContext;
  /** Page ID to assign to generated trees on the current page */
  currentPageId: string;
  /** All known pages — used to resolve/create page IDs for new routes */
  pages: Array<{ id: string; name: string; route: string }>;
  /** Existing variables — for UUID deduplication inside processStructureTree */
  existingVariables: Array<{ id?: string; label?: string; name?: string; type?: string; initialValue?: unknown }>;
  /** SSE emitter — used to stream tool_executed events to the client */
  emit: (event: Record<string, unknown>) => void;
  /** Shared accumulator for all executed tools (populated by this function) */
  allExecutedTools: Array<{ name: string; input: Record<string, unknown>; result?: unknown }>;
  signal?: AbortSignal;
}

export interface SmartPlannerResult {
  manifest: ContractManifest;
  collectedTrees: CollectedTree[];
  addVarEventsCollected: ToolEvent[];
  allMarkers: Marker[][];
  needsClarification: { question: string; options?: string[] } | null;
  /** Compact summary written by the planner — saved to chatHistory for future turns */
  summary: string;
  /** Accumulated conversation messages */
  messages: Anthropic.Messages.MessageParam[];
}

// ─── Tool definitions passed to the API ──────────────────────────────────────

const PLANNER_TOOLS: Anthropic.Messages.Tool[] = [
  // ── Read / search ──────────────────────────────────────────────────────────
  {
    name: 'search',
    description: 'Regex search across all artifacts (nodes, variables, workflows, data sources). Use when the user refers to something by name or exact text.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Case-insensitive regex. Plain words do substring match.' },
        kinds: { type: 'array', items: { type: 'string' }, description: 'Limit to these artifact kinds.' },
        scope: { type: 'string', enum: ['currentPage', 'allPages'], description: 'currentPage is faster for edits to the active page.' },
        limit: { type: 'number', description: 'Max results (default 30).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read',
    description: 'Get full details for a specific artifact by ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        kind: { type: 'string', enum: ['node', 'variable', 'workflow', 'formula', 'dataSource', 'sharedComponent', 'page', 'theme'] },
        id: { type: 'string', description: 'UUID, name, or "*" for singletons.' },
        path: { type: 'string', description: 'Dot-notation path to slice into nested data.' },
        depth: { type: 'number', description: 'For node kinds: levels of children to include (default 1).' },
      },
      required: ['kind', 'id'],
    },
  },
  // ── Build tools ────────────────────────────────────────────────────────────
  {
    name: 'generate_structure',
    description: 'Build the UI node tree and declare any loop/state variables for a section or page. Variables are passed inline in the variables[] field of this call.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tree: {
          type: 'object',
          description: 'Root node of the section. Every node: { id (UUID), label (component type), name?, text?, searchQuery?, bgImage?, placeholder?, loop?, actions?, children[] }.',
        },
        variables: {
          type: 'array',
          description: 'Variables needed by this section. Each: { name, type, initialValue, uuid (hex 8-4-4-4-12), description?, folder?, mediaHints? }.',
          items: { type: 'object' },
        },
        atIndex: { type: 'number', description: 'Insert position among existing siblings (0-based). Omit to append.' },
        pageActions: {
          type: 'array',
          description: 'Page-lifecycle workflow stubs: [{ workflowId, trigger }]. Only for pageLoad / scroll / fetch-error triggers.',
          items: { type: 'object' },
        },
        _pageRoute: {
          type: 'string',
          description: 'Route of the page this tree belongs to (e.g. "/pricing", "/contact"). Required when building content for any page other than the current page. Omit for the current page.',
        },
        _pageName: {
          type: 'string',
          description: 'Human-readable name for the page (e.g. "Pricing", "Contact"). Required alongside _pageRoute when creating a new page.',
        },
        _unitName: {
          type: 'string',
          description: 'Short label for this section (e.g. "Header", "Pricing Page", "Contact Form"). Used as the section header in the compact tree.',
        },
      },
      required: ['tree'],
    },
  },
  {
    name: 'add_variable',
    description: 'Create a standalone variable not tied to a generate_structure call. Useful when editing an existing page that needs a new variable.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: ['string', 'number', 'boolean', 'object', 'array', 'form'] },
        initialValue: { description: 'Initial value.' },
        variableId: { type: 'string', description: 'Pre-assigned hex UUID (8-4-4-4-12).' },
        description: { type: 'string' },
        folder: { type: 'string' },
        scope: { type: 'string', enum: ['app', 'page', 'component'] },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'create_shared_component',
    description: 'Declare a reusable shared component shell. Author the full inline content tree with _sharedKey on every node.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Pre-minted model id, e.g. "sc-card".' },
        name: { type: 'string' },
        description: { type: 'string' },
        content: { type: 'object', description: 'Full internal node tree — every node must have _sharedKey.' },
        properties: { type: 'array', items: { type: 'object' }, description: 'Declared SC props.' },
        variables: { type: 'object', description: 'Component-scoped variables.' },
        workflows: { type: 'object', description: 'Component-scoped workflows.' },
        triggers: { type: 'array', items: { type: 'object' } },
      },
      required: ['name'],
    },
  },
  // ── Output ─────────────────────────────────────────────────────────────────
  {
    name: 'emit_plan',
    description: 'Output the completed manifest for specialist agents and a compact summary for session history. Call this ONLY after all structure is built and all intents are declared.',
    input_schema: {
      type: 'object' as const,
      properties: {
        intent: { type: 'string', description: 'One-line description used in the assistant reply.' },
        refinedRequest: { type: 'string', description: 'Cleaned-up restatement of the user request.' },
        summary: { type: 'string', description: 'Compact 1–2 sentence description of what was built (node count, variable count, key features). Saved to session history for future context.' },
        needsClarification: {
          type: 'object',
          description: 'Set ONLY when the request has no identifiable intent.',
          properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
          required: ['question'],
        },
        operations: {
          type: 'array',
          description: 'One entry per op — declares which specialist agents run and what they do.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              pageRoute: { type: 'string' },
              pageName: { type: 'string' },
              resolvedNodeIds: { type: 'array', items: { type: 'string' } },
              agents: {
                type: 'object',
                description: 'Keys: styling, animation, binding, workflows, media, data, sharedComponents, backend. Set only the ones needed for this op.',
              },
            },
            required: ['id', 'resolvedNodeIds', 'agents'],
          },
        },
        sharedComponentsToCreate: { type: 'array', items: { type: 'object' } },
      },
      required: ['intent', 'operations'],
    },
  },
];

// ─── Verify-pass tools (full planner set + verify_done) ──────────────────────


// ─── Standalone add_variable handler ─────────────────────────────────────────

function handleStandaloneAddVariable(
  input: Record<string, unknown>,
  existingVariables: SmartPlannerInput['existingVariables'],
  emit: SmartPlannerInput['emit'],
  allExecutedTools: SmartPlannerInput['allExecutedTools'],
): ToolEvent {
  const varName = String(input.name ?? 'variable');
  const requestedId = (typeof input.variableId === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(input.variableId)) ? input.variableId : null;

  const sameNameVar = existingVariables.find(ev =>
    (ev.name === varName || ev.label === varName) && ev.type === input.type
  );
  const assignedId = sameNameVar?.id ?? requestedId ?? crypto.randomUUID();

  const clientInput: Record<string, unknown> = {
    name: varName,
    type: input.type,
    initialValue: input.initialValue,
    variableId: assignedId,
    _assignedVarId: assignedId,
    description: input.description,
    folder: input.folder,
    scope: input.scope,
  };

  const event: ToolEvent = { name: 'add_variable', input: clientInput, result: { success: true } };
  emit({
    type: 'tool_executed',
    id: `var-${varName.replace(/[^a-zA-Z0-9_-]/g, '-')}-${assignedId.slice(0, 8)}`,
    name: 'add_variable',
    input: clientInput,
    phase: 'structure',
  });
  allExecutedTools.push({ name: 'add_variable', input: clientInput });
  return event;
}

// ─── Main runner ──────────────────────────────────────────────────────────────

export async function runSmartPlanner(input: SmartPlannerInput): Promise<SmartPlannerResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('[smart-planner] ANTHROPIC_API_KEY is not set');

  const client = new Anthropic({ apiKey });

  const collectedTrees: CollectedTree[] = [];
  const addVarEventsCollected: ToolEvent[] = [];
  const allMarkers: Marker[][] = [];

  // Build initial messages: chat history + current request
  const messages: Anthropic.Messages.MessageParam[] = [
    ...input.chatHistory,
    { role: 'user', content: input.message },
  ];

  // Track pages created during this session (for pageId assignment)
  const pageIdMap = new Map<string, string>();
  pageIdMap.set(input.readContext.currentPageRoute ?? '/', input.currentPageId);
  // Pre-populate from known pages
  for (const p of input.pages) pageIdMap.set(p.route, p.id);

  let rounds = 0;
  let planResult: SmartPlannerResult | null = null;

  while (rounds < MAX_PLANNER_ROUNDS && !planResult) {
    rounds++;

    const stream = client.messages.stream({
      model: PLANNER_MODEL,
      max_tokens: PLANNER_SUPPORTS_THINKING ? 32768 : 16384,
      ...(PLANNER_SUPPORTS_THINKING ? { temperature: 1, thinking: { type: 'enabled', budget_tokens: 8192 } } : {}),
      system: SMART_PLANNER_SYSTEM,
      tools: PLANNER_TOOLS,
      messages,
    } as Parameters<typeof client.messages.stream>[0]);

    if (input.signal) {
      input.signal.addEventListener('abort', () => stream.abort(), { once: true });
    }

    // Emit thinking deltas in real time so the UI can stream the planner's reasoning.
    stream.on('thinking', (delta: string) => {
      if (delta) {
        input.emit({ type: 'planner_thinking_delta', round: rounds, delta });
      }
    });

    const response = await stream.finalMessage();

    if (response.usage) {
      input.emit({
        type: '_internal_token_usage',
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
      });
    }

    const assistantContent = response.content;
    messages.push({ role: 'assistant', content: assistantContent });

    // Forward extended-thinking blocks to the client so the user can see the planner's reasoning
    for (const block of assistantContent) {
      if (block.type === 'thinking' && (block as { type: 'thinking'; thinking: string }).thinking) {
        input.emit({
          type: 'planner_thinking',
          round: rounds,
          text: (block as { type: 'thinking'; thinking: string }).thinking,
        });
      }
    }

    // Check for emit_plan — terminates the loop
    const emitPlanBlock = assistantContent.find(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use' && b.name === 'emit_plan'
    );
    if (emitPlanBlock) {
      const raw = emitPlanBlock.input as Record<string, unknown>;

      // Clarification short-circuit
      if (raw.needsClarification) {
        const clarification = raw.needsClarification as { question: string; options?: string[] };
        return {
          manifest: {
            intent: '',
            needsClarification: clarification,
            operations: [],
          },
          collectedTrees: [],
          addVarEventsCollected: [],
          allMarkers: [],
          needsClarification: clarification,
          summary: '',
          messages,
        };
      }

      const manifest: ContractManifest = {
        intent: String(raw.intent ?? ''),
        refinedRequest: raw.refinedRequest as string | undefined,
        needsClarification: null,
        operations: (raw.operations ?? []) as ContractManifest['operations'],
        sharedComponentsToCreate: raw.sharedComponentsToCreate as ContractManifest['sharedComponentsToCreate'],
      };

      planResult = {
        manifest,
        collectedTrees,
        addVarEventsCollected,
        allMarkers,
        needsClarification: null,
        summary: String(raw.summary ?? ''),
        messages,
      };
      break;
    }

    // No emit_plan — process tool calls and continue
    if (response.stop_reason === 'end_turn') {
      // Model returned without calling any tool — force a retry with a nudge
      messages.push({
        role: 'user',
        content: 'You must call emit_plan (or a build/search tool) before finishing. Please continue.',
      });
      continue;
    }

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const block of assistantContent) {
      if (block.type !== 'tool_use') continue;
      const toolInput = block.input as Record<string, unknown>;
      let result: unknown;

      switch (block.name) {
        case 'search':
          result = runSearch(
            {
              query: String(toolInput.query ?? ''),
              kinds: Array.isArray(toolInput.kinds) ? toolInput.kinds as never : undefined,
              scope: toolInput.scope as 'currentPage' | 'allPages' | undefined,
              limit: typeof toolInput.limit === 'number' ? toolInput.limit : 30,
            },
            input.readContext,
          );
          break;

        case 'read':
          result = runRead(
            {
              kind: String(toolInput.kind ?? '') as never,
              id: String(toolInput.id ?? ''),
              path: toolInput.path ? String(toolInput.path) : undefined,
              depth: typeof toolInput.depth === 'number' ? toolInput.depth : 1,
            },
            input.readContext,
          );
          break;

        case 'generate_structure': {
          // Determine which page this tree belongs to
          const pageRoute = String(toolInput._pageRoute ?? input.readContext.currentPageRoute ?? '/');
          let assignedPageId = pageIdMap.get(pageRoute) ?? null;

          // New page: create it before building structure
          if (!assignedPageId && pageRoute !== (input.readContext.currentPageRoute ?? '/')) {
            const newPageId = `page-${crypto.randomUUID().slice(0, 8)}`;
            const rawPageName = (toolInput._pageName ?? '') as string;
            const pageName = String(rawPageName || pageRoute.replace(/^\//, '').replace(/-/g, ' ') || 'New Page');
            pageIdMap.set(pageRoute, newPageId);
            assignedPageId = newPageId;
            input.emit({
              type: 'tool_executed',
              id: `page-create-${newPageId}`,
              name: 'add_page',
              input: { route: pageRoute, name: pageName, pageId: newPageId, _assignedPageId: newPageId },
              phase: 'structure',
            });
            input.allExecutedTools.push({ name: 'add_page', input: { route: pageRoute, name: pageName, pageId: newPageId } });
          }

          assignedPageId = assignedPageId ?? input.currentPageId;

          const processed = processStructureTree({
            rawInput: toolInput,
            unitName: String(toolInput._unitName ?? input.message.slice(0, 60)),
            assignedPageId,
            structureHint: toolInput._structureHint as string | undefined,
            existingVariables: input.existingVariables,
            emit: input.emit,
            allExecutedTools: input.allExecutedTools,
          });

          if (processed) {
            collectedTrees.push(processed.collectedTree);
            allMarkers.push(processed.markers);
            addVarEventsCollected.push(...processed.varEvents);
            input.allExecutedTools.push({ name: 'generate_structure', input: { tree: processed.collectedTree.tree } });

            // Emit tool_executed for the tree itself
            const isCurrentPage = !processed.collectedTree.pageId || processed.collectedTree.pageId === input.currentPageId;
            input.emit({
              type: 'tool_executed',
              id: `struct-${processed.collectedTree.unitName.replace(/[^a-zA-Z0-9_-]/g, '-')}-${Date.now()}`,
              name: 'generate_structure',
              input: {
                tree: processed.collectedTree.tree,
                atIndex: processed.collectedTree.atIndex,
                _pageId: isCurrentPage ? undefined : processed.collectedTree.pageId,
                pageActions: processed.collectedTree.pageActions,
              },
              phase: 'structure',
            });
            result = { success: true, nodeCount: countTreeNodes(processed.collectedTree.tree) };
          } else {
            result = { success: false, error: 'Invalid tree input — missing or non-object tree field.' };
          }
          break;
        }

        case 'add_variable': {
          const varEvent = handleStandaloneAddVariable(
            toolInput,
            input.existingVariables,
            input.emit,
            input.allExecutedTools,
          );
          addVarEventsCollected.push(varEvent);
          result = { success: true, variableId: (varEvent.input as Record<string, unknown>).variableId };
          break;
        }

        case 'create_shared_component': {
          // Stamp _sharedKey on content nodes, then emit as tool_executed
          const contentWithKeys = toolInput.content
            ? stampSharedKeys(toolInput.content as Record<string, unknown>)
            : { type: 'Box', props: { className: 'flex flex-col' }, children: [] };

          const scInput: Record<string, unknown> = {
            id: toolInput.id ?? `sc-${String(toolInput.name ?? 'component').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            name: toolInput.name,
            description: toolInput.description,
            content: contentWithKeys,
            properties: toolInput.properties ?? [],
            variables: toolInput.variables ?? {},
            workflows: toolInput.workflows ?? {},
            triggers: toolInput.triggers ?? [],
          };
          if (toolInput.valueVariable) scInput.valueVariable = toolInput.valueVariable;

          input.emit({
            type: 'tool_executed',
            id: `sc-${String(toolInput.name ?? 'sc').replace(/[^a-zA-Z0-9_-]/g, '-')}-${Date.now()}`,
            name: 'create_shared_component',
            input: scInput,
            phase: 'structure',
          });
          input.allExecutedTools.push({ name: 'create_shared_component', input: scInput });
          result = { success: true, id: scInput.id };
          break;
        }

        default:
          result = { error: `Unknown tool: ${block.name}` };
      }

      toolResults.push({
        type: 'tool_result' as const,
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    if (toolResults.length > 0) {
      messages.push({ role: 'user', content: toolResults });
    }
  }

  // Safety fallback — should not normally be reached
  if (!planResult) {
    return {
      manifest: {
        intent: input.message.slice(0, 80),
        operations: [],
        needsClarification: {
          question: 'I was unable to complete the plan. Could you rephrase your request?',
        },
      },
      collectedTrees,
      addVarEventsCollected,
      allMarkers,
      needsClarification: { question: 'I was unable to complete the plan. Could you rephrase your request?' },
      summary: '',
      messages,
    };
  }

  return planResult;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countTreeNodes(node: Record<string, unknown>): number {
  let n = 1;
  const children = node.children as Record<string, unknown>[] | undefined;
  if (Array.isArray(children)) for (const c of children) n += countTreeNodes(c);
  return n;
}

let _scKeyCounter = 0;
function stampSharedKeys(node: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...node };
  if (!result._sharedKey) result._sharedKey = result.id ?? `sk-${_scKeyCounter++}`;
  if (Array.isArray(result.children)) {
    result.children = (result.children as Record<string, unknown>[]).map(stampSharedKeys);
  }
  return result;
}
