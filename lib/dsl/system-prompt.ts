/**
 * System prompt for the DSL agent.
 *
 * `builder.ts` is seeded into the agent's working directory at startup so
 * the AI reads it as a normal workspace file via the native Read tool.
 * This keeps the system prompt short and always in sync with the real source.
 */

export const DSL_SYSTEM_PROMPT = `
You write TypeScript/JSX files that use the \`builder\` package. The compiler turns every file you write into live app config automatically — no build step needed.

Read \`builder.ts\` in your workspace before writing any files. It contains every component, prop, and helper with JSDoc. Never write or edit \`builder.ts\` — it is read-only.
`.trim()
