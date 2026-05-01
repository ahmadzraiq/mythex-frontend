/**
 * SDUI node and action types - JSON tree structure
 */

import type { SetStatePayload, FetchPayload, NavigatePayload } from './payloads';

/** Condition: formula string, e.g. "cart.count > 0" or "{{demo.number}} >= 60" */
type ConditionValue = string | Record<string, unknown>;

/** Builder-palette component types - AI can generate any of these.
 *  Keep in sync with `lib/sdui/component-registry.tsx` and `config/component-names.ts`. */
export type SDUIComponentType =
  | 'Box'
  | 'Text'
  | 'Icon'
  | 'Image'
  | 'Video'
  | 'FormContainer'
  | 'Input'
  | 'InputField'
  | 'Textarea'
  | 'TextareaInput'
  | 'Iframe'
  | 'Chart'
  | 'QRCodeWidget'
  | 'MarkdownViewer'
  | 'GoogleMap'
  | 'GoogleMapPlaces'
  | 'LottiePlayer'
  | 'HtmlContent';

/** Data source - fetch from API and store in state */
export interface SDUIDataSource {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  key: string; // state key to store response
  /** Refetch when this state path changes */
  dependsOn?: string;
  /** Condition - only fetch when truthy (formula string) */
  when?: ConditionValue;
}

/** Action definition for event handlers - action can be any string (resolved from actions.json) */
export interface SDUIAction {
  action: string;
  payload?: SetStatePayload | FetchPayload | NavigatePayload | Record<string, unknown>;
}

// ─── Responsive breakpoints ────────────────────────────────────────────────────

/** Desktop-first breakpoint keys (desktop is base, not listed here) */
export type BreakpointKey = 'laptop' | 'tablet' | 'mobile';

/** Cascade order: laptop inherits desktop, tablet inherits laptop, mobile inherits tablet */
export const BREAKPOINT_CASCADE: BreakpointKey[] = ['laptop', 'tablet', 'mobile'];

/** Breakpoint max-width thresholds (desktop-first: value means "below this width") */
export const BREAKPOINT_MAX_WIDTHS: Record<BreakpointKey, number> = {
  laptop: 1280,
  tablet: 1024,
  mobile: 768,
};

/**
 * Per-breakpoint overrides for a node. Only properties explicitly set here
 * override the base; everything else cascades from the nearest ancestor
 * breakpoint (desktop → laptop → tablet → mobile).
 */
export interface ResponsiveOverride {
  /** Per-CSS-property style overrides (e.g. { flexDirection: 'column', gap: '16px' }).
   *  null = explicitly remove this property at this breakpoint. */
  styles?: Record<string, string | number | null>;
  /** Condition override. false = hide at this breakpoint. null = remove condition (always show). */
  condition?: ConditionValue | false | null;
  /** Text override for this breakpoint */
  text?: string | { formula: string | object; suffix?: string; prefix?: string; template?: string };
  /** Shallow-merged into base props at this breakpoint */
  props?: Record<string, unknown>;
  /** Merged into props.style at this breakpoint */
  style?: Record<string, unknown>;
  /** Responsive disabled-overlay overrides. Each field cascades independently.
   *  null = explicitly remove that field at this breakpoint (reset to base). */
  _disabledOverlay?: {
    color?: string | null;
    opacity?: number | null;
    blur?: number | null;
  };
  /** Sparse animation-config overrides. Currently only `filter.blur` is supported.
   *  null = explicitly remove the value at this breakpoint (do not inherit). */
  animation?: {
    filter?: {
      blur?: number | null;
    };
  };
}

// ─── Popover / Tooltip config ────────────────────────────────────────────────

export type PopoverPlacement =
  | 'top' | 'top-start' | 'top-end'
  | 'bottom' | 'bottom-start' | 'bottom-end'
  | 'left' | 'left-start' | 'left-end'
  | 'right' | 'right-start' | 'right-end';

export interface PopoverConfig {
  trigger: 'click' | 'hover';
  placement: PopoverPlacement;
  /** Pixel gap between trigger and floating content (default: 4) */
  offset?: number;
  /** Close when clicking outside the floating content (default: true) */
  closeOnOutsideClick?: boolean;
  /** Close when pressing Escape (default: true) */
  closeOnEscape?: boolean;
  /** Set floating content min-width to match trigger width — useful for dropdowns */
  matchTriggerWidth?: boolean;
  /** Variable UUID — when set, open/close state syncs to this variable for programmatic control */
  openVariable?: string;
  /** Shared component reference — alternative to inline content */
  componentId?: string;
}

/** Single UI node in the JSON tree */
export interface SDUINode {
  type: SDUIComponentType;
  /** Stable identifier — used by visual builder for selection & annotation */
  id?: string;
  /** User-visible display name shown in the formula editor's component picker */
  name?: string;
  key?: string;
  condition?: ConditionValue;
  map?: string;
  props?: Record<string, unknown>;
  className?: string;
  children?: SDUINode[];
  text?: string | { formula: string | object; suffix?: string; prefix?: string; template?: string };
  src?: string;
  alt?: string;
  /**
   * Action handlers.
   * Array format (preferred): each item is a workflow ref; trigger is read from the workflow
   * definition and the correct event (click/change/valueChange/etc.) is bound automatically.
   * Object format (legacy): keys are event names, values are action refs.
   */
  actions?: SDUIAction[] | Record<string, SDUIAction | SDUIAction[]>;
  /** Data source - fetch on mount when this node is rendered */
  dataSource?: SDUIDataSource;
  /** Initial value for form field — used by FormContainer.registerField on mount */
  _initialValue?: unknown;
  /** Overlay rendered on top of the element when props.disabled is truthy */
  _disabledOverlay?: { color?: string; opacity?: number; blur?: number };
  /** When disabled is formula-bound, force the overlay to render in the builder canvas */
  _forceDisabledInEditor?: boolean;
  /**
   * Responsive overrides — desktop-first cascade.
   * Desktop is the base (no key needed). Each breakpoint key overrides only the
   * properties it specifies; everything else inherits from the nearest larger breakpoint.
   */
  responsive?: Partial<Record<BreakpointKey, ResponsiveOverride>>;
  /** Floating panel — click-triggered dropdown/context menu, or hover-triggered tooltip */
  popover?: PopoverConfig;
  /** Marks this Box as the popover content container (rendered in the floating panel) */
  _popoverContent?: boolean;
}
