/**
 * decompile-nodes
 *
 * Converts a SDUINode tree back to a JSX string that matches the DSL syntax
 * Claude writes. Uses `_sx` (preserved at compile time) to emit `sx={{ }}`
 * instead of className, and maps actions to `onClick={workflow(...)}`.
 */

import type { SDUINode, SDUIAction } from '@/lib/sdui/types/node';
import type { ResolveContext } from './resolve';
import { resolveVarRefs } from './resolve';

// ── sx pretty-printer ─────────────────────────────────────────────────────────

/**
 * Serialize a raw sx Record back to inline JSX object syntax.
 * Numbers stay unquoted, strings are quoted, booleans are unquoted.
 */
function sxToJsx(sx: Record<string, unknown>, indentLevel: number): string {
  const pad   = '  '.repeat(indentLevel + 1);
  const close = '  '.repeat(indentLevel);
  const entries = Object.entries(sx);
  if (entries.length === 0) return '{}';
  const lines = entries.map(([k, v]) => {
    if (typeof v === 'string') return `${pad}${k}: '${v}'`;
    if (typeof v === 'number' || typeof v === 'boolean') return `${pad}${k}: ${v}`;
    // formula / spread value — emit as string
    return `${pad}${k}: ${JSON.stringify(v)}`;
  });
  return `{{\n${lines.join(',\n')},\n${close}}}`;
}

// ── Prop value serializer ─────────────────────────────────────────────────────

function serializePropValue(value: unknown, ctx: ResolveContext): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return `{${value}}`;
  if (typeof value === 'number') return `{${value}}`;
  if (typeof value === 'string') {
    const resolved = resolveVarRefs(value, ctx);
    if (resolved.includes('{{') || resolved.includes('vars[') || resolved.includes('variables[')) {
      const expr = resolved.replace(/^\{\{(.+)\}\}$/, '$1');
      return `{${expr}}`;
    }
    const escaped = resolved.replace(/"/g, '&quot;');
    return `"${escaped}"`;
  }
  if (typeof value === 'object') {
    return `{${JSON.stringify(value)}}`;
  }
  return `{${JSON.stringify(value)}}`;
}

// ── Action → onClick / onChange handler ──────────────────────────────────────

function actionsToProps(
  actions: SDUINode['actions'],
  ctx: ResolveContext,
): Array<{ prop: string; expr: string }> {
  if (!actions) return [];

  const rawEntries: unknown[] = Array.isArray(actions)
    ? actions
    : Object.values(actions).flat();

  const result: Array<{ prop: string; expr: string }> = [];

  for (const raw of rawEntries) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;

    // Compact format: { trigger, workflowId }
    if (typeof a.trigger === 'string' && typeof a.workflowId === 'string') {
      const triggerProp = a.trigger === 'click' ? 'onClick'
        : a.trigger === 'change' ? 'onChange'
        : a.trigger === 'submit' ? 'onSubmit'
        : `on${(a.trigger as string).charAt(0).toUpperCase()}${(a.trigger as string).slice(1)}`;
      const wfName = ctx.uuidToWorkflow.get(a.workflowId as string) ?? (a.workflowId as string);
      const params = a.params as Record<string, unknown> | undefined;
      const hasParams = params && Object.keys(params).length > 0;
      if (hasParams) {
        const argsStr = Object.values(params!).map(v =>
          typeof v === 'string' ? `'${v}'` : JSON.stringify(v)
        ).join(', ');
        result.push({ prop: triggerProp, expr: `{() => ${wfName}(${argsStr})}` });
      } else {
        result.push({ prop: triggerProp, expr: `{${wfName}}` });
      }
      continue;
    }
        // Legacy steps format: { trigger: 'click', steps: [{ type: 'executeWorkflow', config: { workflowId, params? } }] }
    if (typeof a.trigger === 'string' && Array.isArray(a.steps)) {
      const triggerProp = a.trigger === 'click' ? 'onClick'
        : a.trigger === 'change' ? 'onChange'
        : a.trigger === 'submit' ? 'onSubmit'
        : `on${a.trigger.charAt(0).toUpperCase()}${a.trigger.slice(1)}`;

      // Find the first executeWorkflow step to extract the workflowId
      const execStep = (a.steps as Array<Record<string, unknown>>).find(s => s.type === 'executeWorkflow');
      if (execStep) {
        const cfg = (execStep.config ?? {}) as Record<string, unknown>;
        const workflowId = (cfg.workflowId ?? cfg.workflowName ?? '') as string;
        const wfName = ctx.uuidToWorkflow.get(workflowId) ?? workflowId;
        const params = cfg.params as Record<string, unknown> | undefined;
        const hasParams = params && Object.keys(params).length > 0;
        if (hasParams) {
          const argsStr = Object.values(params!).map(v =>
            typeof v === 'string' ? `'${v}'` : JSON.stringify(v)
          ).join(', ');
          result.push({ prop: triggerProp, expr: `{() => ${wfName}(${argsStr})}` });
        } else {
          result.push({ prop: triggerProp, expr: `{${wfName}}` });
        }
      }
      continue;
    }

    // Legacy format: { action: 'uuid', params?: {...} }
    const legacyAction = a as unknown as SDUIAction;
    const wfName = ctx.uuidToWorkflow.get(legacyAction.action) ?? legacyAction.action;
    const hasParams = legacyAction.params && Object.keys(legacyAction.params).length > 0;
    if (hasParams) {
      // With params: onClick={() => workflowName(args)}
      const argsStr = Object.values(legacyAction.params!).map(v =>
        typeof v === 'string' ? `'${v}'` : JSON.stringify(v)
      ).join(', ');
      result.push({ prop: 'onClick', expr: `{() => ${wfName}(${argsStr})}` });
    } else {
      // Direct reference: onClick={workflowName}
      result.push({ prop: 'onClick', expr: `{${wfName}}` });
    }
  }

  return result;
}

// ── Text serializer ───────────────────────────────────────────────────────────

function serializeText(text: SDUINode['text'], ctx: ResolveContext): string | null {
  if (text === undefined || text === null || text === '') return null;

  if (typeof text === 'string') {
    const resolved = resolveVarRefs(text, ctx);
    if (resolved.includes('{{') || resolved.includes('vars[')) {
      const expr = resolved.replace(/^\{\{(.+)\}\}$/, '$1');
      return `{${expr}}`;
    }
    return resolved;
  }

  if (typeof text === 'object') {
    const formula = typeof text.formula === 'string'
      ? resolveVarRefs(text.formula, ctx)
      : JSON.stringify(text.formula);
    let expr = formula;
    if (text.prefix)  expr = `'${text.prefix}' + ${expr}`;
    if (text.suffix)  expr = `${expr} + '${text.suffix}'`;
    return `{${expr}}`;
  }

  return null;
}

// ── Collect all component types used in a node tree ──────────────────────────

export function collectComponentTypes(nodes: SDUINode[]): Set<string> {
  const types = new Set<string>();
  function walk(node: SDUINode) {
    types.add(node.type);
    (node.children ?? []).forEach(walk);
  }
  nodes.forEach(walk);
  return types;
}

/** True when any node in the tree has actions (needs `workflow` import). */
export function hasWorkflowRefs(nodes: SDUINode[]): boolean {
  function walk(node: SDUINode): boolean {
    if ((node.actions as unknown[])?.length) return true;
    return (node.children ?? []).some(walk);
  }
  return nodes.some(walk);
}

/** True when any node in the tree has a vars[] text binding (needs `vars` import). */
export function hasVarRefs(nodes: SDUINode[]): boolean {
  function check(val: unknown): boolean {
    if (typeof val === 'string') return val.includes('variables[') || val.includes('vars[');
    if (typeof val === 'object' && val !== null) {
      return Object.values(val as Record<string, unknown>).some(check);
    }
    return false;
  }
  function walk(node: SDUINode): boolean {
    if (check(node.text)) return true;
    if (check(node.props)) return true;
    return (node.children ?? []).some(walk);
  }
  return nodes.some(walk);
}

// ── Core node serializer ──────────────────────────────────────────────────────

function serializeNode(node: SDUINode, ctx: ResolveContext, indent: number): string {
  const pad      = '  '.repeat(indent);
  const padInner = '  '.repeat(indent + 1);
  const tag      = node.type;

  const attrParts: string[] = [];

  // Emit className as flat prop string (no _sx needed in new API)
  if (node.props?.className) {
    attrParts.push(`className="${node.props.className as string}"`);
  }

  // condition
  if (node.condition !== undefined && node.condition !== null) {
    const cond = typeof node.condition === 'string'
      ? resolveVarRefs(node.condition, ctx)
      : JSON.stringify(node.condition);
    attrParts.push(`condition={${cond}}`);
  }

  // map
  if (node.map && typeof node.map === 'string') {
    attrParts.push(`map={${resolveVarRefs(node.map, ctx)}}`);
  }

  // src / alt
  if (node.src) attrParts.push(`src="${node.src}"`);
  if (node.alt) attrParts.push(`alt="${node.alt}"`);

  // Other props (skip className since we already handled it above)
  if (node.props) {
    for (const [key, val] of Object.entries(node.props)) {
      if (key === 'className') continue;
      if (key === 'style' && typeof val === 'object' && val !== null) {
        attrParts.push(`style={${JSON.stringify(val)}}`);
      } else {
        attrParts.push(`${key}=${serializePropValue(val, ctx)}`);
      }
    }
  }

  // onClick / onChange from actions
  const actionProps = actionsToProps(node.actions, ctx);
  for (const { prop, expr } of actionProps) {
    attrParts.push(`${prop}=${expr}`);
  }

  const attrsStr = attrParts.length > 0 ? ' ' + attrParts.join(' ') : '';

  const textContent = serializeText(node.text, ctx);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const hasContent  = textContent !== null || hasChildren;

  if (!hasContent) {
    return `${pad}<${tag}${attrsStr} />`;
  }

  const childLines: string[] = [];
  if (textContent !== null) childLines.push(`${padInner}${textContent}`);
  if (node.children) {
    for (const child of node.children) {
      childLines.push(serializeNode(child, ctx, indent + 1));
    }
  }

  return [
    `${pad}<${tag}${attrsStr}>`,
    ...childLines,
    `${pad}</${tag}>`,
  ].join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

export function decompileNodes(nodes: SDUINode[], ctx: ResolveContext, indent = 1): string {
  if (nodes.length === 0) return '  <Box />';
  if (nodes.length === 1) return serializeNode(nodes[0]!, ctx, indent);

  const pad      = '  '.repeat(indent);
  const children = nodes.map(n => serializeNode(n, ctx, indent + 1)).join('\n');
  return `${pad}<>\n${children}\n${pad}</>`;
}
