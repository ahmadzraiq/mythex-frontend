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
- Node IDs and variable IDs are UUIDs — never invent them, only use IDs from prior results.`;
