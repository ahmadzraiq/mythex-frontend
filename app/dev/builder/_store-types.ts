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
  /** The first user message sent to this agent (contains inline tree, varRoster, original request, etc.) */
  userMessage?: string;
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
  /** Compact tree + variable roster sent to all parallel agents — populated by structure_context SSE event */
  structureContext?: { compactTree: string; varRoster: string };
  /** Full build plan (mode, flags, units) — populated by build_plan SSE event */
  buildPlan?: { mode: string; needsStyling?: boolean; needsBinding?: boolean; needsWorkflows?: boolean; editSummary?: string; buildUnits: unknown[] };
  /** Repeat/condition/direction markers extracted by the structure agent — populated by structure_markers SSE event */
  structureMarkers?: Array<{ nodeId: string; loop?: string | boolean; loopKey?: string; showIf?: string; direction?: string }>;
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
  /** Per-page URL query parameter definitions (name + test value for builder preview). */
  queryParams?: Array<{ name: string; value: string }>;
  /** World-space X position of the page frame (top-left corner). Used for free canvas layout. */
  wx: number;
  /** World-space Y position of the page frame (top-left corner). Used for free canvas layout. */
  wy: number;
  // ── Access control ──────────────────────────────────────────────────────────
  /** Who can access this page. 'everyone' = public, 'authenticated' = logged-in only. */
  access?: 'everyone' | 'authenticated';
  /** Optional JS formula for fine-grained access (role/permission/plan).
   *  Evaluated after the auth check. Falsy → redirect to authConfig.unauthorizedRedirect. */
  accessCondition?: string;
  /** If true, authenticated users are redirected away (e.g. /sign-in, /register pages). */
  guestOnly?: boolean;
}

/** Global authentication configuration stored in the builder project. */
export interface AuthRole {
  id: string;
  name: string;
  createdAt: number;
}

export interface AuthUserGroup {
  id: string;
  name: string;
  roles: string[];  // role ids
  createdAt: number;
}

export interface AuthConfig {
  tokenType?: 'bearer' | 'basic' | 'custom';
  tokenStorageKey?: string;
  userQuery?: string;
  userQueryEndpoint?: string;
  userQueryHeaders?: Record<string, string>;
  userEndpoint?: string;
  refreshEndpoint?: string;
  unauthenticatedRedirect?: string;
  unauthorizedRedirect?: string;
  authenticatedRedirect?: string;
  roleProperty?: string;
  roles?: AuthRole[];
  userGroups?: AuthUserGroup[];
}

/**
 * A single global history snapshot — covers ALL pages + freeform canvas nodes.
 * Replaces the old per-page SDUINode[][] history format.
 */
export interface HistorySnapshot {
  /** Per-page state keyed by pageId */
  pages: Record<string, { nodes: SDUINode[]; wx: number; wy: number }>;
  /** Freeform canvas nodes (outside any page frame) */
  canvasNodes: SDUINode[];
  /** Snapshot of all shared component models so rename/delete/property changes are undoable */
  sharedComponents?: Record<string, unknown>;
}

/**
 * A freeform canvas node that lives outside any page frame.
 * The _cx/_cy store world-space position; _cw/_ch optional captured size. Stripped before export / when moving back to a page.
 */
export interface CanvasNode extends SDUINode {
  _cx: number;
  _cy: number;
  /** Captured rendered size (world px) so w-full children keep width off-page */
  _cw?: number;
  _ch?: number;
  /** Original className before stripping absolute positioning (restored on drop-back) */
  _originalCls?: string;
  /** Original inline style before stripping position props (restored on drop-back) */
  _originalStyle?: Record<string, unknown>;
}

// ─── Workflow types ────────────────────────────────────────────────────────────

// ─── Global Formula types ──────────────────────────────────────────────────────

export interface GlobalFormulaParam {
  id: string;
  name: string;
  type: 'Text' | 'Number' | 'Boolean' | 'Object' | 'Array';
  /** Test value shown in the formula editor PARAMETERS section when editing the formula body */
  testValue?: unknown;
}

export interface GlobalFormulaDef {
  /** Human-readable display name (also used as the function name — no spaces) */
  name: string;
  folder?: string;
  description?: string;
  /** Positional parameters — mapped in order when the formula is called as a function */
  params: GlobalFormulaParam[];
  /** JS expression string, may reference parameters?.['paramName'] */
  formula: string;
}

export interface WorkflowParam {
  id: string;
  name: string;
  type: 'Text' | 'Number' | 'Boolean' | 'Object' | 'Array';
  /** When true, the param accepts multiple values (stored as an array) */
  allowMultiple?: boolean;
  /** Test value used in the formula editor preview when editing the global workflow */
  testValue?: unknown;
}

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
  /**
   * True for workflows created via the Triggers tab (appLoad, pageLoad, scroll, etc.).
   * These are page-level workflows but should NOT appear in the right panel's
   * WorkflowsSection or the Logic tab.
   */
  isTrigger?: boolean;
  /**
   * For page-scoped trigger workflows: the route config name (e.g. "home", "product")
   * that this trigger should fire on. Empty / undefined = fires on all pages.
   */
  pageScope?: string;
  /** Declared input parameters for global workflows */
  params?: WorkflowParam[];
}

export type WorkflowCanvasTarget =
  | { kind: 'element'; nodeId: string; event: string }
  | { kind: 'pageTrigger'; trigger: string }
  | { kind: 'pageWorkflow'; name: string; isNew?: boolean; nodeId?: string }
  | { kind: 'globalWorkflow'; id: string; isNew?: boolean }
  /** A workflow scoped to a shared component model. */
  | { kind: 'componentWorkflow'; modelId: string; workflowId: string; isNew?: boolean };

// ─── Full store shape ──────────────────────────────────────────────────────────

export interface BuilderStore {
  // ── Multi-page state ────────────────────────────────────────────────────────
  pages: BuilderPage[];
  /** The page currently shown in the Layers panel and targeted by node operations.
   *  Auto-updates when the user clicks a node on any page. */
  focusedPageId: string;
  /** @deprecated Use focusedPageId. Alias kept for backward compat. */
  currentPageId: string;
  /** Set of page IDs whose nodes have been fetched from the backend. */
  loadedPageIds: Set<string>;

  // ── Freeform canvas nodes (outside any page frame) ─────────────────────────
  /** Nodes placed freely on the canvas, not inside any page. */
  canvasNodes: CanvasNode[];

  // ── Page state (active page working copy) ───────────────────────────────────
  pageNodes: SDUINode[];

  /** Snapshot of pageNodes before entering edit mode — restored when all editors close */
  _savedPageNodes: SDUINode[] | null;

  // ── Shared Component edit mode ───────────────────────────────────────────────
  /**
   * The node ID (and page ID) the user was on when they entered component edit mode.
   * Used by "Back to instance" to restore the selection on exit.
   */
  _editEntrySelection: { nodeId: string; pageId: string } | null;
  /** IDs of ALL shared component models currently open for editing in the canvas */
  editingSharedComponentIds: string[];
  /** The most-recently-opened shared component being edited */
  editingSharedComponentId: string | null;
  /** Root content node map per shared component being edited (keyed by modelId) */
  editingSharedComponentContentsMap: Record<string, SDUINode>;
  /** Full shared component model map per component being edited (keyed by modelId) */
  editingSharedComponentModelsMap: Record<string, Record<string, unknown>>;
  /** Convenience alias: content of the most-recently-opened shared component */
  editingSharedComponentContent: SDUINode | null;
  /** Convenience alias: model of the most-recently-opened shared component */
  editingSharedComponentModel: Record<string, unknown> | null;
  /**
   * Pre-edit snapshot for SIMPLE edit mode (keyed by modelId).
   *
   * When the user enters simple edit mode on an instance A that has per-instance
   * overrides, we temporarily hide those overrides so the canvas + panel show
   * the pure MODEL view (matching user expectation of "entering the component").
   * The snapshot records A's pre-edit state so we can restore overrides on exit
   * for props the user didn't explicitly change while editing the model.
   */
  _preEditInstanceSnapshot: Record<string, {
    /** ID of the instance node (A) that was used as the simple-mode entry */
    instanceNodeId: string;
    /** A._overrides before we cleared them */
    instanceOverrides: string[];
    /** Snapshot of A's relevant props + animation (enough for copyCssProp to restore values) */
    instancePropsSnapshot: {
      className?: string;
      style?: Record<string, unknown>;
      animation?: Record<string, unknown>;
    };
    /**
     * Per-descendant overrides inside A's subtree (nested "hidden" overrides).
     *
     * Child nodes do NOT currently track `_overrides` explicitly — any cssProp
     * where the instance descendant's value differs from the corresponding model
     * descendant's value is treated as an effective override. We compute this
     * diff at entry time (sharedKey → cssProps + snapshot) so exit can restore
     * them even after the user edits the same cssProp inside the model in edit
     * mode, AND even after structural divergences (local insertions, removed
     * keys) have shifted the index-path alignment between instance and model.
     *
     * Descendants are matched by their stable `_sharedKey` (not by child-index
     * path) because the path of a descendant in the instance may not match the
     * path of the same descendant in the model whenever the instance has
     * structural divergences relative to the model.
     */
    descendantOverrides: Array<{
      sharedKey: string;
      cssProps: string[];
      propsSnapshot: {
        className?: string;
        style?: Record<string, unknown>;
        animation?: Record<string, unknown>;
      };
    }>;
    /** Deep clone of the model content BEFORE editing started (to detect what the user changed) */
    modelContentSnapshot: Record<string, unknown>;
    /** Snapshot of the instance's explicit `_descendantOverrides` map at enter time (Phase 3 metadata). */
    explicitDescendantOverrides?: Record<string, string[]>;
    /** Snapshot of the instance's `_removedKeys` at enter time (Phase 5 metadata). */
    removedKeys?: string[];
    /** Snapshot of the instance's `_localInsertions` at enter time (Phase 5 metadata). */
    localInsertions?: Array<{ parentSharedKey: string; atIdx: number; subtreeSharedKey: string }>;
    /**
     * Actual subtree payload for each local insertion at enter time,
     * keyed by `subtreeSharedKey`. The live subtree is removed from the
     * canvas on enter (so the user sees a pure model view); the saved
     * payload here lets exit re-graft the insertion back onto the live
     * instance at the original parent + position.
     */
    insertedSubtrees?: Record<string, Record<string, unknown>>;
  }>;
  /** Enter shared-component-edit mode.
   *  Pass `entryNodeId` to record which instance the user came from (for Back to instance).
   *  Pass `simple: true` to open the panel without inserting a backdrop/overlay into the canvas
   *  (the component stays in its normal position — used by the right-panel Edit button). */
  enterSharedComponentEdit: (modelId: string, content: SDUINode, model: Record<string, unknown>, entryNodeId?: string, simple?: boolean) => void;
  /** Exit shared-component-edit mode for a specific model (or the last opened if omitted) */
  exitSharedComponentEdit: (modelId?: string) => void;
  /** Save the current live state of a shared component being edited without exiting */
  saveEditingSharedComponent: (modelId: string) => void;

  // ── Selection ───────────────────────────────────────────────────────────────
  selectedIds: string[];
  /** When the selected node is a map/repeat template, which instance (0-based) is
   *  the primary selection. Other instances show a dim sibling outline in the overlay. */
  selectedMapIndex: number | null;
  hoveredId: string | null;
  /** When the hovered node is a map/repeat template, which instance is under the cursor. */
  hoveredMapIndex: number | null;
  altHoveredId: string | null;
  altMode: boolean;

  // ── Layer state ─────────────────────────────────────────────────────────────
  lockedIds: Set<string>;
  hiddenIds: Set<string>;
  expandedIds: Set<string>;

  // ── Popover builder preview ──────────────────────────────────────────────
  /** Keys are `popover:{nodeId}` — tracks which overlays are shown on canvas */
  shownPopovers: Set<string>;
  togglePopoverShown: (nodeId: string) => void;
  setPopoverConfig: (nodeId: string, config: Record<string, unknown> | null) => void;

  // ── Tool ────────────────────────────────────────────────────────────────────
  tool: 'select' | 'hand';

  // ── Viewport (zoom / pan) ───────────────────────────────────────────────────
  zoom: number;
  panX: number;
  panY: number;

  // ── Responsive viewport ──────────────────────────────────────────────────────
  viewport: ViewportSize;
  /** Active responsive editing breakpoint — linked to viewport by default.
   *  When editing at a non-desktop breakpoint, style changes go to responsive overrides. */
  activeBreakpoint: 'desktop' | 'laptop' | 'tablet' | 'mobile';

  // ── Grid overlay ─────────────────────────────────────────────────────────────
  gridOverlay: GridOverlayConfig;

  // ── Clipboard ───────────────────────────────────────────────────────────────
  clipboard: SDUINode[];

  // ── History ─────────────────────────────────────────────────────────────────
  /** Global history — each entry is a full snapshot of ALL pages + canvas nodes.
   *  Undo/redo restores the entire canvas state simultaneously. */
  history: HistorySnapshot[];
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
  select: (id: string | null, multi?: boolean, mapIndex?: number) => void;
  selectAll: () => void;
  selectParent: (id: string) => void;
  selectFirstChild: (id: string) => void;
  hover: (id: string | null, mapIndex?: number) => void;
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
  /** Set the active editing breakpoint (linked to viewport by default) */
  setActiveBreakpoint: (bp: 'desktop' | 'laptop' | 'tablet' | 'mobile') => void;
  /** Set a responsive override on a node for a specific breakpoint */
  patchResponsive: (id: string, breakpoint: 'laptop' | 'tablet' | 'mobile', field: string, value: unknown) => void;
  /** Remove a responsive override from a node (or entire breakpoint if field is omitted) */
  removeResponsiveOverride: (id: string, breakpoint: 'laptop' | 'tablet' | 'mobile', field?: string) => void;

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
  addPageAt: (name: string, wx: number, wy: number, initialNode?: SDUINode) => void;
  focusPage: (pageId: string) => void;
  /** Switch to a page AND signal the canvas to pan/zoom to it. */
  navigatePage: (pageId: string) => void;
  renamePage: (pageId: string, name: string) => void;
  removePage: (pageId: string) => void;
  /** Update the free-canvas position of a page frame. Pushes history. */
  movePagePosition: (pageId: string, wx: number, wy: number) => void;
  /** Auto-focus the page that contains a given node (for layers panel). No-op if not found. */
  focusPageForNode: (nodeId: string) => void;

  // Freeform canvas nodes
  /** Remove a node from its page and place it on the canvas at world coords (cx, cy). */
  moveNodeToCanvas: (nodeId: string, cx: number, cy: number, cw?: number, ch?: number) => void;
  /** Move a canvas node to a specific page, inserting at (parentId, atIdx). */
  moveCanvasNodeToPage: (nodeId: string, pageId: string, parentId: string | null, atIdx: number) => void;
  /** Update the world position of a freeform canvas node (during drag). */
  moveCanvasNodePosition: (nodeId: string, cx: number, cy: number) => void;

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
  /**
   * Detach a single shared-component instance subtree.
   * Strips _shared, _overrides, _descendantOverrides, _removedKeys,
   * _localInsertions, and _sharedKey from the node AND all of its
   * descendants. Leaves the SC model and all other instances untouched.
   * (Figma-style per-instance detach.)
   */
  detachInstance: (id: string) => void;
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
  /** Set per-page URL query parameter definitions for the current page */
  setCurrentPageQueryParams: (params: Array<{ name: string; value: string }>) => void;
  /** Set per-page access control (who can see the page, optional formula, guestOnly flag) */
  setCurrentPageAccess: (access: 'everyone' | 'authenticated', guestOnly: boolean, accessCondition?: string) => void;
  /** Global authentication configuration for the project */
  authConfig?: AuthConfig;
  /** Update the global auth configuration */
  setAuthConfig: (config: AuthConfig) => void;
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
  /** Global reusable formulas callable as functions — keyed by formula id */
  globalFormulas: Record<string, GlobalFormulaDef>;
  setPageWorkflow: (name: string, actions: object[]) => void;
  removePageWorkflow: (name: string) => void;
  setPageWorkflowMeta: (name: string, meta: Partial<WorkflowMeta>) => void;
  setGlobalWorkflow: (name: string, actions: object[]) => void;
  removeGlobalWorkflow: (name: string) => void;
  setGlobalWorkflowMeta: (id: string, meta: Partial<WorkflowMeta>) => void;
  /** Legacy — sets a formula by id (keeps name = id for backward compat) */
  setGlobalFormula: (id: string, def: GlobalFormulaDef | null) => void;
  /** Set a full GlobalFormulaDef by id, also syncing the evaluator registry */
  setGlobalFormulaFull: (id: string, def: GlobalFormulaDef | null) => void;
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
  /**
   * Propagate edits between a shared-component model and its instances.
   *
   * Behavior depends on whether the edited node lives under an active Edit
   * Component session (its `_shared.id` is in `editingSharedComponentIds`):
   *   - In edit-model mode: write the edited content to the model and
   *     propagate to every instance, preserving per-instance overrides
   *     (declared props + cssProps listed in each instance's `_overrides`).
   *   - Outside edit-model mode (instance-side edit): record the changed
   *     cssProps into that instance root's `_overrides` array. The model
   *     and other instances are NOT touched.
   *
   * `opts.prevEditedNode` is the snapshot of the edited node captured
   * immediately before the mutation — used to diff cssProps for override
   * tracking. When omitted (legacy callers), instance-side override recording
   * is skipped and the call becomes a no-op outside edit-model mode.
   */
  _syncSharedInstances: (editedNodeId: string, opts?: { prevEditedNode?: SDUINode | null }) => void;
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
