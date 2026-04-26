/**
 * Stepper system component.
 *
 * Renders a step progress row from `steps` (array of `{ label }`). Each step
 * renders as `done | current | upcoming` based on its 1-indexed position vs
 * `activeStep`. Connector lines use the same comparison. Clicking a step
 * emits `On step click` (`stepper-t-on-step-click`) with `{ index, label }`.
 */

import type { SystemComponentModel } from '../system-component-types';
import stepperData from './stepper.data.json';

const stepper: SystemComponentModel = {
  ...(stepperData as unknown as SystemComponentModel),
  id: 'sys-stepper',
  name: (stepperData as { name?: string }).name ?? 'Stepper',
  isBuiltIn: true,
  icon: '①',
};

export default stepper;
