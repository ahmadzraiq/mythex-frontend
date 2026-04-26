/**
 * Breadcrumbs system component.
 *
 * Renders a breadcrumb trail from `items` (array of `{ label, href }`). Each
 * non-last item is followed by a separator Icon (configurable via
 * `separatorIcon`). Clicking any item emits `On item click`
 * (`bc-t-on-item-click`) with `{ label, href, index }`.
 */

import type { SystemComponentModel } from '../system-component-types';
import breadcrumbsData from './breadcrumbs.data.json';

const breadcrumbs: SystemComponentModel = {
  ...(breadcrumbsData as unknown as SystemComponentModel),
  id: 'sys-breadcrumbs',
  name: (breadcrumbsData as { name?: string }).name ?? 'Breadcrumbs',
  isBuiltIn: true,
  icon: '›',
};

export default breadcrumbs;
