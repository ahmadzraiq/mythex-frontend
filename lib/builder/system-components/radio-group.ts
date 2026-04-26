/**
 * Radio Group system component.
 *
 * Accessible radio group built on the real `RadioGroup` / `Radio` /
 * `RadioIndicator` / `RadioLabel` primitives. `options` is an array of
 * `{ value, label }`; the selection is mirrored on the per-instance
 * `rg-v-value-uuid` variable. When the user picks a new option the variable
 * is updated and `On change` (`rg-t-on-change`) is emitted with `{ value }`.
 */

import type { SystemComponentModel } from '../system-component-types';
import radioGroupData from './radio-group.data.json';

const radioGroup: SystemComponentModel = {
  ...(radioGroupData as unknown as SystemComponentModel),
  id: 'sys-radio-group',
  name: (radioGroupData as { name?: string }).name ?? 'Radio Group',
  isBuiltIn: true,
  icon: '◎',
};

export default radioGroup;
