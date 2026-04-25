/**
 * Internal helper used by each built-in system component module.
 *
 * Reduces boilerplate: a system component definition is just a name + icon +
 * content tree. Properties/variables/formulas/workflows are empty by default
 * and can be filled in per-module when needed.
 */

import type { SystemComponentModel } from '../system-component-types';

export function makeSystemComponent(
  id: string,
  name: string,
  content: Record<string, unknown>,
  opts?: Partial<Pick<SystemComponentModel,
    'icon' | 'folder' | 'description' | 'properties' | 'variables' | 'formulas' | 'workflows'
  >>,
): SystemComponentModel {
  return {
    id,
    name,
    folder: opts?.folder,
    description: opts?.description,
    properties: opts?.properties ?? [],
    variables: opts?.variables ?? {},
    formulas: opts?.formulas ?? {},
    workflows: opts?.workflows ?? {},
    content: content as unknown as SystemComponentModel['content'],
    isBuiltIn: true,
    icon: opts?.icon,
  };
}
