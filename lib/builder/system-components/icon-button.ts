/**
 * Icon Button system component.
 *
 * Renders a square or round icon-only clickable Box. Variant (`ghost|solid|
 * outline`) + size (`sm|md|lg`) + shape (`square|round`) drive the className
 * via formula. The body lives next to this module as `icon-button.data.json`.
 *
 * Public API:
 *   - props.icon / props.shape / props.size / props.variant / props.disabled
 *   - trigger `ibtn-t-on-click` (`On click`) — emits with `{ icon }`.
 *     Suppressed while `disabled` is true.
 */

import type { SystemComponentModel } from '../system-component-types';
import iconButtonData from './icon-button.data.json';

const iconButton: SystemComponentModel = {
  ...(iconButtonData as unknown as SystemComponentModel),
  id: 'sys-icon-button',
  name: (iconButtonData as { name?: string }).name ?? 'Icon Button',
  isBuiltIn: true,
  icon: '⬚',
};

export default iconButton;
