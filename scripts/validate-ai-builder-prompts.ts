import { strict as assert } from 'node:assert';
import { TOOL_DESCRIPTIONS } from '../lib/ai/tool-descriptions';
import { ALL_BUILDER_TOOLS, PHASE_W_TOOLS } from '../lib/ai/builder-tools';
import { buildStylingAgentPrompt } from '../lib/ai/agents/layout/prompt';
import { buildStructureAgentPrompt } from '../lib/ai/agents/structure/prompt';
import { buildWorkflowsAgentPrompt } from '../lib/ai/agents/workflows/prompt';
import { buildDataAgentPrompt } from '../lib/ai/agents/data/prompt';
import { buildSharedComponentAgentPrompt } from '../lib/ai/agents/sharedComponents/prompt';

function main() {
  const styling = buildStylingAgentPrompt({
    pages: [{ id: 'p1', name: 'Home', route: '/' }],
    currentPageName: 'Home',
    currentPageRoute: '/',
    paletteSnapshot: 'primary = #111111',
  });
  const phaseW = buildWorkflowsAgentPrompt({
    pages: [{ id: 'p1', name: 'Home', route: '/' }],
    currentPageName: 'Home',
    currentPageRoute: '/',
  });

  assert.ok(styling.static.length > 0, 'Styling system prompt should not be empty');
  assert.ok(phaseW.static.length > 0, 'Phase W system prompt should not be empty');
  assert.ok(!styling.static.includes('NEVER use fillOpacity'), 'Styling prompt must not contain the deprecated hard-ban text for fillOpacity');
  assert.ok(!styling.static.includes('set_size(width:"100vw") to fill the viewport'), 'Styling prompt should avoid forcing 100vw root default');
  assert.ok(!styling.static.includes('set_condition('), 'Styling prompt must not mention set_condition (binding-only tool)');
  assert.ok(!phaseW.static.includes('arrayOperation'), 'Phase W prompt should not mention unsupported changeVariableValue arrayOperation');
  assert.ok(!phaseW.static.includes('## Prohibited'), 'Phase W prompt should not use obsolete prohibited section');
  assert.ok(!phaseW.static.includes('NOT functional'), 'Phase W prompt should not contain obsolete NOT functional wording');
  assert.ok(phaseW.static.includes('add_workflow_step'), 'Phase W prompt should reference add_workflow_step');
  assert.ok(phaseW.static.includes('multiOptionBranch'), 'Phase W prompt should document multiOptionBranch dispatch rules');
  const getTool = (name: string) => ALL_BUILDER_TOOLS.find(t => t.name === name);

  // branchKey moved to tool schema (Phase 7) — verify it lives there, not in the prompt
  assert.ok(!phaseW.static.includes('branchKey'), 'Phase W prompt must NOT contain branchKey — that detail belongs in the tool schema');
  const addWorkflowStep = getTool('add_workflow_step');
  const branchKeyProp = (addWorkflowStep?.input_schema.properties.branchKey as { description?: string } | undefined);
  assert.ok(branchKeyProp?.description?.includes('trueBranch'), 'add_workflow_step branchKey field description must document trueBranch/falseBranch values');
  assert.ok(branchKeyProp?.description?.includes('defaultBranch'), 'add_workflow_step branchKey field description must document defaultBranch requirement');

  assert.ok(
    !TOOL_DESCRIPTIONS.set_text.includes('nearest Text child'),
    'set_text description must not claim auto-targeting nearest Text child'
  );
  assert.ok(
    TOOL_DESCRIPTIONS.set_opacity.includes('rgba'),
    'set_opacity description should mention rgba as the alternative for background-only transparency'
  );

  const addComponent = getTool('add_component');
  const addComponentLabelDesc = String(
    ((addComponent?.input_schema.properties.label as { description?: string } | undefined)?.description) ?? ''
  );
  assert.ok(!addComponentLabelDesc.includes('HStack'), 'add_component label description must not reference stale "HStack"');

  const generateStructure = getTool('generate_structure');
  const treeDesc = String(
    ((generateStructure?.input_schema.properties.tree as { description?: string } | undefined)?.description) ?? ''
  );
  assert.ok(!treeDesc.includes('Switch/Switch On'), 'generate_structure tree description must not reference stale Switch/Switch On pairing');

  const legacyNodeIdText = 'UUID of the target node — from generate_structure or add_component result. Never a display name.';
  for (const tool of ALL_BUILDER_TOOLS) {
    const nodeIdProp = tool.input_schema.properties.nodeId as { description?: string } | undefined;
    if (!nodeIdProp?.description) continue;
    assert.ok(
      nodeIdProp.description !== legacyNodeIdText,
      `Tool ${tool.name} should not use legacy verbose nodeId description`
    );
  }

  const structure = buildStructureAgentPrompt();
  assert.ok(structure.static.length > 0, 'Structure system prompt should not be empty');
  assert.ok(
    structure.static.includes('empty Box renders'),
    'Structure prompt must include completeness principle (empty Box renders as empty rectangle)'
  );
  assert.ok(
    structure.static.includes('`schema`'),
    'Structure prompt must require schema on add_variable'
  );
  assert.ok(
    structure.static.includes('Element mapping'),
    'Structure prompt must include HTML-to-tree element mapping'
  );

  const data = buildDataAgentPrompt();
  assert.ok(data.static.length > 0, 'Data agent system prompt should not be empty');
  assert.ok(
    data.static.includes('add_data_source'),
    'Data agent prompt must reference add_data_source'
  );
  assert.ok(
    data.static.includes('predicted'),
    'Data agent prompt must explain predicted dataSourceId handling'
  );
  assert.ok(
    data.static.includes('storeIn'),
    'Data agent prompt must reference storeIn for schema'
  );

  const sc = buildSharedComponentAgentPrompt({});
  assert.ok(sc.static.length > 0, 'Shared component agent system prompt should not be empty');
  assert.ok(
    sc.static.includes('enter_shared_component_edit'),
    'SC agent prompt must reference enter_shared_component_edit'
  );
  assert.ok(
    sc.static.includes('exit_shared_component_edit'),
    'SC agent prompt must reference exit_shared_component_edit'
  );
  assert.ok(
    sc.static.includes('shell already exists'),
    'SC agent prompt must warn that the shell is pre-minted (do not re-create)'
  );

  // ── Phase 9: collapsed workflow step types are in add_workflow_step schema ──
  const stepTypeProp = (addWorkflowStep?.input_schema.properties.type as { enum?: string[] } | undefined);
  assert.ok(
    stepTypeProp?.enum?.includes('controlAnimation'),
    'add_workflow_step type enum must include consolidated controlAnimation step type (Phase 9)'
  );
  assert.ok(
    stepTypeProp?.enum?.includes('controlPopover'),
    'add_workflow_step type enum must include consolidated controlPopover step type (Phase 9)'
  );
  assert.ok(
    stepTypeProp?.enum?.includes('modifySharedComponent'),
    'add_workflow_step type enum must include consolidated modifySharedComponent step type (Phase 9)'
  );

  // ── Phase 12: structure prompt should not contain removed verbose sections ──
  assert.ok(
    !structure.static.includes('Downstream agents and what they need from you'),
    'Structure prompt must not contain verbose "Downstream agents" section (removed in Phase 12)'
  );
  assert.ok(
    !structure.static.includes('Binding agent: reads the varRoster'),
    'Structure prompt must not contain inline downstream agent descriptions (removed in Phase 12)'
  );
  assert.ok(
    structure.static.includes('Field completeness'),
    'Structure prompt must still include Field completeness rule for array variables'
  );
  assert.ok(
    structure.static.includes('multiOptionBranch'),
    'Structure prompt must still include schema/multiOptionBranch dispatch guidance'
  );

  // ── Phase 12: workflows prompt should not contain removed "Variables" section ──
  assert.ok(
    !phaseW.static.includes('Use only UUIDs from the var roster. The structure agent declares everything you need.'),
    'Workflows prompt must not contain the removed redundant "Variables" section (Phase 12)'
  );

  // ── Phase 5: formula-scope must not teach general JS (Claude already knows it) ──
  const formulaScopeContent = styling.static + phaseW.static;
  assert.ok(
    !formulaScopeContent.includes('operators, optional chaining, ternary, template literals, regex, Math, JSON, Date, Array/String methods'),
    'Agent prompts must not re-teach general JS syntax — Claude already knows it (Phase 5/12)'
  );

  // ── Final pipeline polish: structure declares actions, workflows only adds steps ──

  // generate_structure schema must include actions[] per node and top-level pageActions[]
  const generateStructureTree = generateStructure?.input_schema.properties.tree as { properties?: Record<string, unknown> } | undefined;
  assert.ok(
    'actions' in (generateStructureTree?.properties ?? {}),
    'generate_structure tree must have actions[] property for node-bound workflow stubs'
  );
  assert.ok(
    'pageActions' in (generateStructure?.input_schema.properties ?? {}),
    'generate_structure must have top-level pageActions[] for page-lifecycle workflow stubs'
  );

  // PHASE_W_TOOLS must NOT contain create_workflow or bind_action
  const phaseWToolNames = new Set(PHASE_W_TOOLS.map((t: { name: string }) => t.name));
  assert.ok(
    !phaseWToolNames.has('create_workflow'),
    'PHASE_W_TOOLS must not contain create_workflow — structure agent pre-mints stubs'
  );
  assert.ok(
    !phaseWToolNames.has('bind_action'),
    'PHASE_W_TOOLS must not contain bind_action — structure agent pre-binds stubs'
  );

  // Workflows prompt must not reference create_workflow or bind_action
  assert.ok(
    !phaseW.static.includes('create_workflow'),
    'Workflows prompt must not mention create_workflow (removed from PHASE_W_TOOLS)'
  );
  assert.ok(
    !phaseW.static.includes('bind_action'),
    'Workflows prompt must not mention bind_action (removed from PHASE_W_TOOLS)'
  );

  // Structure prompt must include the new Actions declaration section
  assert.ok(
    structure.static.includes('actions: [{ workflowId, trigger }]'),
    'Structure prompt must instruct the AI to declare actions[] on interactive nodes'
  );
  assert.ok(
    structure.static.includes('pageActions'),
    'Structure prompt must instruct the AI to declare pageActions[] for page lifecycle'
  );

  // formula-scope must declare event as SDUI-curated, not DOM
  assert.ok(
    phaseW.static.includes('NOT a DOM event'),
    'Workflows prompt (via SHARED_FORMULA_SYNTAX) must declare event is NOT a DOM event'
  );
  assert.ok(
    phaseW.static.includes('no event.target'),
    'Workflows prompt (via SHARED_FORMULA_SYNTAX) must explicitly forbid event.target'
  );

  // animationLevel guidance must be gone from styling and animation agents
  assert.ok(
    !styling.static.includes('Animation Level'),
    'Styling prompt must not contain deprecated animationLevel guidance block'
  );

  console.log('AI builder prompt checks passed.');
}

main();
