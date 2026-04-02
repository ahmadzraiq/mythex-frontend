'use client';

/**
 * SDUI Renderer - Fine-grained reactivity
 * Each node subscribes only to the variables it uses - no unnecessary re-renders
 *
 * Prop-mutation helpers and element-wrapping utilities live in renderer-node-props.tsx.
 * This file is responsible only for the rendering lifecycle: state setup, map expansion,
 * hook orchestration, and JSX composition.
 */

import React, { memo, useSyncExternalStore, useContext, useEffect, useRef, useMemo } from 'react';
import { AnimatedNode } from './components/animated-node';
import type { AnimationConfig } from './components/animated-node';
import { FormContext, FormScopeContext } from './form-context';
import { getNestedValue } from './nested-utils';
import { trackFormFieldProps, useFormFieldRegistration, useExternalNodeValueSync, useExternalFormSync } from './form-field-tracker';
import { evaluateFormula } from './formula-evaluator';
import { getComponent } from './component-registry';
import { evaluateCondition, resolveProps, resolveText } from './utils';
import { createVariableStore, useVariablePaths } from './variable-store';
import { extractNodeDependencies } from './dependency-extractor';
import type { SDUINode, SDUIContext } from './types';
import { isScreenScopedPath } from './path-utils';
import { createGet } from './create-get';
import { bindActionsToProps } from './action-binding';
import { useBuilderMode } from './builder-context';
import { InputParentContext, useParentInputId } from './input-parent-context';
import { PARENT_CONTEXT_PROVIDER_TYPES } from './controlled-component-registry';
import {
  PRESS_ONLY_TYPES, CHANGE_TEXT_TYPES,
  applyFormContextBindings, applyStateOverrides, applyClassFormulas, applyAutofill,
  injectControlledProps, applyBuilderAnnotation,
  wrapWithClickHandler, renderWithDisabledOverlay,
  DataSourceWrapper,
} from './renderer-node-props';

/** Stable empty object for useSyncExternalStore fallback — avoids infinite loop from new {} each call */
const STABLE_EMPTY_OBJECT: Record<string, unknown> = {};

/**
 * Extract arbitrary-value Tailwind classes (e.g. `w-[1228px]`, `pt-[120px]`, `gap-[32px]`)
 * into equivalent inline style properties.
 *
 * Tailwind's JIT can only compile classes found in scanned source files. Classes that come
 * from JSON config at runtime are never compiled, so they would have no visual effect without
 * this fallback. Only numeric values (px, vh, vw, %) are extracted — color and CSS-variable
 * classes (bg-[#hex], text-[var(--x)]) are left to NativeWind to handle.
 *
 * The JSON remains class-only; this is purely a render-time enrichment.
 */
function classToInlineStyle(className: string | undefined): Record<string, string> {
  if (!className) return {};
  const style: Record<string, string> = {};

  // Handle non-arbitrary position and inset keywords (no [value] suffix).
  // These are bare Tailwind utilities compiled by JIT for source files but NOT for
  // JSON config — so we convert them to inline styles here as a fallback.
  const POSITION_KW: Record<string, string> = {
    absolute: 'absolute', relative: 'relative',
    fixed: 'fixed', sticky: 'sticky', static: 'static',
  };
  for (const tok of className.split(/\s+/)) {
    const clean = tok.startsWith('!') ? tok.slice(1) : tok;
    if (POSITION_KW[clean]) { style.position = POSITION_KW[clean]; }
    // inset-0 / inset-x-0 / inset-y-0 bare keywords → top/right/bottom/left = 0
    else if (clean === 'inset-0')   { style.top = style.right = style.bottom = style.left = '0px'; }
    else if (clean === 'inset-x-0') { style.left = style.right = '0px'; }
    else if (clean === 'inset-y-0') { style.top  = style.bottom = '0px'; }
  }

  for (const token of className.split(/\s+/)) {
    // Strip the ! importance prefix so "!bg-[#0f172a]" is handled the same as "bg-[#0f172a]"
    const clean = token.startsWith('!') ? token.slice(1) : token;
    const m = clean.match(/^([\w-]+)-\[(.+)\]$/);
    if (!m) continue;
    const [, prefix, value] = m;

    // Determine value category so we can apply the right CSS property below.
    const isNumeric  = /^-?\d/.test(value);           // 96px, 900px, 80vh, -10px
    const isHexColor = /^#[0-9a-fA-F]/.test(value);  // #0f172a, #cbd5e1
    const isCssFn    = /^\w[\w-]*\(/.test(value);     // rgb(...), rgba(...), hsl(...), var(--)

    switch (prefix) {
      // ── Numeric layout ────────────────────────────────────────────────────────
      case 'w':       if (isNumeric) { style.width        = value; } break;
      case 'h':       if (isNumeric) { style.height       = value; } break;
      case 'min-w':   if (isNumeric) { style.minWidth     = value; } break;
      case 'max-w':   if (isNumeric) { style.maxWidth     = value; } break;
      case 'min-h':   if (isNumeric) { style.minHeight    = value; } break;
      case 'max-h':   if (isNumeric) { style.maxHeight    = value; } break;
      case 'p':       if (isNumeric) { style.paddingTop = style.paddingRight = style.paddingBottom = style.paddingLeft = value; } break;
      case 'pt':      if (isNumeric) { style.paddingTop    = value; } break;
      case 'pr':      if (isNumeric) { style.paddingRight  = value; } break;
      case 'pb':      if (isNumeric) { style.paddingBottom = value; } break;
      case 'pl':      if (isNumeric) { style.paddingLeft   = value; } break;
      case 'px':      if (isNumeric) { style.paddingLeft   = style.paddingRight = value; } break;
      case 'py':      if (isNumeric) { style.paddingTop    = style.paddingBottom = value; } break;
      case 'm':       if (isNumeric) { style.marginTop = style.marginRight = style.marginBottom = style.marginLeft = value; } break;
      case 'mt':      if (isNumeric) { style.marginTop     = value; } break;
      case 'mr':      if (isNumeric) { style.marginRight   = value; } break;
      case 'mb':      if (isNumeric) { style.marginBottom  = value; } break;
      case 'ml':      if (isNumeric) { style.marginLeft    = value; } break;
      case 'mx':      if (isNumeric) { style.marginLeft    = style.marginRight = value; } break;
      case 'my':      if (isNumeric) { style.marginTop     = style.marginBottom = value; } break;
      case 'gap':     if (isNumeric) { style.gap           = value; } break;
      case 'gap-x':   if (isNumeric) { style.columnGap     = value; } break;
      case 'gap-y':   if (isNumeric) { style.rowGap        = value; } break;
      case 'top':     if (isNumeric) { style.top           = value; } break;
      case 'right':   if (isNumeric) { style.right         = value; } break;
      case 'bottom':  if (isNumeric) { style.bottom        = value; } break;
      case 'left':    if (isNumeric) { style.left          = value; } break;
      case 'inset':   if (isNumeric) { style.top = style.right = style.bottom = style.left = value; } break;
      case 'inset-x': if (isNumeric) { style.left = style.right = value; } break;
      case 'inset-y': if (isNumeric) { style.top  = style.bottom = value; } break;
      case 'opacity':     if (isNumeric) { style.opacity               = value; } break;
      // ── Border radius — matches styleToClassName inverse ─────────────────────
      case 'rounded':     if (isNumeric) { style.borderRadius           = value; } break;
      case 'rounded-tl':  if (isNumeric) { style.borderTopLeftRadius    = value; } break;
      case 'rounded-tr':  if (isNumeric) { style.borderTopRightRadius   = value; } break;
      case 'rounded-br':  if (isNumeric) { style.borderBottomRightRadius = value; } break;
      case 'rounded-bl':  if (isNumeric) { style.borderBottomLeftRadius = value; } break;
      // ── Z-index ───────────────────────────────────────────────────────────────
      case 'z':           if (isNumeric) { style.zIndex                 = value; } break;
      // ── Translate — stored as separate properties, combined into transform by the renderer ──
      case 'translate-x': if (isNumeric) { style.translateX = value; } break;
      case 'translate-y': if (isNumeric) { style.translateY = value; } break;

      // ── Colors — hex, rgb(...), var(--...), etc. ─────────────────────────────
      // bg-[#hex], bg-[rgb(...)], bg-[var(--theme-...)]
      case 'bg':
        if (isHexColor || isCssFn) style.backgroundColor = value;
        break;
      // text-[#hex] / text-[var(...)] → color; text-[16px] → fontSize
      case 'text':
        if (isHexColor || isCssFn) style.color = value;
        else if (isNumeric) style.fontSize = value;
        break;
      // border-[#hex] / border-[var(...)] → borderColor; border-[2px] → borderWidth
      case 'border':
        if (isHexColor || isCssFn) style.borderColor = value;
        else if (isNumeric) style.borderWidth = value;
        break;
    }
  }

  return style;
}

/** No-op subscribe — used by useSyncExternalStore when we don't need a subscription */
const NOOP_SUBSCRIBE_FN = (_cb: () => void) => () => {};

interface RendererContext {
  store: ReturnType<typeof createVariableStore>;
  mergedStore?: { getState: () => { merged: Record<string, unknown> }; subscribe: (cb: () => void) => () => void };
  mergedState?: Record<string, unknown>;
  runAction: SDUIContext['runAction'];
  fetchData: SDUIContext['fetchData'];
  actionsConfig?: Record<string, unknown>;
  screenName?: string;
  screenScopedAliases?: string[];
  /** Active preview state in builder mode — used to apply _stateOverrides per node */
  previewState?: string;
}

interface RendererProps {
  node: SDUINode;
  context: RendererContext;
  scope?: Record<string, unknown>;
  /** Stable tree path string used for builder node IDs (e.g. "0", "0-1", "0-1-2") */
  builderPath?: string;
}

const SDURendererInner = memo(function SDURendererInner({ node, context, scope, builderPath = '0' }: RendererProps) {
  const { builderMode } = useBuilderMode();
  const { store, mergedStore, mergedState, runAction, fetchData, actionsConfig, screenName, screenScopedAliases = [], previewState } = context;

  // Builder needs full subscription so preview-state patches (loading/error/disabled overlays
  // applied in applyBuilderPatches) immediately trigger a re-render on every setMerged call.
  //
  // Production: skip the blanket subscription — it causes O(N) re-renders per rAF tick because
  // Zustand always creates a new { merged: newObj } reference, making Object.is always fail for
  // every mounted SDURendererInner regardless of whether its deps changed. Instead, read merged
  // directly at render time; useVariablePaths (below) is the sole re-render scheduler and only
  // fires for components whose specific dep values actually changed.
  const mergedFromStore = useSyncExternalStore(
    builderMode && mergedStore ? mergedStore.subscribe : NOOP_SUBSCRIBE_FN,
    () => builderMode && mergedStore ? mergedStore.getState().merged : STABLE_EMPTY_OBJECT,
    () => STABLE_EMPTY_OBJECT,
  );
  const merged = mergedStore
    ? (builderMode ? mergedFromStore : mergedStore.getState().merged)
    : (mergedState ?? STABLE_EMPTY_OBJECT);

  // FormScopeContext: set by FormContainer — scopes local.data.form.* to the
  // nearest enclosing FormContainer's isolated store instead of the shared singleton.
  const activeFormKey = useContext(FormScopeContext);

  const rawDeps = extractNodeDependencies(node);
  const screenMappedDeps =
    screenName && rawDeps.some((p) => isScreenScopedPath(p, screenScopedAliases))
      ? rawDeps.map((p) => (isScreenScopedPath(p, screenScopedAliases) ? `screens.${screenName}.${p}` : p))
      : rawDeps;
  // When inside a FormContainer, redirect local.data.form.* subscriptions to the
  // per-container isolated store (variables['formKey'].*) so only this container's
  // state changes trigger re-renders for this node — not other containers' submits.
  const LOCAL_FORM = 'local.data.form';
  const deps = activeFormKey
    ? screenMappedDeps.map(p => {
        if (p === LOCAL_FORM) return `variables['${activeFormKey}']`;
        if (p.startsWith(LOCAL_FORM + '.')) return `variables['${activeFormKey}'].${p.slice(LOCAL_FORM.length + 1)}`;
        return p;
      })
    : screenMappedDeps;

  useVariablePaths(store, deps, scope, mergedStore);
  const get = createGet(store, merged, scope, mergedStore, screenName, screenScopedAliases);
  const storeState = store.getState().getFullState();
  const state = merged ? { ...storeState, ...merged } : storeState;
  const stateBase = scope
    ? {
        ...state,
        // Legacy scope vars — kept for backward compat
        $item: scope.$item, $index: scope.$index, $parent: scope.$parent,
        // Pass through the already-structured context.item built by the map loop above,
        // so context.item.data / context.item.parent / context.item.index all resolve correctly.
        context: scope.context ?? { item: scope.$item, index: scope.$index, parent: scope.$parent },
        // Spread any additional custom scope keys (e.g. `popup` for popup instances,
        // so {{popup.props.title}} resolves in templates and formula expressions).
        ...Object.fromEntries(
          Object.entries(scope).filter(([k]) => !['$item', '$index', '$parent', 'context'].includes(k))
        ),
      }
    : state;

  // Inject per-FormContainer local scope: override state.local so that any formula
  // or template expression using local.data.form.* resolves against THIS container's
  // isolated store (variables[formKey]) rather than the shared singleton.
  const formStateForScope = activeFormKey
    ? ((state.variables as Record<string, unknown> | undefined)?.[activeFormKey] as Record<string, unknown> | undefined) ?? null
    : null;
  const stateWithScope = formStateForScope
    ? { ...stateBase, local: { data: { form: formStateForScope } } }
    : stateBase;

  // Scoped getter: redirect local.data.form.* to the per-FC isolated store
  // so {{local.data.form.formData.x}} template interpolation also resolves correctly.
  const scopedGet = formStateForScope
    ? (path: string, s?: Record<string, unknown>) => {
        if (path === LOCAL_FORM) return formStateForScope;
        if (path.startsWith(LOCAL_FORM + '.')) return getNestedValue(formStateForScope, path.slice(LOCAL_FORM.length + 1));
        return get(path, s);
      }
    : get;

  const sduiContext: SDUIContext = {
    state: stateWithScope,
    setState: (updater) => store.getState().setState(updater),
    get: scopedGet,
    runAction,
    fetchData,
  };

  // Form field registration: handles all controlled components generically.
  // See lib/sdui/form-field-tracker.ts for the full implementation.
  const formCtx = useContext(FormContext);
  const parentInputId = useParentInputId();
  useFormFieldRegistration(node, formCtx, parentInputId);

  // External value sync: subscribes to the node's variable-store slot and returns
  // controlled React props. Active for all controlled types including those inside
  // FormContainer so that workflow writes (changeVariableValue) update every type.
  const { value: externalValue, isChecked: externalIsChecked } = useExternalNodeValueSync(node, formCtx, parentInputId);
  // Sync external writes back into FormContainer state (local.data.form.formData.*)
  // so form submission and formulas always read the latest value.
  useExternalFormSync(node, formCtx, parentInputId, externalValue, externalIsChecked);

  // Lifecycle triggers: collect actions with trigger "created" or "mounted" and run
  // them once on mount via useEffect. Skipped in builder mode to avoid side-effects.
  const lifecycleRefs = useMemo(() => {
    if (!node?.actions || !Array.isArray(node.actions)) return null;
    const out: unknown[] = [];
    for (const item of node.actions as Array<unknown>) {
      if (!item || typeof item !== 'object') continue;
      const actionRef = item as Record<string, unknown>;
      const wfName = typeof actionRef.action === 'string' ? actionRef.action : '';
      const wfDef = wfName ? actionsConfig?.[wfName] as Record<string, unknown> | undefined : undefined;
      const trigger = typeof wfDef?.trigger === 'string' ? wfDef.trigger : null;
      if (trigger === 'created' || trigger === 'mounted') out.push(item);
    }
    return out.length ? out : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.actions, actionsConfig]);

  const lifecycleRanRef = useRef(false);
  useEffect(() => {
    if (!lifecycleRefs || builderMode || lifecycleRanRef.current) return;
    lifecycleRanRef.current = true;
    for (const a of lifecycleRefs) {
      Promise.resolve(runAction(a as Parameters<typeof runAction>[0], undefined, scope)).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-once: lifecycle triggers fire exactly once when the node mounts

  if (!node) return null;

  // In builder mode, _forceShowInEditor bypasses any condition so the node is
  // always visible on the canvas regardless of its runtime condition.
  const forceShow = builderMode && (node as { _forceShowInEditor?: boolean })._forceShowInEditor === true;

  if (!forceShow) {
    // Cast to unknown first — condition can be false at runtime (builder sets it) even though
    // the ConditionValue type doesn't include boolean.
    if ((node.condition as unknown) === false) return null;
    if (node.condition != null && !evaluateCondition(node.condition, sduiContext)) {
      return null;
    }
  }

  if (node.map) {
    let arr: unknown[];
    if (typeof node.map === 'string') {
      arr = (get(node.map) as unknown[]) ?? [];
    } else if (node.map && typeof node.map === 'object' && ('expr' in node.map || 'formula' in node.map)) {
      const m = node.map as { expr?: string | object; formula?: string };
      const expr = 'expr' in m ? m.expr! : m.formula!;
      arr = (evaluateFormula(expr, stateWithScope).value as unknown[]) ?? [];
    } else {
      arr = [];
    }
    if (!Array.isArray(arr)) return null;

    // The outer repeat's context.item becomes the `parent` for nested repeats
    const outerItemCtx = (scope?.context as { item?: unknown } | undefined)?.item ?? null;

    return (
      <>
        {arr.map((item, index) => {
          // `data` = raw item fields + all repeat metadata under one key.
          // Canonical access: context.item?.['data']?.['productName'], context.item?.['data']?.['index'], etc.
          // Backward compat: raw item fields are also spread on context.item root so
          //   existing context.item?.['productName'] formulas still resolve.
          const dataCtx = {
            ...(typeof item === 'object' && item !== null ? (item as object) : {}),
            // For primitive items (string, number) expose the raw value under "value" so
            // {{context.item.data.value}} works for string-array repeats (e.g. feature lists).
            ...(typeof item !== 'object' || item === null ? { value: item } : {}),
            index,
            repeatIndex: index,
            isACopy: false,
            parent: outerItemCtx,
            repeatedItems: arr,
          };
          const itemCtx = {
            ...(typeof item === 'object' && item !== null ? (item as object) : {}),
            data: dataCtx,
            // top-level aliases kept for backward compat
            parent: outerItemCtx,
            index,
            repeatIndex: index,
            isACopy: false,
            repeatedItems: arr,
          };
          return (
            <SDURendererInner
              key={node.key ? `${node.key}-${index}` : index}
              node={{ ...node, map: undefined, key: node.key ? `${node.key}-${index}` : String(index) }}
              context={context}
              scope={{ ...scope, $item: item, $index: index, $parent: scope?.$item, context: { item: itemCtx, index, parent: outerItemCtx } }}
              builderPath={`${builderPath}-m${index}`}
            />
          );
        })}
      </>
    );
  }

  const Component = getComponent(node.type);
  if (!Component) {
    console.warn(`[SDUI] Unknown component type: ${node.type}`);
    return null;
  }

  const className = node.className ?? node.props?.className;
  const resolvedProps = resolveProps(
    {
      ...node.props,
      ...(node.id && { id: node.id }),
      ...(className && { className }),
      ...(node.src && { src: node.src }),
      ...(node.alt && { alt: node.alt }),
    },
    sduiContext,
    runAction,
    scope
  );

  const cleanProps = Object.fromEntries(
    Object.entries(resolvedProps).filter(([k]) => !k.startsWith('$') && k !== '_meta' && k !== 'animation')
  ) as Record<string, unknown>;

  // Map data-testid → testID so Gluestack Button surfaces it in the DOM.
  // React Native uses testID (rendered as data-testid by RN-Web); plain HTML elements
  // (e.g. Text → span) forward data-* directly, but Gluestack compound components may not.
  if ('data-testid' in cleanProps && !('testID' in cleanProps)) {
    cleanProps.testID = cleanProps['data-testid'];
  }

  // Apply each concern via named helpers — one function per responsibility.
  applyStateOverrides(node, cleanProps, previewState, builderMode);
  applyClassFormulas(node, cleanProps, sduiContext);
  applyAutofill(node, cleanProps, builderMode);

  Object.assign(cleanProps, bindActionsToProps(node.actions, runAction, actionsConfig, scope, node.type));
  applyFormContextBindings(node, cleanProps, formCtx, actionsConfig);
  trackFormFieldProps(node, cleanProps, formCtx, parentInputId);
  injectControlledProps(cleanProps, externalValue, externalIsChecked);

  // Pass the SDUI node ID to FormContainer so it can sync to variables['{id}-form'].
  // When the node has no explicit id (e.g. screen JSON loaded from config), pass an empty
  // string so FormContainer falls back to its own stable internal ID (see FormContainer.tsx).
  if ((node.type as string) === 'FormContainer') {
    cleanProps._formNodeId = node.id ?? '';
  }

  // In builder mode, animated nodes own their own data-builder-id (set directly on the
  // outer View in AnimatedNode). Skip applyBuilderAnnotation for those so the inner
  // element never gets a duplicate data-builder-id via the ref callback.
  const animCfgForIdCheck = (node.props as Record<string, unknown>)?.animation
    ?? (node as unknown as Record<string, unknown>).animation;
  const animNodeOwnsId = !!(builderMode && node.id && animCfgForIdCheck);
  if (!animNodeOwnsId) {
    applyBuilderAnnotation(node, cleanProps, builderMode);
  }

  const textContent = node.text != null ? resolveText(node.text, sduiContext, scope) : undefined;

  let children: React.ReactNode = null;
  if (node.children?.length) {
    const childElements = node.children.map((child, i) => {
      if (child == null) return null;
      const childKey = child.key;
      const isScopeVar = childKey === '$index' || childKey === '$item';
      // Use the SDUI node's stable id as the React key when available.
      // This prevents React from reusing DOM elements when siblings are reordered
      // (e.g. inserting a node before an existing one in the builder), which would
      // otherwise cause imperatively-applied inline styles to bleed onto the wrong node.
      const key = child.id ?? (childKey && !isScopeVar ? childKey : `child-${i}`);
      return <SDURendererInner key={key} node={child} context={context} scope={scope} builderPath={`${builderPath}-${i}`} />;
    });
    // Provide parent Input ID to descendant InputField nodes so they can write to
    // variables['{inputId}-value'] on change (formula live-binding).
    // Uses PARENT_CONTEXT_PROVIDER_TYPES from registry — no hardcoded 'Input' string.
    children = PARENT_CONTEXT_PROVIDER_TYPES.has(node.type as string) && node.id
      ? <InputParentContext.Provider value={node.id}>{childElements}</InputParentContext.Provider>
      : childElements;
  } else if (textContent !== undefined) {
    children = textContent;
  }

  // Guard: strip onPress from any component that is NOT a press-type.
  // This prevents React from logging "Unknown event handler property `onPress`" when
  // onPress accidentally ends up in cleanProps (e.g. from node.props JSON or any other path).
  if (!PRESS_ONLY_TYPES.has(node.type as string)) {
    delete cleanProps.onPress;
  }

  // Guard: strip onChangeText from non-input components.
  // action-binding sets onChangeText for every "change" trigger regardless of component type.
  // Box/div (and other layout components) don't support it, causing React's
  // "Unknown event handler property `onChangeText`" warning on every render.
  if (!CHANGE_TEXT_TYPES.has(node.type as string)) {
    delete cleanProps.onChangeText;
  }

  // If style.icon is a resolved string (from a formula binding on the icon name),
  // promote it to props.icon so the IconifyIcon component receives the dynamic name.
  // resolveProps evaluates { formula: "..." } objects recursively, so style.icon will
  // already be a plain string by the time we reach here.
  const resolvedStyleIcon = (cleanProps.style as Record<string, unknown> | undefined)?.icon;
  if (typeof resolvedStyleIcon === 'string' && resolvedStyleIcon) {
    cleanProps.icon = resolvedStyleIcon;
    // Remove icon from the style object — it is not a valid CSS property.
    const styleObj = { ...(cleanProps.style as Record<string, unknown>) };
    delete styleObj.icon;
    cleanProps.style = styleObj;
  }

  // If style.color is a resolved hex/rgb string (from a formula or direct style binding),
  // also inject it as !text-[color] into className so NativeWind's cssInterop on Heading/Text
  // components honours it — Gluestack's headingStyle base includes text-typography-900 which
  // can win over a plain inline style when cssInterop converts className to style internally.
  // The !important prefix ensures the injected class beats the typography token.
  // classToInlineStyle below then converts it back to inline style as a fallback for
  // arbitrary values that NativeWind JIT doesn't compile from JSON config.
  const resolvedStyleColor = (cleanProps.style as Record<string, unknown> | undefined)?.color;
  if (typeof resolvedStyleColor === 'string' && resolvedStyleColor) {
    const existing = (cleanProps.className as string | undefined) ?? '';
    // Strip only existing text-COLOR arbitrary classes (hex / CSS color functions) to avoid
    // duplicates. Must NOT strip text-SIZE classes like text-[20px] or text-[1.5rem].
    // Colors start with # or a CSS function name (rgb, rgba, hsl, hsla, var).
    const stripped = existing.replace(/\s*!?text-\[(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|var\([^)]+\))\]/g, '').trim();
    cleanProps.className = `${stripped} !text-[${resolvedStyleColor}]`.trim();
  }

  // Capture resolved node.props.style BEFORE arbStyles merge — used later for the outer
  // Animated.View wrapper. node.props.style may contain raw formula objects ({ formula: "..." })
  // that resolveProps has already evaluated into cleanProps.style. Reading node.props.style
  // directly would leak unresolved formula objects into the DOM as [object Object] strings.
  const resolvedNodeStyle = (cleanProps.style as Record<string, unknown> | undefined)
    ? { ...(cleanProps.style as Record<string, unknown>) }
    : {};

  // Apply inline style fallback for arbitrary-value classes (e.g. w-[1228px], pt-[120px]).
  // Tailwind JIT only compiles classes from scanned source files, not from JSON config —
  // so arbitrary values from the SDUI config need an inline style equivalent to render correctly.
  // props.style wins over the extracted values (e.g. transform stays intact).
  const arbStyles = classToInlineStyle(cleanProps.className as string | undefined);
  // Detect animation config early. When the node is animated AND absolutely/fixed positioned,
  // the outer Animated.View wrapper owns position/insets — stripping them from the inner
  // element prevents doubled offsets (inner positioned relative to outer which is itself
  // already positioned at the same coordinates).
  const _hasAnim = !!(
    (node.props as Record<string, unknown> | undefined)?.animation ??
    (node as unknown as Record<string, unknown>).animation
  );
  if (Object.keys(arbStyles).length > 0) {
    const isOffflow = _hasAnim && (arbStyles.position === 'absolute' || arbStyles.position === 'fixed');
    if (isOffflow) {
      // Outer Animated.View owns position/insets — inner element stays in normal flow.
      const { position: _p, top: _t, right: _r, bottom: _b, left: _l, zIndex: _z, ...contentStyles } = arbStyles;
      // In builder mode with animNodeOwnsId, the outer Animated.View also owns the pixel
      // size (outerStyle carries width/height). Replace fixed dimensions on the inner
      // element with 100% so it fills the wrapper during live resize drag.
      if (animNodeOwnsId) {
        if ('width'  in contentStyles) (contentStyles as Record<string, unknown>).width  = '100%';
        if ('height' in contentStyles) (contentStyles as Record<string, unknown>).height = '100%';
      }
      cleanProps.style = { ...contentStyles, ...(cleanProps.style as Record<string, unknown> ?? {}) };
      // Strip position-keyword and inset/z arbitrary-value classes from className so
      // NativeWind does not re-apply them on the inner element. The outer Animated.View
      // already owns position/insets via outerStyle — leaving them on className causes
      // the inner element to be double-offset relative to the outer wrapper, pushing
      // absolutely-positioned content completely outside its clipping boundary (blank box).
      if (cleanProps.className) {
        cleanProps.className = (cleanProps.className as string)
          .split(/\s+/)
          .filter(tok => !['absolute', 'fixed', 'sticky', 'relative', 'static', 'inset-0', 'inset-x-0', 'inset-y-0'].includes(tok))
          .filter(tok => !/^!?(?:top|right|bottom|left|z|inset(?:-[xy])?)-\[/.test(tok))
          .join(' ')
          .trim();
      }
      // Remove transform from the inner element — the outer wrapper already receives it
      // via _nodePropsStyleForOuter (below). Keeping it on both causes double-rotation.
      if (cleanProps.style) {
        const _s = cleanProps.style as Record<string, unknown>;
        delete _s.transform;
      }
      // The inner element lost its absolute positioning (stripped above), so it's now in normal
      // flow inside the outer Animated.View wrapper. Without explicit dimensions it collapses to
      // content height, breaking flex-based centering (e.g. justify-center, items-center).
      // Force it to fill the outer wrapper so layout props work as the author intended.
      {
        const _s = cleanProps.style as Record<string, unknown> ?? {};
        if (!_s.width)  _s.width  = '100%';
        if (!_s.height) _s.height = '100%';
        cleanProps.style = _s;
      }
    } else {
      // Same logic for non-offflow animated nodes that have explicit width/height.
      const innerStyles: Record<string, unknown> = { ...(arbStyles as Record<string, unknown>) };
      if (animNodeOwnsId) {
        if ('width'  in innerStyles) innerStyles.width  = '100%';
        if ('height' in innerStyles) innerStyles.height = '100%';
      }
      cleanProps.style = { ...innerStyles, ...(cleanProps.style as Record<string, unknown> ?? {}) };
    }
  }

  // Compose translateX / translateY / transform (rotation-only) into a single CSS transform.
  // translateX and translateY are stored as separate style keys (either as plain strings like
  // "20px" or formula-evaluated values). This keeps rotation and translate independent so
  // editing one never overwrites the other.
  {
    const sStyle = cleanProps.style as Record<string, unknown> | undefined;
    if (sStyle) {
      const txRaw = sStyle.translateX;
      const tyRaw = sStyle.translateY;
      if (txRaw !== undefined || tyRaw !== undefined) {
        // Normalise a translate value to a CSS px string: 20 → "20px", "20px" → "20px", "" → ""
        const toPx = (v: unknown): string => {
          if (v === undefined || v === null || v === '') return '';
          if (typeof v === 'number') return `${v}px`;
          const s = String(v).trim();
          if (!s) return '';
          if (/^-?[\d.]+$/.test(s)) return `${s}px`;
          return s;
        };
        const txStr = toPx(txRaw);
        const tyStr = toPx(tyRaw);
        const rotStr = (sStyle.transform as string | undefined) ?? '';
        const parts = [
          txStr ? `translateX(${txStr})` : '',
          tyStr ? `translateY(${tyStr})` : '',
          rotStr,
        ].filter(Boolean);
        sStyle.transform = parts.join(' ') || undefined;
        delete sStyle.translateX;
        delete sStyle.translateY;
      }
    }
  }

  const element = React.createElement(Component, { ...cleanProps, key: node.key }, children);

  // Wrap with AnimatedNode when the node has an animation config.
  // Support both node.props.animation (canonical) and node.animation (top-level alias).
  const animCfg = (node.props as Record<string, unknown> | undefined)?.animation
    ?? (node as unknown as Record<string, unknown>).animation;
  if (animCfg && typeof animCfg === 'object') {
    // $index is the top-level map iteration index set on scope (scope.$index = index).
    // repeatIndex lives inside scope.context.item, not at scope root — use $index.
    const staggerIndex =
      typeof (scope as { $index?: number } | undefined)?.$index === 'number'
        ? (scope as { $index: number }).$index
        : typeof (scope as { repeatIndex?: number } | undefined)?.repeatIndex === 'number'
          ? (scope as { repeatIndex: number }).repeatIndex
          : 0;
    // Resolve any formula-value objects in animation config numeric fields.
    // The builder stores { formula: "variables['UUID']" } when a field is bound.
    // Evaluate them here so AnimatedNode always receives plain numbers.
    const resolveAnimNum = (v: unknown, fallback: number): number => {
      if (v == null) return fallback;
      if (typeof v === 'object' && v !== null && 'formula' in v) {
        const r = evaluateFormula((v as { formula: string }).formula, stateWithScope);
        return Number(r.value ?? fallback);
      }
      return typeof v === 'number' ? v : fallback;
    };

    // Resolve imperativeTrigger.watchVar — it's a formula expression like "variables['UUID']"
    // that must be evaluated (not just path-looked-up) against the current state so
    // AnimatedNode can watch its resolved value and re-play the animation when it changes.
    let resolvedAnimCfg = animCfg as AnimationConfig;

    // Resolve formula-bound numeric fields in each animation sub-config.
    const _rawCfg = animCfg as AnimationConfig;
    if (_rawCfg.enter) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        enter: {
          ...(_rawCfg.enter),
          duration:  resolveAnimNum(_rawCfg.enter.duration,  400),
          delay:     resolveAnimNum(_rawCfg.enter.delay,     0),
          stagger:   resolveAnimNum(_rawCfg.enter.stagger,   0),
        },
      };
    }
    if (_rawCfg.exit) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        exit: {
          ...(_rawCfg.exit),
          duration: resolveAnimNum(_rawCfg.exit.duration, 300),
        },
      };
    }
    if (_rawCfg.loop) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        loop: {
          ...(_rawCfg.loop),
          duration:    resolveAnimNum(_rawCfg.loop.duration,    1000),
          delay:       resolveAnimNum(_rawCfg.loop.delay,       0),
          repeatCount: resolveAnimNum(_rawCfg.loop.repeatCount, -1),
        },
      };
    }
    if (_rawCfg.hover) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        hover: {
          ...(_rawCfg.hover),
          scale:    resolveAnimNum(_rawCfg.hover.scale,    1.05),
          opacity:  resolveAnimNum(_rawCfg.hover.opacity,  1),
          y:        resolveAnimNum(_rawCfg.hover.y,        -4),
          duration: resolveAnimNum(_rawCfg.hover.duration, 200),
        },
      };
    }
    if (_rawCfg.press) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        press: {
          ...(_rawCfg.press),
          scale:    resolveAnimNum(_rawCfg.press.scale,    0.95),
          opacity:  resolveAnimNum(_rawCfg.press.opacity,  1),
          duration: resolveAnimNum(_rawCfg.press.duration, 120),
        },
      };
    }
    if (_rawCfg.parallax) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        parallax: {
          ...(_rawCfg.parallax),
          speed: resolveAnimNum(_rawCfg.parallax.speed, 0.4),
          clamp: resolveAnimNum(_rawCfg.parallax.clamp, 120),
        },
      };
    }
    if (_rawCfg.scroll) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        scroll: {
          ...(_rawCfg.scroll),
          duration: resolveAnimNum(_rawCfg.scroll.duration, 500),
        },
      };
    }
    if (_rawCfg.tilt) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        tilt: {
          ...(_rawCfg.tilt),
          maxX:        resolveAnimNum(_rawCfg.tilt.maxX,        15),
          maxY:        resolveAnimNum(_rawCfg.tilt.maxY,        15),
          perspective: resolveAnimNum(_rawCfg.tilt.perspective, 800),
          scale:       resolveAnimNum(_rawCfg.tilt.scale,       1.03),
          duration:    resolveAnimNum(_rawCfg.tilt.duration,    200),
        },
      };
    }
    if (_rawCfg.imperativeTrigger) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        imperativeTrigger: {
          ...(_rawCfg.imperativeTrigger),
          duration: resolveAnimNum(_rawCfg.imperativeTrigger.duration, 400),
        },
      };
    }
    if (_rawCfg.filter) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        filter: {
          ...(_rawCfg.filter),
          blur:         resolveAnimNum(_rawCfg.filter.blur,         0) || undefined,
          backdropBlur: resolveAnimNum(_rawCfg.filter.backdropBlur, 0) || undefined,
        },
      };
    }
    // Resolve formula objects inside outerStyle (e.g. backgroundImage: { formula: "..." })
    if (_rawCfg.outerStyle) {
      const outerSt = _rawCfg.outerStyle as Record<string, unknown>;
      const bgImg = outerSt.backgroundImage;
      if (bgImg != null && typeof bgImg === 'object' && 'formula' in bgImg) {
        const resolved = evaluateFormula((bgImg as { formula: string }).formula, stateWithScope);
        resolvedAnimCfg = {
          ...resolvedAnimCfg,
          outerStyle: {
            ...outerSt,
            backgroundImage: typeof resolved.value === 'string' ? resolved.value : '',
          },
        };
      }
    }

    const itCfg = resolvedAnimCfg.imperativeTrigger;
    if (itCfg && typeof itCfg.watchVar === 'string') {
      const resolvedVal = evaluateFormula(itCfg.watchVar, stateWithScope).value;
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        imperativeTrigger: { ...itCfg, watchVar: resolvedVal },
      };
    }
    // Resolve states.watchVar so AnimatedNode receives the current state name
    const smCfg = resolvedAnimCfg.states;
    if (smCfg && typeof smCfg.watchVar === 'string') {
      const resolvedState = evaluateFormula(smCfg.watchVar, stateWithScope).value;
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        states: { ...smCfg, watchVar: String(resolvedState ?? '') },
      };
    }
    // Auto-inject node.text into splitText.text and node className into splitText.className
    // when the node uses animation.splitText but has no explicit values set.
    // This lets the Text/Heading node own the content and styling in the builder while
    // AnimatedNode uses those values when rendering the split spans in live mode.
    const stCfg = resolvedAnimCfg.splitText;
    const nodeClassName = resolvedProps?.className as string | undefined;
    if (stCfg && textContent != null) {
      resolvedAnimCfg = {
        ...resolvedAnimCfg,
        splitText: {
          ...stCfg,
          ...(!stCfg.text ? { text: String(textContent) } : {}),
          ...(!stCfg.className && nodeClassName ? { className: nodeClassName } : {}),
        },
      };
    }
    // In builder mode the Animated.View is the selectable/resizable target:
    // (1) Always clear data-builder-id from inner element — AnimatedNode sets it on the
    //     Animated.View directly so patchStyle and canvas resize hit the right element.
    // (2) Forward any inline style to outerStyle so patchProp changes survive re-renders.
    // (3) Keep outerClassName forwarding only for paint-replacing animations (gradient/shimmer)
    //     so regular enter-animation boxes don't have their className moved off the inner Box.
    if (!resolvedAnimCfg.outerClassName && nodeClassName &&
        (resolvedAnimCfg.gradientAnimation?.enabled || resolvedAnimCfg.color || resolvedAnimCfg.shimmer)) {
      resolvedAnimCfg = { ...resolvedAnimCfg, outerClassName: nodeClassName };
    }
    // animNodeOwnsId is already true here (same condition) — data-builder-id was never
    // added to cleanProps as a prop (applyBuilderAnnotation was skipped), so nothing to
    // delete. Forward any inline style to outerStyle so patchProp commits survive re-renders.
    if (animNodeOwnsId) {
      // Only forward size/positioning/radius/zIndex to the outer selection wrapper.
      // Padding, margin, color, fontSize, borderWidth/Color must stay on the inner element —
      // moving them to outerStyle doubles the spacing (inner has padding from CSS classes,
      // outer would add padding again), causing builder to show elements taller/wider than preview.
      const OUTER_PASSTHROUGH = new Set([
        'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
        'top', 'right', 'bottom', 'left',
        'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
        'borderBottomRightRadius', 'borderBottomLeftRadius',
        'zIndex',
      ]);
      // Only OUTER_PASSTHROUGH keys from arbStyles go to the outer wrapper.
      const outerFromArb: Record<string, unknown> = {};
      for (const key of OUTER_PASSTHROUGH) {
        if (key in arbStyles) outerFromArb[key] = (arbStyles as Record<string, unknown>)[key];
      }
      // resolvedNodeStyle contains the evaluated version of node.props.style (formulas resolved).
      // Using this instead of raw node.props.style prevents formula objects from leaking into
      // the DOM as [object Object] strings on the outer Animated.View wrapper.
      const nodePropsStyle = resolvedNodeStyle;
      const styleForOuter: Record<string, unknown> = { ...outerFromArb, ...nodePropsStyle };
      // Position forwarding is handled universally by the sizeOverride block below (all modes).
      // This block only needs OUTER_PASSTHROUGH keys + nodePropsStyle for builder selection.
      // MERGE into the existing outerStyle (don't overwrite) so animation.outerStyle values
      // like backgroundImage (used by gradientDrift) are preserved alongside the builder's
      // size/position overrides from arbStyles.
      if (Object.keys(styleForOuter).length > 0) {
        const existingOuterStyle = (resolvedAnimCfg.outerStyle as Record<string, unknown>) ?? {};
        resolvedAnimCfg = { ...resolvedAnimCfg, outerStyle: { ...existingOuterStyle, ...styleForOuter } };
      }
      // Do NOT delete cleanProps.style — the inner element needs its arbStyles inline styles
      // so non-JIT-compiled arbitrary classes (from JSON nodes) still render correctly.
      // Note: width/height are replaced with 100% earlier (before createElement) so the
      // inner fills the outer Animated.View during live resize drag in builder mode.
    }
    // Forward size-critical classes from the inner node to the outer wrapper.
    // React Native Web's base View style includes align-self: flex-start, which causes
    // the outer Animated.View/View wrapper to collapse to content-width/height when it
    // is a flex item. The inner node's w-full/flex-1 are percentages of the wrapper,
    // not the grandparent — so the wrapper itself must also carry the sizing.
    // Note: explicit outerStyle properties take precedence (spread after sizeOverride).
    if (nodeClassName) {
      const sizeOverride: Record<string, unknown> = {};
      if (/\bw-full\b/.test(nodeClassName)) {
        sizeOverride.width = '100%';
        sizeOverride.flexShrink = 1; // RNW Animated.View defaults flex-shrink:0; restore CSS default
      }
      if (/\bflex-1\b/.test(nodeClassName)) sizeOverride.flex = 1;
      if (/\bmin-w-0\b/.test(nodeClassName)) sizeOverride.minWidth = 0;
      // Mirror border-radius onto the outer wrapper (Animated.View / plain View).
      // Two reasons: (1) In builder mode (animNodeOwnsId=true) this ensures patchStyle({
      // borderRadius }) on the outer wrapper has visible effect for the selection ring.
      // (2) In all modes, React Native Web's View/Animated.View applies overflow:hidden by
      // default. Without a matching borderRadius on the outer wrapper, it clips the inner
      // element's rounded background to a square — making the border-radius look like 0 in
      // preview even though the inner className has rounded-[Npx].
      const globalRounded = nodeClassName.match(/\brounded-\[(\d+(?:\.\d+)?)px\]/);
      if (globalRounded) {
        sizeOverride.borderRadius = `${globalRounded[1]}px`;
      } else {
        const cornerAbbrs = [
          ['tl', 'borderTopLeftRadius'],
          ['tr', 'borderTopRightRadius'],
          ['br', 'borderBottomRightRadius'],
          ['bl', 'borderBottomLeftRadius'],
        ] as const;
        for (const [abbr, cssKey] of cornerAbbrs) {
          const m = nodeClassName.match(new RegExp(`\\brounded-${abbr}-\\[(\\d+(?:\\.\\d+)?)px\\]`));
          if (m) sizeOverride[cssKey] = `${m[1]}px`;
        }
      }
      // Forward position keyword + insets to the outer wrapper in ALL modes.
      // classToInlineStyle only handles arbitrary [N] classes — bare keywords like
      // `absolute`, `fixed`, `sticky` are never extracted. Without forwarding them
      // to outerStyle, the outer Animated.View is left in normal flow while the
      // inner element's position applies relative to the wrong ancestor. This caused
      // absolutely-positioned animated cards to stack in normal flow in preview mode
      // even though the builder showed them correctly (builder had a separate code path).
      const POSITION_KEYWORDS: Record<string, string> = {
        absolute: 'absolute', relative: 'relative',
        fixed: 'fixed', sticky: 'sticky', static: 'static',
      };
      for (const tok of nodeClassName.split(/\s+/)) {
        if (POSITION_KEYWORDS[tok]) {
          sizeOverride.position = POSITION_KEYWORDS[tok];
          // For abs/fixed: also forward width/height so the outer Animated.View is correctly
          // sized. Without explicit dimensions a 0×0 wrapper makes glowPulse box-shadow render
          // as a tiny dot and collapses hover/click areas.
          if (POSITION_KEYWORDS[tok] === 'absolute' || POSITION_KEYWORDS[tok] === 'fixed') {
            const aw = (arbStyles as Record<string, unknown>).width;
            const ah = (arbStyles as Record<string, unknown>).height;
            if (aw !== undefined) sizeOverride.width = aw;
            if (ah !== undefined) sizeOverride.height = ah;
          }
          break;
        }
      }
      // Forward insets, zIndex, and explicit size constraints from arbitrary classes so the outer
      // wrapper matches the inner node's exact dimensions. Without this, the outer Animated.View
      // collapses in preview mode for nodes like h-[120px] min-w-[200px] (no NativeWind class
      // on the outer wrapper means no compiled CSS — only inline outerStyle is applied).
      for (const key of ['top', 'right', 'bottom', 'left', 'zIndex', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) {
        if ((arbStyles as Record<string, unknown>)[key] !== undefined) {
          sizeOverride[key] = (arbStyles as Record<string, unknown>)[key];
        }
      }
      // Forward resolved node.props.style (e.g. opacity from set_opacity) to the outer wrapper
      // for ALL modes so visual properties apply to the Animated.View and its box-shadow effects.
      // Example: glowPulse on an opacity:0.15 blob should pulse at 15% opacity, not 100%.
      // In builder mode, resolvedAnimCfg.outerStyle (from animNodeOwnsId) already contains
      // nodePropsStyle and spreads LAST, so builder values always take precedence.
      // Uses resolvedNodeStyle (formulas already evaluated) instead of raw node.props.style to
      // prevent formula objects leaking as [object Object] into the outer Animated.View DOM.
      const _nodePropsStyleForOuter = resolvedNodeStyle;
      const _outerBase = { ...sizeOverride, ..._nodePropsStyleForOuter };
      if (Object.keys(_outerBase).length > 0) {
        resolvedAnimCfg = {
          ...resolvedAnimCfg,
          outerStyle: { ..._outerBase, ...(resolvedAnimCfg.outerStyle as object ?? {}) },
        };
      }
    }
    return (
      <AnimatedNode
        key={node.key}
        animation={resolvedAnimCfg}
        staggerIndex={staggerIndex}
        nodeId={node.id}
        nodeType={node.type as string | undefined}
        builderMode={builderMode}
      >
        {element}
      </AnimatedNode>
    );
  }

  // Wrap non-interactive elements that have click handlers in a transparent div.
  const wrapped = wrapWithClickHandler(element, cleanProps, node.type as string, builderMode);
  if (wrapped !== element) return wrapped;

  if (node.dataSource) {
    return (
      <DataSourceWrapper dataSource={node.dataSource} fetchData={fetchData}>
        {element}
      </DataSourceWrapper>
    );
  }

  // Disabled overlay — when props.disabled is truthy wrap with a relative container
  // and an absolutely positioned tinted/blurred overlay div.
  const disabledElement = renderWithDisabledOverlay(element, node, resolvedProps, builderMode);
  if (disabledElement) return disabledElement;

  return element;
});

export function SDURenderer({ node, context }: Omit<RendererProps, 'scope'>) {
  return <SDURendererInner node={node} context={context} />;
}

/** Scoped renderer — like SDURenderer but accepts an initial scope (e.g. popup.props). */
export function SDURendererScoped({ node, context, scope }: RendererProps) {
  return <SDURendererInner node={node} context={context} scope={scope} />;
}

export type { RendererContext };
