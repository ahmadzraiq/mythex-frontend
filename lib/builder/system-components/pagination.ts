/**
 * Pagination system component.
 *
 * Stateless pagination strip — reads `currentPage` / `totalPages` /
 * `siblingCount` from props and emits `On page change` (`pg-t-on-change`)
 * with `{ page }` for prev / next / page-click. Parents own the page index
 * and re-render the list.
 */

import type { SystemComponentModel } from '../system-component-types';
import paginationData from './pagination.data.json';

const pagination: SystemComponentModel = {
  ...(paginationData as unknown as SystemComponentModel),
  id: 'sys-pagination',
  name: (paginationData as { name?: string }).name ?? 'Pagination',
  isBuiltIn: true,
  icon: '⟨⟩',
};

export default pagination;
