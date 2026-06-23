/**
 * PostToolUse validator for the JSON agent.
 *
 * Called after every Write/Edit tool use. Parses the written file,
 * checks required fields by VFS path kind, and returns an error message
 * as additionalContext if invalid (the agent sees it and self-corrects).
 */

export interface ValidationResult {
  ok: boolean;
  /** Present when ok === false */
  error?: string;
}

/** Strip the .json extension to get the VFS path. */
export function toVfsPath(filePath: string): string {
  return filePath.replace(/\.json$/, '');
}

/** Determine which kind of entity a VFS path represents. */
type EntityKind =
  | 'routes'
  | 'theme'
  | 'colors'
  | 'variable'
  | 'formula'
  | 'workflow'
  | 'trigger'
  | 'datasource'
  | 'page'
  | 'pageWorkflow'
  | 'pageTrigger'
  | 'component'
  | 'unknown';

function classifyPath(vfsPath: string): EntityKind {
  const p = vfsPath;
  if (p === 'routes') return 'routes';
  if (p === 'design/theme') return 'theme';
  if (p === 'design/colors') return 'colors';
  if (p.startsWith('store/')) return 'variable';
  if (p.startsWith('utils/')) return 'formula';
  if (p.startsWith('data/')) return 'datasource';
  if (p.startsWith('triggers/')) return 'trigger';
  if (p.startsWith('workflows/')) return 'workflow';
  if (p.startsWith('components/') && p.endsWith('/component')) return 'component';
  if (/^pages\/[^/]+\/page$/.test(p)) return 'page';
  if (/^pages\/[^/]+\/workflows\//.test(p)) return 'pageWorkflow';
  if (/^pages\/[^/]+\/triggers\//.test(p)) return 'pageTrigger';
  return 'unknown';
}

function requireFields(obj: Record<string, unknown>, fields: string[]): string | null {
  for (const f of fields) {
    if (obj[f] === undefined || obj[f] === null) {
      return `missing required field "${f}"`;
    }
  }
  return null;
}

function validateByKind(kind: EntityKind, data: unknown, vfsPath: string): string | null {
  if (kind === 'unknown') return null; // allow unknown paths through

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return 'entity file must be a JSON object';
  }

  const obj = data as Record<string, unknown>;

  switch (kind) {
    case 'routes': {
      if (!Array.isArray(obj.routes)) return '"routes" must be an array';
      for (const r of obj.routes as unknown[]) {
        if (typeof r !== 'object' || r === null) continue;
        const route = r as Record<string, unknown>;
        if (!route.path || !route.config) return 'each route must have "path" and "config"';
      }
      return null;
    }

    case 'theme': {
      return null; // any object is valid for theme overrides
    }

    case 'colors': {
      if (!Array.isArray(data)) return 'colors must be an array';
      return null;
    }

    case 'variable': {
      const err = requireFields(obj, ['id', 'name', 'type', 'initialValue']);
      if (err) return err;
      const validTypes = ['string', 'number', 'boolean', 'object', 'array'];
      if (!validTypes.includes(obj.type as string)) {
        return `"type" must be one of: ${validTypes.join(', ')}`;
      }
      return null;
    }

    case 'formula': {
      const err = requireFields(obj, ['name', 'formula', 'params']);
      if (err) return err;
      if (!Array.isArray(obj.params)) return '"params" must be an array';
      return null;
    }

    case 'datasource': {
      const err = requireFields(obj, ['id', 'name', 'type']);
      if (err) return err;
      const validTypes = ['rest', 'graphql'];
      if (!validTypes.includes(obj.type as string)) {
        return `"type" must be one of: ${validTypes.join(', ')}`;
      }
      return null;
    }

    case 'workflow':
    case 'pageWorkflow': {
      const err = requireFields(obj, ['id', 'meta', 'steps']);
      if (err) return err;
      const meta = obj.meta as Record<string, unknown> | null;
      if (!meta || typeof meta !== 'object') return '"meta" must be an object';
      if (!meta.name) return '"meta.name" is required';
      if (!meta.trigger) return '"meta.trigger" is required';
      if (kind === 'pageWorkflow' && !meta.pageScope) {
        return '"meta.pageScope" is required for page-scoped workflows';
      }
      if (!Array.isArray(obj.steps)) return '"steps" must be an array';
      const stepsErr = validateSteps(obj.steps as unknown[]);
      if (stepsErr) return stepsErr;
      return null;
    }

    case 'trigger':
    case 'pageTrigger': {
      const err = requireFields(obj, ['id', 'meta', 'steps']);
      if (err) return err;
      if (!Array.isArray(obj.steps)) return '"steps" must be an array';
      return null;
    }

    case 'page': {
      if (!obj.ui) return '"ui" field is required on a page entity';
      const rawUi = obj.ui;
      const uiArr = Array.isArray(rawUi) ? rawUi : [rawUi];
      const nodeErr = validateNodes(uiArr);
      if (nodeErr) return nodeErr;
      return null;
    }

    case 'component': {
      return null; // allow any valid object for components
    }

    default:
      return null;
  }
}

const VALID_NODE_TYPES = new Set([
  'Box', 'Text', 'Input', 'Textarea', 'FormContainer',
  'Image', 'Icon', 'Video', 'Iframe',
  'Chart', 'LottiePlayer', 'HtmlContent',
]);

function validateNodes(nodes: unknown[]): string | null {
  for (const n of nodes) {
    if (typeof n !== 'object' || n === null) continue;
    const node = n as Record<string, unknown>;
    if (!node.type) return 'each UINode must have a "type" field';
    if (!VALID_NODE_TYPES.has(node.type as string)) {
      return `unknown node type "${node.type}". Valid: ${[...VALID_NODE_TYPES].join(', ')}`;
    }
    // text only on Text nodes
    if (node.text !== undefined && node.type !== 'Text') {
      return `"text" field is only valid on Text nodes (found on ${node.type})`;
    }
    // children only on Box / FormContainer
    if (Array.isArray(node.children)) {
      if (node.type !== 'Box' && node.type !== 'FormContainer') {
        return `"children" is only valid on Box and FormContainer nodes (found on ${node.type})`;
      }
      const childErr = validateNodes(node.children as unknown[]);
      if (childErr) return childErr;
    }
  }
  return null;
}

const VALID_STEP_TYPES = new Set([
  'changeVariableValue', 'resetVariableValue', 'branch', 'multiOptionBranch',
  'navigateTo', 'navigatePrev', 'runJavaScript', 'graphql', 'fetchCollection',
  'fetchCollectionsParallel', 'forEach', 'whileLoop', 'timeDelay', 'setFormState',
  'authenticate', 'setUser', 'clearSession', 'restoreSession', 'copyToClipboard',
  'scrollToElement', 'controlAnimation', 'runProjectWorkflow', 'returnValue',
  'stopPropagation', 'breakLoop', 'continueLoop', 'fetchData', 'updateCollection',
  'resetForm', 'passThroughCondition', 'executeComponentAction',
  'pickFile', 'printPdf', 'downloadFileFromUrl', 'createUrlFromBase64', 'encodeFileAsBase64',
]);

function validateSteps(steps: unknown[]): string | null {
  for (const s of steps) {
    if (typeof s !== 'object' || s === null) continue;
    const step = s as Record<string, unknown>;
    if (!step.type) return 'each workflow step must have a "type" field';
    if (!VALID_STEP_TYPES.has(step.type as string)) {
      return `unknown step type "${step.type}"`;
    }
    // branch: require trueBranch + falseBranch
    if (step.type === 'branch') {
      if (!Array.isArray(step.trueBranch)) return 'branch step requires "trueBranch" array';
      if (!Array.isArray(step.falseBranch)) return 'branch step requires "falseBranch" array';
    }
    // multiOptionBranch: require branches + defaultBranch
    if (step.type === 'multiOptionBranch') {
      if (!Array.isArray(step.branches)) return 'multiOptionBranch requires "branches" array';
      if (!Array.isArray(step.defaultBranch)) return 'multiOptionBranch requires "defaultBranch" array';
    }
    // forEach / whileLoop: require loopBody
    if (step.type === 'forEach' || step.type === 'whileLoop') {
      if (!Array.isArray(step.loopBody)) return `${step.type} step requires "loopBody" array`;
    }
  }
  return null;
}

/**
 * Validate a file written by the agent.
 *
 * @param filePath  VFS-relative path — with or without .json extension
 * @param content   Raw file content (string)
 */
export function validateEntityFile(filePath: string, content: string): ValidationResult {
  // Normalise: strip .json so classifyPath works regardless of how the caller passes the path
  const vfsPath = toVfsPath(filePath);
  const kind = classifyPath(vfsPath);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return {
      ok: false,
      error: `JSON parse error in ${filePath}: ${(e as Error).message}`,
    };
  }

  const err = validateByKind(kind, parsed, vfsPath);
  if (err) {
    return { ok: false, error: `Validation error in ${filePath} (${kind}): ${err}` };
  }

  return { ok: true };
}
