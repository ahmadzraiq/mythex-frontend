/** Shared formula + repeat-scope rules used by Binding and styling sub-agents. */

export const SHARED_FORMULA_SYNTAX = `## Formula Syntax

- Variable: \`variables['UUID']\`
- Data source: \`collections['UUID']?.data?.field\`
- Repeat item field: \`context?.item?.data?.field\`
- Nested repeat outer field: \`context?.item?.parent?.data?.field\`
- Theme color in ternary: \`'theme:tokenName'\`
- Conventions: \`?.\` on all paths, \`not(value)\` for negation (never \`!\`), single quotes for strings \`'active'\`
- Node IDs and variable IDs are UUIDs — never invent them, only use IDs from prior results.`;

export const SHARED_SCOPE_RULES = `## Scope Rules

- \`context?.item?.data?.field\` — fields of the current repeat item
- \`context?.item?.parent?.data?.field\` — fields of the OUTER item in a nested repeat
- \`context?.item?.data?.value\` — value when repeating over a string/number array
- \`context?.item?.data?.index\` — 0-based index of current item
- \`.parent\` is ONLY valid inside an inner (nested) repeat template. Direct children of the outer template use \`context?.item?.data\`.`;
