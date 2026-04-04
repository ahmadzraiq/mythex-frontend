import { strict as assert } from 'node:assert';
import {
  ALL_BUILDER_TOOLS,
  PHASE3_BUILDER_TOOLS,
  PHASE_W_TOOLS,
  BINDING_AGENT_TOOLS,
  LAYOUT_AGENT_TOOLS,
  COLORS_AGENT_TOOLS,
  TYPO_ANIM_AGENT_TOOLS,
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
  assertSubset(LAYOUT_AGENT_TOOLS.map(t => t.name), 'LAYOUT_AGENT_TOOLS');
  assertSubset(COLORS_AGENT_TOOLS.map(t => t.name), 'COLORS_AGENT_TOOLS');
  assertSubset(TYPO_ANIM_AGENT_TOOLS.map(t => t.name), 'TYPO_ANIM_AGENT_TOOLS');

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

  console.log('AI builder contract checks passed.');
}

main();
