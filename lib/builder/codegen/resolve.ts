/**
 * resolve.ts — Flatten shared-component instances and resolve responsive overrides.
 *
 * Takes a raw SDUINode tree from the builder and returns a fully-resolved tree
 * where:
 *  - Shared component instances have their per-instance overrides merged into the subtree
 *  - Responsive overrides are merged into the base className / style
 *  - $slot / layout resolution is handled separately in routing.ts (not needed here —
 *    builder state already stores the post-$slot tree)
 */

import type { SDUINode } from '@/lib/sdui/types/node';
import { getSharedComponents } from '@/lib/builder/shared-component-data';
import { isExpression } from '@/lib/sdui/is-expression';

type AnyNode = SDUINode & {
  _shared?: { id: string };
  _overrides?: string[];
  responsive?: Record<string, { className?: string; styles?: Record<string, unknown>; condition?: unknown }>;
  children?: AnyNode[];
};

/** Merge responsive overrides into a node for export (desktop-first cascade) */
function mergeResponsive(node: AnyNode): AnyNode {
  if (!node.responsive) return node;

  // Collect ordered breakpoints from most-specific to least
  const breakpoints: Array<[string, string]> = [
    ['mobile', 'sm'],
    ['tablet', 'md'],
    ['laptop', 'lg'],
  ];

  let extraClasses = '';
  const extraStyles: Record<string, unknown> = {};

  for (const [bpKey, twPrefix] of breakpoints) {
    const bp = node.responsive[bpKey];
    if (!bp) continue;
    if (bp.className) {
      // Prefix every Tailwind class with the breakpoint
      const bpClasses = bp.className.trim().split(/\s+/).map((c: string) => `${twPrefix}:${c}`).join(' ');
      extraClasses += ' ' + bpClasses;
    }
    if (bp.styles) {
      for (const [k, v] of Object.entries(bp.styles)) {
        // Responsive inline styles not directly supported in Tailwind in generated code;
        // kept as a data attribute for developer awareness
        extraStyles[`data-${twPrefix}-${k}`] = v;
      }
    }
  }

  const baseClass = (node.props?.className as string | undefined) ?? '';
  return {
    ...node,
    props: {
      ...node.props,
      className: (baseClass + extraClasses).trim(),
    },
    responsive: undefined,
  };
}

type SCProperty = { name: string; defaultValue: unknown };
type SCVarDef = { initialValue: unknown };
type SCWorkflowStep = {
  id: string;
  type: string;
  config?: Record<string, unknown>;
};
type SCWorkflow = {
  id: string;
  trigger?: string;
  steps?: SCWorkflowStep[];
};

/** Safe identifier: convert any string to a valid JS variable suffix */
function toSafeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Compile a shared-component workflow step into an inline JS code string.
 * Component variables are read/written via state.componentVars['instanceId']['varName'].
 * When the changed variable is the component's valueVariable, also syncs to
 * state.variables[instanceId + '-value'] so that live-value indicators update.
 */
function compileScStep(
  step: SCWorkflowStep,
  instanceId: string,
  scVarNames: Set<string>,
  valueVariable?: string,
  componentProps?: Record<string, unknown>,
  rhfName?: string,
): string {
  if (step.type === 'changeVariableValue') {
    const varName = step.config?.variableName as string | undefined;
    if (varName && scVarNames.has(varName)) {
      const rawVal = step.config?.value;
      const compiledVal = compileScValue(rawVal, instanceId, scVarNames, componentProps);
      const instanceKey = JSON.stringify(instanceId);
      const varKey = JSON.stringify(varName);
      let code = `useStore.setState(s => ({ ...s, componentVars: { ...s.componentVars, ${instanceKey}: { ...(s.componentVars?.[${instanceKey}] ?? {}), ${varKey}: ${compiledVal} } } }));`;
      // Also sync the valueVariable to state.variables[instanceId-value] for live indicators
      if (valueVariable && varName === valueVariable) {
        const liveKey = JSON.stringify(`${instanceId}-value`);
        code += `\n  useStore.setState(s => ({ ...s, variables: { ...s.variables, ${liveKey}: ${compiledVal} } }));`;
        // If the SC instance has a node-level 'name' (RHF field name), also call form.setValue
        // so the field appears in _rhf.watch() and inside/outside FormContainer live displays.
        const effectiveRhfName = rhfName ?? (componentProps?.['name'] as string | undefined);
        if (effectiveRhfName) {
          code += `\n  form?.setValue?.(${JSON.stringify(effectiveRhfName)}, ${compiledVal});`;
        }
      }
      return code;
    }
  }
  if (step.type === 'emitTrigger') {
    return `/* emitTrigger: ${step.config?.name ?? ''} */`;
  }
  if (step.type === 'pickFile') {
    // Open a hidden file input, read the selected file, and store to the component's valueVariable.
    // Fall back to step.config.storeIn when the SC model has no valueVariable (e.g. sc-file-upload).
    const rawAccept = step.config?.accept;
    // Resolve accept value — may be a formula with context.component.props.accept reference
    const acceptExpr = rawAccept !== undefined && rawAccept !== null
      ? compileScValue(rawAccept, instanceId, scVarNames, componentProps)
      : '"*/*"';
    const acceptStr = acceptExpr;
    const pickFileVar = (valueVariable ?? (step.config as Record<string, unknown>)?.storeIn) as string | undefined;
    const storeKey = pickFileVar ? JSON.stringify(pickFileVar) : null;
    const instanceKey = JSON.stringify(instanceId);
    // Pre-compute the "-value" variable key as a static string (not a template literal) so the
    // generated code doesn't contain computed template-literal property keys that break SWC/JSX parsing.
    const valueKey = JSON.stringify(`${instanceId}-value`);
    // For form.setValue, store a plain-object snapshot instead of the raw File (which JSON.stringify
    // serialises as {}) so the live form-state display shows something meaningful.
    // The value stored in variables[valueKey] is synced to form.setValue by a controlled-field
    // useEffect in routing.ts. Store the formatted array (not the raw File) so the sync sets
    // the correct value. componentVars still holds the raw File for the upload-box display.
    const filePayloadExpr = rhfName
      ? `[{ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, file }]`
      : 'file';
    const storeCode = storeKey
      ? `useStore.setState(s => ({ ...s, componentVars: { ...s.componentVars, ${instanceKey}: { ...(s.componentVars?.[${instanceKey}] ?? {}), ${storeKey}: file } } }));\n  useStore.setState(s => ({ ...s, variables: { ...s.variables, ${valueKey}: ${filePayloadExpr} } }));`
      : rhfName
        ? `form?.setValue?.(${JSON.stringify(rhfName)}, ${filePayloadExpr});`
        : '';
    return `(function _pickFile() {
  const _inp = document.createElement('input'); _inp.type = 'file'; _inp.accept = ${acceptStr};
  _inp.onchange = () => { const file = _inp.files?.[0]; if (!file) return; ${storeCode} };
  _inp.click();
})();`;
  }
  return `/* sc-step: ${step.type} */`;
}

/** Compile a value that may be a formula/js object, handling component variable refs */
function compileScValue(val: unknown, instanceId: string, scVarNames: Set<string>, componentProps?: Record<string, unknown>): string {
  if (val === null || val === undefined) return 'undefined';
  if (typeof val === 'boolean' || typeof val === 'number') return String(val);
  if (typeof val === 'string') return JSON.stringify(val);
  if (Array.isArray(val)) { try { return JSON.stringify(val); } catch { return '[]'; } }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if ('formula' in obj && typeof obj.formula === 'string') {
      const rewritten = substituteScVarsInFormula(obj.formula, instanceId, scVarNames, componentProps);
      if (!isExpression(obj.formula)) {
        return `(() => { ${rewritten} })()`;
      }
      return rewritten;
    }
    if ('js' in obj && typeof obj.js === 'string') {
      const rewritten = substituteScVarsInFormula(obj.js, instanceId, scVarNames, componentProps);
      if (!isExpression(obj.js)) {
        return `(() => { ${rewritten} })()`;
      }
      return rewritten;
    }
  }
  return JSON.stringify(val);
}

/** Replace context.component.variables, context.component.props, and context.item refs in a formula/step string */
function substituteScVarsInFormula(
  formula: string,
  instanceId: string,
  scVarNames: Set<string>,
  componentProps?: Record<string, unknown>,
): string {
  const idKey = JSON.stringify(instanceId);
  let out = formula;

  // Substitute context.item → _item (used in workflows that reference the loop variable)
  out = out.replace(/\bcontext\??\.item\b/g, '_item');
  out = out.replace(/\bcontext\??\.index\b/g, 'index');

  // Substitute context.component.props.X → literal prop value
  if (componentProps) {
    // Dot notation: context?.component?.props?.propName or context.component.props.propName
    out = out.replace(
      /context\??\.component\??\.props\??(?:\.|\?\.)?([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
      (_, propName) => {
        const val = componentProps[propName];
        if (val === undefined || val === null) return 'undefined';
        if (typeof val === 'string') return JSON.stringify(val);
        if (typeof val === 'number' || typeof val === 'boolean') return String(val);
        return JSON.stringify(val);
      },
    );
    // Bracket notation: context?.component?.props?.['propName'] or context.component.props['propName']
    out = out.replace(
      /context\??\.component\??\.props\??(?:\.|\?\.)?(?:\[['"]([^'"]+)['"]\])/g,
      (_, propName) => {
        const val = componentProps[propName];
        if (val === undefined || val === null) return 'undefined';
        if (typeof val === 'string') return JSON.stringify(val);
        if (typeof val === 'number' || typeof val === 'boolean') return String(val);
        return JSON.stringify(val);
      },
    );
  }

  // Matches: context?.component?.variables?.['name'], context?.component?.variables?.name,
  // context.component.variables['name'], etc. — handles optional-chain and regular dot access.
  out = out.replace(
    /context\??\.component\??\.variables\??(?:(?:\.|\?\.)?\[\s*['"]([^'"]+)['"]\s*\]|(?:\.|\?\.)?([a-zA-Z_$][a-zA-Z0-9_$]*))/g,
    (_, bracketName, dotName) => {
      const varName = bracketName ?? dotName;
      if (!varName) return 'undefined';
      if (scVarNames.has(varName)) {
        return `state?.componentVars?.[${idKey}]?.[${JSON.stringify(varName)}]`;
      }
      return 'undefined';
    },
  );
  return out;
}

/**
 * Substitute template strings and formula expressions for both
 * context.component.props.X (static) and context.component.variables.X (dynamic store access).
 */
function substituteComponentContext(
  node: AnyNode,
  cProps: Record<string, unknown>,
  instanceId: string,
  scVarNames: Set<string>,
): AnyNode {
  if (!node || typeof node !== 'object') return node;

  const idKey = JSON.stringify(instanceId);

  function substitutePropStr(s: string): string {
    return s
      .replace(/\{\{context\.component\.props\.(\w+)\}\}/g, (_, k) => {
        const v = cProps[k];
        return v !== undefined ? String(v) : '';
      })
      .replace(/\{\{context\.component\.variables\.([^}]+)\}\}/g, (_, k) => {
        if (scVarNames.has(k)) return `\${state?.componentVars?.[${idKey}]?.[${JSON.stringify(k)}]}`;
        return '';
      });
  }

  function substituteFormulaStr(s: string): string {
    // First substitute props references
    let out = s.replace(
      /context\??\.component\??\.props\??(?:\.?\[\s*['"]([^'"]+)['"]\s*\]|\.(\w+))/g,
      (_, bracketName, dotName) => {
        const k = bracketName ?? dotName;
        const val = cProps[k];
        if (val === undefined) return 'undefined';
        if (typeof val === 'string') return JSON.stringify(val);
        if (typeof val === 'number' || typeof val === 'boolean') return String(val);
        // Arrays and objects must be JSON-serialized to avoid "[object Object]" in generated code
        try { return JSON.stringify(val); } catch { return 'undefined'; }
      },
    );
    // Then substitute variables references
    out = substituteScVarsInFormula(out, instanceId, scVarNames);
    return out;
  }

  function substituteValue(v: unknown): unknown {
    if (typeof v === 'string') return substitutePropStr(v);
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      if ('formula' in obj && typeof obj.formula === 'string') {
        return { ...obj, formula: substituteFormulaStr(obj.formula) };
      }
      if ('js' in obj && typeof obj.js === 'string') {
        return { ...obj, js: substituteFormulaStr(obj.js) };
      }
      // Plain style/map object — substitute each value recursively
      const out: Record<string, unknown> = {};
      for (const [sk, sv] of Object.entries(obj)) out[sk] = substituteValue(sv);
      return out;
    }
    return v;
  }

  // Replace in node.text (handles both plain strings and formula objects)
  const rawText = (node as Record<string, unknown>).text;
  const newText = rawText !== undefined ? substituteValue(rawText) : rawText;

  // Replace in node.map (Repeater formula)
  const rawMap = (node as Record<string, unknown>).map;
  const newMap = rawMap ? substituteValue(rawMap) : rawMap;

  // Replace in node.condition
  const rawCond = (node as Record<string, unknown>).condition;
  const newCond = typeof rawCond === 'string' ? substituteFormulaStr(rawCond) : rawCond;

  // Replace actions: action refs to internal SC workflows → add __inlineCode
  const rawActions = (node as Record<string, unknown>).actions;
  const newActions = substituteActions(rawActions, instanceId, scVarNames);

  const newProps: Record<string, unknown> = {};
  for (const [k, v] of Object.entries((node.props as Record<string, unknown>) ?? {})) {
    newProps[k] = substituteValue(v);
  }

  // Annotate popover nodes inside an SC: find the SC variable that controls open state
  const isPopoverNode = !!(node as Record<string, unknown>).popover;
  let popoverControlled: { instanceId: string; openVar: string } | undefined;
  if (isPopoverNode && scVarNames.size > 0) {
    const openVar = [...scVarNames].find(
      v => v.endsWith('-open') || v === 'open' || v.toLowerCase().includes('open'),
    );
    if (openVar) popoverControlled = { instanceId, openVar };
  }

  return {
    ...node,
    ...(popoverControlled ? { _popoverControlled: popoverControlled } : {}),
    ...(newText !== rawText ? { text: newText } : {}),
    ...(newMap !== rawMap ? { map: newMap } : {}),
    ...(newCond !== rawCond ? { condition: newCond } : {}),
    ...(newActions !== rawActions ? { actions: newActions } : {}),
    props: newProps,
    children: (node.children ?? []).map(c =>
      substituteComponentContext(c, cProps, instanceId, scVarNames),
    ),
  };
}

type InlineAction = { action: string; trigger?: string; __inlineCode?: string };

/** Replace internal SC workflow references with __inlineCode */
function substituteActions(
  actions: unknown,
  instanceId: string,
  scVarNames: Set<string>,
): unknown {
  if (!actions) return actions;
  // Actions registry (component workflows) is looked up later in flattenSharedInstance
  // Here we just mark them for deferral — actual inline code is set in flattenSharedInstance
  return actions;
}

/**
 * Annotate template nodes of Input/Textarea type with _inputValueId from the instance children.
 * This allows emitNodeInner to generate an onChange handler even when template nodes have no id.
 */
function annotateInputValueIds(
  node: AnyNode,
  pending: Array<{ type: string; id: string }>,
): AnyNode {
  if (!node || typeof node !== 'object') return node;
  const type = node.type as string | undefined;
  const inputTypes = new Set(['Input', 'InputField', 'Textarea', 'TextareaInput']);
  let annotated = node;

  if (type && inputTypes.has(type) && !(node as Record<string, unknown>).id) {
    const match = pending.find(p => p.type === type);
    if (match) {
      annotated = { ...node, _inputValueId: match.id } as AnyNode;
      // Remove the matched entry so subsequent same-type nodes get the next id
      pending = pending.filter(p => p !== match);
    }
  }

  if ((annotated.children ?? []).length > 0) {
    annotated = {
      ...annotated,
      children: (annotated.children as AnyNode[]).map(c => annotateInputValueIds(c, pending)),
    };
  }
  return annotated;
}

/** Flatten a shared component instance into its own subtree with overrides applied */
function flattenSharedInstance(node: AnyNode): AnyNode {
  if (!node._shared?.id) return node;

  try {
    const allSCs = getSharedComponents();
    const model = allSCs[node._shared.id];
    if (!model) return { ...node, _shared: undefined };

    const content = (model as unknown as { content?: AnyNode }).content;
    if (!content) return { ...node, _shared: undefined };

    // Build component props map: start with property defaultValues
    const properties = (model as unknown as { properties?: SCProperty[] }).properties ?? [];
    const componentProps: Record<string, unknown> = {};
    for (const p of properties) {
      componentProps[p.name] = p.defaultValue;
    }

    // Apply instance-level overrides (via _overrides list AND any matching prop key)
    if (node.props) {
      const instanceProps = node.props as Record<string, unknown>;
      for (const key of node._overrides ?? []) {
        if (key in instanceProps) componentProps[key] = instanceProps[key];
      }
      for (const p of properties) {
        if (p.name in instanceProps) componentProps[p.name] = instanceProps[p.name];
      }
    }

    // Build component variables map: { varName: initialValue }
    const variables = (model as unknown as { variables?: Record<string, SCVarDef> }).variables ?? {};
    const scVarNames = new Set(Object.keys(variables));
    const scVarsInit: Record<string, unknown> = {};
    for (const [varName, varDef] of Object.entries(variables)) {
      scVarsInit[varName] = varDef.initialValue;
    }

    // Build component workflows map
    const scWorkflows = (model as unknown as { workflows?: Record<string, SCWorkflow> }).workflows ?? {};
    const instanceId = (node.id as string) ?? node._shared.id;
    // The valueVariable is the SC's "output" variable — synced to state.variables[instanceId-value]
    const valueVariable = (model as unknown as { valueVariable?: string }).valueVariable;

    // Substitute context.component.props.* AND context.component.variables.* throughout the content tree
    let resolved = substituteComponentContext(content, componentProps, instanceId, scVarNames);

    // Walk the resolved tree and replace SC workflow action references with inline code
    // Pass the instance node's 'name' (if set) as the RHF field name for form.setValue registration.
    const instanceRhfName = typeof node.name === 'string' && node.name ? node.name : undefined;
    if (Object.keys(scWorkflows).length > 0) {
      resolved = inlineScWorkflows(resolved, instanceId, scVarNames, scWorkflows, valueVariable, componentProps, instanceRhfName);
    }

    // For components without valueVariable (e.g. sc-input-field, sc-textarea-field):
    // find Input/Textarea child IDs from the instance node's children and annotate the
    // corresponding template node so nodes.ts can emit an onChange value-sync handler.
    if (!valueVariable) {
      const inputTypes = new Set(['Input', 'InputField', 'Textarea', 'TextareaInput']);
      const instanceChildren = (node.children ?? []) as AnyNode[];
      const inputChildIds = instanceChildren
        .filter(c => inputTypes.has(c.type as string) && c.id)
        .map(c => ({ type: c.type as string, id: c.id as string }));
      if (inputChildIds.length > 0) {
        resolved = annotateInputValueIds(resolved, inputChildIds);
      }
    }

    // Preserve _controlled, name, _initialValue and valueVariable from the instance node on the resolved root.
    // These mark the node as a custom form field (used by routing.ts to generate RHF sync effects).
    if (node._controlled !== undefined) {
      (resolved as Record<string, unknown>)._controlled = node._controlled;
      if (node.name) (resolved as Record<string, unknown>).name = node.name;
      if ((node as Record<string, unknown>)._initialValue !== undefined) {
        (resolved as Record<string, unknown>)._initialValue = (node as Record<string, unknown>)._initialValue;
      }
      // Preserve _validation so routing.ts can register RHF rules for SC-based controlled fields
      if ((node as Record<string, unknown>)._validation !== undefined) {
        (resolved as Record<string, unknown>)._validation = (node as Record<string, unknown>)._validation;
      }
      // Preserve the SC's valueVariable so routing.ts can find the correct initial value in _scVarsInit
      if (valueVariable) (resolved as Record<string, unknown>)._valueVariable = valueVariable;
      // Use the instance's id as the value-variable key (consistent with {instanceId}-value convention)
      (resolved as Record<string, unknown>).id = instanceId;
    }

    // Merge per-instance CSS/className overrides to the root node
    const overrides = node._overrides ?? [];
    const merged: AnyNode = { ...resolved };
    if (overrides.length > 0 && node.props) {
      const overriddenProps: Record<string, unknown> = {};
      for (const key of overrides) {
        if (key in ((node.props as Record<string, unknown>) ?? {})) {
          overriddenProps[key] = (node.props as Record<string, unknown>)[key];
        }
      }
      merged.props = { ...merged.props, ...overriddenProps };
    }

    // Annotate with component var initializers so the page can seed the store.
    // Also include valueVariable so routing.ts can initialize state.variables[instanceId-value]
    // with the correct default (fixes live-indicator showing "—" on first load).
    if (scVarNames.size > 0) {
      (merged as Record<string, unknown>)._scVarsInit = { instanceId, vars: scVarsInit, valueVariable: valueVariable ?? null };
    }

    return flattenNode(merged);
  } catch {
    return { ...node, _shared: undefined };
  }
}

/** Walk a resolved subtree and replace SC workflow action refs with __inlineCode */
function inlineScWorkflows(
  node: AnyNode,
  instanceId: string,
  scVarNames: Set<string>,
  scWorkflows: Record<string, SCWorkflow>,
  valueVariable?: string,
  componentProps?: Record<string, unknown>,
  rhfName?: string,
): AnyNode {
  const rawActions = (node as Record<string, unknown>).actions;
  let newActions = rawActions;

  if (Array.isArray(rawActions)) {
    newActions = rawActions.map((item: unknown) => {
      if (!item || typeof item !== 'object') return item;
      const ref = item as InlineAction;
      const wf = scWorkflows[ref.action];
      if (!wf) return ref;
      const stepsCode = (wf.steps ?? [])
        .map(step => compileScStep(step, instanceId, scVarNames, valueVariable, componentProps, rhfName))
        .join('\n  ');
      return { ...ref, __inlineCode: stepsCode };
    });
  } else if (rawActions && typeof rawActions === 'object') {
    const mapped: Record<string, unknown> = {};
    for (const [evt, action] of Object.entries(rawActions as Record<string, unknown>)) {
      const ref = action as InlineAction;
      const wfId = ref?.action ?? (typeof action === 'string' ? action : '');
      const wf = scWorkflows[wfId];
      if (wf) {
        const stepsCode = (wf.steps ?? [])
          .map(step => compileScStep(step, instanceId, scVarNames, valueVariable, componentProps, rhfName))
          .join('\n  ');
        mapped[evt] = { ...(typeof ref === 'object' ? ref : { action: wfId }), __inlineCode: stepsCode };
      } else {
        mapped[evt] = action;
      }
    }
    newActions = mapped;
  }

  return {
    ...node,
    ...(newActions !== rawActions ? { actions: newActions } : {}),
    children: (node.children ?? []).map(c => inlineScWorkflows(c, instanceId, scVarNames, scWorkflows, valueVariable, componentProps, rhfName)),
  };
}

function flattenNode(node: AnyNode): AnyNode {
  // 1. Flatten shared instance
  const n1 = flattenSharedInstance(node);
  // 2. Merge responsive
  const n2 = mergeResponsive(n1);
  // 3. Recurse
  return {
    ...n2,
    children: (n2.children ?? []).map(flattenNode),
  };
}

/** Collect all _scVarsInit annotations from a resolved tree */
export function collectScVarsInits(
  nodes: SDUINode[],
): Array<{ instanceId: string; vars: Record<string, unknown>; valueVariable: string | null }> {
  const result: Array<{ instanceId: string; vars: Record<string, unknown>; valueVariable: string | null }> = [];
  const seen = new Set<string>();
  function walk(node: Record<string, unknown>) {
    if (node._scVarsInit) {
      const init = node._scVarsInit as { instanceId: string; vars: Record<string, unknown>; valueVariable?: string | null };
      if (!seen.has(init.instanceId)) {
        seen.add(init.instanceId);
        result.push({ instanceId: init.instanceId, vars: init.vars, valueVariable: init.valueVariable ?? null });
      }
    }
    const children = node.children as Record<string, unknown>[] | undefined;
    if (Array.isArray(children)) children.forEach(walk);
  }
  (nodes as unknown as Record<string, unknown>[]).forEach(walk);
  return result;
}

export function resolvePageNodes(nodes: SDUINode[]): SDUINode[] {
  return (nodes as AnyNode[]).map(flattenNode) as SDUINode[];
}

// Re-export toSafeId for use in routing.ts
export { toSafeId };
