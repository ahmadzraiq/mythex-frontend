/**
 * env.ts — LoweringEnv: the context object threaded through every Babel-based
 * lowering pass.  Built from the module-globals in compile-page.ts at each
 * call site; no behaviour change to the JSX structural walker.
 */
import type * as t from '@babel/types'

// ---------------------------------------------------------------------------
// Map context stack entry — one entry per active .map() nesting level.
// Stack[0] is the OUTERMOST map; Stack[last] is the innermost (current).
// ---------------------------------------------------------------------------
export interface MapFrame {
  /** The callback param name used as the item accessor, e.g. "q" in .map((q, qi) => ...) */
  itemParam: string | undefined
  /** The index param name, e.g. "qi" */
  indexParam: string | undefined
  /** Block-body locals declared in the .map() callback (name → raw expression text) */
  locals: Map<string, string>
}

// ---------------------------------------------------------------------------
// LoweringEnv — everything the lowerers need to resolve an identifier.
// ---------------------------------------------------------------------------
export interface LoweringEnv {
  /**
   * DSL variable / workflow / page-path → UUID map.
   * Keys are either bare names ("myVar"), legacy paths ("store/myVar" or
   * "workflows/myWf"), or UUID strings (key === value).
   */
  pathToId: Map<string, string>

  /**
   * Page-local `const` declarations whose RHS should be emitted as a
   * const-preamble IIFE in formula mode.
   * name → raw initialiser expression text (not yet UUID-resolved).
   */
  pageLocals: Map<string, string>

  /**
   * Zero-arg page-level functions that can be called as `fn()` in formulas.
   * name → already-inlined IIFE string (pre-resolved by the old compiler).
   * Used for legacy compatibility; the Babel lowerer will also handle these.
   */
  localFns: Map<string, string>

  /**
   * Parameterised page-level functions: name → raw arrow/function text.
   * Inlined as IIFEs: `fn(a,b)` → `((p1,p2)=>body)(a,b)`.
   */
  localParamFns: Map<string, string>

  /**
   * Component prop names — when compiling a shared-component render fn,
   * bare prop references like `label` are rewritten to
   * `context.component?.props?.['label']`.
   */
  componentProps: string[]

  /**
   * Name of the event parameter in an event handler (e.g. "e" in onChange(e)).
   * `e.value` → `context.event?.value`.
   */
  eventParam: string | undefined

  /**
   * Nested .map() context stack.
   * Empty outside a map; push/pop as the JSX walker enters/exits map callbacks.
   */
  mapStack: MapFrame[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function makeEnv(overrides: Partial<LoweringEnv> = {}): LoweringEnv {
  return {
    pathToId: new Map(),
    pageLocals: new Map(),
    localFns: new Map(),
    localParamFns: new Map(),
    componentProps: [],
    eventParam: undefined,
    mapStack: [],
    ...overrides,
  }
}

/**
 * Derive a UUID-or-undefined for a bare identifier.
 * Returns undefined for workflow names (they are call-targets, not values).
 */
export function resolveVarUuid(name: string, env: LoweringEnv): string | undefined {
  for (const [key, uuid] of env.pathToId) {
    if (key === name && key !== uuid && !key.includes('/')) return uuid
  }
  return undefined
}

/**
 * Derive a workflow UUID for a bare identifier used as a call target.
 */
export function resolveWorkflowUuid(name: string, env: LoweringEnv): string | undefined {
  const wfKey = `workflows/${name}`
  for (const [key, uuid] of env.pathToId) {
    if (key === wfKey) return uuid
  }
  // Fall back: a plain name that maps to a UUID that doesn't appear under any 'store/'  prefix
  for (const [key, uuid] of env.pathToId) {
    if (key === name && key !== uuid && !key.includes('/')) {
      // Prefer workflow if the same name isn't a known variable in pathToId under 'store/'
      const hasVarPath = [...env.pathToId.keys()].some(k => k.startsWith('store/') && k.endsWith(`/${name}`))
      if (!hasVarPath) return uuid
    }
  }
  return undefined
}

/**
 * Current map depth (0 = outside any map).
 */
export function mapDepth(env: LoweringEnv): number {
  return env.mapStack.length
}

/**
 * The innermost (current) map frame, or undefined outside maps.
 */
export function currentMapFrame(env: LoweringEnv): MapFrame | undefined {
  return env.mapStack.length ? env.mapStack[env.mapStack.length - 1] : undefined
}

/**
 * Frame at depth `d` from the bottom (0 = outermost, mapStack.length-1 = innermost).
 */
export function mapFrameAt(env: LoweringEnv, d: number): MapFrame | undefined {
  return env.mapStack[d]
}
