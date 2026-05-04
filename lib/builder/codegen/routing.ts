/**
 * routing.ts — Emit one page.tsx per BuilderPage.
 *
 * Each page is a 'use client' React component that:
 *   - Reads state from useStore
 *   - Calls workflow functions on events
 *   - Optionally exports a `metadata` object (from BuilderPage.meta)
 */

import type { BuilderPage } from '@/app/dev/builder/_store-types';
import type { SDUINode } from '@/lib/sdui/types/node';
import type { CodegenCtx, EmittedFile } from './types';
import { routeToFilePath, routeToComponentName } from './identifiers';
import { resolvePageNodes } from './resolve';
import { emitNode } from './nodes';
import { ImportsTracker } from './tsx-builder';

/** All function names exported from lib/utils.ts that might appear in JSX formulas */
const UTILS_FN_NAMES = new Set([
  // conditional
  'ifThen', 'ifEmpty', 'not', 'and', 'or', 'equal', 'notEqual', 'switchOn',
  // math
  'average', 'rollupSum', 'round', 'sum', 'toNumber', 'abs', 'ceil', 'clamp', 'floor',
  'max', 'min', 'mod', 'pow', 'sqrt', 'toFixed',
  // string
  'lower', 'upper', 'capitalize', 'trim', 'startsWith', 'endsWith', 'replace', 'split',
  'concat', 'textLength', 'substring', 'padStart', 'padEnd',
  // formatting
  'formatCurrency', 'formatNumber', 'formatDate', 'formatRelativeTime',
  // array
  'add', 'contains', 'includes', 'createArray', 'distinct', 'filterByKey', 'findIndex',
  'getByIndex', 'join', 'length', 'lookup', 'merge', 'prepend', 'remove', 'removeByIndex',
  'reverse', 'slice', 'sort', 'flat', 'arrayIncludes', 'arrayLength', 'toggleInArray',
  // object
  'keys', 'values', 'entries', 'has', 'set', 'omit', 'pick',
  // date
  'now', 'today', 'toDate', 'isBefore', 'isAfter',
  // engine-compat
  'getFromMap', 'getKeyValue', 'findItemById', 'clampNumber', 'formatFullName',
  'toText', 'stringify', 'groupBy', 'paginationPages',
  'lookupInArray', 'lookupMap', 'filterExcludeByFieldAndSlice', 'findItemByOptionsMatch',
]);

/** Scan generated JSX for known utils function calls and return the ones found */
function detectUsedUtilsFns(jsx: string): string[] {
  const used: string[] = [];
  for (const fn of UTILS_FN_NAMES) {
    // Match `fn(` with word boundary before to avoid partial matches
    if (new RegExp(`\\b${fn}\\s*\\(`).test(jsx)) {
      used.push(fn);
    }
  }
  return used;
}

export function emitPages(ctx: CodegenCtx, usedAnimations: Set<string>): EmittedFile[] {
  const files: EmittedFile[] = [];

  for (const page of ctx.store.pages ?? []) {
    if (!page.route && !page.name) continue;
    const route = page.route ?? `/${page.name.toLowerCase().replace(/\s+/g, '-')}`;
    const filePath = routeToFilePath(route);

    try {
      const file = emitPage(page, route, filePath, ctx, usedAnimations);
      files.push(file);
    } catch (err) {
      throw new Error(`[codegen] Page "${page.name}" (${route}): ${(err as Error).message}`);
    }
  }

  return files;
}

function emitPage(
  page: BuilderPage,
  route: string,
  filePath: string,
  ctx: CodegenCtx,
  usedAnimations: Set<string>,
): EmittedFile {
  // Compute relative prefix: app/page.tsx → "../", app/cart/page.tsx → "../../", etc.
  const depth = route.split('/').filter(Boolean).length + 1;
  const relPrefix = '../'.repeat(depth);

  const imports = new ImportsTracker();
  imports.addNamed('react', 'useEffect', 'useState');
  imports.addNamed(`${relPrefix}lib/store`, 'useStore');
  imports.addNamed('next/navigation', 'useRouter');

  if (ctx.flags.hasAnimations) {
    imports.addNamed('framer-motion', 'AnimatePresence');
  }

  const resolvedNodes = resolvePageNodes(page.nodes ?? [] as SDUINode[]);
  const allUseEffects: string[] = [];
  const allWorkflowMeta = {
    ...(ctx.store.pageWorkflowMeta ?? {}),
    ...(ctx.store.globalWorkflowMeta ?? {}),
  };

  // Find workflows used by this page to import
  const usedWorkflows = new Set<string>();
  for (const node of resolvedNodes) {
    collectUsedWorkflows(node as unknown as Record<string, unknown>, allWorkflowMeta, ctx, usedWorkflows);
  }

  // Page-level on-mount interaction
  const pageMountWorkflow = page.pageInteractions?.['mount']?.workflow;
  if (pageMountWorkflow) {
    const wfName = ctx.symbols.workflows.get(pageMountWorkflow);
    if (wfName) usedWorkflows.add(wfName);
  }

  if (usedWorkflows.size > 0) {
    imports.addNamed(`${relPrefix}lib/workflows`, ...usedWorkflows);
  }

  if (ctx.flags.hasFetch || ctx.flags.hasGraphQL) {
    imports.addNamed(`${relPrefix}lib/api`, 'api');
  }

  if (ctx.flags.hasToast) {
    imports.addNamed('sonner', 'toast');
  }

  const hasPopovers = resolvedNodes.some(n => hasPopoverInTree(n as unknown as Record<string, unknown>));

  if (hasPopovers || ctx.flags.hasPopovers) {
    imports.addNamed('@radix-ui/react-popover', 'Popover', 'PopoverTrigger', 'PopoverContent');
  }

  // Emit JSX for all nodes
  const nodeJsxParts: string[] = [];
  for (const node of resolvedNodes) {
    const result = emitNode(node as Record<string, unknown> & SDUINode, ctx, imports, usedAnimations, false, 2);
    nodeJsxParts.push(result.jsx);
    allUseEffects.push(...result.useEffects);
  }

  // Auto-detect which utils formula functions are used and add a named import
  const allJsx = nodeJsxParts.join('\n');
  const usedUtils = detectUsedUtilsFns(allJsx);
  if (usedUtils.length > 0) {
    imports.addNamed(`${relPrefix}lib/utils`, ...usedUtils);
  }

  const componentName = routeToComponentName(route);

  // Build component body
  const lines: string[] = [];
  lines.push(`'use client';`);
  lines.push('');
  // Opt out of static prerendering — this is a dynamic client-side app
  lines.push(`export const dynamic = 'force-dynamic';`);
  lines.push('');
  lines.push(imports.render());
  lines.push('');

  // Metadata export (for server components) — included as a comment since page is 'use client'
  if (page.meta?.title || page.meta?.description) {
    lines.push(`// SEO metadata — move to a separate server layout if needed`);
    lines.push(`// export const metadata = ${JSON.stringify({
      title: page.meta.title,
      description: page.meta.description,
      ...(page.meta.ogImage ? { openGraph: { images: [page.meta.ogImage] } } : {}),
    }, null, 2)};`);
    lines.push('');
  }

  lines.push(`export default function ${componentName}() {`);
  lines.push(`  const state = useStore();`);
  lines.push(`  const router = useRouter();`);
  // Always declare these so all workflow call-sites compile without 'not defined' errors
  lines.push(`  const [popoverState, setPopoverState] = useState<Record<string, boolean>>({});`);
  lines.push(`  const popover: [Record<string, boolean>, typeof setPopoverState] = [popoverState, setPopoverState];`);
  lines.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
  lines.push(`  const form: any = undefined;`);
  // globalContext polyfill — reads URL search params / window size for SSR-safe access
  lines.push(`  const _globalCtx = typeof window !== 'undefined'`);
  lines.push(`    ? { browser: { query: Object.fromEntries(new URLSearchParams(window.location.search)), breakpoint: window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop' } }`);
  lines.push(`    : { browser: { query: {} as Record<string, string>, breakpoint: 'desktop' as string } };`);

  // Page mount workflow
  if (pageMountWorkflow) {
    const wfName = ctx.symbols.workflows.get(pageMountWorkflow);
    if (wfName) {
      lines.push(`  useEffect(() => {`);
      lines.push(`    void ${wfName}({ state: useStore.getState(), dispatch: useStore.setState, router, api: {}, form, popover });`);
      lines.push(`  }, []);`);
    }
  }

  // Other useEffects from nodes
  for (const ue of allUseEffects) {
    lines.push(`  ${ue}`);
  }

  lines.push('');
  lines.push(`  return (`);
  lines.push(`    <div>`);
  for (const jsx of nodeJsxParts) {
    lines.push(jsx);
  }
  lines.push(`    </div>`);
  lines.push(`  );`);
  lines.push(`}`);

  return {
    path: filePath,
    content: lines.join('\n'),
  };
}

function collectUsedWorkflows(
  node: Record<string, unknown>,
  workflowMeta: Record<string, unknown>,
  ctx: CodegenCtx,
  out: Set<string>,
): void {
  const actions = node.actions;
  if (Array.isArray(actions)) {
    for (const a of actions as Array<{ action?: string }>) {
      if (a.action) {
        const wfName = ctx.symbols.workflows.get(a.action);
        if (wfName) out.add(wfName);
      }
    }
  } else if (actions && typeof actions === 'object') {
    for (const v of Object.values(actions as Record<string, unknown>)) {
      if (v && typeof v === 'object' && 'action' in v) {
        const wfName = ctx.symbols.workflows.get((v as { action: string }).action);
        if (wfName) out.add(wfName);
      }
    }
  }
  for (const child of (node.children ?? []) as Record<string, unknown>[]) {
    collectUsedWorkflows(child, workflowMeta, ctx, out);
  }
}

function hasPopoverInTree(node: Record<string, unknown>): boolean {
  if (node.popover) return true;
  for (const child of (node.children ?? []) as Record<string, unknown>[]) {
    if (hasPopoverInTree(child)) return true;
  }
  return false;
}
