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

  // Handle condition
  const condExpr = node.condition != null
    ? rewriteFormula(
        typeof node.condition === 'string' ? node.condition : JSON.stringify(node.condition),
        ctx.symbols,
        inMapScope,
      )
    : null;

  // Handle map/repeat
  if (node.map) {
    return emitMapNode(node, ctx, imports, usedAnimations, inMapScope, depth, formDepth);
  }

  const inner = emitNodeInner(node, ctx, imports, usedAnimations, inMapScope, depth, formDepth);

  if (condExpr) {
    return {
      jsx: `${ind}{(${condExpr}) && (\n${inner.jsx}\n${ind})}`,
      useEffects: inner.useEffects,
    };
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

  // Emit the template node (with map scope active)
  const templateNode = { ...node, map: undefined, mapKey: undefined } as AnyNode;
  const templateResult = emitNodeInner(templateNode, ctx, imports, usedAnimations, true, depth + 1, formDepth);

  const keyExpr = /^\d+$/.test(keyField)
    ? `index`
    : `String(item?.${keyField} ?? index)`;

  // If listExpr mixes || / && with the upcoming ??, wrap to satisfy operator precedence rules
  const safeListExpr = /\|\||&&/.test(listExpr) ? `(${listExpr})` : listExpr;

  // Inject key into the root element of the template JSX
  const jsxWithKey = templateResult.jsx.replace(
    /^(\s*<[\w.]+)/,
    `$1 key={${keyExpr}}`,
  );

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jsx: `${ind}{(${safeListExpr} ?? []).map((item: unknown, index: number) => {\n${ind}  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n${ind}  const _item = item as any;\n${ind}  return (\n${jsxWithKey}\n${ind}  );\n${ind}})}`,
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
  const className = (node.props?.className as string) ?? '';
  if (className) {
    propsLines.push(`className="${className}"`);
  }

  // style (inline) — emit as a proper JS object so dynamic values are expressions, not strings
  if (node.props?.style && typeof node.props.style === 'object' && Object.keys(node.props.style as object).length > 0) {
    const styleObj = node.props.style as Record<string, unknown>;
    // If style is a formula block ({ js: "..." }, { formula: "..." }, { var: "..." }),
    // evaluate it as a whole and spread into style={{}} rather than treating "js" as a CSS property name.
    if ('js' in styleObj || 'formula' in styleObj || 'var' in styleObj) {
      const styleExpr = rewritePropValue(styleObj, ctx.symbols, inMapScope);
      propsLines.push(`style={${styleExpr}}`);
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
        const val = String(v ?? '0');
        transformParts.push(`${RN_TRANSFORM_FUNS[k]}(${val})`);
        continue;
      }
      // Capture existing transform separately so we can merge RN transforms into it
      if (k === 'transform') {
        existingTransform = String(v ?? '');
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
    if (styleParts.length > 0) {
      propsLines.push(`style={{ ${styleParts.join(', ')} }}`);
    }
    } // end else (per-property style iteration)
  }

  // Component-specific props
  // Always skip React Native / engine-internal props that have no HTML equivalent
  const skipProps = new Set([
    'className', 'style', 'role', 'as', 'children',
    // Handled separately via animationToMotionProps
    'animation',
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
    const icon = rewritePropValue(node.props?.icon ?? node.props?.name ?? 'mdi:circle', ctx.symbols, inMapScope);
    propsLines.push(`icon={${icon}}`);
    const rawSize = node.props?.size ?? node.props?.width ?? node.props?.height;
    // Convert Tailwind size tokens to pixel numbers; fall back to 24 for unknown tokens
    const ICON_SIZE_MAP: Record<string, number> = {
      xs: 12, sm: 16, md: 20, base: 20, lg: 24, xl: 32, '2xl': 40, '3xl': 48, '4xl': 56,
    };
    const resolvedSize = typeof rawSize === 'string' && ICON_SIZE_MAP[rawSize]
      ? ICON_SIZE_MAP[rawSize]
      : rawSize;
    if (resolvedSize !== undefined && resolvedSize !== null) {
      propsLines.push(`width={${rewritePropValue(resolvedSize, ctx.symbols, inMapScope)}}`);
      propsLines.push(`height={${rewritePropValue(resolvedSize, ctx.symbols, inMapScope)}}`);
    }
    skipProps.add('icon').add('name').add('size').add('width').add('height');
  }

  if (node.type === 'Image') {
    const src = rewritePropValue(node.props?.src ?? node.props?.uri ?? '', ctx.symbols, inMapScope);
    const alt = rewritePropValue(node.props?.alt ?? '', ctx.symbols, inMapScope);
    propsLines.push(`src={${src}}`);
    propsLines.push(`alt={${alt}}`);
    const w = node.props?.width ?? 400;
    const h = node.props?.height ?? 300;
    propsLines.push(`width={${rewritePropValue(w, ctx.symbols, inMapScope)}}`);
    propsLines.push(`height={${rewritePropValue(h, ctx.symbols, inMapScope)}}`);
    skipProps.add('src').add('uri').add('alt').add('width').add('height');
  }

  if (node.type === 'Video') {
    const src = rewritePropValue(node.props?.src ?? '', ctx.symbols, inMapScope);
    if (src) propsLines.push(`src={${src}}`);
    skipProps.add('src');
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
    // Skip RN-specific props that have no HTML equivalent
    ['type', 'inputType', 'placeholder', 'secureTextEntry', 'keyboardType',
      'placeholderTextColor', 'size', 'variant', 'format',
    ].forEach(p => skipProps.add(p));
  }

  if (node.type === 'Textarea' || node.type === 'TextareaInput') {
    const placeholder = rewritePropValue(node.props?.placeholder ?? '', ctx.symbols, inMapScope);
    if (placeholder !== "''") propsLines.push(`placeholder={${placeholder}}`);
    skipProps.add('placeholder');
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
  const allWorkflowMeta = {
    ...(ctx.store.pageWorkflowMeta ?? {}),
    ...(ctx.store.globalWorkflowMeta ?? {}),
  };
  const actionProps = buildActionProps(
    node.actions as Record<string, unknown> | unknown[],
    ctx.symbols,
    allWorkflowMeta,
    node.type as string,
  );
  propsLines.push(...actionProps);

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

  // Build children
  const childNodes = (node.children ?? []) as AnyNode[];
  const childResults: NodeEmitResult[] = childNodes.map(child =>
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
    return emitPopoverNode(node, propsLines, tag, textContent, childJsx, ctx, imports, useEffects, ind, childInd, depth);
  }

  // Build the JSX element
  const propsStr = propsLines.length > 0 ? '\n' + propsLines.map(p => `${childInd}${p}`).join('\n') + '\n' + ind : '';
  const hasContent = textContent || childJsx;

  if (!hasContent && (prim.selfClose || childNodes.length === 0 && !textContent)) {
    return { jsx: `${ind}<${tag}${propsStr}/>`, useEffects };
  }

  return {
    jsx: `${ind}<${tag}${propsStr}>\n${textContent ? childInd + textContent + '\n' : ''}${childJsx ? childJsx + '\n' : ''}${ind}</${tag}>`,
    useEffects,
  };
}

function emitPopoverNode(
  node: AnyNode,
  propsLines: string[],
  tag: string,
  textContent: string,
  childJsx: string,
  ctx: CodegenCtx,
  imports: ImportsTracker,
  useEffects: string[],
  ind: string,
  childInd: string,
  depth: number,
): NodeEmitResult {
  imports.addNamed('@radix-ui/react-popover', 'Popover', 'PopoverTrigger', 'PopoverContent');

  // Use the node's id for controlled mode (workflows can target it by ID).
  // If no id, fall back to uncontrolled mode so multiple instances don't share state.
  const nodeId = node.id && node.id !== 'root' ? node.id : null;

  // The trigger is the node itself; content is in popover.content
  const popsConfig = node.popover as unknown as Record<string, unknown>;
  const contentChildren = (popsConfig?.content ?? popsConfig?.children) as AnyNode[] | undefined;
  const side = popsConfig?.side ?? 'bottom';
  const align = popsConfig?.align ?? 'center';

  const triggerContent = textContent || childJsx || `${childInd}${tag}`;

  let popoverContentJsx = '';
  if (contentChildren) {
    popoverContentJsx = contentChildren.map(c =>
      emitNode(c, ctx, imports, new Set(), false, depth + 2).jsx
    ).join('\n');
  }

  const openProps = nodeId
    ? `open={popoverState[${JSON.stringify(nodeId)}]} onOpenChange={(o) => setPopoverState(s => ({ ...s, ${JSON.stringify(nodeId)}: o }))}`
    : `onOpenChange={(o) => {}}`;

  return {
    jsx: `${ind}<Popover ${openProps}>\n${childInd}<PopoverTrigger asChild>\n${childInd}  <${tag} ${propsLines.join(' ')}>\n${triggerContent}\n${childInd}  </${tag}>\n${childInd}</PopoverTrigger>\n${childInd}<PopoverContent side="${side}" align="${align}">\n${popoverContentJsx}\n${childInd}</PopoverContent>\n${ind}</Popover>`,
    useEffects,
  };
}
