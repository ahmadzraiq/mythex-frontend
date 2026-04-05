export { buildStructureAgentPrompt } from './structure/prompt';
export { buildBindingAgentPrompt } from './binding/prompt';
export { buildStylingAgentPrompt, buildLayoutAgentPrompt } from './layout/prompt';
export { buildColorsAgentPrompt } from './colors/prompt';
export { buildWorkflowsAgentPrompt } from './workflows/prompt';
export { buildAnimationAgentPrompt } from './animation/prompt';
export { buildMediaAgentPrompt } from './media/prompt';

export type { StylingSubAgentContext } from './shared/styling-subagent';
export { SHARED_FORMULA_SYNTAX } from './shared/formula-scope';
export { BUILDER_AGENT_IDS, AGENT_REGISTRY, type BuilderAgentId } from './registry';
