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

/**
 * Metadata for a standalone input node extracted into a narrow-selector sub-component.
 * Used during codegen to skip the inline <input> element and emit a sub-component call instead.
 */
export interface InputVarInfo {
  nodeId: string;
  varKey: string;       // e.g. 'a1f97868-...-value'
  subCompName: string;  // e.g. '_InputLive_a1f97868'
  isTextarea: boolean;
  className: string;    // static Tailwind class (empty if dynamic — fallback to plain input)
  typeAttr: string;     // 'text' | 'email' | 'password' | etc.
  placeholder: string;  // static placeholder text (empty if dynamic)
  initialValue?: string; // from node._initialValue — seeds the Zustand selector fallback
}

/**
 * Metadata for a live-indicator Text node extracted into a narrow-selector sub-component.
 * The indicator reads from the same value variable as its paired input.
 */
export interface LiveIndicatorInfo {
  nodeId: string;
  varKey: string;       // which input var key this displays
  subCompName: string;  // e.g. '_LiveVar_lv_input_field'
  rawFormula: string;   // original formula before rewrite — used to generate _display expression
  className: string;    // static class string for the wrapping element
}

/**
 * Metadata for a Text node inside a FormContainer that displays form data
 * (formula references local.data.form.formData). Extracted into a narrow-selector
 * sub-component so the page doesn't re-render on every form keystroke.
 */
export interface FormDataDisplayInfo {
  nodeId: string;
  subCompName: string;
  /** Zustand store key for the form state, e.g. "form-demo-form" */
  formKey: string;
  /**
   * Raw formula from the config. For inside-form nodes uses `local?.data?.form?.formData`;
   * for outside-form nodes uses `variables?.['formKey']`.
   * Empty string when the node has static text content (condition-only node).
   */
  rawFormula: string;
  /** Raw condition formula, e.g. "variables?.['form-demo-form']?.['isSubmitted']" */
  rawCondition?: string;
  /** Static text when the node has a literal string rather than a formula */
  staticText?: string;
  className: string;
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
  /**
   * Per-page: input nodes that have been extracted into narrow-selector sub-components.
   * Set by routing.ts before calling emitNode; read in nodes.ts emitNodeInner.
   */
  inputVarNodeIds?: Set<string>;
  inputVarInfoMap?: Map<string, InputVarInfo>;
  /** Per-page: live-indicator Text nodes paired with an extracted input sub-component. */
  liveIndicatorNodeIds?: Map<string, LiveIndicatorInfo>;
  /**
   * Per-page: Text nodes inside FormContainer that display form data (formData key).
   * Extracted as sub-components so typing in form inputs does not re-render the page.
   */
  formDataDisplayNodeIds?: Map<string, FormDataDisplayInfo>;
}
