import { strict as assert } from 'node:assert';
import {
  buildChatSystemPrompt,
  TOOL_DESCRIPTIONS,
  buildPhase3SystemPrompt,
  buildPhaseWSysPrompt,
} from '../lib/ai/builder-knowledge-v2';
import { ALL_BUILDER_TOOLS } from '../lib/ai/builder-tools';
import { buildColorsAgentPrompt } from '../lib/ai/agents/colors/prompt';
import { buildLayoutAgentPrompt } from '../lib/ai/agents/layout/prompt';
import { buildStructureAgentPrompt } from '../lib/ai/agents/structure/prompt';

function main() {
  const chat = buildChatSystemPrompt({
    pages: [{ id: 'p1', name: 'Home', route: '/' }],
    currentPageName: 'Home',
    currentPageRoute: '/',
    paletteSnapshot: 'primary = #111111',
  });
  const colors = buildColorsAgentPrompt({
    pages: [{ id: 'p1', name: 'Home', route: '/' }],
    currentPageName: 'Home',
    currentPageRoute: '/',
    paletteSnapshot: 'primary = #111111',
  });
  const layout = buildLayoutAgentPrompt({
    pages: [{ id: 'p1', name: 'Home', route: '/' }],
    currentPageName: 'Home',
    currentPageRoute: '/',
    paletteSnapshot: 'primary = #111111',
  });
  const phase3 = buildPhase3SystemPrompt({
    pages: [{ id: 'p1', name: 'Home', route: '/' }],
    currentPageName: 'Home',
    currentPageRoute: '/',
    paletteSnapshot: 'primary = #111111',
  });
  const phaseW = buildPhaseWSysPrompt({
    pages: [{ id: 'p1', name: 'Home', route: '/' }],
    currentPageName: 'Home',
    currentPageRoute: '/',
  });

  assert.ok(chat.static.length > 0, 'Main system prompt should not be empty');
  assert.ok(colors.static.length > 0, 'Colors system prompt should not be empty');
  assert.ok(layout.static.length > 0, 'Layout system prompt should not be empty');
  assert.ok(phase3.static.length > 0, 'Phase 3 system prompt should not be empty');
  assert.ok(phaseW.static.length > 0, 'Phase W system prompt should not be empty');
  assert.ok(!colors.static.includes('NEVER use fillOpacity'), 'Colors prompt must not contain the deprecated hard-ban text for fillOpacity');
  assert.ok(!layout.static.includes('set_size(width:"100vw") to fill the viewport'), 'Layout prompt should avoid forcing 100vw root default');
  assert.ok(!layout.static.includes('set_condition('), 'Layout prompt must not mention set_condition (binding-only tool)');
  assert.ok(!phase3.static.includes('Systematic Styling Order'), 'Phase 3 prompt should not contain generic systematic styling boilerplate');
  assert.ok(!phaseW.static.includes('arrayOperation'), 'Phase W prompt should not mention unsupported changeVariableValue arrayOperation');
  assert.ok(!chat.static.includes('Compound components'), 'Main prompt should avoid legacy "compound components" terminology');
  assert.ok(
    !TOOL_DESCRIPTIONS.set_text.includes('nearest Text child'),
    'set_text description must not claim auto-targeting nearest Text child'
  );
  assert.ok(phaseW.static.includes('uploadFile'), 'Phase W prompt should document uploadFile');
  assert.ok(phaseW.static.includes('printPdf'), 'Phase W prompt should document printPdf');
  assert.ok(phaseW.static.includes('downloadFileFromUrl'), 'Phase W prompt should document downloadFileFromUrl');
  assert.ok(phaseW.static.includes('closePopup'), 'Phase W prompt should document closePopup');
  assert.ok(!phaseW.static.includes('## Prohibited'), 'Phase W prompt should not use obsolete prohibited section');
  assert.ok(!phaseW.static.includes('NOT functional'), 'Phase W prompt should not contain obsolete NOT functional wording');

  const getTool = (name: string) => ALL_BUILDER_TOOLS.find(t => t.name === name);
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
  assert.ok(
    TOOL_DESCRIPTIONS.set_background.includes('rgba'),
    'set_background description should include rgba transparency guidance'
  );

  const structure = buildStructureAgentPrompt();
  assert.ok(structure.static.length > 0, 'Structure system prompt should not be empty');
  assert.ok(
    structure.static.includes('empty Box renders'),
    'Structure prompt must include completeness principle (empty Box renders as empty rectangle)'
  );
  assert.ok(
    structure.static.includes('Element mapping'),
    'Structure prompt must include HTML-to-tree element mapping'
  );

  console.log('AI builder prompt checks passed.');
}

main();
