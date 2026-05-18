import { strict as assert } from 'node:assert';
import {
  ALL_BUILDER_TOOLS,
  PHASE3_BUILDER_TOOLS,
  PHASE_W_TOOLS,
  BINDING_AGENT_TOOLS,
  STYLING_AGENT_TOOLS,
  DATA_AGENT_TOOLS,
  SC_AGENT_TOOLS,
  COMBINED_AGENT_TOOLS,
} from '../lib/ai/builder-tools';

function getTool(name: string) {
  return ALL_BUILDER_TOOLS.find(t => t.name === name);
}

function main() {
  const names = ALL_BUILDER_TOOLS.map(t => t.name);
  const uniqueNames = new Set(names);
  assert.equal(uniqueNames.size, names.length, 'Duplicate tool names found in ALL_BUILDER_TOOLS');

  const allNameSet = new Set(names);
  const assertSubset = (subset: string[], label: string) => {
    for (const n of subset) {
      assert.ok(allNameSet.has(n), `${label} contains tool not in ALL_BUILDER_TOOLS: ${n}`);
    }
  };

  assertSubset(PHASE3_BUILDER_TOOLS.map(t => t.name), 'PHASE3_BUILDER_TOOLS');
  assertSubset(PHASE_W_TOOLS.map(t => t.name), 'PHASE_W_TOOLS');
  assertSubset(BINDING_AGENT_TOOLS.map(t => t.name), 'BINDING_AGENT_TOOLS');
  assertSubset(STYLING_AGENT_TOOLS.map(t => t.name), 'STYLING_AGENT_TOOLS');
  assertSubset(DATA_AGENT_TOOLS.map(t => t.name), 'DATA_AGENT_TOOLS');
  assertSubset(SC_AGENT_TOOLS.map(t => t.name), 'SC_AGENT_TOOLS');
  assertSubset(COMBINED_AGENT_TOOLS.map(t => t.name), 'COMBINED_AGENT_TOOLS');

  // DATA_AGENT_TOOLS must include the datasource write tools — they're the agent's whole job.
  const dataNames = DATA_AGENT_TOOLS.map(t => t.name);
  for (const required of ['add_data_source', 'delete_data_source', 'update_data_source_schema']) {
    assert.ok(dataNames.includes(required), `DATA_AGENT_TOOLS must include "${required}"`);
  }
  // DATA_AGENT_TOOLS must NOT include node-mutation tools — that's the binding/styling agents' job.
  for (const forbidden of ['set_text', 'set_style', 'set_repeat', 'set_animation', 'create_workflow']) {
    assert.ok(!dataNames.includes(forbidden), `DATA_AGENT_TOOLS must not include "${forbidden}" (data agent owns datasources only)`);
  }

  const repeat = getTool('set_repeat');
  assert.ok(repeat, 'set_repeat tool missing');
  const repeatRequired = repeat?.input_schema.required ?? [];
  assert.deepEqual(repeatRequired, ['nodeId'], 'set_repeat required fields must be ["nodeId"]');

  const inputProps = getTool('set_input_props');
  assert.ok(inputProps, 'set_input_props tool missing');
  const inputTypeEnum = (((inputProps?.input_schema.properties.type as { enum?: string[] })?.enum) ?? []);
  assert.ok(inputTypeEnum.includes('decimal'), 'set_input_props.type must include "decimal"');

  const animation = getTool('set_animation');
  assert.ok(animation, 'set_animation tool missing');
  const exitEnum = (((animation?.input_schema.properties.exit as { enum?: string[] })?.enum) ?? []);
  for (const removed of ['bounceOut', 'flipOutX', 'flipOutY', 'flipOut3D', 'rollOut']) {
    assert.ok(!exitEnum.includes(removed), `set_animation.exit should not include unsupported "${removed}"`);
  }

  // Phase B removed set_typography / set_spacing / set_position / get_formula_context.
  const removed = ['set_typography', 'set_spacing', 'set_position', 'get_formula_context'];
  for (const r of removed) {
    assert.ok(!allNameSet.has(r), `${r} must be removed from ALL_BUILDER_TOOLS (Phase B)`);
  }

  const size = getTool('set_size');
  assert.ok(size, 'set_size tool missing');
  const widthDesc = String((size?.input_schema.properties.width as { description?: string })?.description ?? '');
  const heightDesc = String((size?.input_schema.properties.height as { description?: string })?.description ?? '');
  assert.ok(widthDesc.includes('Number'), 'set_size.width should document numeric input (px default)');
  assert.ok(heightDesc.includes('Number'), 'set_size.height should document numeric input (px default)');
  assert.ok(!widthDesc.includes('Unitless strings'), 'set_size.width should no longer teach unitless-string rejection');
  assert.ok(!heightDesc.includes('Unitless strings'), 'set_size.height should no longer teach unitless-string rejection');
  const flexProp = size?.input_schema.properties.flex as { type?: string } | undefined;
  assert.ok(flexProp?.type === 'number', 'set_size.flex must be JSON schema type number (flex-grow only)');

  const layoutTool = getTool('set_layout');
  assert.ok(layoutTool, 'set_layout tool missing');
  const justifyProp = layoutTool?.input_schema.properties.justify as { enum?: unknown } | undefined;
  assert.ok(!justifyProp?.enum, 'set_layout.justify must not use enum — allow CSS and Tailwind wording');

  // Fix 1: add_variable must NOT be in PHASE_W_TOOLS — Structure is the sole variable owner
  const phaseWNames = PHASE_W_TOOLS.map(t => t.name);
  assert.ok(
    !phaseWNames.includes('add_variable'),
    'PHASE_W_TOOLS must not include add_variable — Structure agent is the sole variable owner'
  );

  // SC_AGENT_TOOLS must include the SC authoring lifecycle tools.
  const scNames = SC_AGENT_TOOLS.map(t => t.name);
  for (const required of ['enter_shared_component_edit', 'exit_shared_component_edit', 'create_shared_component']) {
    assert.ok(scNames.includes(required), `SC_AGENT_TOOLS must include "${required}"`);
  }
  // SC_AGENT_TOOLS must NOT include add_shared_component_instance — structure step places instances.
  assert.ok(
    !scNames.includes('add_shared_component_instance'),
    'SC_AGENT_TOOLS must not include add_shared_component_instance — structure step handles placement'
  );
  // SC_AGENT_TOOLS must include primitive authoring tools (used inside enter/exit scope).
  assert.ok(scNames.includes('set_style'), 'SC_AGENT_TOOLS must include set_style for content styling');
  assert.ok(scNames.includes('add_component'), 'SC_AGENT_TOOLS must include add_component for content authoring');

  // COMBINED_AGENT_TOOLS must cover all four families' tools.
  const combinedNames = COMBINED_AGENT_TOOLS.map(t => t.name);
  assert.ok(combinedNames.length > 0, 'COMBINED_AGENT_TOOLS must not be empty');
  for (const required of ['set_style', 'set_animation', 'create_workflow', 'bind_action', 'set_text', 'set_repeat', 'set_condition']) {
    assert.ok(combinedNames.includes(required), `COMBINED_AGENT_TOOLS must include "${required}"`);
  }

  console.log('AI builder contract checks passed.');
}

main();
