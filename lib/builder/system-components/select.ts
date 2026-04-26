/**
 * Select system component.
 *
 * Renders a click-to-open dropdown with a popover list of options. The body
 * (properties, variables, workflows, content) lives alongside this module as
 * `select.data.json`.
 *
 * Data flow:
 *   - `props.options` is an array of `{ label, value }` objects (typically
 *     bound via a formula, e.g. mapping a remote list).
 *   - `props.value` is the currently selected value (typically bound to a
 *     parent variable so the parent owns the source of truth).
 *   - On item click, the SC closes the popover and emits the
 *     `sel-t-on-change` trigger with `{ value, label }` payload. The parent
 *     listens with `wf.trigger = 'sel-t-on-change'` and reads `context.event.value`.
 */

import type { SystemComponentModel } from '../system-component-types';
import selectData from './select.data.json';

const select: SystemComponentModel = {
  ...(selectData as unknown as SystemComponentModel),
  id: 'sys-select',
  name: (selectData as { name?: string }).name ?? 'Select',
  isBuiltIn: true,
  icon: '▾',
};

export default select;
