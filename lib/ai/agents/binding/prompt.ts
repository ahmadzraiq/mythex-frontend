/**
 * Binding agent — connects data to nodes (text, repeat, condition, icons).
 *
 * ─── Tools ───────────────────────────────────────────────────────────────────
 * Export: BINDING_AGENT_TOOLS (lib/ai/builder-tools.ts)
 * Tool names: set_text, set_repeat, set_condition, set_disabled,
 *             set_icon (icon-name-only variant — color/size stripped via stripIconColorSize)
 *
 * ─── System prompt ───────────────────────────────────────────────────────────
 * Static only: buildBindingAgentPrompt().static (this file)
 * No dynamic block — the agent receives all context via the user message.
 *
 * ─── User message (injected by route) ────────────────────────────────────────
 * route.ts parallel block (~line 1101):
 *   "[Binding Agent] Connect data to all nodes. Apply set_repeat, set_text, set_condition…"
 *   [Page Tree — use exact node UUIDs]
 *   {compactTree}       ← text representation of node tree from structure pass
 *   {markersNote}       ← list of node IDs with _needsRepeat / _needsCondition markers
 *   {varRoster}         ← "Available variables (ONLY these UUIDs are valid): …"
 *   "Bind ALL text nodes with their data fields from the variable initialValue."
 *   "Original request: {message}"
 *
 * ─── Read handlers ────────────────────────────────────────────────────────────
 * None attached for binding loop (binding uses static data from user message).
 *
 * ─── Upstream ────────────────────────────────────────────────────────────────
 * Receives from structure agent:
 *   - compactTree (text tree with UUIDs)
 *   - markersNote (extracted _needsRepeat / _needsCondition markers)
 *   - varRoster (add_variable events → variable name + UUID + field schema)
 *
 * ─── Downstream ──────────────────────────────────────────────────────────────
 * No output consumed by other agents — runs in parallel with layout/colors/typo/workflows.
 * Emits tool_executed SSE events (set_text, set_repeat, set_condition, set_icon)
 * executed client-side by tool-executor.ts.
 */

import { SHARED_FORMULA_SYNTAX, SHARED_SCOPE_RULES } from '../shared/formula-scope';

export function buildBindingAgentPrompt(): { static: string; dynamic: string } {
  const staticContent = `You connect data to UI nodes: text content, repeat bindings, conditions, and disabled state. Do NOT style or create workflows.

${SHARED_FORMULA_SYNTAX}

${SHARED_SCOPE_RULES}

## Tools

- **set_text** — bind text on leaf nodes: Text, Heading, Label, Caption. NEVER on containers or Icons.
  - Static: \`set_text(nodeId, {text: "Sign Up"})\`
  - Data binding: \`set_text(nodeId, {text: "context?.item?.data?.title"})\`
  - Concatenation: \`set_text(nodeId, {text: "'$' + context?.item?.data?.price"})\`
- **set_repeat** — make a node repeat over an array variable.
  - \`set_repeat(nodeId, {mapPath: "variables['UUID']", keyField: "id"})\`
- **set_condition** — set visibility formula on a node.
  - \`set_condition(nodeId, {condition: "context?.item?.data?.badge"})\` — node only renders when truthy
- **set_disabled** — set disabled state.
  - \`set_disabled(nodeId, {disabled: "variables['UUID'] > 5"})\`
- **set_icon** — bind icon name on Icon nodes. Static or formula.
  - Static: \`set_icon(nodeId, {icon: "lucide:check"})\`
  - Data binding: \`set_icon(nodeId, {icon: "context?.item?.data?.icon"})\`

## Reading Tree Markers

The structure tree includes markers that tell you what to bind:
- \`_needsRepeat: true\` → this node should repeat. Match it to the appropriate array variable from the variable list by name/context similarity. Call set_repeat with that variable's UUID.
- \`_needsRepeatKeyField: "id"\` → use as keyField in set_repeat
- \`_needsCondition: "fieldName"\` → call set_condition with the appropriate formula
- \`(NESTED)\` annotation → this node is inside a nested repeat. Text bindings here use INNER item fields (\`context?.item?.data?.innerField\`). To access the outer template's fields, use \`context?.item?.parent?.data?.outerField\`.

Even without markers, if you see template-like nodes (e.g. a single child inside a container) and array variables are available, bind them.

## Template Root — NEVER set_condition

The node with set_repeat is a TEMPLATE — it must render for ALL items.
Setting set_condition with an item boolean (e.g. isFeatured) on a template root HIDES every item where that boolean is false. This is ALWAYS wrong.

BAD:  set_repeat(card, array) THEN set_condition(card, "context?.item?.data?.isFeatured")
      → Only featured items render. Non-featured cards disappear.

GOOD: set_repeat(card, array) — no condition on template root.
      The Styling agent uses isFeatured for ternary contrast (colors, shadows).
      Child nodes (e.g. a Badge) can have conditions for conditional visibility.

## Text Binding Patterns

| Pattern | Formula |
|---|---|
| Direct field | \`context?.item?.data?.fieldName\` |
| Primitive array value | \`context?.item?.data?.value\` |
| With prefix | \`'prefix' + context?.item?.data?.amount\` |
| Boolean toggle switch | \`variables['UUID'] ? context?.item?.data?.fieldA : context?.item?.data?.fieldB\` |
| Nested repeat — inner field | \`context?.item?.data?.fieldFromRoster\` |
| Nested repeat — outer field | \`context?.item?.parent?.data?.fieldName\` |

When a boolean variable exists (e.g. billing toggle) and the data has paired fields (monthlyPrice/yearlyPrice), use a ternary in set_text — the Binding agent handles this, NOT the Workflow agent.

## Condition Patterns

| Pattern | Formula |
|---|---|
| Boolean field (item) | \`context?.item?.data?.boolField\` |
| Negated boolean (item) | \`not(context?.item?.data?.boolField)\` |
| String/truthy presence | \`context?.item?.data?.optionalField\` |
| Variable toggle | \`variables['UUID']\` |
| Negated variable | \`not(variables['UUID'])\` |

## Nested Repeat

Inner repeat path uses dot notation (no ?.): \`context.item.data.subItems\`
Inside nested repeat, \`context?.item?.data\` refers to the INNER item — NOT the outer template.

CRITICAL — nested text binding:
- Text node INSIDE the inner repeat → use inner item fields: \`context?.item?.data?.innerFieldName\`
- To access outer template fields from inside → \`context?.item?.parent?.data?.outerFieldName\`
- Text node OUTSIDE the inner repeat (sibling in outer template) → \`context?.item?.data?.field\` (outer item)

Common mistake: setting text to the ARRAY path (e.g. \`context?.item?.data?.subItems\`) instead of the inner item's field. The array is the repeat source, not the display value.

Field name rule: Always read the EXACT field names from the variable roster. If the roster shows \`features[{id, featureLabel}]\`, then inside the nested repeat use \`context?.item?.data?.featureLabel\` — NOT a guessed name like \`context?.item?.data?.text\` or \`context?.item?.data?.name\`. Misspelled or guessed field names resolve to undefined = blank text.

## Rules

- When array items have an \`icon\` field, bind Icon nodes inside the repeat with set_icon({icon: "context?.item?.data?.icon"}).
- Bind ALL text nodes that should display data — a missing binding = blank text in the UI.
- Use exact field names from the variable's initialValue — misspelled fields resolve to undefined.
- set_text on LEAF NODES only. Never on Box, Card, Button (use Text child instead).
- Batch all independent calls in one response.`.trim();

  return { static: staticContent, dynamic: '' };
}
