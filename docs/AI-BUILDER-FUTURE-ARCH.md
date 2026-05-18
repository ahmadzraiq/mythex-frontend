# AI Builder — Future Architecture Backlog

Items below are **not** being done now. The current architecture is preserved as-is.
The one immediate change tracked separately is removing `dispatchMode` (see ## Immediate task below).

---

## Immediate task (do now)

Remove `dispatchMode` from the manifest and always use `full_split` behaviour. **Nothing else changes.**

### Files and exact changes

**`lib/ai/agents/manifest.ts`**
- Delete lines 15-24 (`DispatchMode` type + JSDoc comment block).
- Delete lines 34-38 (`dispatchMode?: DispatchMode` field + its JSDoc from `ManifestOperation`).

**`app/api/ai/builder-chat/route.ts`**
- ~line 1299: delete `let manifestDispatchMode: 'full_split' | 'combined_per_page' | 'global_combined' = 'full_split';`
- ~lines 1324-1326: delete the `if (op.dispatchMode && manifestDispatchMode === 'full_split') { manifestDispatchMode = op.dispatchMode; }` assignment inside the op-loop.
- ~lines 2121-2137: delete the `combinedFamilies`, `combinedPromptParts`, `combinedSystemBlocks`, `combinedReadHandlers` declarations (only used by the two removed branches).
- ~lines 2147-2163 (activeAgents label block): delete the `if (manifestDispatchMode === 'combined_per_page')` and `else if (manifestDispatchMode === 'global_combined')` branches — keep only the `else` body (the `full_split` label logic) and make it unconditional.
- ~lines 2166-2231: delete both the `if (manifestDispatchMode === 'combined_per_page') { ... } else if (manifestDispatchMode === 'global_combined') { ... }` branches entirely.
- ~line 2231: remove the `} else {` that wrapped the `full_split` block — it becomes the only unconditional block.
- ~lines 2327-2340: the `expectedAgentNames` section — delete the `if (manifestDispatchMode === 'full_split')` guard and its `else if` / `else` branches; keep only the `full_split` body content (unconditional). `shouldData`, `shouldMedia`, `shouldAuthSC` lines stay as-is.

**`lib/ai/agents/planner/prompt.ts`**
- Lines 24-28: delete the `Choose dispatchMode per operation:` paragraph and the three bullet points describing `combined_per_page`, `full_split`, `global_combined`.
- Line 39: remove `"dispatchMode": "full_split" | "combined_per_page" | "global_combined",` from the JSON output schema example.
- Line 57: remove the last sentence about `combined_per_page` and `global_combined` still listing individual agent keys.

**`lib/ai/agents/combined/prompt.ts`**
- Update the file header comment to remove references to `combined_per_page` and `global_combined` dispatch modes (the file stays — it's just no longer dispatched, but keep it for now).

**`lib/ai/agents/registry.ts`**
- Line 74: update the `combined` entry's `notes` string to remove the dispatch-mode reference.

**`scripts/validate-ai-builder-contracts.ts`** — search for `dispatchMode`; remove any validation that checks or allows that field.

**Verify:** `npx tsc --noEmit` clean. No runtime behaviour changes — the `full_split` path already existed and was the default; removing the other branches just makes it the only path.

**What stays unchanged:** everything else — orchestrator, planner, structure agent, structure step, edit loop, build plan, Phase-0 classifier, all specialist agents, combined agent (file kept, just no longer dispatched), media agent, data agent, SC agent, SSE events, client store.

---

## Future backlog (later, not now)

### 1. Universal search / read tools (replaces 7 per-resource read tools)

Replace `search_nodes`, `get_node_details`, `get_pages`, `get_variables`, `get_workflows`, `get_data_sources`, `get_shared_components` with two universal tools:

```ts
search({ query, in?, page?, regex?, limit? }) => SearchHit[]
read({ ref: { kind, id, page? }, path?, depth? }) => ReadResult
```

`SearchHit` carries typed `refs[]` for cross-reference following (no formula-string parsing).
`read` does depth-limited subtree disclosure with a `children` index for drillable keys.
Index is built server-side per request from raw values (no `inferSchema`, no `fmtInitial` truncation).

### 2. Smart Planner (tool-loop, replaces current single-shot planner)

Replace the current single-shot `runPlanner` with a 15-round Haiku tool-loop that:
- Uses only `search` + `read` as its tools (no upfront rosters).
- Emits the extended `ContractManifest` (with `structureSpec`, `sharedComponentsToCreate`, `mediaPredictions`, `compactTree`).
- Replaces the orchestrator + Phase-0 BuildPlan classifier (two LLM calls → one).

### 3. Flat parallel agent pool

Replace Phase-1 (structure agent LLM) + Phase-2 (dispatch mode branching) + Phase-3 (styling continuation) with a single flat `Promise.all` pool:

- `dynamic` agent kind: planner-configured one-offs with arbitrary tool subsets (replaces `combined`).
- Page specialists auto-batched by 4.
- Global agents (data / appWorkflow / globalFormula / media) auto-batched.
- Structure spec emitted declaratively by the planner → deterministic structure step materialises it (no LLM).

### 4. Knowledge packs

Extract domain expertise strings from specialist prompts into `lib/ai/agents/knowledge/` (one file per domain).
`KNOWLEDGE_PACKS` + `TOOL_TO_KNOWLEDGE` maps reused by specialists and by `dynamic` agent prompt composition.

### 5. Shared component authoring improvements

- Planner emits full SC content inline in `sharedComponentsToCreate[].content` (eliminates shell + parallel SC-author pattern).
- Three-path instance override model explicitly taught to page specialists:
  1. `set_component_props` for declared properties.
  2. `set_style/set_animation/set_text` on internal node IDs (per-instance `_overrides` via `_sharedKey`).
  3. `set_style` on the wrapper Box itself.
- Remove current over-restriction "Never call `set_style` on a shared instance" from prompts.

### 6. Drop remaining hardcoded heuristics

Once the smart planner (item 2) is in place, delete:

| # | What | Where |
|---|---|---|
| 1 | `classifyDeterministic` | `lib/ai/agents/orchestrator/agent.ts` |
| 2 | Selection-only delete fast-path | `lib/ai/agents/orchestrator/agent.ts` |
| 3 | `looksLikeDataPrompt` | `route.ts` |
| 4 | `messageWantsAnimation` | `route.ts` |
| 5 | `looksLikeAppWorkflow` | `route.ts` |
| 6 | `BuildPlan.needs*` fallback chain | `route.ts` |
| 7 | `mightBeBuildRequest` | `route.ts` |
| 8 | `ANIMATION_AGENT_ENABLED` flag | `route.ts` |
| 9 | `MAX_EDIT_ROUNDS` / `MAX_TOOL_ROUNDS` switch | `route.ts` |
| 10 | `shouldMediaEarly` scan | `route.ts` |

### 7. Drop upfront roster builders + client inferSchema

Once the smart planner uses `search`/`read` instead of upfront context:
- Delete `inferSchema` from `_use-ai-chat.ts` (ship raw `_lastFetch.data` to server index instead).
- Delete `fmtInitial`, `existingVarsNote`, `varRoster`, data-source-schema-roster builders from `route.ts`.
- Ship raw `initialValue` already happens today — keep it but stop truncating it in prompts.

### 8. Upfront context shrink

Once search-only model is in:
- Planner system prompt shrinks to: project metadata + theme palette + pages list only.
- No rosters, no counts, no variable previews, no data source schemas.
- Everything else discovered on demand via `search` / `read`.

### 9. SSE cleanup

Once flat pool + new planner are in, drop these SSE event types from `BuilderChatSSE`:
- `build_phase`, `build_plan`, `phase3_started`, `section_progress`, `structure_context`, `structure_markers`, `orchestrator_complete`, `fast_path_triggered`, `needs_clarification`

Update `_ai-activity-feed.tsx` `FAMILY_ORDER` to reflect new agent family names.

### 10. needsClarification removal

Already removed from dispatch/store types. Confirm it is also gone from orchestrator prompt and planner prompt output schema.

---

## Reference

Full detailed plan lives at: [`.cursor/plans/smart-planner-flat-pool_a86f02d3.plan.md`](../.cursor/plans/smart-planner-flat-pool_a86f02d3.plan.md)
