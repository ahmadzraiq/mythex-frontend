/**
 * Shared types for the codegen pipeline.
 */

import type { BuilderStore, CustomVar, DataSourceConfig, CustomColor } from '@/app/dev/builder/_store-types';

export interface EmittedFile {
  /** Path relative to the project root, e.g. "app/page.tsx" */
  path: string;
  /** File content as a UTF-8 string (binary assets excluded from this type) */
  content: string;
  /** Binary content for downloaded assets */
  binary?: Uint8Array;
}

/** Symbol map built once in plan.ts and shared across all emitters */
export interface SymbolMap {
  /** variable uuid or name -> JS identifier (camelCase, safe) */
  vars: Map<string, string>;
  /** collection/datasource uuid -> JS identifier */
  collections: Map<string, string>;
  /** workflow id/name -> JS function name */
  workflows: Map<string, string>;
  /** page route -> Next.js file path */
  routes: Map<string, string>;
}

/** Feature flags derived from the builder state — controls which deps go into package.json */
export interface FeatureFlags {
  hasForms: boolean;
  hasPopovers: boolean;
  hasAnimations: boolean;
  hasCharts: boolean;
  hasMarkdown: boolean;
  hasLottie: boolean;
  hasQR: boolean;
  hasToast: boolean;
  hasFetch: boolean;
  hasGraphQL: boolean;
  hasAuth: boolean;
  hasGoogleMap: boolean;
  hasHtmlContent: boolean;
  hasVideo: boolean;
  hasIframe: boolean;
  hasSearchParamSync: boolean;
  hasPersistedVars: boolean;
  hasComputedValues: boolean;
  hasDarkMode: boolean;
  hasThemeActions: boolean;
}

/** Full codegen context passed to every emitter */
export interface CodegenCtx {
  store: BuilderStore;
  symbols: SymbolMap;
  flags: FeatureFlags;
  /** Custom vars indexed by name */
  varsByName: Map<string, CustomVar>;
  /** Custom vars indexed by id (UUID) */
  varsById: Map<string, CustomVar>;
  /** Data sources indexed by id */
  dsById: Map<string, DataSourceConfig>;
  /** Data sources indexed by storeIn path */
  dsByStoreIn: Map<string, DataSourceConfig>;
  /** Custom colors */
  customColors: CustomColor[];
}
