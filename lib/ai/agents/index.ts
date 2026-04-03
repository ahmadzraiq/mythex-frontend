export { buildStructureAgentPrompt } from './structure/prompt';
export { buildBindingAgentPrompt } from './binding/prompt';
export { buildLayoutAgentPrompt } from './layout/prompt';
export { buildColorsAgentPrompt } from './colors/prompt';
export { buildTypoAnimAgentPrompt } from './typo-anim/prompt';
export { buildWorkflowsAgentPrompt } from './workflows/prompt';

export type { StylingSubAgentContext } from './shared/styling-subagent';
export { SHARED_FORMULA_SYNTAX, SHARED_SCOPE_RULES } from './shared/formula-scope';
export { BUILDER_AGENT_IDS, AGENT_REGISTRY, type BuilderAgentId } from './registry';
