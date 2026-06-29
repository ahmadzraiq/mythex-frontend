/**
 * plan.ts — Build the symbol map and feature flags from the builder store.
 *
 * Called once at the start of codegen; the resulting CodegenCtx is threaded
 * through every emitter so all identifiers are consistent.
 */

import type { BuilderStore, CustomVar, DataSourceConfig } from '@/app/dev/builder/_store-types';
import type { SDUINode } from '@/lib/sdui/types/node';
import type { CodegenCtx, FeatureFlags, SymbolMap } from './types';
import { uniqueIdent } from './identifiers';

function buildSymbolMap(store: BuilderStore): SymbolMap {
  const usedIdents = new Set<string>();

  // Variables
  const vars = new Map<string, string>();
  for (const v of store.customVars ?? []) {
    const ident = uniqueIdent(v.name, v.id ?? v.name, usedIdents);
    vars.set(v.name, ident);
    if (v.id) vars.set(v.id, ident);
  }

  // Collections (datasources)
  const collections = new Map<string, string>();
  for (const ds of store.pageDataSources ?? []) {
    const ident = uniqueIdent(ds._label ?? ds.name, ds.id, usedIdents);
    collections.set(ds.id, ident);
    if (ds.storeIn) collections.set(ds.storeIn, ident);
    if (ds.name) collections.set(ds.name, ident);
  }

  // Workflows
  const workflows = new Map<string, string>();
  const allWorkflows = store.workflows ?? {};
  for (const [id, meta] of Object.entries(allWorkflows)) {
    if (!meta) continue;
    const ident = uniqueIdent(meta.name, id, usedIdents);
    workflows.set(id, ident);
    if (meta.name) workflows.set(meta.name, ident);
  }

  // Routes
  const routes = new Map<string, string>();
  for (const page of store.pages ?? []) {
    if (page.route) routes.set(page.id, page.route);
  }

  return { vars, collections, workflows, routes };
}

function detectFeatures(store: BuilderStore): FeatureFlags {
  const allNodes: SDUINode[] = [];
  for (const page of store.pages ?? []) {
    collectNodes(page.nodes ?? [], allNodes);
  }

  const types = new Set(allNodes.map(n => n.type));
  const hasActions = (types: Set<string>, ...t: string[]) => t.some(x => types.has(x));

  // Scan all workflow steps for action types
  const allSteps: Array<Record<string, unknown>> = [];
  for (const wf of Object.values(store.workflows ?? {})) {
    collectSteps(((wf as { steps?: unknown[] }).steps ?? []) as Record<string, unknown>[], allSteps);
  }
  const actionTypes = new Set(allSteps.map(s => s.type as string).filter(Boolean));

  const hasForms = types.has('FormContainer') || types.has('Input') || types.has('InputField') || types.has('Textarea') || types.has('TextareaInput');
  const hasAnimations = allNodes.some(n => {
    const props = n.props as Record<string, unknown> | undefined;
    return props?.animation != null || (n as unknown as Record<string, unknown>).animation != null;
  });

  return {
    hasForms,
    hasPopovers: allNodes.some(n => (n as unknown as Record<string, unknown>).popover != null) || actionTypes.has('openPopover') || actionTypes.has('closePopover') || actionTypes.has('togglePopover'),
    hasAnimations,
    hasCharts: types.has('Chart'),
    hasMarkdown: types.has('MarkdownViewer'),
    hasLottie: types.has('LottiePlayer'),
    hasQR: types.has('QRCodeWidget'),
    hasToast: false,
    hasFetch: actionTypes.has('fetch') || (store.pageDataSources ?? []).some(ds => ds.type === 'rest'),
    hasGraphQL: actionTypes.has('graphql') || (store.pageDataSources ?? []).some(ds => ds.type === 'graphql'),
    hasAuth: false,
    hasGoogleMap: types.has('GoogleMap') || types.has('GoogleMapPlaces'),
    hasHtmlContent: types.has('HtmlContent'),
    hasVideo: types.has('Video'),
    hasIframe: types.has('Iframe'),
    hasSearchParamSync: (store.customVars ?? []).some(v => false), // set based on store.json at runtime
    hasPersistedVars: (store.customVars ?? []).some(v => v.saveInLocalStorage),
    hasComputedValues: false, // from store.json computed entries
    hasDarkMode: Object.keys(store.themeDarkOverrides ?? {}).length > 0 || (store.customColors ?? []).length > 0,
    hasThemeActions: actionTypes.has('setTheme'),
  };
}

function collectNodes(nodes: SDUINode[], out: SDUINode[]): void {
  for (const n of nodes) {
    out.push(n);
    if (n.children) collectNodes(n.children as SDUINode[], out);
  }
}

function collectSteps(steps: Record<string, unknown>[], out: Record<string, unknown>[]): void {
  for (const s of steps ?? []) {
    out.push(s);
    if (Array.isArray(s.steps)) collectSteps(s.steps as Record<string, unknown>[], out);
    if (Array.isArray(s.actions)) collectSteps(s.actions as Record<string, unknown>[], out);
    // Recurse into branch sub-steps so nested action types are detected for feature flags
    if (Array.isArray(s.trueBranch)) collectSteps(s.trueBranch as Record<string, unknown>[], out);
    if (Array.isArray(s.falseBranch)) collectSteps(s.falseBranch as Record<string, unknown>[], out);
    if (Array.isArray(s.branches)) {
      for (const b of s.branches as Record<string, unknown>[]) {
        if (Array.isArray(b.steps)) collectSteps(b.steps as Record<string, unknown>[], out);
      }
    }
  }
}

export function buildCodegenCtx(store: BuilderStore): CodegenCtx {
  const symbols = buildSymbolMap(store);
  const flags = detectFeatures(store);

  const varsByName = new Map<string, CustomVar>();
  const varsById = new Map<string, CustomVar>();
  for (const v of store.customVars ?? []) {
    varsByName.set(v.name, v);
    if (v.id) varsById.set(v.id, v);
  }

  const dsById = new Map<string, DataSourceConfig>();
  const dsByStoreIn = new Map<string, DataSourceConfig>();
  for (const ds of store.pageDataSources ?? []) {
    dsById.set(ds.id, ds);
    if (ds.storeIn) dsByStoreIn.set(ds.storeIn, ds);
  }

  return {
    store,
    symbols,
    flags,
    varsByName,
    varsById,
    dsById,
    dsByStoreIn,
    customColors: store.customColors ?? [],
  };
}
