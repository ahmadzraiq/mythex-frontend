/**
 * Button system component.
 *
 * Renders a clickable Box with formula-driven className covering five variants
 * (`solid|destructive|outline|ghost|link`) × three sizes (`sm|md|lg`), plus an
 * optional left and right icon and a disabled state. The body lives next to
 * this module as `button.data.json`.
 *
 * Public API:
 *   - props.variant / props.size / props.label / props.iconLeft /
 *     props.iconRight / props.disabled
 *   - trigger `btn-t-on-click` (`On click`) — emits with `{ label, variant }`.
 *     Suppressed while `disabled` is true.
 */

import type { SystemComponentModel } from '../system-component-types';
import buttonData from './button.data.json';

const button: SystemComponentModel = {
  ...(buttonData as unknown as SystemComponentModel),
  id: 'sys-button',
  name: (buttonData as { name?: string }).name ?? 'Button',
  isBuiltIn: true,
  icon: '◼',
};

export default button;
