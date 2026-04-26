/**
 * Tabs system component.
 *
 * Renders a tab strip from `tabs` (array of `{ label, value }`) with an
 * internal `activeTab` variable that mirrors the current selection. Clicking
 * a tab updates the variable and emits `On change` with `{ value, label }`.
 * Listeners on the parent page decide what body to render based on the active
 * value. The body lives next to this module as `tabs.data.json`.
 */

import type { SystemComponentModel } from '../system-component-types';
import tabsData from './tabs.data.json';

const tabs: SystemComponentModel = {
  ...(tabsData as unknown as SystemComponentModel),
  id: 'sys-tabs',
  name: (tabsData as { name?: string }).name ?? 'Tabs',
  isBuiltIn: true,
  icon: '⬜',
};

export default tabs;
