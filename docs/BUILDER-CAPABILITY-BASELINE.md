# Builder Capability Baseline

This document captures the current visual-builder feature surface and the AI control loop before recovery refactors.

## Builder Feature Surface

- Canvas editing: direct SDUI rendering, selection, drag/drop, resize, snap guides, measurement overlays.
- Left panel: layers tree, component palette, data sources, variables, logic/workflows, popups, assets.
- Right panel: design controls, settings, workflows, theme editing, raw JSON tab.
- Workflow canvas: trigger-driven workflow editing with typed step configs and per-step testing.
- Multi-page editing: route-aware page list, page settings, on-mount workflow assignment, SEO metadata.
- Preview/autosave: local preview snapshots and project-backed autosave for page/config metadata.
- AI chat: streaming tool execution over `/api/ai/builder-chat`, client-side mutations via `tool-executor`.

## File Ownership Map

- Builder shell and orchestration: `app/dev/builder/page.tsx`
- Core store + tree mutation surface: `app/dev/builder/_store.ts`
- Canvas rendering + interactions: `app/dev/builder/_canvas.tsx`
- Selection/measure overlays: `app/dev/builder/_overlay.tsx`
- Property editing UI: `app/dev/builder/_panel-right.tsx`
- Workflow authoring UI: `app/dev/builder/_workflow-canvas.tsx`
- AI client bridge: `app/dev/builder/_use-ai-chat.ts`
- Primitive catalog (shared by UI + AI): `lib/builder/primitive-components.ts`
- AI route orchestration: `app/api/ai/builder-chat/route.ts`
- AI mutation executor: `lib/ai/tool-executor.ts`
- Tool schemas and phase toolsets: `lib/ai/builder-tools.ts`

## End-to-End Control Loop (Current)

1. User sends prompt from builder chat.
2. Server orchestrator (`route.ts`) calls Anthropic with tool schemas.
3. Server streams tool intents (`tool_executed`) to client.
4. Client executes mutating tools through `executeTool()` and Zustand store.
5. Server continues loop with tool results (read tools are server-evaluated; mutations are optimistic pending client execution).

## Control Risks (Baseline)

- Pending mutation results can diverge from actual client execution results.
- Some tool paths historically allowed silent no-op success (invalid IDs, root-only wrappers, etc.).
- Prompt and executor drift can cause contradictory guidance and low-confidence output.
- Parallel agent orchestration can partially fail without clear per-agent surfaced errors.

## Baseline Goal for Recovery

The recovery plan targets a strict tool-control loop:

- every mutating tool validates targets,
- every failed mutation returns structured error feedback,
- prompt guidance is compact and project-specific,
- route orchestration is resilient to parse errors, timeouts, and partial parallel failures.
