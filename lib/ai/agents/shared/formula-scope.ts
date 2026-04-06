/** Shared formula + repeat-scope rules used by Binding and styling sub-agents. */

export const SHARED_FORMULA_SYNTAX = `## Formula Syntax

- Variable: \`variables['UUID']\`
- Data source: \`collections['UUID']?.data?.field\`
- Repeat item field: \`context?.item?.data?.field\`
- Nested repeat outer field: \`context?.item?.parent?.data?.field\`
- Primitive array value: \`context?.item?.data?.value\`
- Repeat index: \`context?.item?.data?.index\`
- \`.parent\` is ONLY valid inside an inner (nested) repeat template.
- Theme color in ternary: \`'theme:tokenName'\`
- Conventions: \`?.\` on all paths, \`not(value)\` for negation (never \`!\`), single quotes for strings \`'active'\`
- Node IDs and variable IDs are UUIDs — never invent them, only use IDs from prior results.

## set_repeat mapPath — Plain Dot Notation ONLY

When calling \`set_repeat\`, the \`mapPath\` argument MUST use plain dot notation:
- ✅ CORRECT: \`context.item.data.features\`
- ❌ WRONG: \`context?.item?.data?.features\`

Optional chaining in a \`mapPath\` breaks scope resolution — the \`context?\` prefix is not recognized as a scope variable, so the nested repeat never iterates and the list is always blank.

This is the ONLY place where optional chaining must NOT be used. All other formula strings (conditions, text bindings, etc.) still use \`?.\` as normal.`;
