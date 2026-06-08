export { buildStructureAgentPrompt } from './structure/prompt';
export { buildBindingAgentPrompt } from './binding/prompt';
export { buildStylingAgentPrompt } from './layout/prompt';
export { buildWorkflowsAgentPrompt } from './workflows/prompt';
export { buildAnimationAgentPrompt } from './animation/prompt';
export { buildMediaAgentPrompt } from './media/prompt';
export { buildDataAgentPrompt } from './data/prompt';
export { buildSharedComponentAgentPrompt } from './sharedComponents/prompt';
export { buildBackendAgentPrompt } from './backend/prompt';

export type { StylingSubAgentContext } from './shared/styling-subagent';
export { SHARED_FORMULA_SYNTAX } from './shared/formula-scope';
export { AGENT_DISPLAY_LABELS, AGENT_REGISTRY, BUILDER_AGENT_IDS, type BuilderAgentId } from './registry';

// New-architecture entry points: planner → structure step → parallel agents.
export { runPlanner } from './planner/agent';
export { runStructureStep } from './structure/structure-step';
export { runNewAgentDispatch } from './dispatch';
export type { ContractManifest, ManifestOperation, AgentScope, AgentContract } from './manifest';
