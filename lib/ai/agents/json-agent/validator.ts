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

// ─────────────────────────────────────────────────────────────────────────────
// Path classification
// ─────────────────────────────────────────────────────────────────────────────

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
  | 'serverApi'
  | 'serverModel'
  | 'serverMiddleware'
  | 'serverFunction'
  | 'serverEnum'
  | 'serverSeed'
  | 'unknown';

function classifyPath(vfsPath: string): EntityKind {
  const p = vfsPath;
  if (p === 'routes') return 'routes';
  if (p === 'design/theme') return 'theme';
  if (p === 'design/colors') return 'colors';

  // Server entities
  if (p.startsWith('server/apis/')) return 'serverApi';
  if (p.startsWith('server/models/')) return 'serverModel';
  if (p.startsWith('server/middleware/')) return 'serverMiddleware';
  if (p.startsWith('server/functions/')) return 'serverFunction';
  if (p.startsWith('server/enums/')) return 'serverEnum';
  if (p.startsWith('server/seeds/')) return 'serverSeed';

  // Global frontend
  if (p.startsWith('store/')) return 'variable';
  if (p.startsWith('utils/')) return 'formula';
  if (p.startsWith('data/')) return 'datasource';
  if (p.startsWith('triggers/')) return 'trigger';
  if (p.startsWith('workflows/')) return 'workflow';

  // SC sub-entities — reuse existing kinds
  if (/^components\/[^/]+\/store\//.test(p)) return 'variable';
  if (/^components\/[^/]+\/workflows\//.test(p)) return 'workflow';
  if (/^components\/[^/]+\/triggers\//.test(p)) return 'trigger';
  if (/^components\/[^/]+\/utils\//.test(p)) return 'formula';

  // Component root
  if (p.startsWith('components/') && p.endsWith('/component')) return 'component';

  // Pages
  if (/^pages\/[^/]+\/page$/.test(p)) return 'page';
  if (/^pages\/[^/]+\/workflows\//.test(p)) return 'pageWorkflow';
  if (/^pages\/[^/]+\/triggers\//.test(p)) return 'pageTrigger';

  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper utilities
// ─────────────────────────────────────────────────────────────────────────────

function requireFields(obj: Record<string, unknown>, fields: string[]): string | null {
  for (const f of fields) {
    if (obj[f] === undefined || obj[f] === null) {
      return `missing required field "${f}"`;
    }
  }
  return null;
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: string[],
  entity: string
): string | null {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      return `${entity}: unknown field "${key}". Allowed: ${allowed.join(', ')}`;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Valid trigger set (shared between workflow, trigger, and action validators)
// ─────────────────────────────────────────────────────────────────────────────

const VALID_TRIGGERS = new Set([
  'click', 'change', 'focus', 'blur', 'valueChange', 'enterKey', 'submit',
  'appLoad', 'pageLoad', 'pageUnload', 'reachEnd', 'mounted', 'beforeUnmount',
  'propertyChange', 'execution',
]);

// ─────────────────────────────────────────────────────────────────────────────
// UINode validation
// ─────────────────────────────────────────────────────────────────────────────

const VALID_NODE_TYPES = new Set([
  'Box', 'Text', 'Input', 'Textarea', 'FormContainer',
  'Image', 'Icon', 'Video', 'Iframe',
  'Chart', 'QRCodeWidget', 'MarkdownViewer', 'GoogleMap', 'GoogleMapPlaces',
  'LottiePlayer', 'HtmlContent',
]);

const VALID_NODE_KEYS = new Set([
  'type', 'name', 'id', 'props', 'text', 'condition', 'map', 'actions',
  'children', 'animation', 'popover', '_shared', '_popoverContent',
  '_disabledOverlay', '_validation',
]);

// ── responseSchema derivation ────────────────────────────────────────────────

/** Best-effort JSON Schema derived from a formula string (mirrors the builder UI's auto-fill). */
function schemaFromFormula(formula: string): Record<string, unknown> {
  const reserved = new Set(['formula', 'type', 'value', 'data', 'true', 'false', 'null']);
  const keys = [...formula.matchAll(/[{,]\s*["']?(\w+)["']?\s*:/g)]
    .map(m => m[1])
    .filter((k): k is string => Boolean(k) && !reserved.has(k));
  const unique = [...new Set(keys)];
  if (!unique.length) return { type: 'object', additionalProperties: true };
  const properties: Record<string, unknown> = {};
  for (const k of unique) properties[k] = { type: 'string' };
  return { type: 'object', properties };
}

// ── SxProp key whitelist ────────────────────────────────────────────────────

const VALID_SXPROP_KEYS = new Set([
  // Layout
  'flex', 'col', 'row', 'grid', 'center', 'display', 'direction', 'items',
  'justify', 'self', 'wrap', 'flex1', 'cols', 'gridCols', 'gridRows', 'gridFlow',
  'colSpan', 'colSpanFull', 'rowSpan', 'gap', 'gapX', 'gapY',
  // Size
  'w', 'h', 'minW', 'maxW', 'minH', 'maxH',
  // Spacing
  'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl',
  'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml',
  // Color & typography
  'bg', 'text', 'size', 'textColor', 'color', 'weight', 'textAlign', 'align',
  'leading', 'tracking', 'textDecoration', 'textTransform', 'uppercase', 'lowercase',
  'textOverflow', 'whitespace', 'wordBreak',
  // Border & shape
  'border', 'borderStyle', 'borderColor', 'radius', 'radiusTL', 'radiusTR', 'radiusBR', 'radiusBL',
  // Position & z
  'position', 'absolute', 'relative', 'fixed', 'sticky', 'inset0',
  'top', 'right', 'bottom', 'left', 'z',
  // Misc
  'overflow', 'cursor', 'opacity', 'objectFit', 'shadow', 'disabled',
  // Interaction state shorthands (transformed to animation config by resolve-style)
  'hover', 'press', 'scroll',
  // Responsive sub-objects
  'xl', 'lg', 'md',
  // Widget-specific
  'icon', 'placeholder', 'type', 'readOnly', 'format', 'value', 'content',
  'apiKey', 'lat', 'lng', 'zoom', 'mapId',
  'fgColor', 'bgColor', 'level',
  'src', 'alt', 'controls', 'muted', 'autoplay', 'loop',
  // Special node props kept inside props by convention
  '_validation', 'animation', 'popover',
]);

// Known React/CSS hallucinations → correct SxProp
const COMMON_PROP_MISTAKES: Record<string, string> = {
  backgroundColor: 'bg',
  fontWeight: 'weight',
  fontSize: 'text',
  marginTop: 'mt',
  marginBottom: 'mb',
  marginLeft: 'ml',
  marginRight: 'mr',
  paddingTop: 'pt',
  paddingBottom: 'pb',
  paddingLeft: 'pl',
  paddingRight: 'pr',
  borderRadius: 'radius',
  className: '(remove — use SxProp keys directly)',
  style: '(remove — use SxProp keys directly)',
  onClick: '(use actions array instead)',
  protectionCondition: '(not supported — use condition field)',
  protectionRedirect: '(not supported)',
  backendRunUrl: '(not supported — datasource url is resolved by the engine)',
};

// SxProp enum constraints
const ENUM_PROPS: Record<string, string[]> = {
  display: ['flex', 'grid', 'block', 'inline-block', 'inline', 'none'],
  direction: ['row', 'col', 'row-reverse', 'col-reverse'],
  items: ['start', 'end', 'center', 'stretch', 'baseline'],
  justify: ['start', 'end', 'center', 'between', 'around', 'evenly'],
  self: ['auto', 'start', 'center', 'end', 'stretch'],
  wrap: ['wrap', 'nowrap', 'wrap-reverse'],
  weight: ['thin', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black'],
  textAlign: ['left', 'center', 'right', 'justify'],
  align: ['left', 'center', 'right', 'justify'],
  leading: ['none', 'tight', 'snug', 'normal', 'relaxed', 'loose'],
  tracking: ['tighter', 'tight', 'normal', 'wide', 'wider', 'widest'],
  textDecoration: ['underline', 'line-through', 'no-underline'],
  textTransform: ['uppercase', 'lowercase', 'capitalize'],
  textOverflow: ['truncate'],
  whitespace: ['nowrap', 'pre', 'normal'],
  wordBreak: ['all', 'words', 'keep'],
  borderStyle: ['solid', 'dashed', 'dotted', 'none'],
  position: ['relative', 'absolute', 'fixed', 'sticky', 'static'],
  overflow: ['hidden', 'auto', 'visible', 'scroll'],
  cursor: ['pointer', 'default', 'not-allowed', 'grab', 'move', 'text'],
  objectFit: ['cover', 'contain', 'fill', 'none'],
  shadow: ['sm', 'md', 'lg', 'xl', '2xl', 'none'],
  gridFlow: ['row', 'col', 'dense'],
};

function validateProps(props: Record<string, unknown>): string | null {
  // Layer B semantic checks first (clear error messages)
  if ('style' in props) {
    return 'props.style is not supported. Use SxProp keys directly in props.';
  }
  if (typeof props.display === 'string' && props.display === 'hidden') {
    return 'props.display "hidden" is a Tailwind class, not a CSS display value. Use "none" to hide, or the condition field to remove the node.';
  }

  for (const [key, val] of Object.entries(props)) {
    if (key === 'xl' || key === 'lg' || key === 'md') continue;
    // Reject var(--X) where X doesn't start with theme-
    if (typeof val === 'string' && /var\(--(?!theme-)/.test(val)) {
      const varName = val.match(/var\((--[^)]+)\)/)?.[1] ?? val;
      return `props.${key} uses ${varName} (an RGB triplet variable). Use --theme-${varName.slice(2)} instead (e.g. "var(--theme-${varName.slice(2)})")`;
    }
  }

  // Layer A — key whitelist
  for (const key of Object.keys(props)) {
    if (key === 'xl' || key === 'lg' || key === 'md') {
      // Validate responsive sub-objects recursively
      const sub = props[key];
      if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
        const subErr = validateProps(sub as Record<string, unknown>);
        if (subErr) return `${key}: ${subErr}`;
      }
      continue;
    }
    if (!VALID_SXPROP_KEYS.has(key)) {
      const hint = COMMON_PROP_MISTAKES[key]
        ? ` — did you mean "${COMMON_PROP_MISTAKES[key]}"?`
        : '';
      return `props.${key} is not a valid SxProp${hint}. Check the SxProps table in CLAUDE.md.`;
    }
  }

  // Layer C — enum value checks (only for static strings, skip {js:...})
  for (const [key, allowed] of Object.entries(ENUM_PROPS)) {
    const val = props[key];
    if (typeof val === 'string' && !allowed.includes(val)) {
      return `props.${key} "${val}" is not valid. Allowed values: ${allowed.join(', ')}`;
    }
  }

  return null;
}

// Animation sub-key whitelist
const VALID_ANIMATION_PHASES = new Set(['enter', 'exit', 'loop', 'scroll', 'hover', 'press']);
const VALID_ANIMATION_PHASE_KEYS = new Set([
  'type', 'duration', 'delay', 'easing', 'stagger',
  'threshold', 'once', 'repeatCount', 'scale', 'opacity',
]);

function validateAnimation(animation: unknown): string | null {
  if (typeof animation !== 'object' || animation === null || Array.isArray(animation)) {
    return '"animation" must be an object';
  }
  for (const [phase, val] of Object.entries(animation as Record<string, unknown>)) {
    if (!VALID_ANIMATION_PHASES.has(phase)) {
      return `animation: unknown phase "${phase}". Allowed: ${[...VALID_ANIMATION_PHASES].join(', ')}`;
    }
    if (typeof val !== 'object' || val === null) {
      return `animation.${phase} must be an object`;
    }
    for (const key of Object.keys(val as Record<string, unknown>)) {
      if (!VALID_ANIMATION_PHASE_KEYS.has(key)) {
        return `animation.${phase}: unknown field "${key}". Allowed: ${[...VALID_ANIMATION_PHASE_KEYS].join(', ')}`;
      }
    }
  }
  return null;
}

// Popover field whitelist
const VALID_POPOVER_KEYS = new Set([
  'trigger', 'placement', 'offset', 'closeOnOutsideClick',
  'closeOnEscape', 'matchTriggerWidth', 'openVariable', 'componentId',
]);

function validatePopover(popover: unknown): string | null {
  if (typeof popover !== 'object' || popover === null || Array.isArray(popover)) {
    return '"popover" must be an object';
  }
  const p = popover as Record<string, unknown>;
  if (!p.trigger) return 'popover.trigger is required';
  if (p.trigger !== 'click' && p.trigger !== 'hover') {
    return `popover.trigger "${p.trigger}" is not valid. Use "click" or "hover".`;
  }
  for (const key of Object.keys(p)) {
    if (!VALID_POPOVER_KEYS.has(key)) {
      return `popover: unknown field "${key}". Allowed: ${[...VALID_POPOVER_KEYS].join(', ')}`;
    }
  }
  return null;
}

function validateNodes(nodes: unknown[]): string | null {
  for (const n of nodes) {
    if (typeof n !== 'object' || n === null) continue;
    const node = n as Record<string, unknown>;

    // Type required
    if (!node.type) return 'each UINode must have a "type" field';
    if (!VALID_NODE_TYPES.has(node.type as string)) {
      return `unknown node type "${node.type}". Valid: ${[...VALID_NODE_TYPES].join(', ')}`;
    }

    // Top-level key whitelist
    for (const key of Object.keys(node)) {
      if (!VALID_NODE_KEYS.has(key)) {
        return `UINode type=${node.type}: unknown field "${key}". Allowed top-level fields: ${[...VALID_NODE_KEYS].join(', ')}`;
      }
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

    // Validate props
    if (node.props && typeof node.props === 'object' && !Array.isArray(node.props)) {
      const propsErr = validateProps(node.props as Record<string, unknown>);
      if (propsErr) return `node type=${node.type}: ${propsErr}`;
    }

    // Validate animation
    if (node.animation !== undefined) {
      const animErr = validateAnimation(node.animation);
      if (animErr) return `node type=${node.type}: ${animErr}`;
    }

    // Validate popover
    if (node.popover !== undefined) {
      const popErr = validatePopover(node.popover);
      if (popErr) return `node type=${node.type}: ${popErr}`;
    }

    // Validate _shared
    if (node._shared !== undefined) {
      if (typeof node._shared !== 'object' || node._shared === null) {
        return `node type=${node.type}: "_shared" must be an object`;
      }
      const sh = node._shared as Record<string, unknown>;
      if (!sh.id || typeof sh.id !== 'string') {
        return `node type=${node.type}: "_shared.id" is required (string)`;
      }
      if (!sh.name || typeof sh.name !== 'string') {
        return `node type=${node.type}: "_shared.name" is required (string)`;
      }
      for (const key of Object.keys(sh)) {
        if (key !== 'id' && key !== 'name') {
          return `node type=${node.type}: "_shared" unknown field "${key}". Allowed: id, name`;
        }
      }
    }

    // Validate _validation
    if (node._validation !== undefined) {
      if (typeof node._validation !== 'object' || node._validation === null) {
        return `node type=${node.type}: "_validation" must be an object`;
      }
      const v = node._validation as Record<string, unknown>;
      const validValidationTriggers = ['submit', 'change', 'blur'];
      if (!v.trigger || !validValidationTriggers.includes(v.trigger as string)) {
        return `node type=${node.type}: "_validation.trigger" must be one of: ${validValidationTriggers.join(', ')}`;
      }
      if (!Array.isArray(v.rules)) {
        return `node type=${node.type}: "_validation.rules" must be an array`;
      }
      for (const key of Object.keys(v)) {
        if (key !== 'trigger' && key !== 'rules') {
          return `node type=${node.type}: "_validation" unknown field "${key}". Allowed: trigger, rules`;
        }
      }
    }

    // Validate map field
    if (node.map !== undefined) {
      if (typeof node.map !== 'object' || node.map === null || Array.isArray(node.map)) {
        return `node type=${node.type}: "map" must be an object`;
      }
      const m = node.map as Record<string, unknown>;
      if (!m.js || typeof m.js !== 'string') {
        return `node type=${node.type}: "map" must have a "js" string field`;
      }
      for (const key of Object.keys(m)) {
        if (key !== 'js' && key !== 'as' && key !== 'keyField') {
          return `node type=${node.type}: "map" unknown field "${key}". Allowed: js, as, keyField`;
        }
      }
    }

    // Validate actions
    if (node.actions !== undefined) {
      if (!Array.isArray(node.actions)) {
        return `node type=${node.type}: "actions" must be an array`;
      }
      for (const a of node.actions as unknown[]) {
        if (typeof a !== 'object' || a === null) continue;
        const action = a as Record<string, unknown>;
        if (!action.workflowId || typeof action.workflowId !== 'string') {
          return `node type=${node.type}: action missing required "workflowId" (string)`;
        }
        if (!action.trigger || typeof action.trigger !== 'string') {
          return `node type=${node.type}: action missing required "trigger" (string)`;
        }
        if (!VALID_TRIGGERS.has(action.trigger as string)) {
          return `node type=${node.type}: action trigger "${action.trigger}" is not valid. Valid: ${[...VALID_TRIGGERS].join(', ')}`;
        }
        if (action.params !== undefined && (typeof action.params !== 'object' || Array.isArray(action.params))) {
          return `node type=${node.type}: action "params" must be an object`;
        }
        for (const key of Object.keys(action)) {
          if (!['workflowId', 'trigger', 'params', 'config'].includes(key)) {
            return `node type=${node.type}: action unknown field "${key}". Allowed: workflowId, trigger, params, config`;
          }
        }
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontend step validation
// ─────────────────────────────────────────────────────────────────────────────

const VALID_STEP_TYPES = new Set([
  'changeVariableValue', 'resetVariableValue', 'branch', 'multiOptionBranch',
  'navigateTo', 'navigatePrev', 'runJavaScript', 'graphql', 'fetchCollection',
  'fetchCollectionsParallel', 'forEach', 'whileLoop', 'timeDelay', 'setFormState',
  'copyToClipboard', 'scrollToElement', 'controlAnimation', 'runProjectWorkflow',
  'returnValue', 'stopPropagation', 'breakLoop', 'continueLoop', 'fetchData',
  'updateCollection', 'resetForm', 'passThroughCondition', 'executeComponentAction',
  'pickFile', 'printPdf', 'downloadFileFromUrl', 'createUrlFromBase64',
  'encodeFileAsBase64', 'emitComponentTrigger', 'submitForm',
]);


// Config key whitelists for each frontend step type
const STEP_CONFIG_KEYS: Record<string, string[]> = {
  changeVariableValue: ['variableName', 'value'],
  resetVariableValue: ['variableName'],
  navigateTo: ['path', 'linkType', 'newTab', 'queryParams'],
  fetchData: ['url', 'method', 'headers', 'body'],
  runJavaScript: ['code'],
  graphql: ['url', 'query', 'variables', 'operationName', 'headers'],
  fetchCollection: ['collectionId'],
  fetchCollectionsParallel: ['collectionIds'],
  forEach: ['items'],
  timeDelay: ['ms'],
  runProjectWorkflow: ['workflowId', 'params'],
  returnValue: ['value'],
  passThroughCondition: ['condition'],
  copyToClipboard: ['text'],
  scrollToElement: ['targetNodeId'],
  controlAnimation: ['targetNodeId', 'action'],
  executeComponentAction: ['componentId', 'workflowId'],
  emitComponentTrigger: ['componentId', 'triggerId'],
  submitForm: ['formId'],
  setFormState: ['formId', 'fieldName', 'value'],
  resetForm: ['formId'],
  updateCollection: ['collectionId'],
  pickFile: ['accept', 'multiple'],
  downloadFileFromUrl: ['url', 'fileName'],
  createUrlFromBase64: ['data', 'type'],
  encodeFileAsBase64: ['file'],
  // Empty config — these steps take no config keys
  navigatePrev: [],
  breakLoop: [],
  continueLoop: [],
  stopPropagation: [],
  printPdf: [],
};

function validateSteps(steps: unknown[]): string | null {
  for (const s of steps) {
    if (typeof s !== 'object' || s === null) continue;
    const step = s as Record<string, unknown>;

    // id required
    if (!step.id || typeof step.id !== 'string') {
      return `each workflow step must have an "id" field (string). Steps are referenced as context.workflow['stepId'].result`;
    }

    if (!step.type) return 'each workflow step must have a "type" field';

    const type = step.type as string;

    if (!VALID_STEP_TYPES.has(type)) {
      return `unknown step type "${type}". Valid types: ${[...VALID_STEP_TYPES].join(', ')}`;
    }

    // branch: require trueBranch + falseBranch
    if (type === 'branch') {
      if (!Array.isArray(step.trueBranch)) return 'branch step requires "trueBranch" array';
      if (!Array.isArray(step.falseBranch)) return 'branch step requires "falseBranch" array';
      const tbErr = validateSteps(step.trueBranch as unknown[]);
      if (tbErr) return tbErr;
      const fbErr = validateSteps(step.falseBranch as unknown[]);
      if (fbErr) return fbErr;
    }

    // multiOptionBranch: require branches + defaultBranch
    if (type === 'multiOptionBranch') {
      if (!Array.isArray(step.branches)) return 'multiOptionBranch requires "branches" array';
      if (!Array.isArray(step.defaultBranch)) return 'multiOptionBranch requires "defaultBranch" array';
    }

    // forEach / whileLoop: require loopBody
    if (type === 'forEach' || type === 'whileLoop') {
      if (!Array.isArray(step.loopBody)) return `${type} step requires "loopBody" array`;
      const loopErr = validateSteps(step.loopBody as unknown[]);
      if (loopErr) return loopErr;
    }

    // runJavaScript: code must be in config, not at step root
    if (type === 'runJavaScript') {
      if ('code' in step && !step.config) {
        return 'runJavaScript: "code" must be nested under config: { "type": "runJavaScript", "config": { "code": "..." } }';
      }
    }

    // changeVariableValue: config.variableName required
    if (type === 'changeVariableValue' && step.config && typeof step.config === 'object') {
      const cfg = step.config as Record<string, unknown>;
      if (!cfg.variableName) {
        return 'changeVariableValue: config.variableName is required (UUID from the variable\'s "id" field)';
      }
    }

    // fetchData URL check
    if (type === 'fetchData' && step.config && typeof step.config === 'object') {
      const cfg = step.config as Record<string, unknown>;
      const url = cfg.url;
      if (typeof url === 'string') {
        if (url.includes('/api/db/') || url.includes('{{projectId}}')) {
          return `fetchData: url "${url}" uses an invalid pattern. Use the API_ENDPOINT path (e.g. "/list-products") — the engine prepends the backend base URL automatically.`;
        }
      }
    }

    // Config key whitelist check
    const allowedKeys = STEP_CONFIG_KEYS[type];
    if (allowedKeys !== undefined && step.config && typeof step.config === 'object') {
      for (const key of Object.keys(step.config as object)) {
        if (!allowedKeys.includes(key)) {
          return `step type="${type}" config: unknown field "${key}". Allowed: ${allowedKeys.join(', ') || '(none)'}`;
        }
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Backend step validation
// ─────────────────────────────────────────────────────────────────────────────

const VALID_BACKEND_STEP_TYPES = new Set([
  // ORM
  'ormFindMany', 'ormFindOne', 'ormFindUnique', 'ormFindFirstOrThrow', 'ormFindUniqueOrThrow',
  'ormCreate', 'ormCreateMany', 'ormCreateManyAndReturn',
  'ormUpdate', 'ormUpdateMany', 'ormUpsert',
  'ormDelete', 'ormDeleteMany',
  'ormCount', 'ormAggregate', 'ormGroupBy', 'ormTransaction',
  // Response
  'sendResponse', 'throwError',
  // Control flow
  'branch', 'multiOptionBranch', 'tryCatch', 'passThroughCondition', 'parallelExecution',
  'forEach', 'whileLoop', 'breakLoop', 'continueLoop',
  // Variables
  'createWorkflowVariable', 'changeVariableValue', 'resetVariableValue', 'setRequestContext',
  // Middleware / function terminators
  'middlewareNext', 'workflowResult',
  // Auth / crypto
  'hashPassword', 'verifyPassword', 'generateToken', 'verifyToken', 'randomToken',
  // Other
  'fetchData', 'serverJavaScript', 'runFormula', 'sendEmailAction', 'timeDelay',
  // Storage
  'uploadFile', 'getFileUrl', 'deleteFile',
]);

type BackendStepSpec = {
  required: string[];
  allowed: string[];
  siblings?: string[];
};

const BACKEND_STEP_CONFIG: Record<string, BackendStepSpec> = {
  // ORM read
  ormFindMany: { required: ['model'], allowed: ['model', 'where', 'include', 'select', 'omit', 'orderBy', 'take', 'skip', 'search', 'distinct', 'cursor', 'includeTrashed'] },
  ormFindOne: { required: ['model'], allowed: ['model', 'where', 'include', 'select'] },
  ormFindUnique: { required: ['model'], allowed: ['model', 'where', 'include', 'select'] },
  ormFindFirstOrThrow: { required: ['model'], allowed: ['model', 'where', 'include'] },
  ormFindUniqueOrThrow: { required: ['model'], allowed: ['model', 'where', 'include'] },
  // ORM write
  ormCreate: { required: ['model', 'data'], allowed: ['model', 'data', 'include', 'select'] },
  ormCreateMany: { required: ['model', 'data'], allowed: ['model', 'data', 'skipDuplicates'] },
  ormCreateManyAndReturn: { required: ['model', 'data'], allowed: ['model', 'data', 'select'] },
  ormUpdate: { required: ['model', 'where', 'data'], allowed: ['model', 'where', 'data', 'include', 'select'] },
  ormUpdateMany: { required: ['model', 'where', 'data'], allowed: ['model', 'where', 'data'] },
  ormUpsert: { required: ['model', 'where', 'create', 'update'], allowed: ['model', 'where', 'create', 'update', 'include'] },
  // ORM delete
  ormDelete: { required: ['model', 'where'], allowed: ['model', 'where', 'hardDelete'] },
  ormDeleteMany: { required: ['model', 'where'], allowed: ['model', 'where', 'hardDelete'] },
  // ORM aggregation
  ormCount: { required: ['model'], allowed: ['model', 'where'] },
  ormAggregate: { required: ['model'], allowed: ['model', 'where', '_avg', '_sum', '_min', '_max', '_count'] },
  ormGroupBy: { required: ['model', 'by'], allowed: ['model', 'by', 'where', '_avg', '_count', '_sum', '_min', '_max', 'orderBy', 'having'] },
  ormTransaction: { required: [], allowed: [], siblings: ['transactionBody'] },
  // Response
  sendResponse: { required: ['status', 'body'], allowed: ['status', 'bodyType', 'body', 'responseSchema'] },
  throwError: { required: ['message'], allowed: ['message', 'statusCode'] },
  // Control flow
  branch: { required: ['condition'], allowed: ['condition'], siblings: ['trueBranch', 'falseBranch'] },
  multiOptionBranch: { required: ['value'], allowed: ['value'], siblings: ['branches', 'defaultBranch'] },
  tryCatch: { required: [], allowed: ['catchEnabled', 'finallyEnabled'], siblings: ['tryBody', 'catchBody'] },
  passThroughCondition: { required: ['condition'], allowed: ['condition'] },
  parallelExecution: { required: [], allowed: [], siblings: ['parallelBranches'] },
  // Loops
  forEach: { required: ['items'], allowed: ['items'], siblings: ['loopBody'] },
  whileLoop: { required: ['condition'], allowed: ['condition', 'maxIterations'], siblings: ['loopBody'] },
  breakLoop: { required: [], allowed: [] },
  continueLoop: { required: [], allowed: [] },
  // Variables
  createWorkflowVariable: { required: ['name'], allowed: ['name', 'initialValue'] },
  changeVariableValue: { required: ['variableName', 'value'], allowed: ['variableName', 'value'] },
  resetVariableValue: { required: ['variableName'], allowed: ['variableName'] },
  setRequestContext: { required: ['key', 'value'], allowed: ['key', 'value'] },
  // Terminators
  middlewareNext: { required: [], allowed: [] },
  workflowResult: { required: ['result'], allowed: ['result'] },
  // Auth / crypto
  hashPassword: { required: ['password'], allowed: ['password'] },
  verifyPassword: { required: ['password', 'hash'], allowed: ['password', 'hash'] },
  generateToken: { required: ['payload'], allowed: ['payload', 'expiresIn', 'secret'] },
  verifyToken: { required: ['token'], allowed: ['token'] },
  randomToken: { required: [], allowed: ['length', 'encoding'] },
  // Other
  fetchData: { required: ['url'], allowed: ['url', 'method', 'headers', 'body'] },
  serverJavaScript: { required: ['code'], allowed: ['code'] },
  runFormula: { required: ['formula'], allowed: ['formula'] },
  sendEmailAction: { required: ['to', 'subject'], allowed: ['to', 'subject', 'html', 'cc', 'bcc'] },
  timeDelay: { required: ['ms'], allowed: ['ms'] },
  // Storage
  uploadFile: { required: [], allowed: ['file', 'bucket', 'path', 'key'] },
  getFileUrl: { required: [], allowed: ['key', 'bucket', 'expiresIn'] },
  deleteFile: { required: [], allowed: ['key', 'bucket'] },
};

function validateBackendSteps(steps: unknown[]): string | null {
  for (const s of steps) {
    if (typeof s !== 'object' || s === null) continue;
    const step = s as Record<string, unknown>;

    if (!step.id || typeof step.id !== 'string') {
      return `each backend step must have an "id" field (string)`;
    }
    if (!step.type) return 'each backend step must have a "type" field';

    const type = step.type as string;
    if (!VALID_BACKEND_STEP_TYPES.has(type)) {
      return `unknown backend step type "${type}". Valid types: ${[...VALID_BACKEND_STEP_TYPES].join(', ')}`;
    }

    const spec = BACKEND_STEP_CONFIG[type];
    if (!spec) continue;

    const cfg = (step.config ?? {}) as Record<string, unknown>;

    // Check required config fields
    for (const req of spec.required) {
      if (cfg[req] === undefined || cfg[req] === null) {
        return `backend step type="${type}": config.${req} is required`;
      }
    }

    // Check for unknown config fields
    for (const key of Object.keys(cfg)) {
      if (!spec.allowed.includes(key)) {
        return `backend step type="${type}" config: unknown field "${key}". Allowed: ${spec.allowed.join(', ') || '(none)'}`;
      }
    }

    // Auto-fill responseSchema for sendResponse steps that omit it
    if (type === 'sendResponse' && !cfg.responseSchema) {
      const bodyVal = cfg.body;
      const formulaStr =
        typeof bodyVal === 'string' ? bodyVal :
        (bodyVal && typeof bodyVal === 'object')
          ? (((bodyVal as Record<string, unknown>).js ?? (bodyVal as Record<string, unknown>).formula) ?? '')
          : '';
      if (typeof formulaStr === 'string' && formulaStr)
        cfg.responseSchema = schemaFromFormula(formulaStr as string);
    }

    // Check required sibling arrays
    if (spec.siblings) {
      for (const sib of spec.siblings) {
        // Some siblings are optional (e.g. finallyBody for tryCatch), mark required ones
        const requiredSiblings: Record<string, string[]> = {
          branch: ['trueBranch', 'falseBranch'],
          multiOptionBranch: ['branches', 'defaultBranch'],
          tryCatch: ['tryBody', 'catchBody'],
          parallelExecution: ['parallelBranches'],
          forEach: ['loopBody'],
          whileLoop: ['loopBody'],
          ormTransaction: ['transactionBody'],
        };
        const req = requiredSiblings[type] ?? [];
        if (req.includes(sib) && !Array.isArray(step[sib])) {
          return `backend step type="${type}": requires sibling "${sib}" array`;
        }
      }
    }

    // Recursively validate nested step arrays
    const nestedArrays = ['trueBranch', 'falseBranch', 'branches', 'defaultBranch',
      'tryBody', 'catchBody', 'finallyBody', 'loopBody', 'transactionBody', 'parallelBranches'];
    for (const arr of nestedArrays) {
      if (Array.isArray(step[arr])) {
        // parallelBranches is an array of arrays
        if (arr === 'parallelBranches') {
          for (const branch of step[arr] as unknown[]) {
            if (Array.isArray(branch)) {
              const err = validateBackendSteps(branch);
              if (err) return err;
            }
          }
        } else {
          const err = validateBackendSteps(step[arr] as unknown[]);
          if (err) return err;
        }
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// inputSchema validation (shared by serverApi and serverModel)
// ─────────────────────────────────────────────────────────────────────────────

const VALID_INPUT_SCHEMA_IN = ['body', 'query', 'path', 'header'];
const VALID_INPUT_SCHEMA_TYPES = ['Text', 'Number', 'Boolean', 'Array', 'Object'];
const VALID_INPUT_SCHEMA_KEYS = ['id', 'in', 'name', 'type', 'required', 'validation'];

function validateInputSchema(inputSchema: unknown, entity: string): string | null {
  if (!Array.isArray(inputSchema)) return `${entity}.inputSchema must be an array`;
  for (const item of inputSchema) {
    if (typeof item !== 'object' || item === null) continue;
    const it = item as Record<string, unknown>;
    if (!it.name || typeof it.name !== 'string') {
      return `${entity}.inputSchema item missing "name" (string)`;
    }
    if (it.in !== undefined && !VALID_INPUT_SCHEMA_IN.includes(it.in as string)) {
      return `${entity}.inputSchema item "in" must be one of: ${VALID_INPUT_SCHEMA_IN.join(', ')}`;
    }
    if (it.type !== undefined && !VALID_INPUT_SCHEMA_TYPES.includes(it.type as string)) {
      return `${entity}.inputSchema item "type" must be one of: ${VALID_INPUT_SCHEMA_TYPES.join(', ')}`;
    }
    for (const key of Object.keys(it)) {
      if (!VALID_INPUT_SCHEMA_KEYS.includes(key)) {
        return `${entity}.inputSchema item: unknown field "${key}". Allowed: ${VALID_INPUT_SCHEMA_KEYS.join(', ')}`;
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main validateByKind dispatcher
// ─────────────────────────────────────────────────────────────────────────────

function validateByKind(kind: EntityKind, data: unknown, vfsPath: string): string | null {
  if (kind === 'unknown') return null;

  // serverSeed: top-level must be an array
  if (kind === 'serverSeed') {
    if (!Array.isArray(data)) {
      return `server/seeds entity must be a top-level JSON array of objects. Got ${typeof data}.`;
    }
    for (const row of data) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        return 'server/seeds: each row must be a plain object';
      }
    }
    return null;
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return 'entity file must be a JSON object';
  }

  const obj = data as Record<string, unknown>;

  switch (kind) {

    // ── Routes ──────────────────────────────────────────────────────────────
    case 'routes': {
      if (!Array.isArray(obj.routes)) return '"routes" must be an array';
      for (const r of obj.routes as unknown[]) {
        if (typeof r !== 'object' || r === null) continue;
        const route = r as Record<string, unknown>;
        const err = rejectUnknownKeys(route, ['path', 'config', 'name'], 'route entry');
        if (err) return err;
        if (!route.path || typeof route.path !== 'string') {
          return 'each route must have a "path" (string)';
        }
        if (!route.path.startsWith('/')) {
          return `route path "${route.path}" must start with "/"`;
        }
        if (!route.config) return 'each route must have a "config" field (page name)';
      }
      return null;
    }

    // ── Theme ────────────────────────────────────────────────────────────────
    case 'theme': {
      for (const key of ['overrides', 'darkOverrides'] as const) {
        const block = obj[key];
        if (block !== undefined) {
          if (typeof block !== 'object' || Array.isArray(block)) {
            return `theme "${key}" must be a plain object`;
          }
          for (const k of Object.keys(block as object)) {
            if (!k.startsWith('--')) {
              return `theme ${key} key "${k}" must start with "--" (e.g. "--primary": "#6366f1")`;
            }
          }
        }
      }
      return null;
    }

    // ── Colors ───────────────────────────────────────────────────────────────
    case 'colors': {
      if (!Array.isArray(data)) return 'design/colors must be an array';
      for (const item of data) {
        if (typeof item !== 'object' || item === null) continue;
        const c = item as Record<string, unknown>;
        if (!c.name) return 'each color item must have a "name" field';
        if (!c.value) return 'each color item must have a "value" field';
      }
      return null;
    }

    // ── Variable ─────────────────────────────────────────────────────────────
    case 'variable': {
      const err = rejectUnknownKeys(obj,
        ['id', 'name', 'type', 'initialValue', 'folder', 'label', 'saveInLocalStorage', 'resetOnNavigate'],
        'variable'
      );
      if (err) return err;
      const req = requireFields(obj, ['id', 'name', 'type', 'initialValue']);
      if (req) return req;
      const validTypes = ['string', 'number', 'boolean', 'object', 'array'];
      if (!validTypes.includes(obj.type as string)) {
        return `variable "type" must be one of: ${validTypes.join(', ')}`;
      }
      return null;
    }

    // ── Formula ──────────────────────────────────────────────────────────────
    case 'formula': {
      const err = rejectUnknownKeys(obj, ['name', 'description', 'formula', 'params'], 'formula');
      if (err) return err;
      const req = requireFields(obj, ['name', 'formula', 'params']);
      if (req) return req;
      if (!Array.isArray(obj.params)) return '"params" must be an array';
      const VALID_PARAM_TYPES = ['Number', 'String', 'Boolean', 'Array', 'Object'];
      const VALID_PARAM_KEYS = ['name', 'type', 'testValue'];
      for (const p of obj.params as unknown[]) {
        if (typeof p !== 'object' || p === null) continue;
        const param = p as Record<string, unknown>;
        if (!param.name || typeof param.name !== 'string') {
          return 'formula param missing required "name" (string)';
        }
        if (param.type !== undefined && !VALID_PARAM_TYPES.includes(param.type as string)) {
          return `formula param "type" must be one of: ${VALID_PARAM_TYPES.join(', ')}`;
        }
        for (const key of Object.keys(param)) {
          if (!VALID_PARAM_KEYS.includes(key)) {
            return `formula param: unknown field "${key}". Allowed: ${VALID_PARAM_KEYS.join(', ')}`;
          }
        }
      }
      return null;
    }

    // ── Datasource ───────────────────────────────────────────────────────────
    case 'datasource': {
      const err = rejectUnknownKeys(obj,
        ['id', 'name', 'type', 'url', 'method', 'trigger', 'headers', 'folder'],
        'datasource'
      );
      if (err) return err;
      const req = requireFields(obj, ['id', 'name', 'type']);
      if (req) return req;
      const validTypes = ['rest', 'graphql'];
      if (!validTypes.includes(obj.type as string)) {
        return `datasource "type" must be one of: ${validTypes.join(', ')}`;
      }
      const url = obj.url as string | undefined;
      if (url && (url.includes('/api/db/') || url.includes('{{projectId}}'))) {
        return `datasource url uses an invalid pattern. Use the API_ENDPOINT path (e.g. "/list-products") — the engine prepends the backend URL automatically.`;
      }
      const method = obj.method as string | undefined;
      const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
      if (method && !validMethods.includes(method.toUpperCase())) {
        return `datasource method "${method}" is not valid. Use one of: ${validMethods.join(', ')}`;
      }
      const validTriggers = ['mount', 'manual'];
      if (obj.trigger !== undefined && !validTriggers.includes(obj.trigger as string)) {
        return `datasource trigger "${obj.trigger}" is not valid. Use "mount" or "manual".`;
      }
      if (obj.headers !== undefined) {
        if (typeof obj.headers !== 'object' || Array.isArray(obj.headers)) {
          return 'datasource "headers" must be a plain object (not array or string)';
        }
      }
      return null;
    }

    // ── Workflow / pageWorkflow ───────────────────────────────────────────────
    case 'workflow':
    case 'pageWorkflow': {
      const topErr = rejectUnknownKeys(obj, ['id', 'meta', 'steps'], 'workflow');
      if (topErr) return topErr;
      const req = requireFields(obj, ['id', 'meta', 'steps']);
      if (req) return req;
      const meta = obj.meta as Record<string, unknown> | null;
      if (!meta || typeof meta !== 'object') return '"meta" must be an object';
      const metaErr = rejectUnknownKeys(meta,
        ['id', 'name', 'trigger', 'pageScope', 'isAppTrigger', 'isTrigger'],
        'workflow meta'
      );
      if (metaErr) return metaErr;
      if (!meta.name) return '"meta.name" is required';
      if (!meta.trigger) return '"meta.trigger" is required';
      if (!VALID_TRIGGERS.has(meta.trigger as string)) {
        return `meta.trigger "${meta.trigger}" is not valid. Valid triggers: ${[...VALID_TRIGGERS].join(', ')}`;
      }
      if (kind === 'pageWorkflow' && !meta.pageScope) {
        return '"meta.pageScope" is required for page-scoped workflows';
      }
      if (!Array.isArray(obj.steps)) return '"steps" must be an array';
      const stepsErr = validateSteps(obj.steps as unknown[]);
      if (stepsErr) return stepsErr;
      return null;
    }

    // ── Trigger / pageTrigger ─────────────────────────────────────────────────
    case 'trigger':
    case 'pageTrigger': {
      const topErr = rejectUnknownKeys(obj, ['id', 'meta', 'steps', 'config'], 'trigger');
      if (topErr) return topErr;
      const req = requireFields(obj, ['id', 'meta', 'steps']);
      if (req) return req;
      if (!Array.isArray(obj.steps)) return '"steps" must be an array';
      const meta = obj.meta as Record<string, unknown> | null;
      if (meta && typeof meta === 'object') {
        const metaErr = rejectUnknownKeys(meta,
          ['id', 'name', 'trigger', 'isTrigger', 'pageScope'],
          'trigger meta'
        );
        if (metaErr) return metaErr;
        if (meta.trigger && !VALID_TRIGGERS.has(meta.trigger as string)) {
          return `trigger meta.trigger "${meta.trigger}" is not valid. Valid: ${[...VALID_TRIGGERS].join(', ')}`;
        }
      }
      return null;
    }

    // ── Page ──────────────────────────────────────────────────────────────────
    case 'page': {
      const topErr = rejectUnknownKeys(obj, ['meta', 'ui'], 'page');
      if (topErr) return topErr;
      if (!obj.ui) return '"ui" field is required on a page entity';
      if (obj.meta !== undefined) {
        if (typeof obj.meta !== 'object' || Array.isArray(obj.meta)) {
          return 'page "meta" must be an object';
        }
        const metaErr = rejectUnknownKeys(
          obj.meta as Record<string, unknown>,
          ['title', 'description'],
          'page meta'
        );
        if (metaErr) return metaErr;
      }
      const rawUi = obj.ui;
      const uiArr = Array.isArray(rawUi) ? rawUi : [rawUi];
      const nodeErr = validateNodes(uiArr);
      if (nodeErr) return nodeErr;
      return null;
    }

    // ── Component ─────────────────────────────────────────────────────────────
    case 'component': {
      const topErr = rejectUnknownKeys(obj, ['id', 'name', 'properties', 'content'], 'component');
      if (topErr) return topErr;
      const req = requireFields(obj, ['id', 'content']);
      if (req) return req;
      // Validate properties array
      if (obj.properties !== undefined) {
        if (!Array.isArray(obj.properties)) return 'component "properties" must be an array';
        const VALID_PROP_TYPES = ['text', 'number', 'boolean', 'object'];
        const VALID_PROP_KEYS = ['id', 'name', 'type', 'defaultValue'];
        for (const p of obj.properties as unknown[]) {
          if (typeof p !== 'object' || p === null) continue;
          const prop = p as Record<string, unknown>;
          if (!prop.id || typeof prop.id !== 'string') {
            return 'component property missing "id" (string)';
          }
          if (!prop.name || typeof prop.name !== 'string') {
            return 'component property missing "name" (string)';
          }
          if (!prop.type || !VALID_PROP_TYPES.includes(prop.type as string)) {
            return `component property "type" must be one of: ${VALID_PROP_TYPES.join(', ')}`;
          }
          for (const key of Object.keys(prop)) {
            if (!VALID_PROP_KEYS.includes(key)) {
              return `component property: unknown field "${key}". Allowed: ${VALID_PROP_KEYS.join(', ')}`;
            }
          }
        }
      }
      const content = obj.content;
      const contentArr = Array.isArray(content) ? content : [content];
      return validateNodes(contentArr);
    }

    // ── Server API endpoint ───────────────────────────────────────────────────
    case 'serverApi': {
      const topErr = rejectUnknownKeys(obj,
        ['id', 'name', 'slug', 'kind', 'method', 'path', 'folder', 'inputSchema', 'middlewareIds', 'graph'],
        'serverApi'
      );
      if (topErr) return topErr;
      const req = requireFields(obj, ['id', 'kind', 'method', 'path', 'graph']);
      if (req) return req;
      if (obj.kind !== 'API_ENDPOINT') {
        return `serverApi "kind" must be "API_ENDPOINT"`;
      }
      const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
      if (!validMethods.includes((obj.method as string)?.toUpperCase())) {
        return `serverApi "method" must be one of: ${validMethods.join(', ')}`;
      }
      if (typeof obj.path !== 'string' || !obj.path.startsWith('/')) {
        return `serverApi "path" must be a string starting with "/" (e.g. "/products")`;
      }
      if (!Array.isArray(obj.graph)) return 'serverApi "graph" must be an array';
      if (obj.inputSchema !== undefined) {
        const isErr = validateInputSchema(obj.inputSchema, 'serverApi');
        if (isErr) return isErr;
      }
      return validateBackendSteps(obj.graph as unknown[]);
    }

    // ── Server middleware ─────────────────────────────────────────────────────
    case 'serverMiddleware': {
      const topErr = rejectUnknownKeys(obj, ['id', 'name', 'slug', 'kind', 'graph'], 'serverMiddleware');
      if (topErr) return topErr;
      const req = requireFields(obj, ['id', 'kind', 'graph']);
      if (req) return req;
      if (obj.kind !== 'MIDDLEWARE') {
        return `serverMiddleware "kind" must be "MIDDLEWARE"`;
      }
      if (!Array.isArray(obj.graph)) return 'serverMiddleware "graph" must be an array';
      return validateBackendSteps(obj.graph as unknown[]);
    }

    // ── Server function ───────────────────────────────────────────────────────
    case 'serverFunction': {
      const topErr = rejectUnknownKeys(obj, ['id', 'name', 'slug', 'kind', 'graph'], 'serverFunction');
      if (topErr) return topErr;
      const req = requireFields(obj, ['id', 'kind', 'graph']);
      if (req) return req;
      if (obj.kind !== 'FUNCTION') {
        return `serverFunction "kind" must be "FUNCTION"`;
      }
      if (!Array.isArray(obj.graph)) return 'serverFunction "graph" must be an array';
      return validateBackendSteps(obj.graph as unknown[]);
    }

    // ── Server enum ───────────────────────────────────────────────────────────
    case 'serverEnum': {
      const topErr = rejectUnknownKeys(obj, ['id', 'name', 'values', 'folder'], 'serverEnum');
      if (topErr) return topErr;
      const req = requireFields(obj, ['name', 'values']);
      if (req) return req;
      if (!Array.isArray(obj.values) || obj.values.length === 0) {
        return 'serverEnum "values" must be a non-empty array';
      }
      for (const v of obj.values as unknown[]) {
        if (typeof v !== 'string') return 'serverEnum "values" must be an array of strings';
      }
      return null;
    }

    // ── Server model ─────────────────────────────────────────────────────────
    case 'serverModel': {
      const topErr = rejectUnknownKeys(obj,
        ['id', 'name', 'table', 'folder', 'timestamps', 'softDelete', 'actorTracking',
          'fields', 'indexes', 'search', 'validations', 'hooks', 'events', 'access'],
        'serverModel'
      );
      if (topErr) return topErr;
      const req = requireFields(obj, ['name', 'fields']);
      if (req) return req;
      const name = obj.name as string;
      if (!/^[A-Z]/.test(name)) {
        return `serverModel "name" must be PascalCase (start with uppercase). Got "${name}"`;
      }
      if (!Array.isArray(obj.fields)) return 'serverModel "fields" must be an array';

      const VALID_FIELD_TYPES = [
        'text', 'int', 'bigint', 'decimal', 'float', 'money', 'bool', 'json',
        'uuid', 'date', 'datetime', 'timestamp', 'enum', 'file', 'relation',
      ];
      const VALID_FIELD_KEYS = ['id', 'name', 'type', 'required', 'unique', 'searchable', 'enum', 'file', 'relation', 'computed', 'default'];
      const VALID_RELATION_KINDS = ['manyToOne', 'oneToOne', 'oneToMany', 'manyToMany'];
      const VALID_ON_DELETE = ['cascade', 'setNull', 'restrict'];

      for (const f of obj.fields as unknown[]) {
        if (typeof f !== 'object' || f === null) continue;
        const field = f as Record<string, unknown>;
        const fieldErr = rejectUnknownKeys(field, VALID_FIELD_KEYS, 'model field');
        if (fieldErr) return fieldErr;
        if (!field.name || typeof field.name !== 'string') {
          return 'model field missing "name" (string)';
        }
        if (!field.type || !VALID_FIELD_TYPES.includes(field.type as string)) {
          return `model field "${field.name}" type "${field.type}" must be one of: ${VALID_FIELD_TYPES.join(', ')}`;
        }
        // Validate relation
        if (field.relation !== undefined) {
          if (typeof field.relation !== 'object' || field.relation === null) {
            return `model field "${field.name}": "relation" must be an object`;
          }
          const rel = field.relation as Record<string, unknown>;
          if (!rel.to || typeof rel.to !== 'string') {
            return `model field "${field.name}": relation.to is required (string, model name)`;
          }
          if (!rel.kind || !VALID_RELATION_KINDS.includes(rel.kind as string)) {
            return `model field "${field.name}": relation.kind must be one of: ${VALID_RELATION_KINDS.join(', ')}`;
          }
          if (rel.onDelete !== undefined && !VALID_ON_DELETE.includes(rel.onDelete as string)) {
            return `model field "${field.name}": relation.onDelete must be one of: ${VALID_ON_DELETE.join(', ')}`;
          }
        }
        // Validate computed
        if (field.computed !== undefined) {
          if (typeof field.computed !== 'object' || field.computed === null) {
            return `model field "${field.name}": "computed" must be an object`;
          }
          const comp = field.computed as Record<string, unknown>;
          if (!comp.expr || typeof comp.expr !== 'string') {
            return `model field "${field.name}": computed.expr is required (string)`;
          }
        }
      }

      // Validate indexes
      if (obj.indexes !== undefined) {
        if (!Array.isArray(obj.indexes)) return 'serverModel "indexes" must be an array';
        for (const idx of obj.indexes as unknown[]) {
          if (typeof idx !== 'object' || idx === null) continue;
          const index = idx as Record<string, unknown>;
          const idxErr = rejectUnknownKeys(index, ['fields', 'unique', 'name'], 'model index');
          if (idxErr) return idxErr;
          if (!Array.isArray(index.fields)) return 'model index "fields" must be an array of strings';
        }
      }

      // Validate access
      const VALID_ACCESS_OPS = ['list', 'read', 'create', 'update', 'delete', '*'];
      if (obj.access !== undefined) {
        if (typeof obj.access !== 'object' || Array.isArray(obj.access)) {
          return 'serverModel "access" must be a plain object';
        }
        for (const [op, val] of Object.entries(obj.access as Record<string, unknown>)) {
          if (!VALID_ACCESS_OPS.includes(op)) {
            return `serverModel access key "${op}" is not valid. Allowed: ${VALID_ACCESS_OPS.join(', ')}`;
          }
          if (!Array.isArray(val)) {
            return `serverModel access["${op}"] must be an array of middleware slugs`;
          }
        }
      }

      // Validate inputSchema if present
      if (obj.inputSchema !== undefined) {
        const isErr = validateInputSchema(obj.inputSchema, 'serverModel');
        if (isErr) return isErr;
      }

      return null;
    }

    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a file written by the agent.
 *
 * @param filePath  VFS-relative path — with or without .json extension
 * @param content   Raw file content (string)
 */
export function validateEntityFile(filePath: string, content: string): ValidationResult {
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
