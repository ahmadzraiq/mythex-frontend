/**
 * FAB (floating action button) system component.
 *
 * Renders a pill-shaped clickable Box with a primary background, drop shadow,
 * an icon and an optional label. The label child is gated by `condition` so
 * an empty label doesn't render. The body lives next to this module as
 * `fab.data.json`.
 *
 * Public API:
 *   - props.icon / props.label / props.disabled
 *   - trigger `fab-t-on-click` (`On click`) — emits with `{ label, icon }`.
 *     Suppressed while `disabled` is true.
 */

import type { SystemComponentModel } from '../system-component-types';
import fabData from './fab.data.json';

const fab: SystemComponentModel = {
  ...(fabData as unknown as SystemComponentModel),
  id: 'sys-fab',
  name: (fabData as { name?: string }).name ?? 'FAB',
  isBuiltIn: true,
  icon: '⊕',
};

export default fab;
