/**
 * decompile-page
 *
 * Converts a BuilderPage back to a TypeScript/JSX source file that matches
 * the DSL syntax Claude writes — `from 'builder'`, `sx={{ }}`, `export default`.
 *
 * Output: src/pages/<pageName>.tsx
 */

import type { BuilderPage } from '@/app/dev/builder/_store-types';
import type { SDUINode } from '@/lib/sdui/types/node';
import type { ResolveContext } from './resolve';
import { decompileNodes, collectComponentTypes, hasWorkflowRefs, hasVarRefs } from './decompile-nodes';

/**
 * The exact set of JSX element identifiers exported from 'builder'
 * (lib/dsl/builder/index.ts). Only these should appear in the import statement.
 */
const BUILDER_COMPONENTS = new Set([
  'Box', 'Text', 'Input', 'Textarea', 'Image', 'Icon',
  'Video', 'Iframe', 'FormContainer', 'SC',
]);

export function decompilePage(page: BuilderPage, ctx: ResolveContext): string {
  const nodes  = (page.nodes ?? []) as SDUINode[];
  const route  = page.route ?? `/${page.name.toLowerCase()}`;
  const title  = page.meta?.title ?? page.name;

  // Collect which builder symbols are actually used
  const usedTypes    = collectComponentTypes(nodes);
  const needsWorkflow = hasWorkflowRefs(nodes);
  const needsVars    = hasVarRefs(nodes);

  // Only import known builder components; custom components defined in the page don't come from 'builder'
  const componentImports = [...usedTypes]
    .filter(t => BUILDER_COMPONENTS.has(t))
    .sort();

  const namedImports: string[] = ['definePage', ...componentImports];
  if (needsWorkflow) namedImports.push('workflow');
  if (needsVars)     namedImports.push('vars');

  const importLine = `import { ${namedImports.join(', ')} } from 'builder';`;

  // Page meta
  const metaFields: string[] = [`path: '${route}'`];
  if (title && title !== page.name) metaFields.push(`title: '${title}'`);
  if (page.meta?.description)       metaFields.push(`description: '${page.meta.description}'`);
  if (page.access && page.access !== 'everyone') metaFields.push(`access: '${page.access}'`);

  const metaStr    = metaFields.join(', ');
  const jsxContent = decompileNodes(nodes, ctx, 2);

  return [
    importLine,
    '',
    `export default definePage({ ${metaStr} }, () => (`,
    jsxContent,
    '));',
    '',
  ].join('\n');
}
