/**
 * Star rating system component.
 *
 * Stateless rating row — reads `value` / `max` from props and emits
 * `On change` (`rating-t-on-change`) with `{ value }` (1-indexed) when a star
 * is clicked. Read-only mode suppresses the trigger.
 */

import type { SystemComponentModel } from '../system-component-types';
import ratingData from './rating.data.json';

const rating: SystemComponentModel = {
  ...(ratingData as unknown as SystemComponentModel),
  id: 'sys-rating',
  name: (ratingData as { name?: string }).name ?? 'Star Rating',
  isBuiltIn: true,
  icon: '★',
};

export default rating;
