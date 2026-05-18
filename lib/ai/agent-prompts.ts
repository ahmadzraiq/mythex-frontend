/**
 * Re-exports parallel agent prompt builders.
 * Implementations live in `lib/ai/agents/` (one folder per agent + shared snippets).
 */

export {
  buildStructureAgentPrompt,
  buildBindingAgentPrompt,
  buildStylingAgentPrompt,
  buildAnimationAgentPrompt,
  buildWorkflowsAgentPrompt,
  type StylingSubAgentContext,
  BUILDER_AGENT_IDS,
  AGENT_REGISTRY,
  type BuilderAgentId,
} from './agents';
