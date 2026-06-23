'use client';

/**
 * Backward-compatibility re-export.
 *
 * _ai-chat-panel.tsx and _files-panel.tsx import from this file.
 * All implementation has moved to _use-json-agent.ts.
 */

export {
  useJsonAgent as useWebContainerDsl,
  useJsonAgent,
  compileAllAndApply,
  type JsonAgentTokenStats as DslTokenStats,
} from './_use-json-agent';
