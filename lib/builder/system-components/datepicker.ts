/**
 * DatePicker system component.
 *
 * The body (properties, variables, formulas, workflows, content) lives
 * alongside this module as `datepicker.data.json` and is imported at build
 * time. That still counts as "shipped with the app in code" for our
 * code-defined defaults policy — the file is part of the bundle, not
 * user-editable on disk.
 *
 * The DatePicker derives its month grid from a formula on the `map` node
 * (see content), so there is no rebuild-grid workflow and no perceptible
 * delay between interactions and the visible grid.
 */

import type { SystemComponentModel } from '../system-component-types';
import datepickerData from './datepicker.data.json';

const datepicker: SystemComponentModel = {
  ...(datepickerData as unknown as SystemComponentModel),
  id: 'sys-datepicker',
  name: (datepickerData as { name?: string }).name ?? 'DatePicker',
  isBuiltIn: true,
  icon: '📅',
};

export default datepicker;
