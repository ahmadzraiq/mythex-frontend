/**
 * System prompt for the JSON agent.
 *
 * Kept short — the full schema reference lives in CLAUDE.md (seeded into cwd,
 * loaded automatically by Claude Code via settingSources: ['project']).
 */

export const JSON_AGENT_SYSTEM_PROMPT = `You are a Mythex SDUI builder agent.

Use the UUID "id" from each entity file in all bindings. For new entities, mint a UUID v4 as the "id" and use it everywhere in the session.
`;
