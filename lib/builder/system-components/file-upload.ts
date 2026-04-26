/**
 * File upload system component.
 *
 * The body (properties, variables, workflows, content) lives alongside this
 * module as `file-upload.data.json`. The dropzone visuals (icon, label,
 * dashed border) are composed from Box/Icon/Text primitives in JSON. The
 * dropzone Box is the click target; clicking runs an internal workflow whose
 * first step is the `pickFile` action — that step programmatically opens the
 * OS file picker, so we don't need any hidden `<input type="file">` in the
 * tree. After the picker resolves, the SC fires its `On files selected`
 * trigger so listeners can read `context.event.files`.
 *
 * Public API:
 *   - props.label / props.accept / props.multiple — configure the dropzone.
 *   - trigger `fu-t-on-files-selected` (`On files selected`) — fires after the
 *     user picks one or more files. Listeners read `context.event.files`.
 */

import type { SystemComponentModel } from '../system-component-types';
import fileUploadData from './file-upload.data.json';

const fileUpload: SystemComponentModel = {
  ...(fileUploadData as unknown as SystemComponentModel),
  id: 'sys-file-upload',
  name: (fileUploadData as { name?: string }).name ?? 'File upload',
  isBuiltIn: true,
  icon: '📎',
};

export default fileUpload;
