/**
 * _store-types.ts
 *
 * All TypeScript interfaces and types for the builder Zustand store.
 * Extracted from _store.ts to allow type-only imports without loading
 * the full store implementation.
 *
 * Import these types directly instead of _store.ts when you only need the shapes:
 *   import type { DataSourceConfig, WorkflowMeta } from './_store-types';
 *
 * _store.ts re-exports everything here for backward compat.
 */

import type { SDUINode } from '@/lib/sdui/types/node';

// ─── AI Model registry ─────────────────────────────────────────────────────────

export const BUILDER_MODELS = [
  { id: 'claude-haiku-4-5',  label: 'Haiku',  description: 'Fast & efficient', supportsThinking: false },
  { id: 'claude-sonnet-4-5', label: 'Sonnet', description: 'Smart + reasoning',  supportsThinking: true  },
] as const;

export type BuilderModelId = typeof BUILDER_MODELS[number]['id'];

// ─── AI Chat types ─────────────────────────────────────────────────────────────

export interface AiToolCall {
  name: string;
  input: Record<string, unknown>;
  result?: unknown;
  status?: 'pending' | 'success' | 'error' | 'generating';
  /** Which pipeline phase emitted this tool call — used for grouped display in the chat panel */
  phase?: 'planning' | 'structure' | 'media' | 'styling' | 'animation' | 'styling:layout' | 'styling:colors' | 'styling:typo' | 'workflows' | 'binding';
  /** client Date.now() when the event was received — used for per-phase duration display */
  timestamp?: number;
  /** Which Anthropic API round produced this tool (1-based) */
  round?: number;
  /** True when client-side execution failed but the AI was told "pending: ok" — AI is blind to this failure */
  aiBlind?: boolean;
}

export interface AgentDebugInfo {
  agent: string;
  systemPrompt: string;
  tools: string[];
  syntheticMessageCount: number;
  startedAt: number;
  endedAt?: number;
  rounds?: number;
  toolCallCount?: number;
  duration?: number;
  toolCalls: AiToolCall[];
}

export type AiChatRole = 'user' | 'assistant' | 'system';

export interface AiImageResult {
  url: string;
  alt?: string;
  thumbUrl?: string;
  photographer?: string;
}

export interface AiIconResult {
  id: string;
  name: string;
  prefix: string;
}

export interface AiChatMessage {
  id: string;
  role: AiChatRole;
  content: string;
  toolCalls?: AiToolCall[];
  /** ISO date string */
  createdAt: string;
  /** Node IDs referenced in this message */
  selectedNodeIds?: string[];
  /** Whether this message is currently streaming */
  streaming?: boolean;
  /** Whether AI is between rounds (waiting for next Anthropic response) */
  isThinking?: boolean;
  /** Whether this message is in edit-rewind mode (user clicked ✎) */
  isEditing?: boolean;
  /** Extended thinking text (Sonnet only) — streamed via thinking_delta events */
  thinkingContent?: string;
  /** Image search results from search_images tool */
  imageResults?: AiImageResult[];
  /** Icon search results from search_icons tool */
  iconResults?: AiIconResult[];
  /** Build mode progress — current phase */
  buildPhase?: 'planning' | 'editing' | 'building' | 'wiring' | 'structure' | 'parallel';
  /** Total number of sections/units in the current build */
  buildTotal?: number;
  /** How many sections have been completed so far */
  buildDone?: number;
  /** Name of the section currently being inserted */
  buildCurrentName?: string;
  /** Ordered log of all build_phase events with human-readable messages (for debug) */
  phaseLog?: Array<{ phase: string; message: string; at: number }>;
  /** How many Anthropic API round-trips were made for this assistant turn (for debug) */
  roundCount?: number;
  /** Ordered log of all section_progress events (for debug) */
  sectionsLog?: Array<{ done: number; total: number; name: string }>;
  /** AI's build plan — sections decided before structure phase (for debug) */
  buildPlanUnits?: Array<{ name: string; description: string; pageRoute: string; sectionCount?: number }>;
  /** Per-agent debug info — populated by agent_context and agent_complete SSE events */
  agentDebugInfo?: Record<string, AgentDebugInfo>;
}

// ─── Viewport ─────────────────────────────────────────────────────────────────

export interface GridOverlayConfig {
  enabled: boolean;
  type: 'columns' | 'rows' | 'grid';
  count: number;
  color: string;
}

export type ViewportSize = 'mobile' | 'tablet' | 'laptop' | 'desktop';

export const VIEWPORT_WIDTHS: Record<ViewportSize, number> = {
  mobile:  390,
  tablet:  768,
  laptop:  1024,
  desktop: 1280,
};

// ─── Workflow Test Results ─────────────────────────────────────────────────────

export interface WorkflowTestEntry {
  result: unknown;
  error: unknown;       // full error object (Axios error, Error, string, or null)
  actionName: string;   // display name shown in formula picker header
  stepIndex: number;
  ranAt: number;
  workflowId: string;   // which workflow this result belongs to (scopes formula picker results)
}

// ─── Data Source Config ────────────────────────────────────────────────────────

export interface DataSourceHeader { key: string; value: string; enabled?: boolean; }

export interface DataSourceParam { key: string; value: string; enabled: boolean; }

export interface DataSourceAuth {
  type: 'none' | 'bearer' | 'basic' | 'apikey';
  token?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  apiKeyHeader?: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface CustomVar {
  /** UUID key from config/variables.json (only set for config-driven variables) */
  id?: string;
  name: string;
  label?: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'form';
  initialValue?: unknown;
  description?: string;
  saveInLocalStorage?: boolean;
  folderId?: string;
  /** For form-type variables: field definitions */
  fields?: Array<{ name: string; type?: string; initialValue?: unknown; validation?: Record<string, unknown> }>;
}

export interface DataSourceConfig {
  id: string;
  name: string;
  type: 'rest' | 'graphql';
  // REST
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: DataSourceHeader[];
  body?: string;
  queryParams?: DataSourceParam[];
  auth?: DataSourceAuth;
  // GraphQL
  endpoint?: string;
  query?: string;
  variables?: string;
  // Common
  responsePath?: string;
  storeIn?: string;
  trigger?: 'mount' | 'action';
  triggerActionName?: string;
  /** Proxy the request through the server to avoid CORS issues. */
  proxy?: boolean;
  /** Include credentials (cookies) in the request. */
  sendCredentials?: boolean;
  /** Human-readable display label (from config label field) */
  _label?: string;
  /** Whether this datasource came from config/datasources.json */
  _fromConfig?: boolean;
  /** Origin actions/*.json file name (without .json) — used for write-back */
  _sourceFile?: string;
  /** Last manual fetch result — persisted so the result panel reopens on edit */
  _lastFetch?: { status: 'success' | 'error'; data?: unknown; error?: string; fetchedAt?: number };
  folderId?: string;
}

// ─── Page types ────────────────────────────────────────────────────────────────

export interface PageMeta {
  title?: string;
  description?: string;
  ogImage?: string;
}

export interface BuilderPage {
  id: string;
  name: string;
  /** App route path — omitted for builder-internal canvases (e.g. Component Showcase). */
  route?: string;
  nodes: SDUINode[];
  /** Flat key-value dummy data for the "Data" preview state.
   *  Keys match Zustand data paths (e.g. "cart.totalQuantity", "cart.lines"). */
  previewData?: Record<string, unknown>;
  /** Page-level SEO / meta fields */
  meta?: PageMeta;
  /** Page-level interactions keyed by event name (e.g. "mount") */
  pageInteractions?: Record<string, { workflow?: string }>;
}

// ─── Workflow types ────────────────────────────────────────────────────────────

export interface WorkflowMeta {
  id: string;
  name: string;
  folder?: string;
  description?: string;
  /** Event trigger (click, change, valueChange, created, etc.) */
  trigger?: string;
  /**
   * True for auto-generated "set field value on change" workflows — these are
   * system-managed and should not appear as user-editable entries in the right panel.
   */
  isSystem?: boolean;
}

export type WorkflowCanvasTarget =
  | { kind: 'element'; nodeId: string; event: string }
  | { kind: 'pageTrigger'; trigger: string }
  | { kind: 'pageWorkflow'; name: string; isNew?: boolean; nodeId?: string }
  | { kind: 'globalWorkflow'; id: string; isNew?: boolean };

// ─── Full store shape ──────────────────────────────────────────────────────────

export interface BuilderStore {
  // ── Multi-page state ────────────────────────────────────────────────────────
  pages: BuilderPage[];
  currentPageId: string;
  /** Set of page IDs whose nodes have been fetched from the backend. */
  loadedPageIds: Set<string>;

  // ── Page state (active page working copy) ───────────────────────────────────
  pageNodes: SDUINode[];

  // ── Popup edit mode ─────────────────────────────────────────────────────────
  /** IDs of ALL popup models currently open for editing in the canvas */
  editingPopupIds: string[];
  /** The most-recently-opened editing popup — used for right-panel fallback */
  editingPopupId: string | null;
  /** Root content node map per popup being edited (keyed by modelId) */
  editingPopupContentsMap: Record<string, SDUINode>;
  /** Full popup model map per popup being edited (keyed by modelId) */
  editingPopupModelsMap: Record<string, Record<string, unknown>>;
  /** Convenience alias: content of the most-recently-opened popup (right-panel compat) */
  editingPopupContent: SDUINode | null;
  /** Convenience alias: model of the most-recently-opened popup (right-panel compat) */
  editingPopupModel: Record<string, unknown> | null;
  /** Original page nodes saved on the FIRST enterPopupEdit call; cleared when all popups are closed */
  _savedPageNodes: SDUINode[] | null;
  /** Enter popup-edit mode: appends popup to pageNodes; supports multiple concurrent popup edits */
  enterPopupEdit: (modelId: string, content: SDUINode, model: Record<string, unknown>) => void;
  /** Exit popup-edit mode for a specific popup (or the last opened if omitted).
   *  Saves that popup to the API and removes its root node from pageNodes. */
  exitPopupEdit: (modelId?: string) => void;
  /** Save the current live state of a popup being edited to the API without exiting edit mode.
   *  Called automatically on a debounce whenever pageNodes changes during popup edit. */
  saveEditingPopup: (modelId: string) => void;

  // ── Selection ───────────────────────────────────────────────────────────────
  selectedIds: string[];
  hoveredId: string | null;
  altHoveredId: string | null;
  altMode: boolean;

  // ── Layer state ─────────────────────────────────────────────────────────────
  lockedIds: Set<string>;
  hiddenIds: Set<string>;
  expandedIds: Set<string>;

  // ── Tool ────────────────────────────────────────────────────────────────────
  tool: 'select' | 'hand';

  // ── Viewport (zoom / pan) ───────────────────────────────────────────────────
  zoom: number;
  panX: number;
  panY: number;

  // ── Responsive viewport ──────────────────────────────────────────────────────
  viewport: ViewportSize;

  // ── Grid overlay ─────────────────────────────────────────────────────────────
  gridOverlay: GridOverlayConfig;

  // ── Clipboard ───────────────────────────────────────────────────────────────
  clipboard: SDUINode[];

  // ── History ─────────────────────────────────────────────────────────────────
  history: SDUINode[][];
  historyIdx: number;

  // ── Actions ─────────────────────────────────────────────────────────────────

  // Page mutations
  addSection: (variantId: string, node: SDUINode, atIdx?: number) => void;
  addNode: (node: SDUINode, parentId?: string | null, atIdx?: number) => void;
  /** Insert a node into a specific page without switching the active page (used for parallel AI generation). */
  insertNodeIntoPage: (pageId: string, node: SDUINode) => void;
  /** Prepend a node (e.g. Nav) at the start of a specific page. */
  prependNodeIntoPage: (pageId: string, node: SDUINode) => void;
  /** Append a node (e.g. Footer) at the end of a specific page. */
  appendNodeIntoPage: (pageId: string, node: SDUINode) => void;
  /** Append a child node into an existing node (found by nodeId) — used for streaming AI generation. */
  appendChildToNode: (pageId: string, nodeId: string, child: SDUINode) => void;
  moveNode: (nodeId: string, newParentId: string | null, atIdx: number) => void;
  moveNodes: (nodeIds: string[], newParentId: string | null, atIdx: number) => void;
  deleteNodes: (ids: string[]) => void;
  duplicateNodes: (ids: string[]) => void;
  groupNodes: (ids: string[]) => void;
  moveSection: (fromIdx: number, toIdx: number) => void;
  moveNodeUp: (id: string) => void;
  moveNodeDown: (id: string) => void;
  patchProp: (id: string, propPath: string, value: unknown) => void;
  patchClassName: (id: string, oldToken: string, newToken: string) => void;
  renameNode: (id: string, newId: string) => void;

  // Selection
  select: (id: string | null, multi?: boolean) => void;
  selectAll: () => void;
  selectParent: (id: string) => void;
  selectFirstChild: (id: string) => void;
  hover: (id: string | null) => void;
  setAltMode: (on: boolean) => void;
  setAltHovered: (id: string | null) => void;

  // Layer toggles
  toggleVisibility: (id: string) => void;
  toggleLock: (id: string) => void;
  toggleExpanded: (id: string) => void;
  setExpandedIds: (ids: Set<string>) => void;

  // Tool
  setTool: (t: 'select' | 'hand') => void;

  // Viewport
  setZoom: (z: number) => void;
  setPan:  (x: number, y: number) => void;
  setViewport: (v: ViewportSize) => void;

  // Grid overlay
  setGridOverlay: (cfg: Partial<GridOverlayConfig>) => void;

  // Clipboard
  copyToClipboard: () => void;
  pasteFromClipboard: () => void;
  pasteInPlace: () => void;

  // Align / Distribute (reads live DOM rects, sets inline style.position/left/top)
  alignNodes: (ids: string[], edge: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  distributeNodes: (ids: string[], axis: 'h' | 'v') => void;

  // History
  undo: () => void;
  redo: () => void;

  // Cross-page move — removes node from a source page and inserts into the current page
  moveNodeFromPage: (nodeId: string, fromPageId: string, parentId: string | null, atIdx: number) => void;

  // Pages
  addPage: (route: string, name?: string, id?: string) => void;
  switchPage: (pageId: string) => void;
  /** Switch to a page AND signal the canvas to pan/zoom to it. */
  navigatePage: (pageId: string) => void;
  renamePage: (pageId: string, name: string) => void;
  removePage: (pageId: string) => void;

  // Canvas navigation trigger (set by navigatePage, consumed by _canvas.tsx)
  pendingFitToPage: boolean;
  clearPendingFit: () => void;

  // ── Logic / Behavior layer ───────────────────────────────────────────────────
  /** Which component states are being previewed on the canvas (builder-only mock). Multi-select supported. */
  activePreviewStates: string[];
  /** Show interaction lines on the canvas overlay */
  showInteractionLines: boolean;
  /** Signal to the Logic panel to scroll to / open a specific section */
  activeLogicSection: string | null;

  patchCondition: (id: string, condition: object | null) => void;
  patchActions: (id: string, actions: Record<string, unknown> | null) => void;
  patchMap: (id: string, mapPath: string | null, keyField?: string) => void;
  patchDataSource: (id: string, ds: Record<string, unknown> | null) => void;
  patchVariant: (id: string, variants: unknown[] | null) => void;
  /** Generic: patch any top-level or nested field on a node */
  patchNodeField: (id: string, field: string, value: unknown) => void;
  /** Same as patchNodeField but does NOT push to history — use for live drag updates.
   *  Call _pushHistory() once when the gesture ends (mouseup / blur / picker close). */
  patchNodeFieldLive: (id: string, field: string, value: unknown) => void;
  setPreviewState: (state: string) => void;
  togglePreviewState: (state: string) => void;
  setShowInteractionLines: (on: boolean) => void;
  openLogicSection: (section: string | null) => void;
  /** Set the dummy preview data for the current page (used by "Data" preview state) */
  setCurrentPagePreviewData: (data: Record<string, unknown>) => void;
  /** Set meta fields for the current page */
  setCurrentPageMeta: (meta: PageMeta) => void;
  /** Set page-level interactions for the current page */
  setCurrentPageInteractions: (interactions: Record<string, { workflow?: string }>) => void;
  /** Engine conventions loaded from store.json (graphqlEndpoint, graphqlHeaders, etc.) */
  engineConventions: {
    graphqlEndpoint?: string;
    graphqlHeaders?: Record<string, string>;
    graphqlCredentials?: string;
  };

  /** App-level global preview data shared across all pages (overridden per-page) */
  appPreviewData: Record<string, unknown>;
  /** Set global app-level preview data */
  setAppPreviewData: (data: Record<string, unknown>) => void;

  // ── Workflows & Formulas ─────────────────────────────────────────────────────
  /** Named workflows (per-page action sequences, keyed by workflow name) */
  pageWorkflows: Record<string, object[]>;
  /** Metadata (name, trigger, description) for each named workflow, keyed by name */
  pageWorkflowMeta: Record<string, WorkflowMeta>;
  /**
   * Direct actions (graphql, fetch, navigateTo, etc.) from config/actions/*.json, keyed by UUID.
   * Used by the workflow canvas to resolve ActionRefs to their real type (e.g. graphql)
   * instead of always showing them as "Call workflow".
   */
  directActionsMap: Record<string, Record<string, unknown>>;
  /** App-level workflows shared across all pages */
  globalWorkflows: Record<string, object[]>;
  /** Metadata (name, folder, description, params) for each global workflow, keyed by id */
  globalWorkflowMeta: Record<string, WorkflowMeta>;
  /** Named JSON Logic expressions usable as {{formula.name}} anywhere */
  globalFormulas: Record<string, object>;
  setPageWorkflow: (name: string, actions: object[]) => void;
  removePageWorkflow: (name: string) => void;
  setPageWorkflowMeta: (name: string, meta: Partial<WorkflowMeta>) => void;
  setGlobalWorkflow: (name: string, actions: object[]) => void;
  removeGlobalWorkflow: (name: string) => void;
  setGlobalWorkflowMeta: (id: string, meta: Partial<WorkflowMeta>) => void;
  setGlobalFormula: (name: string, expr: object) => void;
  removeGlobalFormula: (name: string) => void;

  // ── Workflow Test Results ─────────────────────────────────────────────────────
  /**
   * Persisted per-step test results from the "▶ Test" button in the workflow canvas.
   * Keyed by step ID. Survives page refresh (stored in localStorage).
   * Used by the formula picker's Workflow tab to show FROM ACTION N groups.
   */
  workflowTestResults: Record<string, WorkflowTestEntry>;
  setWorkflowStepTestResult: (stepId: string, result: unknown, error: unknown, stepIndex: number, actionName?: string, workflowId?: string) => void;

  // ── Workflow Canvas ───────────────────────────────────────────────────────────
  /** Which workflow is currently open in the full-screen canvas overlay */
  workflowCanvasTarget: WorkflowCanvasTarget | null;
  openWorkflowCanvas: (target: WorkflowCanvasTarget) => void;
  closeWorkflowCanvas: () => void;
  /** Live step tree from the open canvas — updated on every step add/remove/reorder.
   *  Used by the formula editor to build accurate step-index chips without waiting for save. */
  liveCanvasSteps: object[] | null;
  setLiveCanvasSteps: (steps: object[] | null) => void;

  // ── Folders ──────────────────────────────────────────────────────────────────
  /** Folders for organising variables */
  varFolders: Folder[];
  addVarFolder: (f: Folder) => void;
  updateVarFolder: (id: string, name: string) => void;
  removeVarFolder: (id: string) => void;
  /** Folders for organising data sources */
  dsFolders: Folder[];
  addDsFolder: (f: Folder) => void;
  updateDsFolder: (id: string, name: string) => void;
  removeDsFolder: (id: string) => void;

  // ── Custom Variables ─────────────────────────────────────────────────────────
  /** User-defined variables with an initial value and type */
  customVars: CustomVar[];
  addCustomVar: (v: CustomVar) => void;
  updateCustomVar: (name: string, patch: Partial<CustomVar>) => void;
  removeCustomVar: (name: string) => void;

  // ── Data Sources ─────────────────────────────────────────────────────────────
  /** Page-level API data sources (REST or GraphQL) */
  pageDataSources: DataSourceConfig[];
  /** Reverse lookup: datasourceUUID → actionUUID (from datasource-actions.json), for resolving old-format collectionName in fetchCollection steps */
  dsActionsMap: Record<string, string>;
  addPageDataSource: (cfg: DataSourceConfig) => void;
  updatePageDataSource: (id: string, patch: Partial<DataSourceConfig>) => void;
  removePageDataSource: (id: string) => void;

  // ── Theme overrides ──────────────────────────────────────────────────────────
  /** Light-mode CSS variable overrides (key = var name without --) */
  themeOverrides: Record<string, string>;
  /** Dark-mode CSS variable overrides (key = var name without --) */
  themeDarkOverrides: Record<string, string>;
  /** Install the Gluestack primary token bridge on page mount (no-op if already installed). */
  initTheme: () => void;
  patchTheme: (cssVar: string, value: string, mode?: 'light' | 'dark') => void;
  resetTheme: () => void;
  /** Apply a complete theme preset atomically — light colors, dark colors, and fonts. */
  applyThemePreset: (
    light: Record<string, string>,
    dark: Record<string, string>,
    fonts?: { heading?: string; body?: string },
  ) => void;

  /** Load Data Sources, Workflows, Variables, Formulas from the app config files via the API.
   *  Only runs if panels are empty (user hasn't manually edited), unless forceReload=true. */
  loadFromConfig: (projectId?: string) => Promise<void>;

  // ── AI Chat ──────────────────────────────────────────────────────────────────
  aiMode: boolean;
  aiChatHistory: AiChatMessage[];
  aiSelectedNodeIds: string[];
  aiGenerating: boolean;
  aiCurrentThreadId: string | null;
  /** Name of the tool currently being executed (shown in typing indicator) */
  aiCurrentTool: string | null;
  /** Currently selected AI model — persisted across sessions */
  aiSelectedModel: BuilderModelId;
  /** Message queued to be auto-sent when the chat panel opens (e.g. from wizard) */
  aiPendingMessage: string | null;

  toggleAiMode: () => void;
  setAiPendingMessage: (msg: string | null) => void;
  addAiChatMessage: (msg: AiChatMessage) => void;
  updateLastAiMessage: (patch: Partial<AiChatMessage>) => void;
  clearAiChat: () => void;
  setAiSelectedNodeIds: (ids: string[]) => void;
  setAiGenerating: (v: boolean) => void;
  setAiCurrentThreadId: (id: string | null) => void;
  setAiCurrentTool: (name: string | null) => void;
  setAiSelectedModel: (id: BuilderModelId) => void;
  /** Prepend older messages (for infinite scroll) at the start of aiChatHistory */
  cancelEditMessage: () => void;
  prependAiChatMessages: (msgs: AiChatMessage[]) => void;
  /** Remove a message and all messages after it (for edit/re-send) */
  truncateAiChatAt: (messageId: string) => void;

  // ── AI Project Context (from wizard — used by section generator) ─────────────
  /** Design mood selected by the user/AI in the wizard (e.g. "organic", "modern") */
  projectMood: string;
  /** Animation level 0-3 selected in wizard */
  projectAnimationLevel: number;
  /** Layout structure complexity 0-4 selected in wizard */
  projectLayoutStructure: number;
  /** Business description from wizard */
  projectDescription: string;
  /** App name from wizard */
  projectAppName: string;
  /** Business category id from wizard (e.g. "restaurant", "ecommerce") */
  projectCategory: string;
  setProjectContext: (ctx: {
    mood?: string;
    animationLevel?: number;
    layoutStructure?: number;
    description?: string;
    appName?: string;
    category?: string;
  }) => void;

  // Internal (debounce wrapper)
  _pushHistory: () => void;
  _setPageNodes: (nodes: SDUINode[]) => void;
  /** E2E only — resets undo/redo history to a single empty snapshot so tests start clean. */
  _clearHistory: () => void;
  // Overlay update callback — set by _canvas.tsx, called by _panel-right.tsx for imperative ring updates
  _requestOverlayUpdate: () => void;
  _setOverlayUpdateCallback: (fn: (() => void) | null) => void;
  // Lightweight ring-only update — skips fills/getComputedStyle; called from patchStyle RAF
  // with already-computed BCR so the overlay doesn't need to re-read the DOM.
  _requestRingUpdate: (elRect: DOMRect, frameRect: DOMRect) => void;
  _setRingUpdateCallback: (fn: ((elRect: DOMRect, frameRect: DOMRect) => void) | null) => void;
}
