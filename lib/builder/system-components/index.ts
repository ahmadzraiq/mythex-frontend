/**
 * Built-in system component definitions.
 *
 * Each module under this folder exports a single `SystemComponentModel` as its
 * default export (or a named export) and gets registered in
 * `SYSTEM_COMPONENT_DEFAULTS` below. `system-component-data.ts` reads from this
 * map at module-load time to produce the initial store.
 *
 * Adding a new system component is a 3-step process:
 *   1. Create `./my-component.ts` that exports a `SystemComponentModel`.
 *   2. Register it in the map below keyed by `sys-<slug>`.
 *   3. In `lib/builder/primitive-components.ts`, point the matching palette
 *      entry at it via `systemComponentId: 'sys-<slug>'`.
 */

import type { SystemComponentModel } from '../system-component-types';

import datepicker from './datepicker';
import modal from './modal';
import drawer from './drawer';
import bottomSheet from './bottom-sheet';
import toast from './toast';
import accordion from './accordion';
import table from './table';
import autocomplete from './autocomplete';
import snackbar from './snackbar';
import alert from './alert';
import badge from './badge';
import avatar from './avatar';

export const SYSTEM_COMPONENT_DEFAULTS: Record<string, SystemComponentModel> = {
  [datepicker.id]: datepicker,
  [modal.id]: modal,
  [drawer.id]: drawer,
  [bottomSheet.id]: bottomSheet,
  [toast.id]: toast,
  [accordion.id]: accordion,
  [table.id]: table,
  [autocomplete.id]: autocomplete,
  [snackbar.id]: snackbar,
  [alert.id]: alert,
  [badge.id]: badge,
  [avatar.id]: avatar,
};
