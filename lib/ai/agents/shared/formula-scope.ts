/**
 * Shared formula + binding-scope reference.
 *
 * STYLING_FORMULA_SYNTAX — for the styling agent (layout/colors/typo).
 * SHARED_FORMULA_SYNTAX  — full version for binding, workflows, sharedComponents agents.
 */

const SCOPE_REFERENCE = `## Binding language: native JavaScript

Every string-typed value field in every tool is a JS expression in this scope. Bare literals are valid expressions. Conditional or per-item values: write a ternary.

Scope identifiers:

- variables['UUID']                   — declared variable value
- collections['UUID']?.data?.field    — datasource value
- context?.item?.data?.field          — current repeat-item field. context ONLY has .item — no other sub-properties exist. Never use context?.variableName or context?.anyOtherPath — those resolve to undefined. variables['UUID'] is the only way to access any declared variable.
- context?.item?.parent?.data?.field  — outer-repeat field (nested repeats only; .parent is NOT valid at depth 1)
- context?.item?.data?.value          — primitive value when iterating a primitive array
- context?.item?.data?.index          — 0-based index in the current repeat
- auth.user, auth.token               — auth state
- event.<field>  — SDUI-curated trigger payload. NOT a DOM event:
    no event.target, no event.currentTarget, no event.preventDefault, no event.nativeEvent.
    Per-trigger fields:
      change / focus / blur / valueChange / enterKey  →  event.value
      enterKey                                        →  event.key (also)
      click                                           →  event.x, event.y, event.button
      scroll                                          →  event.scrollTop, event.scrollLeft
      collectionFetchError                            →  event.error
      drag                                            →  event.translationX/Y, event.percentX/Y, event.velocityX/Y
      swipe                                           →  event.direction ("left"|"right"|"up"|"down"), event.velocityX/Y
- context?.item?.data?.<field>  — value of the item that triggered a workflow bound to a repeat template.
    The workflow runs in the item's scope. event has no item info.
- 'theme:tokenName'                   — theme color reference (anywhere a color string is valid)

IDs are UUIDs from the variables roster, datasource roster, or page tree. Never invent IDs.

## runJavaScript step — imperative code block

Use step type runJavaScript when a single changeVariableValue formula is not enough (complex branching, switch logic, multi-variable updates in one block). The sandbox exposes:

- variables['UUID']  — read (same as formulas)
- variables['UUID'] = value  — write via Proxy; updates the global store immediately
- wwLib.variables.get(nameOrUuid) / .set(nameOrUuid, value) / .reset(nameOrUuid) — alternative write API
- wwLib.navigate.to(path) / .prev() — navigation
- wwLib.workflows.run(name, params?) — call another workflow by name
- context, globalContext, auth, event — same as formulas (read-only)

Return a value from the step body — it is stored at context.workflow['stepId'].result.
fetch and await work here.

The sandbox exposes ONLY these identifiers — nothing else exists:
  variables, wwLib, context, globalContext, auth, event, fetch, Promise, JSON, Math, Date, console.
There are no browser globals: no window, document, navigator, location, history,
localStorage, sessionStorage, Element, HTMLElement, querySelector, getElementById, or any DOM / BOM API.
If you need a visual effect on hover → that is set_animation (animation agent, not workflows).
If you need navigation → wwLib.navigate.to(path).
If you need state → variables['UUID'] = value.

## set_repeat mapPath — Plain Dot Notation ONLY

When calling set_repeat, the mapPath argument MUST use plain dot notation (no optional chaining):
- ✅ CORRECT: context.item.data.features
- ❌ WRONG:   context?.item?.data?.features

context? in mapPath breaks scope resolution — the nested repeat never iterates. Use ?. everywhere else.

## Sequential Step Ordering

Steps execute in sequence — each step reads the current store value of every variable.
If step A updates variable X, step B sees the new value of X, not the original.
When step B's formula needs the old value of X, put step B before step A.
Display-after-accumulator: bind display Text to variables['X'] directly — do NOT re-apply the same transformation (double-applies).`;

export const STYLING_FORMULA_SYNTAX = SCOPE_REFERENCE;
export const SHARED_FORMULA_SYNTAX  = SCOPE_REFERENCE;
