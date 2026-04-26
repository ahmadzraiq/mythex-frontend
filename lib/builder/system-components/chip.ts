/**
 * Chip system component.
 *
 * Pill-shaped chip with optional left icon, label, and a remove icon. Variant
 * (`primary | secondary | outline`) drives the className via formula. Body
 * click emits `On click` (`chip-t-on-click`); the remove icon emits
 * `On remove` (`chip-t-on-remove`) and stops propagation so the parent click
 * doesn't also fire.
 */

import type { SystemComponentModel } from '../system-component-types';
import chipData from './chip.data.json';

const chip: SystemComponentModel = {
  ...(chipData as unknown as SystemComponentModel),
  id: 'sys-chip',
  name: (chipData as { name?: string }).name ?? 'Chip',
  isBuiltIn: true,
  icon: '◉',
};

export default chip;
