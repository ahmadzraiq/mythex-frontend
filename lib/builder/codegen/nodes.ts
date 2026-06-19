/**
 * nodes.ts — Walk an SDUINode tree and produce JSX source.
 *
 * Handles:
 *   - All component types via primitives.ts
 *   - Prop binding ({{path}}, {var}, {formula}, {js}) via formula-rewrite.ts
 *   - Conditions → {cond && (...)}
 *   - map → {list?.map((item, index) => (...))}
 *   - Actions → event handler props via bindings.ts
 *   - Animations → Framer Motion props via animations.ts
 *   - Popovers → @radix-ui/react-popover wrappers
 *   - HtmlContent → dangerouslySetInnerHTML
 *   - MarkdownViewer → <ReactMarkdown>
 *   - FormContainer → RHF wired form
 */

import type { SDUINode } from '@/lib/sdui/types/node';
import type { CodegenCtx } from './types';
import { rewritePropValue, rewriteTextValue, rewriteFormula, pathToExpr } from './formula-rewrite';
import { resolveExpr } from './actions/misc';
import type { SymbolMap } from './types';
import { twMerge } from 'tailwind-merge';

/**
 * NativeWind-aware Tailwind merge.
 *
 * NativeWind converts arbitrary-value classes (e.g. `text-[24px]`, `text-[var(--c)]`) to
 * React Native inline styles, which have higher specificity than stylesheet-based classes.
 * This means an arbitrary class always beats a conflicting regular utility regardless of order.
 *
 * We replicate this by moving all arbitrary-value classes after all regular utilities before
 * handing off to twMerge (which uses last-wins within each CSS-property group).
 * Relative order is preserved within each group.
 *
 * NativeWind (React Native) does NOT apply hover: or active: pseudo-class variants for
 * background changes. Strip hover:bg-*, hover:!bg-*, active:bg-* so the exported web app
 * visually matches the builder preview (where those classes have no effect).
 * Non-background hover variants (hover:underline, hover:text-*, group-hover:opacity-*) are kept
 * because they don't cause the jarring background-color flash seen on option buttons.
 */
function nwMerge(className: string): string {
  const classes = className.trim().split(/\s+/).filter(Boolean);
  // Strip hover/active background changes — NativeWind ignores these on React Native
  const noHoverBg = classes.filter(c => !c.match(/^(?:hover|active):!?bg-/));
  const regular = noHoverBg.filter(c => !c.includes('['));
  const arbitrary = noHoverBg.filter(c => c.includes('['));
  return twMerge([...regular, ...arbitrary].join(' '));
}

/** Convert an SDUI _validation array into react-hook-form register rules code string */
export function buildRhfRulesStr(validation: unknown): string | null {
  // Support both flat array format AND { trigger, rules: [...] } object format
  let rulesArray: unknown = validation;
  if (validation && typeof validation === 'object' && !Array.isArray(validation)) {
    rulesArray = (validation as Record<string, unknown>).rules ?? [];
  }
  if (!Array.isArray(rulesArray) || rulesArray.length === 0) return null;
  const parts: string[] = [];
  for (const v of rulesArray as Array<{ rule: string; message?: string; value?: unknown; formula?: string }>) {
    if (!v?.rule) continue;
    const msg = JSON.stringify(v.message ?? 'Invalid value');
    switch (v.rule) {
      case 'required':
        parts.push(`required: ${JSON.stringify(v.message ?? 'This field is required')}`);
        break;
      case 'formula':
        // Custom formula validation: `value === true`, `value.length > 0`, etc.
        if (v.formula) parts.push(`validate: (value: unknown) => (${v.formula}) || ${msg}`);
        break;
      case 'email':
        parts.push(`pattern: { value: /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/, message: ${msg} }`);
        break;
      case 'minLength':
        parts.push(`minLength: { value: ${Number(v.value ?? 1)}, message: ${msg} }`);
        break;
      case 'maxLength':
        parts.push(`maxLength: { value: ${Number(v.value ?? 255)}, message: ${msg} }`);
        break;
      case 'min':
        parts.push(`min: { value: ${Number(v.value ?? 0)}, message: ${msg} }`);
        break;
      case 'max':
        parts.push(`max: { value: ${Number(v.value ?? 100)}, message: ${msg} }`);
        break;
      case 'pattern':
        if (v.value) parts.push(`pattern: { value: new RegExp(${JSON.stringify(String(v.value))}), message: ${msg} }`);
        break;
    }
  }
  return parts.length > 0 ? `{ ${parts.join(', ')} }` : null;
}

/** Resolve a node's `map` value to a valid JavaScript list expression */
function resolveMapExpr(map: unknown, symbols: SymbolMap, inMapScope = false): string {
  if (typeof map === 'string') return rewriteFormula(map, symbols, inMapScope);
  if (map && typeof map === 'object') {
    const obj = map as Record<string, unknown>;
    if (typeof obj.path === 'string') return rewriteFormula(obj.path, symbols, inMapScope);
    // Pass inMapScope so nested map expressions referencing context.item get rewritten
    return resolveExpr(map, symbols, '[]', inMapScope);
  }
  return '[]';
}
import { getPrimitive, resolveTextTag } from './primitives';
import { buildActionProps, extractLifecycleTriggers } from './bindings';
import { animationToMotionProps, motionTag } from './animations';
import { ImportsTracker } from './tsx-builder';

type AnyNode = SDUINode & Record<string, unknown>;

export interface NodeEmitResult {
  jsx: string;
  useEffects: string[];  // lifecycle trigger useEffect calls
}

export function emitNode(
  node: AnyNode,
  ctx: CodegenCtx,
  imports: ImportsTracker,
  usedAnimations: Set<string>,
  inMapScope = false,
  depth = 0,
  formDepth = 0,
): NodeEmitResult {
  const ind = '  '.repeat(depth);

  // Handle condition — unwrap {formula:"..."} objects before rewriting
  const condRaw = node.condition != null
    ? (typeof node.condition === 'string'
        ? node.condition
        : (node.condition !== null && typeof node.condition === 'object' && 'formula' in (node.condition as object))
          ? String((node.condition as Record<string, unknown>).formula ?? '')
          : (node.condition !== null && typeof node.condition === 'object' && 'js' in (node.condition as object))
            ? String((node.condition as Record<string, unknown>).js ?? '')
            : JSON.stringify(node.condition))
    : null;
  const condExpr = condRaw != null
    ? rewriteFormula(condRaw, ctx.symbols, inMapScope)
    : null;

  // Handle map/repeat
  if (node.map) {
    return emitMapNode(node, ctx, imports, usedAnimations, inMapScope, depth, formDepth);
  }

  const inner = emitNodeInner(node, ctx, imports, usedAnimations, inMapScope, depth, formDepth);

  if (condExpr) {
    // Sub-components extracted for form-data display nodes handle their own condition internally
    // (they subscribe directly to Zustand). Skip the outer wrapper so the page's stale equality
    // check doesn't prevent the sub-component from mounting when form state changes.
    const nodeId = typeof node.id === 'string' ? node.id : undefined;
    const isExtractedSubComp =
      (nodeId && ctx.formDataDisplayNodeIds?.has(nodeId)) ||
      (nodeId && ctx.liveIndicatorNodeIds?.has(nodeId));
    if (!isExtractedSubComp) {
      return {
        jsx: `${ind}{(${condExpr}) && (\n${inner.jsx}\n${ind})}`,
        useEffects: inner.useEffects,
      };
    }
  }

  return inner;
}

function emitMapNode(
  node: AnyNode,
  ctx: CodegenCtx,
  imports: ImportsTracker,
  usedAnimations: Set<string>,
  inMapScope: boolean,
  depth: number,
  formDepth = 0,
): NodeEmitResult {
  const ind = '  '.repeat(depth);
  // Pass current inMapScope so nested map expressions referencing `context.item` (outer _item) are rewritten correctly
  const listExpr = resolveMapExpr(node.map, ctx.symbols, inMapScope);
  const keyField = ((node.map as unknown as Record<string, unknown>)?.keyField as string) ?? (node as Record<string, unknown>).mapKey as string ?? 'id';

  // Formula/JS map expressions generate raw items; the SDUI engine wraps these in {data: item}.
  // Collection-based maps (path) already store items as {id, data} in the store.
  const mapObj = node.map as unknown as Record<string, unknown>;
  const isFormulaMap = mapObj && typeof mapObj === 'object' && ('formula' in mapObj || 'js' in mapObj);

  // Emit the template node (with map scope active)
  const templateNode = { ...node, map: undefined, mapKey: undefined } as AnyNode;
  const templateResult = emitNodeInner(templateNode, ctx, imports, usedAnimations, true, depth + 1, formDepth);

  // Use the raw `item` (before _item wrapping) for the key — item is the plain object from the array.
  const keyExpr = /^\d+$/.test(keyField)
    ? `index`
    : `String((item as Record<string,unknown>)?.[${JSON.stringify(keyField)}] ?? index)`;

  // If listExpr mixes || / && with the upcoming ??, wrap to satisfy operator precedence rules
  const safeListExpr = /\|\||&&/.test(listExpr) ? `(${listExpr})` : listExpr;

  // Inject key into the root element of the template JSX
  const jsxWithKey = templateResult.jsx.replace(
    /^(\s*<[\w.]+)/,
    `$1 key={${keyExpr}}`,
  );

  // The SDUI engine ALWAYS wraps map items as { data: rawItem } for the template context,
  // for both formula maps AND path-based maps. Templates access _item?.data?.field everywhere.
  // Spread `index` into data so `_item?.data?.index` resolves to the loop position.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itemAlias = `const _item = { data: { ...(item as Record<string, unknown>), index }, id: (item as Record<string, unknown>)?.['id'] ?? index } as any;`;
  void isFormulaMap; // kept for future use

  // For outer maps (not already inside a map): capture _parentItem = _item AFTER the _item alias
  // so nested child maps can reference _parentItemId via closure without TDZ issues.
  // Inner maps (inMapScope=true) do NOT redeclare _parentItem/Id — they read the outer
  // scope's values through JS closure, which gives them the correct parent-item context.
  const parentCapture = !inMapScope
    ? `\n${ind}  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n${ind}  const _parentItem = _item as any; const _parentItemId = (_item as any)?.data?.id;`
    : '';

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jsx: `${ind}{(${safeListExpr} ?? []).map((item: unknown, index: number) => {\n${ind}  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n${ind}  ${itemAlias}${parentCapture}\n${ind}  return (\n${jsxWithKey}\n${ind}  );\n${ind}})}`,
    useEffects: [],
  };
}

function emitNodeInner(
  node: AnyNode,
  ctx: CodegenCtx,
  imports: ImportsTracker,
  usedAnimations: Set<string>,
  inMapScope: boolean,
  depth: number,
  formDepth = 0,
): NodeEmitResult {
  const ind = '  '.repeat(depth);
  const childInd = '  '.repeat(depth + 1);
  const useEffects: string[] = [];

  // Sub-component extraction: if this node has been extracted into a narrow-selector component,
  // emit a call to that component instead of inlining the full element. This prevents the
  // 3000+ line page from re-rendering when input values change — only the tiny sub-component does.
  // Mirror the syncId fallback used in the Input onChange path: node.id ?? node._inputValueId
  const _nodeId = (node.id ?? (node as Record<string, unknown>)._inputValueId) as string | undefined;
  if (_nodeId && ctx.inputVarNodeIds?.has(_nodeId)) {
    const _info = ctx.inputVarInfoMap!.get(_nodeId)!;
    return { jsx: `${ind}<${_info.subCompName} />`, useEffects: [] };
  }
  // Live indicators always have an explicit id, so just use node.id
  const _liveNodeId = typeof node.id === 'string' ? node.id : undefined;
  if (_liveNodeId && ctx.liveIndicatorNodeIds?.has(_liveNodeId)) {
    const _info = ctx.liveIndicatorNodeIds!.get(_liveNodeId)!;
    return { jsx: `${ind}<${_info.subCompName} />`, useEffects: [] };
  }
  // Form-data display nodes (inside FormContainer, show _formData) are extracted as sub-components.
  if (_liveNodeId && ctx.formDataDisplayNodeIds?.has(_liveNodeId)) {
    const _info = ctx.formDataDisplayNodeIds!.get(_liveNodeId)!;
    return { jsx: `${ind}<${_info.subCompName} />`, useEffects: [] };
  }

  const prim = getPrimitive(node.type as string);
  let tag = prim.tag;

  // Nested FormContainer: HTML doesn't allow <form> inside <form>, emit as <div> to avoid hydration mismatch
  const isForm = node.type === 'FormContainer';
  if (isForm && formDepth > 0) {
    tag = 'div';
  }
  const nextFormDepth = isForm ? formDepth + 1 : formDepth;

  // Resolve text tag semantically
  if (node.type === 'Text' && node.props) {
    tag = resolveTextTag(node.props as Record<string, unknown>);
  }

  // Box with href → render as <a> tag (link)
  if ((node.type === 'Box' || node.type === 'View') && (node.props as Record<string, unknown>)?.href) {
    tag = 'a';
  }

  // Box with type="submit" inside a FormContainer → render as <button> so it actually submits the form
  if ((node.type === 'Box' || node.type === 'View') && (node.props as Record<string, unknown>)?.type === 'submit') {
    tag = 'button';
  }

  // Register imports
  if (prim.importFrom) {
    if (prim.isDefaultImport) {
      imports.addDefault(prim.importFrom, prim.importName ?? tag);
    } else {
      imports.addNamed(prim.importFrom, prim.importName ?? tag);
    }
  }

  // Collect animation props (stored in node.props.animation per renderer convention)
  const animMotionProps: Record<string, string> = {};
  let useMotion = false;
  const animConfig = (node.props as Record<string, unknown> | undefined)?.animation
    ?? (node as Record<string, unknown>).animation;

  if (animConfig) {
    const motionProps = animationToMotionProps(animConfig as Record<string, unknown>, usedAnimations);
    // Check if it's a CSS animation (named loop)
    if ('data-css-animation' in motionProps) {
      const animName = JSON.parse(motionProps['data-css-animation']!);
      // Add CSS animation class instead of framer motion
      const existingClass = (node.props?.className as string) ?? '';
      node = {
        ...node,
        props: {
          ...node.props,
          className: `${existingClass} animate-${animName}`.trim(),
        },
      };
    } else if (Object.keys(motionProps).length > 0 && prim.supportsMotion !== false) {
      imports.addNamed('framer-motion', 'motion');
      tag = motionTag(tag);
      useMotion = true;
      Object.assign(animMotionProps, motionProps);
    }
  }

  // Build props
  const propsLines: string[] = [];

  // id
  if (node.id && node.id !== 'root') {
    propsLines.push(`id="${node.id}"`);
  }

  // className
  let className = (node.props?.className as string) ?? '';
  // For Icon nodes, strip ALL text-[...] arbitrary classes.
  // The builder renders icons as <img> via IconifyIcon.tsx — size comes from width/height
  // attributes, not font-size, so text-[Npx] has no effect. Color classes (text-[#hex]) are
  // also stripped: they don't affect <img> CDN URL color in the builder (which uses
  // ?color=currentColor), so emitting them to @iconify/react would create a mismatch.
  // Icon color comes solely from the explicit `color` prop on the node (handled below).
  if (node.type === 'Icon' && className) {
    className = className
      .split(/\s+/)
      .filter(cls => !cls.startsWith('text-['))
      .join(' ');
  }

  // For Input/InputField/Textarea/TextareaInput nodes, convert `placeholderTextColor`
  // (React Native prop) to a Tailwind placeholder color class for plain HTML inputs.
  const INPUT_TYPES = new Set(['Input', 'InputField', 'Textarea', 'TextareaInput']);
  if (INPUT_TYPES.has(node.type)) {
    // Default to #737373 when no explicit prop — matches the component-level default in InputWithField/TextareaWithInput.
    const ptc = (node.props?.placeholderTextColor as string | undefined) ?? '#737373';
    // Encode the color for Tailwind arbitrary value syntax (e.g. #9ca3af → #9ca3af is safe,
    // rgba(...) needs underscores for spaces: rgba(0,0,0,0.5) → rgba(0,0,0,0.5))
    const encoded = ptc.replace(/\s/g, '_');
    className = (className ? `${className} ` : '') + `placeholder-[${encoded}]`;
  }

  // RNW always injects resize:none on TextInput; exported <textarea> needs the same.
  if (node.type === 'Textarea' || node.type === 'TextareaInput') {
    className = (className ? `${className} ` : '') + 'resize-none';
  }

  // Mirror builder Video default: objectFit='cover'. Add object-cover unless the node
  // already has an explicit objectFit in its inline style.
  if (node.type === 'Video') {
    const nodeStyle = (node.props as Record<string, unknown>)?.style as Record<string, unknown> | undefined;
    const hasObjectFit = nodeStyle && Object.prototype.hasOwnProperty.call(nodeStyle, 'objectFit');
    if (!hasObjectFit) {
      className = (className ? `${className} ` : '') + 'object-cover';
    }
  }

  // The engine's renderWithDisabledOverlay wraps disabled nodes in a relative container +
  // absolutely-positioned rgba overlay (pointerEvents:'all' to block clicks).
  // We replicate that at code-gen time: the element stays unchanged; the overlay is emitted
  // around the final JSX string below. Collect the config here so we can use it later.
  const FORM_ELEMENTS = new Set(['Input', 'InputField', 'Textarea', 'TextareaInput', 'Select']);
  const rawDisabledProp = (node.props as Record<string, unknown>)?.disabled;
  const disabledIsOnFormEl = FORM_ELEMENTS.has(node.type as string);
  // Static boolean disabled — always wrap. Formula disabled — emit conditional wrap.
  const staticDisabled = rawDisabledProp === true && !disabledIsOnFormEl;
  const formulaDisabledExpr = (!disabledIsOnFormEl && rawDisabledProp && typeof rawDisabledProp === 'object')
    ? rewritePropValue(rawDisabledProp, ctx.symbols, inMapScope)
    : null;

  // React Native View (Box) defaults to flexDirection:'column'. In HTML a plain <div> has no
  // flex context, so inline children (spans, inputs) flow on the same line instead of stacking.
  // Inject 'flex flex-col' when the node is a Box/View and has no explicit flex direction set.
  if (
    (node.type === 'Box' || node.type === 'View') &&
    tag === 'div' &&
    !/(^|\s)(flex-row|flex-col|flex-wrap|grid\b|inline|hidden|contents)/.test(className ?? '')
  ) {
    className = className ? `flex flex-col ${className}` : 'flex flex-col';
  }

  // Resolve conflicting Tailwind utilities to match NativeWind's behavior:
  // NativeWind converts arbitrary value classes (text-[24px]) to inline styles, giving them
  // higher specificity than regular utilities (text-base). We replicate this by sorting all
  // arbitrary classes after regular ones before passing to twMerge (which uses last-wins),
  // so arbitrary always beats a conflicting regular utility — just like NativeWind.
  if (className) {
    className = nwMerge(className);
    propsLines.push(`className="${className}"`);
  }

  // animation.states → computed inline style parts (state-machine driven CSS, e.g. Kanban column bg, Carousel slide transform)
  const _statesCfg = (animConfig as Record<string, unknown> | null | undefined)?.states as {
    watchVar: string;
    duration?: number;
    easing?: string;
    defaultState?: string;
    states: Record<string, Record<string, string>>;
  } | undefined;
  const animStatesParts: string[] = [];
  if (_statesCfg?.watchVar && _statesCfg?.states && typeof _statesCfg.states === 'object') {
    const _allProps = new Set<string>();
    for (const sv of Object.values(_statesCfg.states)) {
      if (sv && typeof sv === 'object') Object.keys(sv).forEach(p => _allProps.add(p));
    }
    const _watchExpr = rewriteFormula(_statesCfg.watchVar, ctx.symbols, inMapScope);
    const _defaultKey = _statesCfg.defaultState ?? Object.keys(_statesCfg.states)[0] ?? '';
    for (const _prop of _allProps) {
      const _stateMap: Record<string, string> = {};
      for (const [sk, sv] of Object.entries(_statesCfg.states)) {
        if (sv && typeof sv === 'object' && _prop in sv) _stateMap[sk] = (sv as Record<string, string>)[_prop];
      }
      const _defVal = _stateMap[_defaultKey] ?? Object.values(_stateMap)[0] ?? '';
      animStatesParts.push(`${JSON.stringify(_prop)}: (${JSON.stringify(_stateMap)})[${_watchExpr}] ?? ${JSON.stringify(_defVal)}`);
    }
    if (_statesCfg.duration && _allProps.size > 0) {
      const _tf = _statesCfg.easing === 'easeInOut' ? 'ease-in-out'
                : _statesCfg.easing === 'easeIn' ? 'ease-in'
                : _statesCfg.easing === 'easeOut' ? 'ease-out'
                : (_statesCfg.easing ?? 'ease');
      const _trans = [..._allProps].map(p => {
        const cssProp = p.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
        return `${cssProp} ${_statesCfg.duration}ms ${_tf}`;
      });
      animStatesParts.push(`"transition": "${_trans.join(', ')}"`);
    }
  }

  // style (inline) — emit as a proper JS object so dynamic values are expressions, not strings
  if (node.props?.style && typeof node.props.style === 'object' && Object.keys(node.props.style as object).length > 0) {
    const styleObj = node.props.style as Record<string, unknown>;
    // If style is a formula block ({ js: "..." }, { formula: "..." }, { var: "..." }),
    // evaluate it as a whole and spread into style={{}} rather than treating "js" as a CSS property name.
    if ('js' in styleObj || 'formula' in styleObj || 'var' in styleObj) {
      const styleExpr = rewritePropValue(styleObj, ctx.symbols, inMapScope);
      if (animStatesParts.length > 0) {
        propsLines.push(`style={{ ...${styleExpr}, ${animStatesParts.join(', ')} }}`);
      } else {
        propsLines.push(`style={${styleExpr}}`);
      }
      // skip per-property iteration below
    } else {
    const styleParts: string[] = [];
    // React Native / non-CSS style props to strip out
    const RN_STYLE_PROPS = new Set([
      'shadowColor', 'shadowOffset', 'shadowRadius', 'shadowOpacity', 'elevation',
      'tintColor', 'underlayColor', 'activeOpacity', 'hitSlop', 'pressRetentionOffset',
      'resizeMode', 'overlayColor', 'fadeDuration', 'progressTintColor', 'trackTintColor',
      'thumbTintColor', 'minimumTrackTintColor', 'maximumTrackTintColor',
    ]);
    // React Native transform shorthands → combine into CSS transform string
    const RN_TRANSFORM_FUNS: Record<string, string> = {
      translateX: 'translateX', translateY: 'translateY', translateZ: 'translateZ',
      scaleX: 'scaleX', scaleY: 'scaleY', scale: 'scale',
      rotateX: 'rotateX', rotateY: 'rotateY', rotateZ: 'rotateZ', rotate: 'rotate',
      skewX: 'skewX', skewY: 'skewY',
    };
    const transformParts: string[] = [];
    let existingTransform: string | null = null;
    for (const [k, v] of Object.entries(styleObj)) {
      // Skip Tailwind JIT class names used incorrectly as CSS property keys (e.g. "border-[1px]")
      if (k.includes('[') || k.includes(']')) continue;
      // Skip React Native-only style props
      if (RN_STYLE_PROPS.has(k)) continue;
      // Collect RN transform shorthands to merge with any existing transform
      if (RN_TRANSFORM_FUNS[k]) {
        if (v && typeof v === 'object' && ('formula' in (v as object) || 'js' in (v as object))) {
          // Formula/JS binding — emit as a dynamic expression: translateX(${expr})
          const expr = rewritePropValue(v, ctx.symbols, inMapScope);
          styleParts.push(`"transform": \`${RN_TRANSFORM_FUNS[k]}(\${${expr}})\``);
        } else {
          const val = String(v ?? '0');
          transformParts.push(`${RN_TRANSFORM_FUNS[k]}(${val})`);
        }
        continue;
      }
      // Capture existing transform separately so we can merge RN transforms into it
      if (k === 'transform') {
        if (typeof v === 'string') {
          existingTransform = v;
        } else if (v && typeof v === 'object') {
          const obj = v as Record<string, unknown>;
          // Formula/JS binding — rewrite to expression
          if ('formula' in obj || 'js' in obj) {
            const expr = rewritePropValue(v, ctx.symbols, inMapScope);
            styleParts.push(`"transform": ${expr}`);
          }
          // RN transform array: [{translateX: 10}, {rotate: '45deg'}]
          else if (Array.isArray(v)) {
            const parts = (v as Record<string, unknown>[]).map(t => {
              const [tnKey, tnVal] = Object.entries(t)[0] ?? [];
              if (tnKey) return `${tnKey}(${tnVal})`;
              return '';
            }).filter(Boolean);
            if (parts.length) existingTransform = parts.join(' ');
          }
          // Single RN transform object {translateX: 10}
          else {
            const parts = Object.entries(obj).map(([tnKey, tnVal]) => `${tnKey}(${tnVal})`);
            if (parts.length) existingTransform = parts.join(' ');
          }
        }
        continue;
      }
      // Always run through rewritePropValue so formula/js bindings become live expressions
      const expr = rewritePropValue(v, ctx.symbols, inMapScope);
      styleParts.push(`${JSON.stringify(k)}: ${expr}`);
    }
    // Merge any existing `transform` with collected RN shorthand transforms
    const allTransforms = [
      ...(existingTransform ? [existingTransform] : []),
      ...transformParts,
    ];
    if (allTransforms.length > 0) {
      styleParts.push(`"transform": "${allTransforms.join(' ')}"`);
    }
    if (styleParts.length > 0 || animStatesParts.length > 0) {
      propsLines.push(`style={{ ${[...styleParts, ...animStatesParts].join(', ')} }}`);
    }
    } // end else (per-property style iteration)
  } else if (animStatesParts.length > 0) {
    // No static style on this node, but animation.states contributes dynamic styles
    propsLines.push(`style={{ ${animStatesParts.join(', ')} }}`);
  }

  // Component-specific props
  // Always skip React Native / engine-internal props that have no HTML equivalent
  const skipProps = new Set([
    'className', 'style', 'role', 'as', 'children',
    // Handled separately via animationToMotionProps
    'animation',
    // `disabled` on non-form elements is handled via the overlay wrapper below.
    // On form elements it IS a valid HTML attribute and should be emitted.
    ...(!disabledIsOnFormEl ? ['disabled'] : []),
    // React Native props
    'secureTextEntry', 'keyboardType', 'placeholderTextColor',
    'editable', 'numberOfLines', 'multiline', 'returnKeyType',
    'enablesReturnKeyAutomatically', 'onChangeText', 'onSubmitEditing',
    'scrollEnabled', 'showsVerticalScrollIndicator', 'showsHorizontalScrollIndicator',
    'contentContainerStyle', 'testID',
    // Engine-internal props
    'variant', 'size',
  ]);

  if (node.type === 'Icon') {
    const rawIcon = node.props?.icon ?? node.props?.name;
    // No icon name configured → render nothing (matches engine's IconifyIcon `if (!icon) return null`)
    if (!rawIcon) {
      return { jsx: '', imports, useEffects: [] };
    }
    const icon = rewritePropValue(rawIcon, ctx.symbols, inMapScope);
    propsLines.push(`icon={${icon}}`);
    const rawSize = node.props?.size ?? node.props?.width ?? node.props?.height;
    // Convert Tailwind size tokens to pixel numbers
    const ICON_SIZE_MAP: Record<string, number> = {
      xs: 12, sm: 16, md: 20, base: 20, lg: 24, xl: 32, '2xl': 40, '3xl': 48, '4xl': 56,
    };
    const resolvedSize = typeof rawSize === 'string' && ICON_SIZE_MAP[rawSize]
      ? ICON_SIZE_MAP[rawSize]
      : rawSize;
    // Always emit width/height. Default to 24 to match IconifyIcon.tsx's `size = 24` default.
    // text-[Npx] is stripped from className (it only sets font-size on <img>, not box size),
    // so explicit props or this fallback are the only size source.
    const finalSize = resolvedSize ?? 24;
    propsLines.push(`width={${rewritePropValue(finalSize, ctx.symbols, inMapScope)}}`);
    propsLines.push(`height={${rewritePropValue(finalSize, ctx.symbols, inMapScope)}}`);
    // Emit `color` only from the explicit node prop — this mirrors how IconifyIcon.tsx embeds
    // the color in the CDN URL (?color=encodedHex). Colors that only exist as text-[#hex]
    // className classes are stripped above and NOT emitted here: in the builder those classes
    // have no effect on the <img> CDN URL (which uses ?color=currentColor), so we preserve that
    // black/inherited-color behavior rather than unexpectedly coloring the icon in the export.
    const iconColor = node.props?.color as string | undefined;
    if (iconColor) {
      propsLines.push(`color={${rewritePropValue(iconColor, ctx.symbols, inMapScope)}}`);
    }
    skipProps.add('icon').add('name').add('size').add('width').add('height').add('color');
  }

  if (node.type === 'Image') {
    const src = rewritePropValue(node.props?.src ?? node.props?.uri ?? '', ctx.symbols, inMapScope);
    const alt = rewritePropValue(node.props?.alt ?? '', ctx.symbols, inMapScope);
    propsLines.push(`src={${src}}`);
    propsLines.push(`alt={${alt}}`);

    // Next.js Image: `fill` and `width`/`height` are mutually exclusive.
    // When fill=true the image fills its parent container (parent must be position:relative).
    const isFill = !!(node.props as Record<string, unknown>)?.fill;
    if (!isFill) {
      const w = node.props?.width ?? 400;
      const h = node.props?.height ?? 300;
      propsLines.push(`width={${rewritePropValue(w, ctx.symbols, inMapScope)}}`);
      propsLines.push(`height={${rewritePropValue(h, ctx.symbols, inMapScope)}}`);
    }

    // NativeWind's Image component defaults: resizeMode=cover (→ objectFit:cover) + display:block.
    // display:block removes the inline-baseline gap browsers add below <img> elements.
    // fill images are positioned absolute by Next.js so display:block is redundant; only add
    // objectFit as a style default for fill images. Both are overridden if the node has
    // explicit style props — those are merged in the CSS_ONLY_PROPS block below.
    const hasExplicitObjectFit = Object.prototype.hasOwnProperty.call(node.props ?? {}, 'objectFit');
    if (isFill) {
      if (!hasExplicitObjectFit) propsLines.push(`style={{ objectFit: 'cover' }}`);
    } else {
      if (!hasExplicitObjectFit) {
        propsLines.push(`style={{ objectFit: 'cover', display: 'block' }}`);
      } else {
        propsLines.push(`style={{ display: 'block' }}`);
      }
    }

    skipProps.add('src').add('uri').add('alt').add('width').add('height');
  }

  if (node.type === 'Video') {
    const src = rewritePropValue(node.props?.src ?? '', ctx.symbols, inMapScope);
    if (src) propsLines.push(`src={${src}}`);
    // Always add playsInline so autoPlay works on iOS without entering full-screen
    propsLines.push(`playsInline`);
    // Mirror builder Video default: muted=true (browser default is unmuted).
    const hasMuted = Object.prototype.hasOwnProperty.call(node.props ?? {}, 'muted');
    if (!hasMuted) propsLines.push(`muted`);
    skipProps.add('src').add('playsInline');
  }

  if (node.type === 'Iframe') {
    const src = rewritePropValue(node.props?.src ?? node.props?.uri ?? '', ctx.symbols, inMapScope);
    if (src) propsLines.push(`src={${src}}`);
    skipProps.add('src').add('uri');
  }

  if (node.type === 'LottiePlayer') {
    const src = node.props?.src ?? node.props?.uri ?? node.props?.source;
    if (src) {
      const srcExpr = rewritePropValue(src, ctx.symbols, inMapScope);
      // lottie-react uses `path` for URL-based animations
      propsLines.push(`path={${srcExpr}}`);
    }
    propsLines.push(`autoplay`);
    propsLines.push(`loop`);
    const w = node.props?.width;
    const h = node.props?.height;
    if (w) propsLines.push(`width={${rewritePropValue(w, ctx.symbols, inMapScope)}}`);
    if (h) propsLines.push(`height={${rewritePropValue(h, ctx.symbols, inMapScope)}}`);
    skipProps.add('src').add('uri').add('source').add('autoplay').add('loop').add('width').add('height');
  }

  if (node.type === 'Input' || node.type === 'InputField') {
    const placeholder = rewritePropValue(node.props?.placeholder ?? '', ctx.symbols, inMapScope);
    // `secureTextEntry` is React Native for password fields → convert to type="password"
    const isPassword = node.props?.secureTextEntry === true || node.props?.secureTextEntry === 'true';
    const inputType = isPassword
      ? '"password"'
      : rewritePropValue(node.props?.type ?? node.props?.inputType ?? 'text', ctx.symbols, inMapScope);
    propsLines.push(`type={${inputType}}`);
    if (placeholder !== "''") propsLines.push(`placeholder={${placeholder}}`);

    // Wire RHF register() for inputs inside a FormContainer
    const fieldName = (node.props?.name ?? node.props?.formFieldName ?? (node as Record<string, unknown>).name) as string | undefined;
    if (formDepth > 0 && fieldName) {
      const rulesStr = buildRhfRulesStr((node as Record<string, unknown>)._validation);
      const registerArgs = rulesStr
        ? `${JSON.stringify(fieldName)}, ${rulesStr}`
        : JSON.stringify(fieldName);
      propsLines.push(`{...form?.register?.(${registerArgs})}`);
    } else {
      // Outside a FormContainer: sync value to state.variables['{nodeId}-value'] on change.
      // If the node was extracted as a sub-component (_inputVarNodeIds), emitNodeInner already
      // returned early above — this branch only runs for inputs that couldn't be extracted
      // (e.g. dynamic className/placeholder). For those, emit a plain direct setState.
      // node.id may be absent for template nodes — fall back to _inputValueId injected by resolve.ts.
      const syncId = node.id ?? (node as Record<string, unknown>)._inputValueId;
      if (syncId) {
        const varKey = JSON.stringify(`${syncId}-value`);
        propsLines.push(`onChange={(e: any) => { const _v = e?.target?.value; useStore.setState((s) => ({ ...s, variables: { ...s.variables, ${varKey}: _v } })); }}`);
      }
    }

    // Skip RN-specific props that have no HTML equivalent
    ['type', 'inputType', 'placeholder', 'secureTextEntry', 'keyboardType',
      'placeholderTextColor', 'size', 'variant', 'format', 'name', 'formFieldName',
    ].forEach(p => skipProps.add(p));
  }

  if (node.type === 'Textarea' || node.type === 'TextareaInput') {
    const placeholder = rewritePropValue(node.props?.placeholder ?? '', ctx.symbols, inMapScope);
    if (placeholder !== "''") propsLines.push(`placeholder={${placeholder}}`);

    // Wire RHF register() for textareas inside a FormContainer
    const textareaFieldName = (node.props?.name ?? (node as Record<string, unknown>).name) as string | undefined;
    if (formDepth > 0 && textareaFieldName) {
      const rulesStr2 = buildRhfRulesStr((node as Record<string, unknown>)._validation);
      const regArgs2 = rulesStr2
        ? `${JSON.stringify(textareaFieldName)}, ${rulesStr2}`
        : JSON.stringify(textareaFieldName);
      propsLines.push(`{...form?.register?.(${regArgs2})}`);
    } else {
      const taSyncId = node.id ?? (node as Record<string, unknown>)._inputValueId;
      if (taSyncId) {
        const taVarKey = JSON.stringify(`${taSyncId}-value`);
        propsLines.push(`onChange={(e: any) => { const _v = e?.target?.value; useStore.setState((s) => ({ ...s, variables: { ...s.variables, ${taVarKey}: _v } })); }}`);
      }
    }

    skipProps.add('placeholder').add('name').add('formFieldName');
  }

  if (node.type === 'HtmlContent') {
    const html = rewritePropValue(node.props?.html ?? node.props?.content ?? '', ctx.symbols, inMapScope);
    propsLines.push(`dangerouslySetInnerHTML={{ __html: ${html} }}`);
    skipProps.add('html').add('content');
  }

  if (node.type === 'FormContainer') {
    // These are engine/RHF internal props that have no valid HTML attribute or React DOM equivalent
    ['initialFormData', 'onValidationErrorAction', 'triggerOnChange',
      'validationMode', 'revalidateMode', 'resolver', 'formId',
    ].forEach(p => skipProps.add(p));

    // Fallback: if the FormContainer has no bound submit action, add a bare preventDefault handler
    // so native form submission (page reload) never fires. When there IS a submit action, the
    // binding handler already includes preventDefault (see bindings.ts).
    // Note: allWorkflowMeta is defined below, so we build our own lookup from ctx.store here.
    const _wfMeta = (ctx.store.workflows ?? {}) as Record<string, { trigger?: string }>;
    const hasSubmitAction = Array.isArray(node.actions)
      ? (node.actions as Array<{trigger?: string; action?: string}>).some(a => {
          const trigger = a.trigger ?? _wfMeta[a.action ?? '']?.trigger;
          return trigger === 'submit';
        })
      : node.actions != null && Object.keys(node.actions as object).includes('submit');
    if (!hasSubmitAction) {
      propsLines.push(`onSubmit={(e?: unknown) => { (e as Event)?.preventDefault?.(); }}`);
    }
  }

  // Props that are CSS-only (not valid HTML attributes) → must go in style object
  const CSS_ONLY_PROPS = new Set([
    'objectFit', 'objectPosition', 'backgroundImage', 'backgroundSize', 'backgroundPosition',
    'backgroundRepeat', 'backdropFilter', 'filter', 'mixBlendMode', 'isolation',
    'aspectRatio', 'gap', 'rowGap', 'columnGap', 'gridTemplate',
    'gridTemplateColumns', 'gridTemplateRows', 'gridArea', 'gridColumn', 'gridRow',
    'flexShrink', 'flexGrow', 'flexBasis', 'order', 'alignSelf', 'justifySelf',
    'transform', 'transformOrigin', 'perspective', 'resize',
    'userSelect', 'pointerEvents', 'cursor', 'opacity',
    'overflow', 'overflowX', 'overflowY', 'overflowWrap', 'wordBreak',
    'textOverflow', 'whiteSpace', 'letterSpacing', 'lineHeight', 'textDecoration',
    'textTransform', 'fontStyle', 'fontVariant', 'textAlign', 'verticalAlign',
    'listStyle', 'listStyleType', 'counterReset',
    'borderCollapse', 'borderSpacing', 'captionSide',
    'boxSizing', 'outline', 'outlineColor', 'outlineWidth', 'outlineOffset',
    'willChange', 'appearance', 'contentVisibility',
    'scrollSnapType', 'scrollSnapAlign', 'scrollBehavior',
  ]);

  const extraStyleParts: string[] = [];

  // Remaining props
  for (const [key, value] of Object.entries((node.props as Record<string, unknown>) ?? {})) {
    if (skipProps.has(key)) continue;
    if (key.startsWith('_') || key === 'text') continue; // internal
    if (value === undefined || value === null) continue;

    // Redirect CSS-only props to extra style accumulator
    if (CSS_ONLY_PROPS.has(key)) {
      const expr = rewritePropValue(value, ctx.symbols, inMapScope);
      extraStyleParts.push(`${JSON.stringify(key)}: ${expr}`);
      continue;
    }

    const expr = rewritePropValue(value, ctx.symbols, inMapScope);

    // Boolean attrs
    if (expr === 'true') {
      propsLines.push(key);
    } else if (expr === 'false') {
      // skip false boolean
    } else if (typeof value === 'string' && !value.includes('{{') && !(value as string).startsWith('{')) {
      propsLines.push(`${key}="${value}"`);
    } else {
      propsLines.push(`${key}={${expr}}`);
    }
  }

  // Merge CSS-only props into style (if any were accumulated)
  if (extraStyleParts.length > 0) {
    // Find and extend the existing style prop, or create a new one
    const styleIdx = propsLines.findIndex(l => l.startsWith('style='));
    if (styleIdx >= 0) {
      // Extend: style={{ ...existing, ...extra }}
      const existing = propsLines[styleIdx]!;
      const inner = existing.slice('style={{ '.length, -' }}'.length);
      propsLines[styleIdx] = `style={{ ${inner}, ${extraStyleParts.join(', ')} }}`;
    } else {
      propsLines.push(`style={{ ${extraStyleParts.join(', ')} }}`);
    }
  }

  // Framer Motion props
  for (const [propName, propVal] of Object.entries(animMotionProps)) {
    propsLines.push(`${propName}={${propVal}}`);
  }

  // Action props
  const allWorkflowMeta = ctx.store.workflows ?? {};
  const actionProps = buildActionProps(
    node.actions as Record<string, unknown> | unknown[],
    ctx.symbols,
    allWorkflowMeta,
    node.type as string,
    inMapScope,
  );
  propsLines.push(...actionProps);

  // Drag-with-noVisualMove → pointer event handler (e.g. Slider track).
  // Builder uses Framer Motion drag + dragUpdate/dragStart/dragEnd with event.percentX.
  // In the export we use pointer events + getBoundingClientRect to compute the same percentX,
  // then run the __inlineCode that was pre-compiled by inlineScWorkflows (which references `event`).
  const dragCfg = (node.animation as Record<string, unknown> | undefined)?.drag as Record<string, unknown> | undefined;
  if (dragCfg?.enabled && dragCfg?.noVisualMove && Array.isArray(node.actions)) {
    type DragActionRef = { action?: string; trigger?: string; __inlineCode?: string };
    const dragActions = node.actions as DragActionRef[];
    const getCode = (trigger: string): string | null => {
      for (const a of dragActions) {
        const t = a.trigger ?? allWorkflowMeta[a.action ?? '']?.trigger;
        if (t === trigger && a.__inlineCode) return a.__inlineCode;
      }
      return null;
    };
    const startCode = getCode('dragStart');
    const updateCode = getCode('dragUpdate');
    const endCode = getCode('dragEnd');

    if (startCode || updateCode || endCode) {
      const handlerLines: string[] = [];
      handlerLines.push(`async (e: React.PointerEvent<HTMLDivElement>) => {`);
      handlerLines.push(`  e.currentTarget.setPointerCapture(e.pointerId);`);
      handlerLines.push(`  const _el = e.currentTarget;`);
      handlerLines.push(`  const _pct = (cx: number) => { const _r = _el.getBoundingClientRect(); return Math.max(0, Math.min(1, (cx - _r.left) / (_r.width || 1))); };`);
      if (startCode) {
        handlerLines.push(`  { const event = { percentX: _pct(e.clientX) }; void event; ${startCode} }`);
      }
      if (updateCode) {
        handlerLines.push(`  const _mv = (me: PointerEvent) => { const event = { percentX: _pct(me.clientX) }; void event; ${updateCode} };`);
        handlerLines.push(`  window.addEventListener('pointermove', _mv);`);
      }
      const upLines: string[] = [];
      upLines.push(`  const _up = (ue: PointerEvent) => {`);
      if (endCode) upLines.push(`    const event = { percentX: _pct(ue.clientX) }; void event; ${endCode}`);
      if (updateCode) upLines.push(`    window.removeEventListener('pointermove', _mv);`);
      upLines.push(`    window.removeEventListener('pointerup', _up);`);
      upLines.push(`  };`);
      upLines.push(`  window.addEventListener('pointerup', _up);`);
      handlerLines.push(...upLines);
      handlerLines.push(`}`);
      propsLines.push(`onPointerDown={${handlerLines.join('\n')}}`);
    }
  }

  // Standard drag (e.g. Kanban cards) — translationX/Y + containerWidth event shape.
  // Used when drag.enabled is true but noVisualMove is NOT set (Framer Motion visual drag).
  // Actions reference external workflow functions (not __inlineCode), so we call them directly
  // with { translationX, translationY, containerWidth } matching Framer Motion's event shape.
  if (dragCfg?.enabled && !dragCfg?.noVisualMove && Array.isArray(node.actions)) {
    type DragActionRef = { action?: string; trigger?: string; __inlineCode?: string };
    const dragActions = node.actions as DragActionRef[];
    const getWfName = (trigger: string): string | null => {
      for (const a of dragActions) {
        const t = a.trigger ?? allWorkflowMeta[a.action ?? '']?.trigger;
        if (t !== trigger) continue;
        // Prefer inlined code, fall back to workflow function name
        if (a.__inlineCode) return `__inline__:${a.__inlineCode}`;
        const fn = a.action ? ctx.symbols.workflows.get(a.action) : null;
        if (fn) return fn;
      }
      return null;
    };
    const startWf  = getWfName('dragStart');
    const updateWf = getWfName('dragUpdate');
    const endWf    = getWfName('dragEnd');

    if (startWf || updateWf || endWf) {
      // inMapScope means _item is available — pass it as context so workflows can read context.item.data
      const itemCtxExpr = inMapScope ? `, context: { item: _item }` : '';
      const wfCall = (wf: string, evtExpr: string): string => {
        if (wf.startsWith('__inline__:')) {
          const code = wf.slice('__inline__:'.length);
          return `{ const event = ${evtExpr}; void event; ${code} }`;
        }
        imports.addNamed('../../lib/actions', wf);
        return `void ${wf}({ state: useStore.getState(), dispatch: useStore.setState, router, api: {}, form, popover, event: ${evtExpr}${itemCtxExpr} });`;
      };
      const evtStart  = `{ translationX: 0, translationY: 0, containerWidth: _cw }`;
      const evtMove   = `{ translationX: me.clientX - _sx, translationY: me.clientY - _sy, containerWidth: _cw }`;
      const evtEnd    = `{ translationX: ue.clientX - _sx, translationY: ue.clientY - _sy, containerWidth: _cw }`;

      const h: string[] = [];
      h.push(`async (e: React.PointerEvent<HTMLDivElement>) => {`);
      h.push(`  e.preventDefault();`);
      h.push(`  e.currentTarget.setPointerCapture(e.pointerId);`);
      h.push(`  const _el = e.currentTarget as HTMLElement;`);
      h.push(`  const _sx = e.clientX, _sy = e.clientY;`);
      h.push(`  const _rect = _el.getBoundingClientRect();`);
      h.push(`  const _cw = (_el.closest('[class*="flex-1"]') as HTMLElement|null)?.getBoundingClientRect().width ?? 200;`);
      // Create a fixed-position clone that follows the pointer (fully opaque drag preview).
      // The original element stays in its slot and shows as the ghost (React renders opacity:0.3 on it).
      h.push(`  const _clone = _el.cloneNode(true) as HTMLElement;`);
      h.push(`  _clone.style.cssText = 'position:fixed;left:'+_rect.left+'px;top:'+_rect.top+'px;width:'+_rect.width+'px;pointer-events:none;z-index:1000;opacity:1;margin:0;box-sizing:border-box;';`);
      h.push(`  document.body.appendChild(_clone);`);
      // Hide the original slot element so it appears empty (only the clone is visible)
      h.push(`  _el.style.setProperty('opacity', '0', 'important');`);
      h.push(`  document.body.style.cursor = 'grabbing';`);
      if (startWf)  h.push(`  ${wfCall(startWf, evtStart)}`);
      if (updateWf) {
        h.push(`  const _mv = async (me: PointerEvent) => {`);
        h.push(`    const _tx = me.clientX - _sx, _ty = me.clientY - _sy;`);
        h.push(`    _clone.style.transform = \`translate(\${_tx}px, \${_ty}px)\`;`);
        h.push(`    ${wfCall(updateWf, `{ translationX: me.clientX - _sx, translationY: me.clientY - _sy, containerWidth: _cw }`)}`);
        h.push(`  };`);
        h.push(`  window.addEventListener('pointermove', _mv as EventListener);`);
      }
      h.push(`  const _up = async (ue: PointerEvent) => {`);
      h.push(`    _clone.remove();`);
      h.push(`    _el.style.removeProperty('opacity');`);
      h.push(`    document.body.style.cursor = '';`);
      if (endWf)    h.push(`    ${wfCall(endWf, evtEnd)}`);
      if (updateWf) h.push(`    window.removeEventListener('pointermove', _mv as EventListener);`);
      h.push(`    window.removeEventListener('pointerup', _up as EventListener);`);
      h.push(`  };`);
      h.push(`  window.addEventListener('pointerup', _up as EventListener);`);
      h.push(`}`);
      propsLines.push(`onPointerDown={${h.join('\n')}}`);
    }
  }

  // Swipe gesture (e.g. Carousel) — animation.gesture.swipe: true with onSwipeLeftAction / onSwipeRightAction.
  // Converts pointer events into a left/right swipe with a 50px threshold.
  const swipeCfg = (animConfig as Record<string, unknown> | undefined)?.gesture as Record<string, unknown> | undefined;
  if (swipeCfg?.swipe === true) {
    const leftAction  = swipeCfg.onSwipeLeftAction  as string | undefined;
    const rightAction = swipeCfg.onSwipeRightAction as string | undefined;
    const leftFn  = leftAction  ? ctx.symbols.workflows.get(leftAction)  : null;
    const rightFn = rightAction ? ctx.symbols.workflows.get(rightAction) : null;
    if (leftFn || rightFn) {
      if (leftFn)  imports.addNamed(`../../lib/actions`, leftFn);
      if (rightFn) imports.addNamed(`../../lib/actions`, rightFn);
      const leftCall  = leftFn  ? `void ${leftFn}({ state: useStore.getState(), dispatch: useStore.setState, router, api: {}, form, popover, event: undefined });` : '';
      const rightCall = rightFn ? `void ${rightFn}({ state: useStore.getState(), dispatch: useStore.setState, router, api: {}, form, popover, event: undefined });` : '';
      const h: string[] = [];
      h.push(`(e: React.PointerEvent<HTMLDivElement>) => {`);
      h.push(`  e.preventDefault();`);
      h.push(`  e.currentTarget.setPointerCapture(e.pointerId);`);
      h.push(`  const _el = e.currentTarget as HTMLElement;`);
      h.push(`  const _sx = e.clientX;`);
      // Slide width = the overflow container's width (one slide at a time is visible)
      h.push(`  const _slideW = (_el.parentElement?.offsetWidth ?? _el.offsetWidth) || 1;`);
      // Read current translateX% from the React-applied inline style (e.g. "translateX(-100%)")
      h.push(`  const _curM = (_el.style.transform || '').match(/translateX\\((-?[\\d.]+)%\\)/);`);
      h.push(`  const _curPct = _curM ? parseFloat(_curM[1]) : 0;`);
      // Disable transition so dragging feels instant
      h.push(`  _el.style.transition = 'none';`);
      // Live drag: track follows the pointer
      h.push(`  const _mv = (me: PointerEvent) => {`);
      h.push(`    const _dx = me.clientX - _sx;`);
      h.push(`    _el.style.transform = \`translateX(calc(\${_curPct}% + \${_dx}px))\`;`);
      h.push(`  };`);
      h.push(`  window.addEventListener('pointermove', _mv as EventListener);`);
      h.push(`  const _up = (ue: PointerEvent) => {`);
      h.push(`    window.removeEventListener('pointermove', _mv as EventListener);`);
      h.push(`    window.removeEventListener('pointerup', _up as EventListener);`);
      h.push(`    const _dx = ue.clientX - _sx;`);
      // Determine target percentage, clamp to valid range
      h.push(`    const _tgtPct = _dx < -50 ? _curPct - 100 : _dx > 50 ? _curPct + 100 : _curPct;`);
      // Clamp: assumes slides are at 0%, -100%, -200%, etc. Max negative = -(slideCount-1)*100%
      h.push(`    const _clampedPct = Math.max(-200, Math.min(0, _tgtPct));`);
      // Snap to target with transition, then call workflow to sync React state
      h.push(`    _el.style.transition = 'transform 400ms ease-in-out';`);
      h.push(`    _el.style.transform = \`translateX(\${_clampedPct}%)\`;`);
      if (leftFn)  h.push(`    if (_dx < -50) { ${leftCall} }`);
      if (rightFn) h.push(`    if (_dx > 50)  { ${rightCall} }`);
      h.push(`  };`);
      h.push(`  window.addEventListener('pointerup', _up as EventListener);`);
      h.push(`}`);
      propsLines.push(`onPointerDown={${h.join('\n')}}`);
    }
  }

  // Lifecycle triggers → useEffect entries
  const lifecycleTriggers = extractLifecycleTriggers(
    node.actions as Record<string, unknown> | unknown[],
    allWorkflowMeta,
    ctx.symbols,
  );
  for (const { wfName } of lifecycleTriggers) {
    useEffects.push(
      `useEffect(() => { void ${wfName}({ state: useStore.getState(), dispatch: useStore.setState, router, api: {}, form, popover }); }, []);`,
    );
  }

  // Build children — for popover nodes, separate trigger children from _popoverContent children
  const allChildNodes = (node.children ?? []) as AnyNode[];
  let triggerChildNodes = allChildNodes;
  let popoverContentNodes: AnyNode[] = [];
  if (node.popover) {
    triggerChildNodes = allChildNodes.filter(c => !c._popoverContent);
    popoverContentNodes = allChildNodes.filter(c => c._popoverContent);
  }

  const childResults: NodeEmitResult[] = triggerChildNodes.map(child =>
    emitNode(child, ctx, imports, usedAnimations, inMapScope, depth + 1, nextFormDepth),
  );
  const childJsx = childResults.map(r => r.jsx).join('\n');
  childResults.forEach(r => useEffects.push(...r.useEffects));

  // Text content
  let textContent = '';
  if (node.text != null) {
    const textExpr = rewriteTextValue(
      node.text as string | Record<string, unknown>,
      ctx.symbols,
      inMapScope,
    );
    textContent = `{${textExpr}}`;
  }

  // Popover wrapping
  if (node.popover) {
    return emitPopoverNode(node, propsLines, tag, textContent, childJsx, popoverContentNodes, ctx, imports, useEffects, ind, childInd, depth, inMapScope);
  }

  // Build the JSX element
  const propsStr = propsLines.length > 0 ? '\n' + propsLines.map(p => `${childInd}${p}`).join('\n') + '\n' + ind : '';
  const hasContent = textContent || childJsx;

  const rawJsx = (!hasContent && (prim.selfClose || triggerChildNodes.length === 0 && !textContent))
    ? `${ind}<${tag}${propsStr}/>`
    : `${ind}<${tag}${propsStr}>\n${textContent ? childInd + textContent + '\n' : ''}${childJsx ? childJsx + '\n' : ''}${ind}</${tag}>`;

  // Disabled overlay — mirrors renderWithDisabledOverlay in renderer-node-props.tsx.
  // The engine wraps disabled nodes in position:relative + an absolutely-positioned
  // semi-transparent overlay (rgba black at 30% by default) with pointerEvents:'all'
  // to visually dim and block interaction. _disabledOverlay can customise color/opacity/blur.
  if (staticDisabled || formulaDisabledExpr) {
    const ov = (node as Record<string, unknown>)._disabledOverlay as
      | { color?: string; opacity?: number; blur?: number } | undefined;
    const hex   = ov?.color   ?? '#000000';
    const alpha = ov?.opacity ?? 0.3;
    const r = parseInt(hex.slice(1, 3) || '00', 16) || 0;
    const g = parseInt(hex.slice(3, 5) || '00', 16) || 0;
    const b = parseInt(hex.slice(5, 7) || '00', 16) || 0;
    const blurStyle = ov?.blur ? `, backdropFilter: 'blur(${ov.blur}px)', WebkitBackdropFilter: 'blur(${ov.blur}px)'` : '';
    const overlayDiv = `${ind}  <div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'all', backgroundColor: 'rgba(${r}, ${g}, ${b}, ${alpha})', borderRadius: 'inherit'${blurStyle} }} />`;
    const wrappedJsx = `${ind}<div style={{ position: 'relative' }} data-disabled="true">\n${rawJsx}\n${overlayDiv}\n${ind}</div>`;

    if (staticDisabled) {
      return { jsx: wrappedJsx, useEffects };
    }
    // Formula-based: conditionally wrap
    return {
      jsx: `${ind}{(${formulaDisabledExpr}) ? (\n${wrappedJsx}\n${ind}) : (\n${rawJsx}\n${ind})}`,
      useEffects,
    };
  }

  return { jsx: rawJsx, useEffects };
}

function emitPopoverNode(
  node: AnyNode,
  propsLines: string[],
  tag: string,
  textContent: string,
  childJsx: string,
  popoverContentNodes: AnyNode[],
  ctx: CodegenCtx,
  imports: ImportsTracker,
  useEffects: string[],
  ind: string,
  childInd: string,
  depth: number,
  inMapScope: boolean,
): NodeEmitResult {
  const popsConfig = node.popover as unknown as Record<string, unknown>;
  const isHoverTrigger = popsConfig?.trigger === 'hover';

  const side = popsConfig?.side ?? popsConfig?.placement?.toString().split('-')[0] ?? 'bottom';
  const align = (() => {
    const placement = popsConfig?.placement?.toString() ?? '';
    if (placement.endsWith('-start')) return 'start';
    if (placement.endsWith('-end')) return 'end';
    return popsConfig?.align ?? 'center';
  })();

  const triggerContent = textContent || childJsx;

  // Popover content: prefer nodes with _popoverContent:true, then popover.content children
  const configContentChildren = (popsConfig?.content ?? popsConfig?.children) as AnyNode[] | undefined;
  const allPopoverContent = [
    ...popoverContentNodes,
    ...(configContentChildren ?? []),
  ];

  let popoverContentJsx = '';
  if (allPopoverContent.length > 0) {
    popoverContentJsx = allPopoverContent.map(c =>
      emitNode(c, ctx, imports, new Set(), inMapScope, depth + 2).jsx
    ).join('\n');
  }

  // Hover-trigger → pure CSS/JS tooltip, no library needed.
  // `relative` + `w-max` are injected into the trigger's own className so the absolute-positioned
  // tooltip is always anchored to the trigger's actual size, not a stretched flex-item wrapper.
  if (isHoverTrigger) {
    const nodeId = node.id && node.id !== 'root' ? node.id : `tooltip-${Math.random().toString(36).slice(2, 8)}`;
    const offset = Number(popsConfig?.offset ?? 6);

    // Map side+align → Tailwind position classes for the floating content div
    const posClass = (() => {
      const s = String(side);
      const a = String(align);
      const alignClsH = a === 'start' ? 'left-0' : a === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2';
      const alignClsV = a === 'start' ? 'top-0' : a === 'end' ? 'bottom-0' : 'top-1/2 -translate-y-1/2';
      if (s === 'top')    return `bottom-full mb-[${offset}px] ${alignClsH}`;
      if (s === 'bottom') return `top-full mt-[${offset}px] ${alignClsH}`;
      if (s === 'left')   return `right-full mr-[${offset}px] ${alignClsV}`;
      if (s === 'right')  return `left-full ml-[${offset}px] ${alignClsV}`;
      return `bottom-full mb-[${offset}px] ${alignClsH}`;
    })();

    const openExpr = `popoverState[${JSON.stringify(nodeId)}]`;
    const showFn   = `() => setPopoverState(s => ({ ...s, ${JSON.stringify(nodeId)}: true }))`;
    const hideFn   = `() => setPopoverState(s => ({ ...s, ${JSON.stringify(nodeId)}: false }))`;

    // Inject `relative w-max` into the trigger element's className so it sizes to its content
    // (prevents stretching as a flex item) and acts as the positioning context for the tooltip.
    const updatedProps = propsLines.map(p =>
      /^className=/.test(p)
        ? p.replace(/className="([^"]*)"/, (_, cls) => `className="${cls.trim()} relative w-max"`)
        : p
    );
    if (!updatedProps.some(p => /^className=/.test(p))) {
      updatedProps.push(`className="relative w-max"`);
    }

    return {
      jsx: [
        `${ind}<${tag} ${updatedProps.join(' ')} onMouseEnter={${showFn}} onMouseLeave={${hideFn}}>`,
        triggerContent ?? '',
        `${childInd}{${openExpr} && (`,
        `${childInd}  <div className="absolute ${posClass} z-50 pointer-events-none">`,
        popoverContentJsx,
        `${childInd}  </div>`,
        `${childInd})}`,
        `${ind}</${tag}>`,
      ].filter(l => l !== '').join('\n'),
      useEffects,
    };
  }

  // Click-trigger (default) → @radix-ui/react-popover
  imports.addNamed('@radix-ui/react-popover', 'Popover', 'PopoverTrigger', 'PopoverContent');

  // Use the node's id for controlled mode (workflows can target it by ID).
  // If no id, fall back to uncontrolled mode so multiple instances don't share state.
  const nodeId = node.id && node.id !== 'root' ? node.id : null;

  // For matchTriggerWidth popovers (like Select), use a relative-positioned wrapper
  const matchWidth = popsConfig?.matchTriggerWidth === true;
  const popoverContentProps = matchWidth
    ? `side="${side}" align="${align}" className="w-[var(--radix-popover-trigger-width)] p-0 outline-none"`
    : `side="${side}" align="${align}" className="outline-none"`;

  // Prefer componentVars-controlled open state (for shared components with an *-open variable)
  const controlled = (node as Record<string, unknown>)._popoverControlled as
    | { instanceId: string; openVar: string }
    | undefined;

  const openProps = controlled
    ? `open={state?.componentVars?.[${JSON.stringify(controlled.instanceId)}]?.[${JSON.stringify(controlled.openVar)}] ?? false} onOpenChange={(o) => useStore.setState(s => ({ ...s, componentVars: { ...s.componentVars, ${JSON.stringify(controlled.instanceId)}: { ...(s.componentVars?.[${JSON.stringify(controlled.instanceId)}] ?? {}), ${JSON.stringify(controlled.openVar)}: o } } }))}`
    : nodeId
      ? `open={popoverState[${JSON.stringify(nodeId)}]} onOpenChange={(o) => setPopoverState(s => ({ ...s, ${JSON.stringify(nodeId)}: o }))}`
      : `onOpenChange={(o) => {}}`;

  return {
    jsx: `${ind}<Popover ${openProps}>\n${childInd}<PopoverTrigger asChild>\n${childInd}  <${tag} ${propsLines.join(' ')}>\n${triggerContent ? triggerContent + '\n' : ''}${childInd}  </${tag}>\n${childInd}</PopoverTrigger>\n${childInd}<PopoverContent ${popoverContentProps}>\n${popoverContentJsx}\n${childInd}</PopoverContent>\n${ind}</Popover>`,
    useEffects,
  };
}
