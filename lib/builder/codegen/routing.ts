/**
 * routing.ts — Emit one page.tsx per BuilderPage.
 *
 * Each page is a 'use client' React component that:
 *   - Reads state from useStore
 *   - Calls workflow functions on events
 *   - Optionally exports a `metadata` object (from BuilderPage.meta)
 */

import type { BuilderPage } from '@/app/dev/builder/_store-types';
import type { SDUINode } from '@/lib/sdui/types/node';
import type { CodegenCtx, EmittedFile, InputVarInfo, LiveIndicatorInfo, FormDataDisplayInfo } from './types';
import { routeToFilePath, routeToComponentName } from './identifiers';
import { resolvePageNodes, collectScVarsInits } from './resolve';
import { emitNode, buildRhfRulesStr } from './nodes';
import { ImportsTracker } from './tsx-builder';

/** All function names exported from lib/utils.ts that might appear in JSX formulas */
const UTILS_FN_NAMES = new Set([
  // conditional
  'ifThen', 'ifEmpty', 'not', 'and', 'or', 'equal', 'notEqual', 'switchOn',
  // math
  'average', 'rollupSum', 'round', 'sum', 'toNumber', 'abs', 'ceil', 'clamp', 'floor',
  'max', 'min', 'mod', 'pow', 'sqrt', 'toFixed',
  // string
  'lower', 'upper', 'capitalize', 'trim', 'startsWith', 'endsWith', 'replace', 'split',
  'concat', 'textLength', 'substring', 'padStart', 'padEnd',
  // formatting
  'formatCurrency', 'formatNumber', 'formatDate', 'formatRelativeTime',
  // array
  'add', 'contains', 'includes', 'createArray', 'distinct', 'filterByKey', 'findIndex',
  'getByIndex', 'join', 'length', 'lookup', 'merge', 'prepend', 'remove', 'removeByIndex',
  'reverse', 'slice', 'sort', 'flat', 'arrayIncludes', 'arrayLength', 'toggleInArray',
  // object
  'keys', 'values', 'entries', 'has', 'set', 'omit', 'pick',
  // date
  'now', 'today', 'toDate', 'isBefore', 'isAfter',
  // engine-compat
  'getFromMap', 'getKeyValue', 'findItemById', 'clampNumber', 'formatFullName',
  'toText', 'stringify', 'groupBy', 'paginationPages',
  'lookupInArray', 'lookupMap', 'filterExcludeByFieldAndSlice', 'findItemByOptionsMatch',
]);

/** Scan generated JSX for known utils function calls and return the ones found */
function detectUsedUtilsFns(jsx: string): string[] {
  const used: string[] = [];
  for (const fn of UTILS_FN_NAMES) {
    // Match `fn(` with word boundary before to avoid partial matches
    if (new RegExp(`\\b${fn}\\s*\\(`).test(jsx)) {
      used.push(fn);
    }
  }
  return used;
}

export function emitPages(ctx: CodegenCtx, usedAnimations: Set<string>): EmittedFile[] {
  const files: EmittedFile[] = [];

  for (const page of ctx.store.pages ?? []) {
    if (!page.route && !page.name) continue;
    const route = page.route ?? `/${page.name.toLowerCase().replace(/\s+/g, '-')}`;
    const filePath = routeToFilePath(route);

    try {
      const file = emitPage(page, route, filePath, ctx, usedAnimations);
      files.push(file);
    } catch (err) {
      throw new Error(`[codegen] Page "${page.name}" (${route}): ${(err as Error).message}`);
    }
  }

  return files;
}

function emitPage(
  page: BuilderPage,
  route: string,
  filePath: string,
  ctx: CodegenCtx,
  usedAnimations: Set<string>,
): EmittedFile {
  // Compute relative prefix: app/page.tsx → "../", app/cart/page.tsx → "../../", etc.
  const depth = route.split('/').filter(Boolean).length + 1;
  const relPrefix = '../'.repeat(depth);

  const imports = new ImportsTracker();
  imports.addNamed('react', 'useEffect', 'useState', 'memo');
  imports.addNamed(`${relPrefix}lib/store`, 'useStore');
  imports.addNamed('next/navigation', 'useRouter');

  if (ctx.flags.hasAnimations) {
    imports.addNamed('framer-motion', 'AnimatePresence');
  }

  const resolvedNodes = resolvePageNodes(page.nodes ?? [] as SDUINode[]);
  const scVarsInits = collectScVarsInits(resolvedNodes);
  const allUseEffects: string[] = [];
  const allWorkflowMeta = {
    ...(ctx.store.pageWorkflowMeta ?? {}),
    ...(ctx.store.globalWorkflowMeta ?? {}),
  };

  // Find workflows used by this page to import
  const usedWorkflows = new Set<string>();
  for (const node of resolvedNodes) {
    collectUsedWorkflows(node as unknown as Record<string, unknown>, allWorkflowMeta, ctx, usedWorkflows);
  }

  // Page-level on-mount interaction
  const pageMountWorkflow = page.pageInteractions?.['mount']?.workflow;
  if (pageMountWorkflow) {
    const wfName = ctx.symbols.workflows.get(pageMountWorkflow);
    if (wfName) usedWorkflows.add(wfName);
  }

  if (usedWorkflows.size > 0) {
    imports.addNamed(`${relPrefix}lib/workflows`, ...usedWorkflows);
  }

  if (ctx.flags.hasFetch || ctx.flags.hasGraphQL) {
    imports.addNamed(`${relPrefix}lib/api`, 'api');
  }

  if (ctx.flags.hasToast) {
    imports.addNamed('sonner', 'toast');
  }

  const hasPopovers = resolvedNodes.some(n => hasPopoverInTree(n as unknown as Record<string, unknown>));

  if (hasPopovers || ctx.flags.hasPopovers) {
    imports.addNamed('@radix-ui/react-popover', 'Popover', 'PopoverTrigger', 'PopoverContent');
  }

  // Detect FormContainer nodes early (before imports.render) so useForm import is included
  const hasFormContainer = resolvedNodes.some(n => hasNodeType(n as unknown as Record<string, unknown>, 'FormContainer'));
  if (hasFormContainer) {
    imports.addNamed('react-hook-form', 'useForm');
  }

  // Detect FormContainer IDs early — needed for form-data display extraction below.
  const _formContainerIds = findFormContainerIds(resolvedNodes as unknown as Record<string, unknown>[]);

  // Scan for input nodes to extract as narrow-selector sub-components (performance optimization).
  // Must run BEFORE emitNode so that pageCtx carries the extraction maps.
  const { inputs: _inputVarMap, liveIndicators: _liveIndicatorMap } =
    collectInputVarNodes(resolvedNodes as unknown as Record<string, unknown>[]);

  // Scan for inside-FormContainer "live form data" display nodes.
  // These read local.data.form.formData (→ _formData) and are extracted as sub-components
  // so the page does not re-render on every form keystroke.
  const _formDataDisplayMap = collectFormDataDisplayNodes(
    resolvedNodes as unknown as Record<string, unknown>[],
    _formContainerIds,
  );

  // Scan for per-field debounce configuration from the builder.
  const _formDebounceMap = collectFormDebounceConfig(resolvedNodes as unknown as Record<string, unknown>[]);

  // Add the zustand/traditional import HERE — before imports.render() is called below.
  // Zustand v5 dropped the equalityFn second param from useStore(); the traditional API
  // (useStoreWithEqualityFn) is the v5-correct way to pass a custom equality function.
  // Needed when either standalone inputs OR form-state nodes are extracted as sub-components,
  // because their var/form keys are added to _INPUT_VAR_KEYS and the page should skip
  // re-renders for those changes.
  if (_inputVarMap.size > 0 || _formDataDisplayMap.size > 0) {
    imports.addNamed('zustand/traditional', 'useStoreWithEqualityFn');
  }

  // Build a per-page ctx that carries the extraction maps (avoids mutating the shared ctx).
  // The inputVarNodeIds Set uses nodeId keys from the map (which may be _inputValueId for
  // SC-flattened nodes), matching the same fallback used in nodes.ts emitNodeInner.
  const _hasSubComps = _inputVarMap.size > 0 || _formDataDisplayMap.size > 0;
  const pageCtx: CodegenCtx = _hasSubComps
    ? {
        ...ctx,
        inputVarNodeIds: new Set(_inputVarMap.keys()),
        inputVarInfoMap: _inputVarMap,
        liveIndicatorNodeIds: _liveIndicatorMap,
        formDataDisplayNodeIds: _formDataDisplayMap,
      }
    : ctx;

  // Emit JSX for all nodes
  const nodeJsxParts: string[] = [];
  for (const node of resolvedNodes) {
    const result = emitNode(node as Record<string, unknown> & SDUINode, pageCtx, imports, usedAnimations, false, 2);
    nodeJsxParts.push(result.jsx);
    allUseEffects.push(...result.useEffects);
  }

  // Auto-detect which utils formula functions are used and add a named import
  const allJsx = nodeJsxParts.join('\n');
  const usedUtils = detectUsedUtilsFns(allJsx);
  if (usedUtils.length > 0) {
    imports.addNamed(`${relPrefix}lib/utils`, ...usedUtils);
  }

  const componentName = routeToComponentName(route);

  // Build component body
  const lines: string[] = [];
  lines.push(`'use client';`);
  lines.push('');
  // Opt out of static prerendering — this is a dynamic client-side app
  lines.push(`export const dynamic = 'force-dynamic';`);
  lines.push('');
  lines.push(imports.render());
  lines.push('');

  // Metadata export (for server components) — included as a comment since page is 'use client'
  if (page.meta?.title || page.meta?.description) {
    lines.push(`// SEO metadata — move to a separate server layout if needed`);
    lines.push(`// export const metadata = ${JSON.stringify({
      title: page.meta.title,
      description: page.meta.description,
      ...(page.meta.ogImage ? { openGraph: { images: [page.meta.ogImage] } } : {}),
    }, null, 2)};`);
    lines.push('');
  }

  // Emit sub-components + module-level equality helpers before the page function.
  if (_hasSubComps) {
    lines.push(emitInputSubComponents(_inputVarMap, _liveIndicatorMap, _formDataDisplayMap));
  }

  lines.push(`export default function ${componentName}() {`);

  if (_inputVarMap.size > 0 || _formDataDisplayMap.size > 0) {
    // Module-level constants were emitted above; the page just calls the pre-built helper.
    lines.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
    lines.push(`  const state = useStoreWithEqualityFn(useStore, (s: any) => s, _pageEqualityFn);`);
  } else {
    lines.push(`  const state = useStore();`);
  }

  lines.push(`  const router = useRouter();`);
  // Always declare — workflow call-sites use these even when not all are needed on this page
  lines.push(`  const [popoverState, setPopoverState] = useState<Record<string, boolean>>({});`);
  lines.push(`  const popover: [Record<string, boolean>, typeof setPopoverState] = [popoverState, setPopoverState];`);

  // Wire react-hook-form for pages with FormContainer nodes (hasFormContainer detected before imports.render)
  // _formContainerIds was already computed before emitNode; reuse it here.
  const formContainerIds = _formContainerIds;
  if (hasFormContainer) {
    // Compute controlled fields early so we can pass defaultValues to useForm.
    // Pre-registering them ensures form.setValue() + watch() work reliably from the first render,
    // which fixes the outside-form-state showing {} and the priority sync timing issue.
    const controlledFields = findControlledFields(resolvedNodes as unknown as Record<string, unknown>[]);

    // Also include native Input/Textarea fields inside FormContainer with a `name` prop.
    // Pre-declaring them with "" ensures they appear in getValues() from mount,
    // so formData always contains bio, email, etc. alongside the controlled fields.
    const nativeFormFieldNames = new Set<string>();
    (function scanNativeFormFields(nodes: Record<string, unknown>[], inForm: boolean) {
      for (const node of nodes) {
        const t = node.type as string | undefined;
        const isFC = t === 'FormContainer';
        const nowInForm = inForm || isFC;
        if (nowInForm && !isFC) {
          if (t === 'Input' || t === 'InputField' || t === 'Textarea' || t === 'TextareaInput') {
            const name = (node.props as Record<string, unknown> | undefined)?.name;
            if (typeof name === 'string' && name) nativeFormFieldNames.add(name);
          }
        }
        scanNativeFormFields((node.children ?? []) as Record<string, unknown>[], nowInForm);
      }
    })(resolvedNodes as unknown as Record<string, unknown>[], false);

    // Build merged defaultValues: controlled fields + native text fields (default "") + attachment ([])
    const allDefaultLines: string[] = [];
    // Native text/textarea fields: default ""
    for (const name of nativeFormFieldNames) {
      if (!controlledFields.some(cf => cf.name === name)) {
        allDefaultLines.push(`      ${JSON.stringify(name)}: ""`);
      }
    }
    // Controlled fields with known initial values
    for (const cf of controlledFields) {
      if (cf.initialValue !== undefined) {
        allDefaultLines.push(`      ${JSON.stringify(cf.name)}: ${JSON.stringify(cf.initialValue)}`);
      } else {
        // Controlled field with no initial value (e.g. file upload) → null default
        allDefaultLines.push(`      ${JSON.stringify(cf.name)}: null`);
      }
    }

    lines.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
    if (allDefaultLines.length > 0) {
      lines.push(`  const _rhf = useForm<any>({ defaultValues: {\n${allDefaultLines.join(',\n')}\n    } });`);
    } else {
      lines.push(`  const _rhf = useForm<any>();`);
    }
    lines.push(`  const { register, handleSubmit, formState: { errors, isSubmitted: _formIsSubmitted }, reset, watch, setValue } = _rhf;`);
    // Register controlled fields that have _validation rules so RHF validates them on submit.
    // Controlled fields use setValue (no DOM ref). Calling _rhf.register(name, rules) in the
    // component body (not in JSX) tells RHF to include them in validation — just like
    // {...register("name")} runs on every render but is idempotent.
    const controlledValidationLines: string[] = [];
    for (const cf of controlledFields) {
      if (!cf.validation) continue;
      const rulesStr = buildRhfRulesStr(cf.validation);
      if (!rulesStr) continue;
      controlledValidationLines.push(`  _rhf.register(${JSON.stringify(cf.name)}, ${rulesStr});`);
    }
    if (controlledValidationLines.length > 0) {
      lines.push(`  // Register controlled fields so RHF validates them on submit`);
      lines.push(...controlledValidationLines);
    }
    // _formData: local state snapshot for inside-FormContainer live displays that weren't
    // extracted as sub-components. Skipped when all such nodes were extracted (they read from
    // Zustand directly and don't need this React state).
    if (_formDataDisplayMap.size === 0) {
      lines.push(`  const [_formData, _setFormData] = useState<Record<string, unknown>>(() => _rhf.getValues() as Record<string, unknown>);`);
    } else {
      lines.push(`  // _formData state omitted — all inside-form live displays are narrow sub-components`);
      lines.push(`  const _formData: Record<string, unknown> = {};`);
      lines.push(`  void _formData;`);
    }
    lines.push(`  void setValue;`);
    lines.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
    lines.push(`  const form: any = { register, handleSubmit, formState: { errors, isSubmitted: _formIsSubmitted }, reset, watch, setValue };`);
    // Seed initial state.variables['{id}-value'] for plain _controlled nodes (non-SC, e.g. priority
    // buttons). SC-based controlled nodes are already seeded via the componentVars init useEffect
    // (valueVarInits). Without this, the visual state (button highlight) stays unset on first load.
    const scInitIds = new Set(scVarsInits.map(s => s.instanceId));
    const plainControlledWithInit = controlledFields.filter(
      cf => cf.initialValue !== undefined && !scInitIds.has(cf.id),
    );
    if (plainControlledWithInit.length > 0) {
      const seedLines = plainControlledWithInit.map(
        cf => `      ${JSON.stringify(`${cf.id}-value`)}: ${JSON.stringify(cf.initialValue)}`,
      );
      lines.push(`  // Seed plain _controlled field defaults into state.variables on mount`);
      lines.push(`  // eslint-disable-next-line react-hooks/exhaustive-deps`);
      lines.push(`  useEffect(() => {`);
      lines.push(`    useStore.setState(s => ({ ...s, variables: { ...s.variables,`);
      lines.push(seedLines.join(',\n') + ',');
      lines.push(`    } }));`);
      lines.push(`  // eslint-disable-next-line react-hooks/exhaustive-deps`);
      lines.push(`  }, []);`);
    }

    // Sync _controlled form fields (custom/SC inputs) to RHF via form.setValue.
    // Each _controlled node uses the convention state.variables['{nodeId}-value'] as its value source.
    // This ensures custom inputs (checkbox, switch, date picker, priority box, etc.) appear in _formData.
    if (controlledFields.length > 0) {
      for (const cf of controlledFields) {
        const varKey = `'${cf.id}-value'`;
        const fallback = cf.initialValue !== undefined ? JSON.stringify(cf.initialValue) : 'undefined';
        // An individual useEffect per field so React can track the dependency correctly
        lines.push(`  // Sync _controlled field: ${cf.name}`);
        lines.push(`  // eslint-disable-next-line react-hooks/exhaustive-deps`);
        lines.push(`  useEffect(() => {`);
        lines.push(`    form?.setValue?.(${JSON.stringify(cf.name)}, state.variables?.[${varKey}] ?? ${fallback});`);
        lines.push(`  // eslint-disable-next-line react-hooks/exhaustive-deps`);
        lines.push(`  }, [state.variables?.[${varKey}]]);`);
      }
    }

    // RHF watch subscription: syncs form data to Zustand store (and optionally React state).
    // - _setFormData is skipped when all inside-form live displays are extracted sub-components.
    // - Per-field debounce is applied only to fields that have _debounce configured in the builder.
    // - Non-debounced fields flush immediately; the page won't re-render (form key is in _INPUT_VAR_KEYS).
    const formStoreKeys = formContainerIds.map(id => JSON.stringify(`${id}-form`));
    lines.push(`  // eslint-disable-next-line react-hooks/exhaustive-deps`);
    lines.push(`  useEffect(() => {`);
    lines.push(`    const _flush = (data: Record<string, unknown>) => {`);
    if (_formDataDisplayMap.size === 0) {
      // _formData state is still present — call setter so inside-form displays update
      lines.push(`      _setFormData(data);`);
    }
    if (formStoreKeys.length > 0) {
      // Build per-field validation status from RHF errors so the errors display
      // (fields[name].isValid) matches the SDUI engine: '' = unchecked, error string = invalid.
      lines.push(`      // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
      lines.push(`      const _errs = _rhf.formState.errors as Record<string, any>;`);
      lines.push(`      const _fields = Object.fromEntries(Object.keys(data).map(k => {`);
      lines.push(`        const _e = _errs[k];`);
      // isValid convention matches SDUI engine: '' = no error / not yet validated, error string = invalid
      lines.push(`        return [k, { value: data[k], isValid: _e ? (_e.message ?? false) : '' }];`);
      lines.push(`      }));`);
      for (const key of formStoreKeys) {
        lines.push(`      useStore.setState(s => ({ ...s, variables: { ...s.variables, ${key}: { formData: data, isSubmitted: _rhf.formState.isSubmitted, fields: _fields } } }));`);
      }
    }
    lines.push(`    };`);
    lines.push(`    _flush(_rhf.getValues() as Record<string, unknown>); // immediate on mount`);
    if (_formDebounceMap.size > 0) {
      // Emit per-field debounce map — only configured fields get a timer, others flush immediately.
      const debounceObj = JSON.stringify(Object.fromEntries(_formDebounceMap));
      lines.push(`    const _fieldDebounce: Record<string, number> = ${debounceObj};`);
      lines.push(`    const _debTimers: Record<string, ReturnType<typeof setTimeout>> = {};`);
      lines.push(`    const { unsubscribe } = _rhf.watch((data, { name }) => {`);
      lines.push(`      const _delay = name ? _fieldDebounce[name] : undefined;`);
      lines.push(`      if (_delay !== undefined) {`);
      lines.push(`        clearTimeout(_debTimers[name!]);`);
      lines.push(`        _debTimers[name!] = setTimeout(() => _flush(data as Record<string, unknown>), _delay);`);
      lines.push(`      } else {`);
      lines.push(`        _flush(data as Record<string, unknown>);`);
      lines.push(`      }`);
      lines.push(`    });`);
      lines.push(`    return () => { unsubscribe(); Object.values(_debTimers).forEach(clearTimeout); };`);
    } else {
      lines.push(`    const { unsubscribe } = _rhf.watch((data) => _flush(data as Record<string, unknown>));`);
      lines.push(`    return () => unsubscribe();`);
    }
    lines.push(`  // eslint-disable-next-line react-hooks/exhaustive-deps`);
    lines.push(`  }, []);`);
    if (formStoreKeys.length > 0) {
      // Re-sync when isSubmitted changes: RHF only finalises errors after handleSubmit, not in watch.
      // Inline the same fields-from-errors logic (can't reference the _flush closure from outside).
      lines.push(`  // eslint-disable-next-line react-hooks/exhaustive-deps`);
      lines.push(`  useEffect(() => {`);
      lines.push(`    const _data = _rhf.getValues() as Record<string, unknown>;`);
      lines.push(`    // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
      lines.push(`    const _errs = _rhf.formState.errors as Record<string, any>;`);
      lines.push(`    const _fields = Object.fromEntries(Object.keys(_data).map(k => {`);
      lines.push(`      const _e = _errs[k];`);
      lines.push(`      return [k, { value: _data[k], isValid: _e ? (_e.message ?? false) : '' }];`);
      lines.push(`    }));`);
      for (const key of formStoreKeys) {
        lines.push(`    useStore.setState(s => ({ ...s, variables: { ...s.variables, ${key}: { formData: _data, isSubmitted: _formIsSubmitted, fields: _fields } } }));`);
      }
      lines.push(`  // eslint-disable-next-line react-hooks/exhaustive-deps`);
      lines.push(`  }, [_formIsSubmitted]);`);
    }
  } else {
    lines.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
    lines.push(`  const form: any = undefined;`);
    // Provide an empty errors object so form error references don't crash on non-form pages
    lines.push(`  const errors: Record<string, unknown> = {};`);
    lines.push(`  void errors;`);
    lines.push(`  const _formData: Record<string, unknown> = {};`);
    lines.push(`  const _formIsSubmitted = false;`);
    lines.push(`  void _formData; void _formIsSubmitted;`);
  }
  // globalContext polyfill — reads URL search params / window size for SSR-safe access
  lines.push(`  const _globalCtx = typeof window !== 'undefined'`);
  lines.push(`    ? { browser: { query: Object.fromEntries(new URLSearchParams(window.location.search)), breakpoint: window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop' } }`);
  lines.push(`    : { browser: { query: {} as Record<string, string>, breakpoint: 'desktop' as string } };`);

  // Seed component-level variables into the store on first mount.
  // Also initializes state.variables[instanceId-value] for SC instances that have a valueVariable
  // so live-indicator displays (radio, select, slider, etc.) show the correct default on first load.
  if (scVarsInits.length > 0) {
    const initParts = scVarsInits
      .map(({ instanceId, vars }) => `    ${JSON.stringify(instanceId)}: ${JSON.stringify(vars)}`)
      .join(',\n');
    // Collect initial value-variable assignments: { key: initialValue } for each SC with a valueVariable
    const valueVarInits = scVarsInits
      .filter(({ valueVariable, vars }) => valueVariable && valueVariable in vars)
      .map(({ instanceId, vars, valueVariable }) => {
        const key = JSON.stringify(`${instanceId}-value`);
        const val = JSON.stringify(vars[valueVariable!]);
        return `      ${key}: ${val}`;
      });
    lines.push(`  useEffect(() => {`);
    lines.push(`    useStore.setState(s => ({ ...s, componentVars: {`);
    lines.push(initParts + ',');
    lines.push(`      ...s.componentVars,`);
    lines.push(`    } }));`);
    if (valueVarInits.length > 0) {
      lines.push(`    // Init value-variables so live indicators show defaults before first interaction`);
      lines.push(`    useStore.setState(s => ({ ...s, variables: { ...s.variables,`);
      lines.push(valueVarInits.join(',\n') + ',');
      lines.push(`    } }));`);
    }
    lines.push(`  }, []);`);
  }

  // Page mount workflow
  if (pageMountWorkflow) {
    const wfName = ctx.symbols.workflows.get(pageMountWorkflow);
    if (wfName) {
      lines.push(`  useEffect(() => {`);
      lines.push(`    void ${wfName}({ state: useStore.getState(), dispatch: useStore.setState, router, api: {}, form, popover });`);
      lines.push(`  }, []);`);
    }
  }

  // Other useEffects from nodes
  for (const ue of allUseEffects) {
    lines.push(`  ${ue}`);
  }

  lines.push('');
  lines.push(`  return (`);
  lines.push(`    <div>`);
  for (const jsx of nodeJsxParts) {
    lines.push(jsx);
  }
  lines.push(`    </div>`);
  lines.push(`  );`);
  lines.push(`}`);

  return {
    path: filePath,
    content: lines.join('\n'),
  };
}

function collectUsedWorkflows(
  node: Record<string, unknown>,
  workflowMeta: Record<string, unknown>,
  ctx: CodegenCtx,
  out: Set<string>,
): void {
  const actions = node.actions;
  if (Array.isArray(actions)) {
    for (const a of actions as Array<{ action?: string }>) {
      if (a.action) {
        const wfName = ctx.symbols.workflows.get(a.action);
        if (wfName) out.add(wfName);
      }
    }
  } else if (actions && typeof actions === 'object') {
    for (const v of Object.values(actions as Record<string, unknown>)) {
      if (v && typeof v === 'object' && 'action' in v) {
        const wfName = ctx.symbols.workflows.get((v as { action: string }).action);
        if (wfName) out.add(wfName);
      }
    }
  }
  for (const child of (node.children ?? []) as Record<string, unknown>[]) {
    collectUsedWorkflows(child, workflowMeta, ctx, out);
  }
}

function hasPopoverInTree(node: Record<string, unknown>): boolean {
  if (node.popover) return true;
  for (const child of (node.children ?? []) as Record<string, unknown>[]) {
    if (hasPopoverInTree(child)) return true;
  }
  return false;
}

function hasNodeType(node: Record<string, unknown>, type: string): boolean {
  if (node.type === type) return true;
  for (const child of (node.children ?? []) as Record<string, unknown>[]) {
    if (hasNodeType(child, type)) return true;
  }
  return false;
}

function findFormContainerIds(nodes: Record<string, unknown>[]): string[] {
  const ids: string[] = [];
  function walk(node: Record<string, unknown>) {
    if (node.type === 'FormContainer' && typeof node.id === 'string') ids.push(node.id);
    for (const child of (node.children ?? []) as Record<string, unknown>[]) walk(child);
  }
  nodes.forEach(walk);
  return ids;
}

interface ControlledFieldInfo {
  id: string;       // node id (used to derive value variable: '{id}-value')
  name: string;     // RHF field name
  initialValue: unknown; // static fallback when variable is undefined
  validation?: unknown;  // raw _validation object (may have { trigger, rules } or array format)
}

/** Find all _controlled form field nodes (custom inputs registered with FormContainer) */
function findControlledFields(nodes: Record<string, unknown>[]): ControlledFieldInfo[] {
  const result: ControlledFieldInfo[] = [];
  function walk(node: Record<string, unknown>) {
    if (
      node._controlled !== undefined &&
      typeof node.name === 'string' && node.name &&
      typeof node.id === 'string' && node.id
    ) {
      // _initialValue may be a string, number, boolean, array, or formula object
      const rawInit = node._initialValue;
      let initFallback: unknown = undefined;
      if (rawInit === null || rawInit === undefined || typeof rawInit === 'object') {
        // Try to get the initial value from _scVarsInit using the _valueVariable name
        const scInit = node._scVarsInit as { vars?: Record<string, unknown> } | undefined;
        const valueVar = node._valueVariable as string | undefined;
        if (scInit?.vars) {
          if (valueVar && valueVar in scInit.vars) {
            initFallback = scInit.vars[valueVar]; // correct: use the SC's primary value variable
          } else {
            // Fallback: look for a null/undefined initial value (date pickers, file pickers)
            const primaryEntry = Object.entries(scInit.vars).find(([, v]) => v === null || v === undefined || typeof v === 'string' || typeof v === 'boolean');
            if (primaryEntry) initFallback = primaryEntry[1];
          }
        }
      } else if (typeof rawInit === 'string' || typeof rawInit === 'number' || typeof rawInit === 'boolean') {
        initFallback = rawInit;
      } else if (Array.isArray(rawInit)) {
        initFallback = rawInit;
      }
      result.push({ id: node.id as string, name: node.name as string, initialValue: initFallback, validation: node._validation });
    }
    for (const child of (node.children ?? []) as Record<string, unknown>[]) walk(child);
  }
  nodes.forEach(walk);
  return result;
}

/**
 * Scan for Text nodes that read from form state — both inside-FormContainer
 * (formula has `local?.data?.form?.formData`) and outside-FormContainer
 * (formula or condition references `variables?.['formKey']`).
 *
 * All detected nodes are extracted as narrow-selector sub-components so the page
 * does not re-render on every form keystroke.
 */
function collectFormDataDisplayNodes(
  resolvedNodes: Record<string, unknown>[],
  formContainerIds: string[],
): Map<string, FormDataDisplayInfo> {
  const result = new Map<string, FormDataDisplayInfo>();
  if (formContainerIds.length === 0) return result;

  const INNER_FORMDATA_RE = /local\??\.data\??\.form\??\.formData\b/;
  // Detect the AGGREGATE fields object usage — e.g. Object.entries(local?.data?.form?.fields ?? {})
  // (used by errors-value-inner). Per-field accesses like fields?.username?.isValid are handled
  // by the formula-rewriter and do NOT need sub-component extraction.
  const INNER_FIELDS_RE = /Object\.entries\s*\(\s*local\??\.data\??\.form\??\.fields/;

  // Build patterns for each form key  (e.g. "form-demo-form")
  const outerPatterns: Array<{ formKey: string; re: RegExp }> = formContainerIds.map(id => {
    const formKey = `${id}-form`;
    const escaped = formKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Matches variables?.['formKey'] or variables?.["formKey"] or variables['formKey'] etc.
    const re = new RegExp(`variables\\??\\.['"\\[].*${escaped}`);
    return { formKey, re };
  });

  function matchesOuterForm(s: string): string | null {
    for (const { formKey, re } of outerPatterns) {
      if (re.test(s)) return formKey;
    }
    return null;
  }

  function walk(nodes: Record<string, unknown>[]) {
    for (const node of nodes) {
      const nodeId = node.id as string | undefined;
      if (!nodeId) { walk((node.children as Record<string, unknown>[]) ?? []); continue; }

      const text = node.text as Record<string, unknown> | undefined;
      const rawFormula = (text?.formula as string | undefined) ?? '';
      // condition can be a string directly on the node (outside props) or in props
      const rawCondition =
        (node.condition as string | undefined) ??
        ((node.props as Record<string, unknown>)?.condition as string | undefined) ??
        '';
      const staticTextStr = typeof node.text === 'string' ? (node.text as string) : undefined;
      const className = ((node.props as Record<string, unknown>)?.className as string) ?? '';

      // Inside-form: formula references local.data.form.formData
      if (rawFormula && INNER_FORMDATA_RE.test(rawFormula)) {
        const formKey = `${formContainerIds[0]}-form`;
        result.set(nodeId, {
          nodeId,
          subCompName: `_FormDataLive_${nodeIdToSafeIdent(nodeId)}`,
          formKey, rawFormula, className,
        });
      }
      // Inside-form: formula references the aggregate local.data.form.fields object
      // (e.g. the "field errors:" inner display). Rewrite fields → _fk?.fields.
      else if (rawFormula && INNER_FIELDS_RE.test(rawFormula)) {
        const formKey = `${formContainerIds[0]}-form`;
        result.set(nodeId, {
          nodeId,
          subCompName: `_FormDataLive_${nodeIdToSafeIdent(nodeId)}`,
          formKey,
          rawFormula,
          className,
        });
      }
      // Outside-form: formula OR condition references variables?.['formKey']
      else {
        const formulaMatch = rawFormula ? matchesOuterForm(rawFormula) : null;
        const condMatch = rawCondition ? matchesOuterForm(rawCondition) : null;
        const formKey = formulaMatch ?? condMatch;
        if (formKey) {
          result.set(nodeId, {
            nodeId,
            subCompName: `_FormDataLive_${nodeIdToSafeIdent(nodeId)}`,
            formKey,
            rawFormula: rawFormula ?? '',
            rawCondition: rawCondition || undefined,
            staticText: staticTextStr,
            className,
          });
        }
      }

      walk((node.children as Record<string, unknown>[]) ?? []);
    }
  }
  walk(resolvedNodes);
  return result;
}

/**
 * Scan for Input/Textarea nodes inside a FormContainer that have `_debounce` configured.
 * Returns a map of RHF field name → delay in ms.
 */
function collectFormDebounceConfig(resolvedNodes: Record<string, unknown>[]): Map<string, number> {
  const result = new Map<string, number>();

  function walk(nodes: Record<string, unknown>[], inForm: boolean) {
    for (const node of nodes) {
      const isForm = node.type === 'FormContainer';
      const nowInForm = inForm || isForm;

      if (nowInForm && !isForm) {
        const nodeType = node.type as string;
        if (nodeType === 'Input' || nodeType === 'Textarea' || nodeType === 'InputField' || nodeType === 'TextareaInput') {
          const debounce = node._debounce as { enabled?: boolean; delay?: number } | undefined;
          if (debounce?.enabled) {
            const fieldName = (node.props as Record<string, unknown>)?.name as string | undefined;
            if (fieldName) result.set(fieldName, debounce.delay ?? 500);
          }
        }
      }
      walk((node.children as Record<string, unknown>[]) ?? [], nowInForm);
    }
  }
  walk(resolvedNodes, false);
  return result;
}

// ─── Input Sub-Component Extraction ───────────────────────────────────────────

/** Convert a node ID to a safe JS identifier fragment (max 32 chars) */
function nodeIdToSafeIdent(nodeId: string): string {
  return nodeId.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 32);
}

/**
 * Scan the resolved node tree and collect:
 *   inputs       — Input/Textarea nodes outside any FormContainer
 *   liveIndicators — Text nodes whose formula reads from one of those inputs' value variables
 *
 * Two-pass: first collects all inputs (so their varKeys are known), then scans for indicators.
 */
function collectInputVarNodes(resolvedNodes: Record<string, unknown>[]): {
  inputs: Map<string, InputVarInfo>;
  liveIndicators: Map<string, LiveIndicatorInfo>;
} {
  const inputs = new Map<string, InputVarInfo>();
  const liveIndicators = new Map<string, LiveIndicatorInfo>();

  // Pass 1: collect Input/Textarea nodes outside FormContainer.
  // Uses the same id-fallback as nodes.ts: node.id ?? node._inputValueId
  function walkForInputs(nodes: Record<string, unknown>[], formDepth: number) {
    for (const node of nodes) {
      const nodeType = node.type as string | undefined;
      // Mirror the syncId logic in nodes.ts: node.id falls back to _inputValueId for SC-flattened inputs
      const nodeId = (node.id ?? node._inputValueId) as string | undefined;
      const isFormContainer = nodeType === 'FormContainer';
      const nextFormDepth = isFormContainer ? formDepth + 1 : formDepth;

      if (
        formDepth === 0 &&
        nodeId &&
        (nodeType === 'Input' || nodeType === 'InputField' ||
         nodeType === 'Textarea' || nodeType === 'TextareaInput')
      ) {
        const isTextarea = nodeType === 'Textarea' || nodeType === 'TextareaInput';
        const props = (node.props ?? {}) as Record<string, unknown>;

        // Only extract when all key props are static strings — formulae/paths reference state
        // and would be broken inside an isolated sub-component without a state subscription.
        let className = typeof props.className === 'string' ? props.className : null;
        const isPassword = props.secureTextEntry === true || props.secureTextEntry === 'true';
        const typeAttr = isPassword ? 'password'
          : typeof props.type === 'string' ? props.type
          : typeof props.inputType === 'string' ? props.inputType
          : 'text';
        const placeholder = typeof props.placeholder === 'string' ? props.placeholder : null;

        // Skip if any prop is still a formula (object) — those need runtime state access
        if (className !== null && placeholder !== null) {
          // Mirror the nodes.ts transformations that are skipped for extracted sub-components:
          // 1. placeholder color (RN prop → Tailwind class)
          const ptc = (typeof props.placeholderTextColor === 'string' ? props.placeholderTextColor : undefined) ?? '#737373';
          const ptcEncoded = ptc.replace(/\s/g, '_');
          className = (className ? `${className} ` : '') + `placeholder-[${ptcEncoded}]`;
          // 2. resize-none for textareas (RNW always injects resize:none on TextInput)
          if (isTextarea) {
            className = `${className} resize-none`;
          }

          const varKey = `${nodeId}-value`;
          const prefix = isTextarea ? '_TextareaLive' : '_InputLive';
          const subCompName = `${prefix}_${nodeIdToSafeIdent(nodeId)}`;
          inputs.set(nodeId, {
            nodeId, varKey, subCompName, isTextarea,
            className, typeAttr, placeholder,
          });
        }
      }

      walkForInputs((node.children ?? []) as Record<string, unknown>[], nextFormDepth);
    }
  }

  // Pass 2: collect live-indicator Text nodes that reference an input's varKey
  function walkForLiveIndicators(nodes: Record<string, unknown>[]) {
    for (const node of nodes) {
      const nodeType = node.type as string | undefined;
      const nodeId = node.id as string | undefined;

      if (nodeId && nodeType === 'Text') {
        const text = node.text;
        if (text && typeof text === 'object' && 'formula' in (text as Record<string, unknown>)) {
          const formula = (text as { formula: string }).formula;
          // Check whether this formula references any collected input var key
          for (const info of inputs.values()) {
            const singleQ = `['${info.varKey}']`;
            const doubleQ = `["${info.varKey}"]`;
            if (formula.includes(singleQ) || formula.includes(doubleQ)) {
              const props = (node.props ?? {}) as Record<string, unknown>;
              const className = typeof props.className === 'string' ? props.className : '';
              const subCompName = `_LiveVar_${nodeIdToSafeIdent(nodeId)}`;
              liveIndicators.set(nodeId, {
                nodeId, varKey: info.varKey, subCompName, rawFormula: formula, className,
              });
              break;
            }
          }
        }
      }

      walkForLiveIndicators((node.children ?? []) as Record<string, unknown>[]);
    }
  }

  walkForInputs(resolvedNodes, 0);
  walkForLiveIndicators(resolvedNodes);

  return { inputs, liveIndicators };
}

/**
 * Emit module-level constants and React.memo sub-component definitions for extracted inputs
 * and their live-indicator siblings. Everything is at module scope so it is created once —
 * never inside the page function where it would be re-created on every render.
 */
function emitInputSubComponents(
  inputs: Map<string, InputVarInfo>,
  liveIndicators: Map<string, LiveIndicatorInfo>,
  formDataDisplayNodes: Map<string, FormDataDisplayInfo>,
): string {
  const parts: string[] = [];

  // ── Module-level equality helpers for the page's useStoreWithEqualityFn call ──
  // Zustand v5 dropped the equalityFn arg from useStore(); useStoreWithEqualityFn
  // from zustand/traditional is the correct API. Both constants live at module scope
  // so they are created once and their identity is stable across renders.
  // Standalone input var keys + form variable keys (when all form-state-dependent nodes
  // have been extracted as sub-components). This allows the page to skip re-renders for
  // input typing AND form data changes — only the tiny sub-components re-render.
  const formKeySet = new Set([...formDataDisplayNodes.values()].map(f => f.formKey));
  const inputVarKeysList = [
    ...[...inputs.values()].map(i => JSON.stringify(i.varKey)),
    ...[...formKeySet].map(k => JSON.stringify(k)),
  ].join(', ');
  parts.push(`// eslint-disable-next-line @typescript-eslint/no-explicit-any`);
  parts.push(`const _INPUT_VAR_KEYS = new Set<string>([${inputVarKeysList}]);`);
  parts.push(`// eslint-disable-next-line @typescript-eslint/no-explicit-any`);
  parts.push(`const _pageEqualityFn = (prev: any, next: any): boolean => {`);
  parts.push(`  if (prev === next) return true;`);
  parts.push(`  if (prev.variables === next.variables) return false; // something else changed`);
  parts.push(`  // Check all non-variables top-level fields (componentVars, user, etc.)`);
  parts.push(`  const _allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);`);
  parts.push(`  for (const _k of _allKeys) {`);
  parts.push(`    if (_k === 'variables') continue;`);
  parts.push(`    if (prev[_k] !== next[_k]) return false;`);
  parts.push(`  }`);
  parts.push(`  // Variables changed — skip re-render only if ALL changes are input-owned`);
  parts.push(`  const _pv = prev.variables ?? {};`);
  parts.push(`  const _nv = next.variables ?? {};`);
  parts.push(`  const _changed = Object.keys({ ..._pv, ..._nv }).filter((_k: string) => _pv[_k] !== _nv[_k]);`);
  parts.push(`  return _changed.length > 0 && _changed.every((_k: string) => _INPUT_VAR_KEYS.has(_k));`);
  parts.push(`};`);
  parts.push('');

  for (const info of inputs.values()) {
    const { nodeId, varKey, subCompName, isTextarea, className, typeAttr, placeholder } = info;
    const varKeyJson = JSON.stringify(varKey);
    const classAttr = className ? ` className="${className}"` : '';
    const phAttr = placeholder ? ` placeholder="${placeholder.replace(/"/g, '\\"')}"` : '';
    const tag = isTextarea ? 'textarea' : 'input';
    const typeAttrHtml = isTextarea ? '' : ` type="${typeAttr}"`;

    // The sub-component subscribes only to its own value variable — typing in this field
    // re-renders ONLY this tiny component, not the 3000+ line page component.
    parts.push(`const ${subCompName} = memo(function ${subCompName}() {`);
    parts.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
    parts.push(`  const _val = useStore((s: any) => (s.variables?.[${varKeyJson}] as string) ?? "");`);
    parts.push(`  return (`);
    if (isTextarea) {
      parts.push(`    <textarea`);
      parts.push(`      id="${nodeId}"`);
      if (className) parts.push(`      className="${className}"`);
      if (placeholder) parts.push(`      placeholder="${placeholder.replace(/"/g, '\\"')}"`);
      parts.push(`      value={_val}`);
      parts.push(`      // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
      parts.push(`      onChange={(e: any) => { const _v = e.target.value; useStore.setState((s: any) => ({ ...s, variables: { ...s.variables, ${varKeyJson}: _v } })); }}`);
      parts.push(`    />`);
    } else {
      parts.push(`    <input`);
      parts.push(`      id="${nodeId}"`);
      if (className) parts.push(`      className="${className}"`);
      parts.push(`      type="${typeAttr}"`);
      if (placeholder) parts.push(`      placeholder="${placeholder.replace(/"/g, '\\"')}"`);
      parts.push(`      value={_val}`);
      parts.push(`      // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
      parts.push(`      onChange={(e: any) => { const _v = e.target.value; useStore.setState((s: any) => ({ ...s, variables: { ...s.variables, ${varKeyJson}: _v } })); }}`);
      parts.push(`    />`);
    }
    // silence unused-vars warning for variables used only for HTML attribute side-effects
    void classAttr; void phAttr; void tag; void typeAttrHtml;
    parts.push(`  );`);
    parts.push(`});`);
    parts.push('');
  }

  for (const info of liveIndicators.values()) {
    const { varKey, subCompName, rawFormula, className } = info;
    const varKeyJson = JSON.stringify(varKey);

    // Transform the raw formula: replace variables?.['varKey'] with _val
    // (single-quote and double-quote variants)
    const escapedVarKey = varKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const transformedFormula = rawFormula
      .replace(new RegExp(`variables\\??\\.\\['${escapedVarKey}'\\]`, 'g'), '_val')
      .replace(new RegExp(`variables\\??\\.\\["${escapedVarKey}"\\]`, 'g'), '_val')
      .replace(new RegExp(`variables\\['${escapedVarKey}'\\]`, 'g'), '_val')
      .replace(new RegExp(`variables\\["${escapedVarKey}"\\]`, 'g'), '_val');

    const classAttrJsx = className ? ` className="${className}"` : '';

    parts.push(`const ${subCompName} = memo(function ${subCompName}() {`);
    parts.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
    parts.push(`  const _val = useStore((s: any) => s.variables?.[${varKeyJson}]);`);
    parts.push(`  const _display = ${transformedFormula};`);
    parts.push(`  return <span${classAttrJsx}>{_display}</span>;`);
    parts.push(`});`);
    parts.push('');
  }

  // ── Form-data live display sub-components ─────────────────────────────────
  // Each sub-component reads the full form state from Zustand and re-renders when
  // form data changes. The page itself skips re-rendering (form key is in _INPUT_VAR_KEYS).
  for (const info of formDataDisplayNodes.values()) {
    const { nodeId, subCompName, formKey, rawFormula, rawCondition, staticText, className } = info;
    const formKeyJson = JSON.stringify(formKey);
    const escapedFormKey = formKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Formula rewrite helpers
    // Inside-form: replace local?.data?.form?.formData with _fk?.formData
    // Outside-form: replace variables?.['formKey'] (all quote/bracket variants) with _fk
    const outerRe = new RegExp(
      `variables\\??\\.\\[['"]${escapedFormKey}['"]\\]|variables\\['${escapedFormKey}'\\]|variables\\["${escapedFormKey}"\\]`,
      'g',
    );
    const rewriteFormula = (f: string) =>
      f
        .replace(/local\??\.data\??\.form\??\.formData\b/g, '_fk?.formData')
        .replace(/local\??\.data\??\.form\??\.fields\b/g, '(_fk?.fields as Record<string,any>|undefined)')
        .replace(outerRe, '_fk');

    const rewrittenFormula = rawFormula ? rewriteFormula(rawFormula) : '';
    const rewrittenCondition = rawCondition ? rewriteFormula(rawCondition) : '';
    const classAttrJsx = className ? ` className="${className}"` : '';

    parts.push(`const ${subCompName} = memo(function ${subCompName}() {`);
    parts.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
    parts.push(`  const _fk = useStore((s: any) => s.variables?.[${formKeyJson}] as Record<string,unknown> | undefined);`);

    if (rewrittenCondition) {
      // Conditional node: render only when condition is true
      const content = rewrittenFormula
        ? `{${rewrittenFormula}}`
        : staticText
          ? `{${JSON.stringify(staticText)}}`
          : `{null}`;
      parts.push(`  if (!${rewrittenCondition}) return null;`);
      parts.push(`  return <span id="${nodeId}"${classAttrJsx}>${content}</span>;`);
    } else if (rewrittenFormula) {
      parts.push(`  return <span id="${nodeId}"${classAttrJsx}>{${rewrittenFormula}}</span>;`);
    } else {
      parts.push(`  return <span id="${nodeId}"${classAttrJsx}>{${JSON.stringify(staticText ?? '')}}</span>;`);
    }

    parts.push(`});`);
    parts.push('');
  }

  return parts.join('\n');
}
