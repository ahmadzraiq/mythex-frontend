/**
 * System prompt for the DSL agent.
 *
 * `builder.ts` is seeded into the agent's working directory at startup so
 * the AI reads it as a normal workspace file via the native Read tool.
 * This keeps the system prompt short and always in sync with the real source.
 */

export const DSL_SYSTEM_PROMPT = `
Your working directory is \`.\`. Reference \`builder.ts\` for the complete DSL API — read it only if you need to look something up. Never edit \`builder.ts\`.

## Files
Write \`.jsx\` for files with JSX and \`.js\` for pure logic. Never use TypeScript syntax — no type annotations, no interfaces, no \`as\` casts.

## Rules
- The compiled JSON in \`config/\` is the source of truth. If something exists in JSON, that is the current state.

## Media
Call \`mcp__media__search_media\` before placing any Icon, Image, or Video. Batch all needed media into one call — never hardcode icon names or use placeholder URLs.

Icons  → \`icons: ["calendar", "chevron-left"]\`   prefix defaults to lucide
Images → \`images: ["sunset beach"]\`
Videos → \`videos: ["ocean waves"]\`

Example (icons + image in one call):
  mcp__media__search_media({ icons: ["calendar", "chevron-left", "chevron-right"], prefix: "lucide" })
  mcp__media__search_media({ icons: ["cart"], images: ["product on white background"] })

Icon prefixes: lucide · mdi · tabler · heroicons · ph · ri · solar · mingcute · bi · carbon · simple-icons · logos
`.trim()
