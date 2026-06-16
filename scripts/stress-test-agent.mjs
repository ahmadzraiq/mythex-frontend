/**
 * Stress-test runner for the file-based builder agent.
 *
 * Usage:
 *   node scripts/stress-test-agent.mjs
 *   node scripts/stress-test-agent.mjs --scenario 4      run only scenario 4
 *   node scripts/stress-test-agent.mjs --from 20         run from scenario 20 onward
 *   node scripts/stress-test-agent.mjs --verbose         full turn output
 *   node scripts/stress-test-agent.mjs --dump            print every written file
 *   node scripts/stress-test-agent.mjs --routing         routing scenarios only
 *   node scripts/stress-test-agent.mjs --model claude-sonnet-4-5
 */

const API_URL = 'http://localhost:3001/api/ai/builder-chat';

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const DUMP = args.includes('--dump'); // print full content of every written file
const ONLY_SCENARIO = (() => {
  const i = args.indexOf('--scenario');
  return i !== -1 ? parseInt(args[i + 1], 10) : null;
})();
const FROM_SCENARIO = (() => {
  const i = args.indexOf('--from');
  return i !== -1 ? parseInt(args[i + 1], 10) : null;
})();
const MODEL = (() => {
  const i = args.indexOf('--model');
  return i !== -1 ? args[i + 1] : null;
})();

// ── Violation checker ─────────────────────────────────────────────────────────

/**
 * Each check returns an array of { level: 'VIOLATION'|'WARN', message: string }.
 * Called once per written file with its path and content.
 */
function checkFile(filePath, content) {
  const issues = [];
  // eslint-disable-next-line no-unused-vars
  const lines = content.split('\n');

  function violation(msg) { issues.push({ level: 'VIOLATION', msg }); }
  function warn(msg)      { issues.push({ level: 'WARN', msg }); }

  // Attempt JSON parse for structural checks
  let parsed = null;
  try { parsed = JSON.parse(content); } catch { /* leave null */ }

  // ── className checks ──────────────────────────────────────────────────────

  // Walk all className values in the JSON tree
  const classNames = [];
  function collectClassNames(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(collectClassNames); return; }
    if (typeof node.className === 'string') classNames.push({ cn: node.className, nodeType: node.type });
    for (const v of Object.values(node)) collectClassNames(v);
  }
  if (parsed) collectClassNames(parsed);

  for (const { cn, nodeType } of classNames) {
    // { "js": "..." } or { "formula": "..." } in className
    if (typeof cn !== 'string') {
      violation(`className must be a static string, found non-string value in node type=${nodeType}`);
    }

    const cn_ = cn ?? '';


    if (/\bshadow-(sm|md|lg|xl|2xl)\b/.test(cn_))
      violation(`className contains shadow-* (use props.style.boxShadow): "${cn_}"`);

    if (/\bbg-gradient-to-\S+/.test(cn_) || /\bfrom-\S+/.test(cn_) || /\bto-\S+/.test(cn_))
      violation(`className contains Tailwind gradient utility (use props.style.backgroundImage): "${cn_}"`);

    if (/\bcontents\b/.test(cn_))
      violation(`className contains "contents" (display:contents not supported): "${cn_}"`);

    if (/\brotate-\S+/.test(cn_) || /\btranslate-\S+/.test(cn_) || /\bscale-\S+/.test(cn_))
      violation(`className contains transform utility (use props.style.transform): "${cn_}"`);

    // flex alone without flex-row or flex-col
    // Allow: centering pattern, flex-1 (grow), inline-flex (badge/pill — implicit row is intentional)
    const isCenteringOnly = /\bitems-center\b/.test(cn_) && /\bjustify-center\b/.test(cn_);
    const isInlineFlex = /\binline-flex\b/.test(cn_);
    if (/\bflex\b/.test(cn_) && !isInlineFlex && !/\bflex-(row|col)\b/.test(cn_) && !/\bflex-1\b/.test(cn_) && !isCenteringOnly)
      violation(`className has "flex" without flex-row/flex-col (SDUI default is column, not row): "${cn_}"`);

    // Named spacing (warn — should use bracket form)
    if (/\b[pm]-\d\b/.test(cn_) || /\bgap-\d\b/.test(cn_))
      warn(`className uses named spacing scale (e.g. p-2, gap-4) — always use bracket form p-[Npx]: "${cn_}"`);

    // Named text size (warn)
    if (/\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)\b/.test(cn_))
      warn(`className uses named text size (text-xl etc.) — always use text-[Npx]: "${cn_}"`);

    // Responsive prefixes
    if (/\b(sm:|md:|lg:|xl:)\S+/.test(cn_))
      violation(`className uses Tailwind responsive prefix (sm:/md:/lg:/xl:) — use SDUI responsive object instead: "${cn_}"`);
  }

  // ── {{ }} syntax anywhere (except datasource URL fields which allow {{variables['uuid']}}) ──
  if (content.includes('{{') && !filePath.startsWith('data/')) {
    const lineNums = lines.reduce((acc, l, i) => l.includes('{{') ? [...acc, i+1] : acc, []);
    violation(`{{ }} template syntax found (use { "js": "expr" } instead) at lines: ${lineNums.join(', ')}`);
  }

  // ── className is a formula object ─────────────────────────────────────────
  const classFormulaMatch = /"className"\s*:\s*\{/.test(content);
  if (classFormulaMatch) {
    violation('"className" bound to a formula object — className must always be a static string');
  }

  // ── Node id must be a UUID ────────────────────────────────────────────────
  const UI_NODE_TYPES = new Set(['Box','Text','Input','Textarea','FormContainer','Image','Icon','Video','Iframe','LottiePlayer','HtmlContent']);
  // UUID-like format: 8-4-4-4-12 hex digits, group 3 must start with 4 (UUID v4 version).
  // We do NOT enforce the variant bits ([89ab]) on group 4 — the system only needs unique identifiers.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function checkNodeIds(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(checkNodeIds); return; }
    if (UI_NODE_TYPES.has(node.type)) {
      if (node.id === undefined || node.id === null || node.id === '') {
        violation(`Node type="${node.type}" name="${node.name ?? '?'}" is missing "id" — every node must have a UUID v4 id`);
      } else if (!UUID_RE.test(node.id)) {
        violation(`Node type="${node.type}" has non-UUID id "${node.id}" — node ids must be UUID v4`);
      }
    }
    if (Array.isArray(node.children)) checkNodeIds(node.children);
  }
  if (parsed?.ui) checkNodeIds(parsed.ui);
  if (parsed?.content) checkNodeIds(parsed.content);

  // ── Workflow/action id must be a UUID ─────────────────────────────────────
  if (/^(pages\/[^/]+\/workflows|workflows|pages\/[^/]+\/triggers|triggers)\//.test(filePath) && parsed) {
    if (parsed.id && !UUID_RE.test(parsed.id)) {
      violation(`Workflow file top-level "id" is not a UUID: "${parsed.id}" — must be UUID v4`);
    }
  }

  // ── Store var path segment must be a UUID ─────────────────────────────────
  if (/^store\//.test(filePath)) {
    const pathSegment = filePath.split('/').pop();
    if (pathSegment && !UUID_RE.test(pathSegment)) {
      warn(`Store var path "${filePath}" uses non-UUID segment "${pathSegment}" — should be store/<uuid>`);
    }
  }

  // ── Page file structure ───────────────────────────────────────────────────
  if (/^pages\/[^/]+\/page$/.test(filePath)) {
    if (!parsed) {
      violation(`pages/*/page must be valid JSON`);
    } else if (!Array.isArray(parsed.ui) && !parsed.content) {
      violation(`pages/*/page must have "ui" array or "content" object — found neither`);
    } else if (parsed.ui && !Array.isArray(parsed.ui)) {
      violation(`pages/*/page "ui" field must be an array, found ${typeof parsed.ui}`);
    }
  }

  // ── Workflow step structural checks ──────────────────────────────────────
  function checkWorkflowSteps(steps, depth) {
    if (!Array.isArray(steps)) return;
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue;

      // step id must be a UUID v4
      if (step.id === undefined || step.id === null || step.id === '') {
        violation(`Workflow step type="${step.type ?? '?'}" is missing "id" — every step must have a UUID v4 id`);
      } else if (!UUID_RE.test(step.id)) {
        violation(`Workflow step type="${step.type ?? '?'}" has non-UUID id "${step.id}" — step ids must be UUID v4`);
      }

      // runJavaScript: no window/document/localStorage, no wwLib.setVariable (wrong API)
      if (step.type === 'runJavaScript' && typeof step.config?.code === 'string') {
        if (/\bwindow\b/.test(step.config.code))
          violation(`runJavaScript step "${step.id ?? '?'}" uses window.* (no window object in sandbox)`);
        if (/\bdocument\b/.test(step.config.code))
          violation(`runJavaScript step "${step.id ?? '?'}" uses document.* (no DOM in sandbox)`);
        if (/\blocalStorage\b/.test(step.config.code))
          violation(`runJavaScript step "${step.id ?? '?'}" uses localStorage (no BOM in sandbox)`);
        if (/wwLib\.setVariable\b/.test(step.config.code))
          violation(`runJavaScript step "${step.id ?? '?'}" calls wwLib.setVariable() which does not exist — use wwLib.variables.set(uuid, value)`);
      }

      // event.value usage in non-Input workflows — event.value only exists for Input onChange
      // changeVariableValue is the canonical Input onChange step, so event.value IS valid there.
      // Flag it in other step types (runJavaScript, custom conditions, etc.).
      function hasEventValue(obj) {
        if (!obj || typeof obj !== 'object') return false;
        if (typeof obj === 'string') return /\bevent\.value\b/.test(obj);
        return Object.values(obj).some(v =>
          typeof v === 'string' ? /\bevent\.value\b/.test(v) : hasEventValue(v)
        );
      }
      if (step.type !== 'changeVariableValue' && step.config && hasEventValue(step.config)) {
        violation(`Workflow step "${step.id ?? '?'}" type="${step.type}" uses event.value — only changeVariableValue (Input onChange) can use event.value; other step types cannot.`);
      }

      // changeVariableValue: must have config.variableName
      if (step.type === 'changeVariableValue') {
        if (!step.config?.variableName)
          violation(`changeVariableValue step "${step.id ?? '?'}" missing config.variableName`);
        if (step.variable !== undefined && !step.config?.variableName)
          violation(`changeVariableValue step "${step.id ?? '?'}" uses "variable" field — must use config.variableName`);
      }

      // navigateTo: must have config.path
      if (step.type === 'navigateTo') {
        if (!step.config?.path && !step.config?.externalUrl)
          violation(`navigateTo step "${step.id ?? '?'}" missing config.path`);
      }

      // fetchCollection: must have config.collectionId
      if (step.type === 'fetchCollection') {
        if (!step.config?.collectionId)
          violation(`fetchCollection step "${step.id ?? '?'}" missing config.collectionId`);
      }

      // fetchCollectionsParallel: must have config.collectionIds array
      if (step.type === 'fetchCollectionsParallel') {
        if (!Array.isArray(step.config?.collectionIds))
          violation(`fetchCollectionsParallel step "${step.id ?? '?'}" missing config.collectionIds array`);
      }

      // branch: must have config.condition + trueBranch + falseBranch
      if (step.type === 'branch') {
        if (!step.config?.condition)
          violation(`branch step "${step.id ?? '?'}" missing config.condition`);
        if (!Array.isArray(step.trueBranch))
          violation(`branch step "${step.id ?? '?'}" missing trueBranch array`);
        if (!Array.isArray(step.falseBranch))
          violation(`branch step "${step.id ?? '?'}" missing falseBranch array`);
      }

      // multiOptionBranch: must have config.condition + branches array
      if (step.type === 'multiOptionBranch') {
        if (!step.config?.condition)
          violation(`multiOptionBranch step "${step.id ?? '?'}" missing config.condition`);
        if (!Array.isArray(step.branches))
          violation(`multiOptionBranch step "${step.id ?? '?'}" missing branches array`);
      }

      // forEach: must have config.items + config.loopBody
      if (step.type === 'forEach') {
        if (!step.config?.items)
          violation(`forEach step "${step.id ?? '?'}" missing config.items`);
        if (!Array.isArray(step.config?.loopBody))
          violation(`forEach step "${step.id ?? '?'}" missing config.loopBody array`);
      }

      // whileLoop: must have config.condition + config.loopBody
      if (step.type === 'whileLoop') {
        if (!step.config?.condition)
          violation(`whileLoop step "${step.id ?? '?'}" missing config.condition`);
        if (!Array.isArray(step.config?.loopBody))
          violation(`whileLoop step "${step.id ?? '?'}" missing config.loopBody array`);
      }

      // timeDelay: must have config.ms as a number
      if (step.type === 'timeDelay') {
        if (step.config?.ms === undefined || step.config?.ms === null)
          violation(`timeDelay step "${step.id ?? '?'}" missing config.ms`);
      }

      // Recurse into branches
      checkWorkflowSteps(step.trueBranch, depth + 1);
      checkWorkflowSteps(step.falseBranch, depth + 1);
      checkWorkflowSteps(step.config?.loopBody, depth + 1);
      if (Array.isArray(step.branches)) {
        for (const b of step.branches) checkWorkflowSteps(b.steps, depth + 1);
      }
      checkWorkflowSteps(step.defaultBranch, depth + 1);
    }
  }
  if (parsed?.steps) checkWorkflowSteps(parsed.steps, 0);

  // ── text on non-Text node ────────────────────────────────────────────────
  function checkTextOnBox(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(checkTextOnBox); return; }
    if (node.type && node.type !== 'Text' && node.text !== undefined) {
      violation(`Node type="${node.type}" has "text" field — text is only valid on Text nodes`);
    }
    if (Array.isArray(node.children)) checkTextOnBox(node.children);
  }
  if (parsed?.ui) checkTextOnBox(parsed.ui);

  // ── store variable uses "value" instead of "initialValue" ────────────────
  if (/^store\//.test(filePath) && parsed && 'value' in parsed && !('initialValue' in parsed)) {
    violation(`store file uses "value" field — must use "initialValue"`);
  }

  // ── store variable: must have either label or name, must have type ───────
  if (/^store\//.test(filePath) && parsed) {
    if (!parsed.label && !parsed.name) violation(`store file missing "label" (or "name") field`);
    if (!parsed.type) violation(`store file missing required "type" field`);
  }

  // ── workflow/trigger missing required "id" ────────────────────────────────
  if ((/^(pages\/[^/]+\/workflows|workflows|pages\/[^/]+\/triggers|triggers)\//.test(filePath)) && parsed) {
    if (!parsed.id) violation(`workflow/trigger file missing required top-level "id" field`);
  }

  // ── datasource missing required "id" ─────────────────────────────────────
  if (/^data\//.test(filePath) && parsed) {
    if (!parsed.id) violation(`datasource file missing required "id" field`);
  }

  // ── hover:/focus:/active: in any className ────────────────────────────────
  for (const { cn } of classNames) {
    const cn_ = cn ?? '';
    if (/\b(hover|focus|active|dark|group-hover):[^\s"]+/.test(cn_))
      violation(`className uses state variant (hover:/focus:/active:) — not processed by renderer, use props.animation.hover/press instead: "${cn_}"`);

    if (/\b(transition|transition-\S+|duration-\d+|ease-\S+|delay-\d+)\b/.test(cn_))
      violation(`className uses CSS transition utility — not processed by renderer: "${cn_}"`);
  }

  // ── context.item.data used directly as a value (not via a field) ─────────
  // Catches: context.item.data.toString() — produces [object Object]
  //          "context.item.data" as a bare string literal
  if (/context\.item\.data\.toString\(\)/.test(content)) {
    violation(`context.item.data.toString() — context.item.data is an object; access a specific field: context.item.data.num or context.item.data.value`);
  }


  // ── actions.action is a formula object instead of string ─────────────────
  function checkActions(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(checkActions); return; }
    if (Array.isArray(node.actions)) {
      for (const a of node.actions) {
        if (typeof a.action !== 'string')
          violation(`node action must be a static string workflow ID, found: ${JSON.stringify(a.action)}`);
      }
    }
    if (Array.isArray(node.children)) checkActions(node.children);
  }
  if (parsed?.ui) checkActions(parsed.ui);
  // Also check bare-array files (group files, component arrays)
  if (Array.isArray(parsed)) checkActions(parsed);

  // ── map is a plain string instead of { "js": "..." } ─────────────────────
  function checkMapField(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(checkMapField); return; }
    if (node.map !== undefined && typeof node.map === 'string')
      violation(`map field is a plain string — must be { "js": "expr" }, found: "${node.map}"`);
    if (Array.isArray(node.children)) checkMapField(node.children);
  }
  if (parsed?.ui) checkMapField(parsed.ui);
  // Also check bare-array files (group files, component arrays)
  if (Array.isArray(parsed)) checkMapField(parsed);

  // ── routes file is a flat array instead of { routes: [...] } ─────────────
  if (filePath === 'routes') {
    if (parsed && Array.isArray(parsed)) {
      violation('routes file is a flat array — must be { "routes": [...] } object');
    }
    if (parsed && !Array.isArray(parsed.routes)) {
      violation('routes file missing "routes" array — must be { "routes": [...] }');
    }
  }

  // (ui-array check already handled in page structure check above)

  // ── .json extension in file path written (unlikely but check) ────────────
  if (filePath.endsWith('.json')) {
    violation(`File path has .json extension — VFS paths never have extensions`);
  }

  return issues;
}

// ── SSE parser ────────────────────────────────────────────────────────────────

async function* parseSSE(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') return;
      try { yield JSON.parse(raw); } catch { /* skip */ }
    }
  }
}

// ── Single turn runner ────────────────────────────────────────────────────────

async function runTurn(message, virtualFiles, chatHistory, scenarioLabel) {
  if (VERBOSE) {
    console.log(`\n  [TURN] ${message.slice(0, 80)}`);
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      virtualFiles,
      chatHistory: chatHistory ?? [],
      pages: [{ id: 'home', name: 'Home', route: '/' }],
      pageId: 'home',
      ...(MODEL ? { model: MODEL } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const writes = [];       // { path, content, tool }
  const deletes = [];      // path strings
  const toolErrors = [];   // { tool, error }
  let assistantText = '';
  const updatedFiles = { ...virtualFiles };
  const toolsUsed = [];
  let lastToolName = '';  // track which tool produced the next file_written events
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of parseSSE(res)) {
    switch (event.type) {
      case 'text_delta':
        assistantText += (event.content ?? '');
        if (VERBOSE) process.stdout.write(event.content ?? '');
        break;

      case 'tool_executed':
        lastToolName = event.name;
        toolsUsed.push(event.name);
        if (event.error) {
          toolErrors.push({ tool: event.name, error: event.error });
          if (VERBOSE) console.log(`\n  [TOOL ERROR] ${event.name}: ${event.error}`);
        }
        break;

      case 'file_written':
        writes.push({ path: event.path, content: event.content, tool: lastToolName });
        updatedFiles[event.path] = event.content;
        if (VERBOSE) console.log(`\n  [WRITE:${lastToolName}] ${event.path}`);
        if (DUMP) console.log(`\n  ── ${event.path} ──\n${event.content}\n`);
        break;

      case 'file_deleted':
        deletes.push(event.path);
        delete updatedFiles[event.path];
        if (VERBOSE) console.log(`  [DELETE] ${event.path}`);
        break;

      case 'turn_stats':
        inputTokens += (event.inputTokens ?? 0);
        outputTokens += (event.outputTokens ?? 0);
        break;

      case 'error': {
        const errMsg = event.message ?? String(event);
        const isCredit = errMsg.includes('credit balance') || errMsg.includes('insufficient_quota');
        toolErrors.push({ tool: 'stream', error: errMsg, creditExhausted: isCredit });
        break;
      }
    }
  }

  return { assistantText, updatedFiles, writes, deletes, toolErrors, toolsUsed, inputTokens, outputTokens };
}

// ── Scenario runner ───────────────────────────────────────────────────────────

const EMPTY_FILES = {
  routes: JSON.stringify({ routes: [] }, null, 2),
};

/**
 * Run one scenario. Returns { scenarioId, label, issues, toolErrors, writeCount, passed }.
 */
async function runScenario(scenario) {
  const { id, label, turns } = scenario;

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`Scenario ${id}: ${label}`);
  console.log('─'.repeat(70));

  let virtualFiles = scenario.initialFiles ? { ...scenario.initialFiles } : { ...EMPTY_FILES };
  let chatHistory = [];
  const allWrites = [];    // { path, content, tool, turnIndex }
  const allToolErrors = [];
  const allToolsUsed = [];
  const writtenPathsPerScenario = new Map(); // turnKey → { tool }
  const routingViolations = []; // routing assertion failures
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    for (let t = 0; t < turns.length; t++) {
      const turn = turns[t];
      const message = typeof turn === 'string' ? turn : turn.message;
      const afterTurnChecks = typeof turn === 'object' ? turn.checks : null;

      console.log(`  Turn ${t + 1}: "${message.slice(0, 70)}"`);
      const result = await runTurn(message, virtualFiles, chatHistory, `${id}.${t+1}`);

      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;

      virtualFiles = result.updatedFiles;
      chatHistory = [
        ...chatHistory,
        { role: 'user', content: message },
        { role: 'assistant', content: result.assistantText },
      ];

      allToolsUsed.push(...result.toolsUsed);

      for (const w of result.writes) {
        allWrites.push({ ...w, turnIndex: t });

        // Duplicate write_file on the same path in the same turn is a violation.
        // write_file → edit_file is fine (correction pattern).
        const turnKey = `${t}::${w.path}`;
        const prevEntry = writtenPathsPerScenario.get(turnKey);
        if (prevEntry && w.tool === 'write_file' && prevEntry.tool === 'write_file') {
          allWrites[allWrites.length - 1]._duplicateWrite = true;
        }
        writtenPathsPerScenario.set(turnKey, w);
      }

      // Check if this turn was blocked by credit exhaustion — skip routing checks if so
      const turnCreditBlocked = result.toolErrors.some(e => e.creditExhausted);
      allToolErrors.push(...result.toolErrors);

      if (!turnCreditBlocked) {
        // Per-turn scenario checks
        if (afterTurnChecks) {
          for (const check of afterTurnChecks) {
            check(result, allWrites, chatHistory);
          }
        }
        if (result._routingIssue) {
          routingViolations.push(result._routingIssue);
          console.log(`    ✗ ROUTING: ${result._routingIssue}`);
        }
      }
      const tokStr = result.inputTokens > 0 ? `  📊 in:${result.inputTokens} out:${result.outputTokens}` : '';
      console.log(`    → ${result.writes.length} write(s), ${result.deletes.length} delete(s), ${result.toolErrors.length} tool error(s), tools: [${result.toolsUsed.join(', ')}]${tokStr}`);
    }
  } catch (err) {
    console.error(`  FATAL: ${err.message}`);
    return {
      id, label,
      issues: [{ level: 'VIOLATION', msg: `Turn crashed: ${err.message}` }],
      toolErrors: allToolErrors,
      writeCount: allWrites.length,
      passed: false,
    };
  }

  // If every turn was blocked by a credit error and nothing was written, mark as SKIP
  const creditBlocked = allToolErrors.some(e => e.creditExhausted) && allWrites.length === 0;
  if (creditBlocked) {
    console.log(`  ⏭ SKIP — API credit balance exhausted`);
    return { id, label, issues: [], toolErrors: allToolErrors, writeCount: 0, passed: true, skipped: true };
  }

  // ── Per-file checks ───────────────────────────────────────────────────────
  const issues = [];

  // Build a map of final file content (last write wins, since edit_file updates the file)
  const finalFiles = {};
  for (const { path: filePath, content } of allWrites) {
    finalFiles[filePath] = content;
  }

  for (const [filePath, content] of Object.entries(finalFiles)) {
    // Per-file structural and style violation checks
    const fileIssues = checkFile(filePath, content);
    for (const issue of fileIssues) {
      issues.push({ level: issue.level, msg: `[${filePath}] ${issue.msg}` });
    }
  }

  // Custom scenario-level check (scenario.check receives the final file map)
  if (typeof scenario.check === 'function') {
    const customIssues = scenario.check(finalFiles);
    for (const issue of customIssues) {
      issues.push(issue);
    }
  }

  // Routing assertion failures
  for (const msg of routingViolations) {
    issues.push({ level: 'VIOLATION', msg: `[routing] ${msg}` });
  }

  // ── Icon nodes written without search_icons call ──────────────────────────
  const searchIconsCalled = allToolsUsed.includes('search_icons');
  if (!searchIconsCalled) {
    // Check all written files for Icon nodes with a string "icon" prop
    function hasIconNode(node) {
      if (!node || typeof node !== 'object') return false;
      if (Array.isArray(node)) return node.some(hasIconNode);
      if (node.type === 'Icon' && typeof node.props?.icon === 'string') return true;
      if (Array.isArray(node.children) && node.children.some(hasIconNode)) return true;
      return false;
    }
    for (const { path: fp, content: fc } of allWrites) {
      let fp_parsed = null;
      try { fp_parsed = JSON.parse(fc); } catch {}
      if (fp_parsed?.ui && hasIconNode(fp_parsed.ui)) {
        issues.push({ level: 'VIOLATION', msg: `[${fp}] Icon node found but search_icons was never called — always call search_icons before using an icon` });
        break;
      }
    }
  }

  // ── Manual audit report ───────────────────────────────────────────────────
  const UUID_RE_AUDIT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const dumpContent = process.env.DUMP_FILES === '1';
  console.log(`\n  ┌─ FILES WRITTEN (${allWrites.length}) ${'─'.repeat(50)}`);
  for (const { path: p, content: c } of allWrites) {
    let parsed = null;
    try { parsed = JSON.parse(c); } catch {}

    // Collect IDs for manual review
    const nodeIds = [];
    const actionRefs = [];
    const workflowId = parsed?.id ?? null;
    const storeLabel = parsed?.name ?? parsed?.label ?? null;

    function auditNode(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(auditNode); return; }
      if (node.id) nodeIds.push({ id: node.id, type: node.type ?? '?', name: node.name ?? '' });
      if (Array.isArray(node.actions)) {
        for (const a of node.actions) {
          if (a.action) actionRefs.push(a.action);
        }
      }
      if (node.children) auditNode(node.children);
    }

    if (parsed?.ui) auditNode(parsed.ui);
    if (parsed?.content) auditNode(parsed.content);

    const idStatus = nodeIds.map(n => {
      const isUUID = UUID_RE_AUDIT.test(n.id);
      return `${isUUID ? '✓' : '✗'} ${n.type}${n.name ? '('+n.name+')' : ''}: ${n.id.slice(0,8)}...`;
    });

    const actionStatus = actionRefs.map(a => {
      const isUUID = UUID_RE_AUDIT.test(a);
      return `${isUUID ? '✓' : '✗'} action: ${a}`;
    });

    const wfStatus = workflowId ? `  workflow id: ${UUID_RE_AUDIT.test(workflowId) ? '✓' : '✗'} ${workflowId}` : '';
    const storeStatus = p.startsWith('store/') ? `  store path seg: ${UUID_RE_AUDIT.test(p.split('/').pop()) ? '✓' : '✗'} ${p.split('/').pop()}  name: ${storeLabel ?? 'MISSING'}` : '';

    console.log(`  │  ${p}`);
    if (wfStatus) console.log(`  │    ${wfStatus}`);
    if (storeStatus) console.log(`  │    ${storeStatus}`);
    if (idStatus.length) console.log(`  │    node ids: ${idStatus.join(' | ')}`);
    if (actionStatus.length) console.log(`  │    ${actionStatus.join(' | ')}`);
    if (dumpContent) {
      console.log(`  │    ── CONTENT ──`);
      c.split('\n').forEach(l => console.log(`  │    ${l}`));
    }
  }
  console.log(`  └${'─'.repeat(60)}`);

  const violations = issues.filter(i => i.level === 'VIOLATION');
  const warnings   = issues.filter(i => i.level === 'WARN');

  const tokenSummary = totalInputTokens > 0
    ? `  📊 tokens — in: ${totalInputTokens.toLocaleString()}  out: ${totalOutputTokens.toLocaleString()}  total: ${(totalInputTokens + totalOutputTokens).toLocaleString()}`
    : '';

  if (violations.length === 0) {
    console.log(`  ✓ PASS — ${allWrites.length} files written`);
  } else {
    for (const v of violations) console.log(`  ✗ ${v.msg}`);
  }
  if (tokenSummary) console.log(tokenSummary);

  return {
    id,
    label,
    issues,
    toolErrors: allToolErrors,
    writeCount: allWrites.length,
    passed: violations.length === 0,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  };
}

// ── Scenario definitions ──────────────────────────────────────────────────────

const SCENARIOS = [
  {
    id: 1,
    label: 'Simple counter (+/-)',
    turns: [
      'Create a counter page with a number display and two buttons: one to increment and one to decrement. Store the count in a variable.',
    ],
  },

  {
    id: 2,
    label: 'Login form + validation',
    turns: [
      'Create a login page with a form that has email and password fields. Email must be valid, password required. On submit, log the values to console via runJavaScript.',
    ],
  },

  {
    id: 3,
    label: 'Product grid from static data',
    turns: [
      'Create a page with a grid of 4 product cards. Use a map over a static array of objects with name and price fields. Show each product name and formatted price. Use only raw data values — no Tailwind class names in the data.',
    ],
  },

  {
    id: 4,
    label: 'Apple calculator',
    turns: [
      'Create an Apple-style calculator page. The display shows the current value. Buttons for digits 0-9, operators +/-/x/÷, AC, and = should all work. Use a multiOptionBranch workflow to handle each button press. Store display value and operands in variables.',
    ],
  },

  {
    id: 5,
    label: 'Multi-page app (Home + About + nav)',
    turns: [
      'Create two pages: Home and About. Each page has a top navigation bar with links to the other page using navigateTo workflows. Add both pages to the routes file.',
    ],
  },

  {
    id: 6,
    label: 'Animated landing hero',
    turns: [
      'Create a landing page hero section with a big headline and a subtitle. The headline should animate in with a fadeIn enter animation. The subtitle should have a slideInUp enter with a 200ms delay. No transition-* classes.',
    ],
  },

  {
    id: 7,
    label: 'Settings page with theme toggle',
    turns: [
      'Create a settings page with a dark mode toggle. Store a boolean isDark variable. Use classFormulas to apply a dark background class when isDark is true. The toggle button switches the variable on click.',
    ],
  },

  {
    id: 8,
    label: 'Todo list (add + complete)',
    turns: [
      'Create a todo list page. An input lets the user type a new item; a button adds it to a todos array variable. Each item is rendered with map and has a checkbox that marks it complete by toggling a "done" field. Show completed items with a different style using classFormulas.',
    ],
  },

  {
    id: 9,
    label: 'Create profile → add edit mode (2-turn)',
    turns: [
      'Create a user profile page showing a name, email, and avatar. The profile data is stored in a variable.',
      {
        message: 'Add an edit mode to the profile page. An Edit button shows editable inputs for name and email. A Save button updates the variable. A Cancel button reverts. Do not recreate the page from scratch.',
        checks: [
          (result, allWrites) => {
            // Turn 2 should use edit_file, not write_file on pages/*/page
            const pageWrites = result.writes.filter(w => /^pages\/[^/]+\/page$/.test(w.path));
            if (pageWrites.length > 0) {
              // Not a violation if it's the first write ever, but in turn 2 it's a rewrite
              result._turn2PageRewrite = true;
            }
          },
        ],
      },
    ],
  },

  {
    id: 10,
    label: 'Users list from REST datasource',
    turns: [
      'Create a page that lists users from a REST API at https://jsonplaceholder.typicode.com/users. Create a datasource for it. Show each user\'s name and email in a card using map. Add a "Reload" button that refetches the datasource.',
    ],
  },

  {
    id: 11,
    label: 'Progressive build + semantic locate (5-turn)',
    turns: [
      'Create a landing page with a hero section (big headline, subtitle, and a green CTA button) and a features section below it with 3 cards: Fast, Reliable, Secure.',
      {
        message: 'Add a pricing section below the features with 3 tiers: Free, Pro at $29/month, and Enterprise.',
        checks: [
          (result) => {
            // Turn 2 should NOT write_file on pages/landing/page (use edit or group file)
            const fullPageRewrites = result.writes.filter(w => w.path === 'pages/landing/page');
            if (fullPageRewrites.length > 0) {
              result._turn2FullPageRewrite = true;
            }
          },
        ],
      },
      {
        message: 'Make the hero headline bigger and change the CTA button background to blue.',
        checks: [
          (result) => {
            const fullPageRewrites = result.writes.filter(w => w.path === 'pages/landing/page');
            if (fullPageRewrites.length > 0) {
              result._turn3FullPageRewrite = true;
            }
          },
        ],
      },
      'Move the pricing section so it appears between the hero and features.',
      'Find the card that says Reliable and change its background to a dark color. Also find the CTA button and add a press animation to it.',
    ],
  },
];

// ── Fixture VFS for search routing scenarios ─────────────────────────────────

const FIXTURE_VFS = (() => {
  const pricingCard = {
    type: 'Box',
    name: 'pricingCard',
    _group: 'Pricing',
    props: { className: 'rounded-[12px] p-[24px] bg-[#ffffff]' },
    children: [
      {
        type: 'Box',
        name: 'popularChip',
        props: { className: 'rounded-full bg-[#7C3AED] px-[12px]' },
        children: [{ type: 'Text', text: 'Popular' }],
      },
    ],
  };

  const statusBox = {
    type: 'Box',
    name: 'statusToggleBtn',
    props: { className: 'bg-[#7C3AED] rounded-[8px] p-[16px]' },
    actions: [{ action: 'toggleStatus' }],
  };

  const bookTitleText = {
    type: 'Text',
    name: 'bookTitle',
    text: { js: "variables['greetingVar']" },
  };

  const cardsGrid = {
    type: 'Box',
    name: 'cardsGrid',
    props: { className: 'flex flex-col gap-[16px]' },
    children: [
      { type: 'Box', name: 'bookCard1', props: { className: 'p-[16px]' }, children: [{ type: 'Text', text: 'Card 1' }] },
      { type: 'Box', name: 'bookCard2', props: { className: 'p-[16px]' }, children: [{ type: 'Text', text: 'Card 2' }] },
    ],
  };

  const dropdownMenu = {
    type: 'Box',
    name: 'dropdownMenu',
    popover: { trigger: 'click', content: { type: 'Box', children: [] } },
    props: { className: 'relative' },
  };

  const submitBtn = {
    type: 'Box',
    name: 'submitFormBtn',
    props: { className: 'bg-[#2563EB] rounded-[8px]' },
    actions: [{ action: 'submitForm' }],
    children: [{ type: 'Text', text: 'Submit' }],
  };

  return {
    routes: JSON.stringify({ routes: [
      { name: 'pageA', path: '/a' },
      { name: 'pageB', path: '/b' },
      { name: 'pageC', path: '/c' },
    ]}),
    'design/theme': JSON.stringify({ primary: '#7C3AED', accent: '#2563EB' }),
    'workflows/toggleStatus': JSON.stringify({
      id: 'toggleStatus',
      name: 'toggleStatus',
      description: 'Switches the order status between open and closed',
      steps: [],
    }),
    'workflows/submitForm': JSON.stringify({
      id: 'submitForm',
      name: 'submitForm',
      description: 'Validates and submits the contact form data',
      steps: [],
    }),
    'store/greetingVar': JSON.stringify({
      id: 'greetingVar',
      name: 'greetingVar',
      description: 'Initial greeting shown to the user — value is displayed as page title',
      initialValue: 'my book',
    }),
    'pages/pageA/page': JSON.stringify({
      ui: [pricingCard, statusBox, dropdownMenu],
    }),
    'pages/pageA/groups/Pricing': JSON.stringify({
      ui: [pricingCard],
    }),
    'pages/pageB/page': JSON.stringify({
      ui: [
        { type: 'Box', name: 'booksSection', _group: 'Books',
          children: [cardsGrid, bookTitleText] },  // bookTitle is BELOW cards — agent must move it up
        submitBtn,
      ],
    }),
    'pages/pageC/page': JSON.stringify({
      ui: [
        { type: 'Box', name: 'heroSection', _group: 'Hero',
          children: [
            { type: 'Text', name: 'heroTitle', text: { js: "variables['greetingVar']" } },
          ] },
      ],
    }),
  };
})();

// ── Routing scenarios (12-19) — seeded fixture, assert tool order ─────────────

const ROUTING_SCENARIOS = [
  {
    id: 12,
    label: 'Exact label — make the pricing chip green',
    initialFiles: FIXTURE_VFS,
    turns: [
      {
        message: 'Make the pricing chip (popularChip) have a green background instead of purple.',
        checks: [
          (result) => {
            const first = result.toolsUsed[0];
            if (first !== 'grep') {
              result._routingIssue = `Expected grep first, got ${first}`;
            }
            // Should edit the pricingCard group or page that contains popularChip
            const editedCorrectFile = result.writes.some(w =>
              w.path.includes('pageA') || w.path.includes('Pricing')
            );
            if (!editedCorrectFile) {
              result._routingIssue = `Did not edit pageA/Pricing, wrote: ${result.writes.map(w=>w.path).join(', ')}`;
            }
          },
        ],
      },
    ],
    routingAssertions: ['grep should be called first'],
  },

  {
    id: 13,
    label: 'Behavioral — disable the box that changes status on click',
    initialFiles: FIXTURE_VFS,
    turns: [
      {
        message: 'Find the button that toggles the order status and add a condition to disable it (condition: false).',
        checks: [
          (result) => {
            const editedStatusNode = result.writes.some(w => w.path.includes('pageA'));
            if (!editedStatusNode) {
              result._routingIssue = `Should have edited pageA, wrote: ${result.writes.map(w=>w.path).join(', ')}`;
            }
          },
        ],
      },
    ],
  },

  {
    id: 14,
    label: 'Variable binding — change the node showing "my book" to say "hi"',
    initialFiles: FIXTURE_VFS,
    turns: [
      {
        message: 'Find the text element that shows the greeting "my book" and change it to say "hi" by updating the variable\'s initialValue.',
        checks: [
          (result) => {
            // Agent must update the store/greetingVar file, not a page file
            const updatedVar = result.writes.some(w => w.path === 'store/greetingVar');
            if (!updatedVar) {
              result._routingIssue = `Expected store/greetingVar to be updated, wrote: ${result.writes.map(w=>w.path).join(', ')}`;
            }
            // Must NOT edit the bound text node directly (it uses a formula, not literal text)
            const wrongEdit = result.writes.some(w =>
              w.path.includes('pageB') && w.content.includes('"hi"') && !w.path.includes('greetingVar')
            );
            if (wrongEdit) {
              result._routingIssue = `Should update the store var, not hard-code text in the page`;
            }
          },
        ],
      },
    ],
  },

  {
    id: 15,
    label: 'Concept/unlabeled — tweak the dropdown menu',
    initialFiles: FIXTURE_VFS,
    turns: [
      {
        message: 'Find the dropdown menu on pageA and give it a white background.',
        checks: [
          (result) => {
            const editedPageA = result.writes.some(w => w.path.includes('pageA'));
            if (!editedPageA) {
              result._routingIssue = `Should have edited pageA, wrote: ${result.writes.map(w=>w.path).join(', ')}`;
            }
          },
        ],
      },
    ],
  },

  {
    id: 16,
    label: 'Color — find the purple badge/chip',
    initialFiles: FIXTURE_VFS,
    turns: [
      {
        message: 'Find the purple chip/badge and change its color to orange.',
        checks: [
          (result) => {
            const editedCorrect = result.writes.some(w =>
              w.path.includes('pageA') || w.path.includes('Pricing')
            );
            if (!editedCorrect) {
              result._routingIssue = `Should have edited pageA/Pricing, wrote: ${result.writes.map(w=>w.path).join(', ')}`;
            }
          },
        ],
      },
    ],
  },

  {
    id: 17,
    label: 'Multi-page ref resolution — move "my book" text above cards',
    initialFiles: FIXTURE_VFS,
    turns: [
      {
        message: 'Move the element showing "my book" to appear above the cards grid. It is on the page that also has the cards.',
        checks: [
          (result) => {
            // Should edit pageB (has both bookTitle and cardsGrid), NOT pageA or pageC
            const editedPageB = result.writes.some(w => w.path.includes('pageB'));
            const editedPageA = result.writes.some(w => w.path.includes('pageA'));
            const editedPageC = result.writes.some(w => w.path.includes('pageC'));
            if (!editedPageB) {
              result._routingIssue = `Should have edited pageB, wrote: ${result.writes.map(w=>w.path).join(', ')}`;
            }
            if (editedPageA || editedPageC) {
              result._routingIssue = `Should NOT edit pageA or pageC, wrote: ${result.writes.map(w=>w.path).join(', ')}`;
            }
          },
        ],
      },
    ],
  },

  {
    id: 18,
    label: 'Behavioral across pages — find the submit form button',
    initialFiles: FIXTURE_VFS,
    turns: [
      {
        message: 'Find the button that submits the form and change its background to green.',
        checks: [
          (result) => {
            // submitFormBtn is on pageB
            const editedPageB = result.writes.some(w => w.path.includes('pageB'));
            if (!editedPageB) {
              result._routingIssue = `Should have edited pageB, wrote: ${result.writes.map(w=>w.path).join(', ')}`;
            }
          },
        ],
      },
    ],
  },

  {
    id: 19,
    label: 'Multi-page disambiguation — identical var on 2 pages, agent asks',
    initialFiles: FIXTURE_VFS,
    turns: [
      {
        message: 'Rename the "my book" text to say "our books" (the variable is used on multiple pages — figure out which one to update or ask).',
        checks: [
          (result) => {
            // Acceptable: either asks the user (no writes, text contains "which" or "page")
            // OR updates the shared store/greetingVar (affects all pages — valid since it's shared)
            const askedUser = result.assistantText.toLowerCase().includes('which') ||
              result.assistantText.toLowerCase().includes('both pages') ||
              result.assistantText.toLowerCase().includes('all pages');
            const updatedSharedVar = result.writes.some(w => w.path === 'store/greetingVar');
            if (!askedUser && !updatedSharedVar) {
              result._routingIssue = `Should either ask user about ambiguity or update the shared variable. Got: ${result.assistantText.slice(0, 200)}`;
            }
          },
        ],
      },
    ],
  },
];

// ── Extended scenarios (20-29) ────────────────────────────────────────────────

const EXTENDED_SCENARIOS = [
  {
    id: 20,
    label: 'classFormulas — dynamic styles from variable',
    turns: [
      'Create a page with a notification banner. Store a boolean "showBanner" variable (default true). Use classFormulas to hide/show the banner: when showBanner is false apply "hidden", otherwise show it. Add a dismiss button that sets showBanner to false.',
    ],
  },

  {
    id: 21,
    label: 'PageLoad trigger — fetch data on mount',
    turns: [
      'Create a dashboard page. Add a REST datasource that fetches stats from https://jsonplaceholder.typicode.com/todos?_limit=5. Add a pageLoad trigger that fetches the datasource when the page opens. Show the data in a list using map.',
    ],
  },

  {
    id: 22,
    label: 'Conditional workflow — if/else branch',
    turns: [
      'Create a checkout page with a total amount variable (default 0). Add a "Place Order" button. The workflow checks: if total > 0, show a success message by setting a "orderStatus" variable to "confirmed"; otherwise set it to "empty_cart". Display the order status text on screen.',
    ],
  },

  {
    id: 23,
    label: 'Delete file — remove a workflow',
    initialFiles: FIXTURE_VFS,
    turns: [
      {
        message: 'The toggleStatus workflow is no longer needed. Remove it and also remove the action from the statusToggleBtn on pageA.',
        checks: [
          (result) => {
            const deletedWorkflow = result.deletes.some(d => d.includes('toggleStatus'));
            const editedPageA = result.writes.some(w => w.path.includes('pageA'));
            if (!deletedWorkflow && !editedPageA) {
              result._routingIssue = `Should have deleted the workflow or edited pageA. Deletes: ${result.deletes.join(', ')}`;
            }
          },
        ],
      },
    ],
  },

  {
    id: 24,
    label: 'Multi-turn: create → search → add feature (3-turn)',
    turns: [
      'Create an e-commerce product page for a "Wireless Headphones" product. Show the product name, price ($99), description, and an "Add to Cart" button. Store the cart count in a variable.',
      {
        message: 'Add a quantity selector to the product page. Show a minus button, a quantity number (default 1), and a plus button. The add to cart workflow should use the quantity when updating the cart.',
        checks: [
          (result) => {
            // Should search before editing
            const searched = result.toolsUsed.some(t => t === 'grep' || t === 'read_file');
            if (!searched) {
              result._routingIssue = `Turn 2 should search/read before editing`;
            }
          },
        ],
      },
      'Find the Add to Cart button and add a press animation to it.',
    ],
  },

  {
    id: 25,
    label: 'Image gallery with lightbox state',
    turns: [
      'Create an image gallery page with 6 sample images in a 3-column grid. Clicking any image opens a lightbox — a fullscreen overlay that shows the clicked image larger. Store the selected image index in a variable (null when closed). Add a close button on the overlay.',
    ],
  },

  {
    id: 26,
    label: 'Nested map — list with sub-items',
    turns: [
      'Create a FAQ page with 4 questions. Each FAQ item has a question string and an array of answer paragraphs. Use map to render the items, and inside each item use another map to render the answer paragraphs. Store the FAQ data in a variable.',
    ],
  },

  {
    id: 27,
    label: 'Form with select input + condition',
    turns: [
      'Create a feedback form with a name field, a rating select (options: 1-5 stars), and a comments textarea. Show a "Thank you" section conditionally when a boolean "submitted" variable is true. On submit, set submitted to true.',
    ],
  },

  {
    id: 28,
    label: 'Search input with live filter',
    turns: [
      'Create a contacts page with a list of 5 static contacts (name + email). Add a search input at the top. Use a store variable for the search query. Use classFormulas or condition on each contact item to hide items that don\'t match the search. The filtering happens without a button press — just as you type.',
    ],
  },

  {
    id: 29,
    label: 'Multi-turn: add animation then find and tweak it (2-turn)',
    turns: [
      'Create a hero section with a headline "Welcome" and a subtitle "Start building today". Add a fadeIn enter animation to the headline and a slideInUp enter animation (300ms delay) to the subtitle.',
      {
        message: 'Find the headline with the fadeIn animation and change its animation duration to 1200ms.',
        checks: [
          (result) => {
            const searched = result.toolsUsed.some(t => t === 'grep' || t === 'codebase_search');
            if (!searched) {
              result._routingIssue = `Turn 2 should use grep/codebase_search to find the animation node`;
            }
          },
        ],
      },
    ],
  },
];

// ── Scenarios 30-39 ──────────────────────────────────────────────────────────

const EXTENDED_SCENARIOS_2 = [
  {
    id: 30,
    label: 'Tabs pattern — active tab with classFormulas',
    turns: [
      'Create a settings page with 3 tabs: "Profile", "Security", "Notifications". Store the active tab in a variable (default "profile"). Each tab button uses classFormulas to apply a bold bottom-border style when it is active. Each tab panel is shown/hidden with condition. Clicking a tab sets the variable to that tab name.',
    ],
  },

  {
    id: 31,
    label: 'Global workflow used from 2 pages',
    turns: [
      'Create a global "logout" workflow that sets a "isLoggedIn" store variable to false and navigates to /login. Create a Header component (a Box with a logo Text and a logout button). Add it to two pages: dashboard and profile. Both pages trigger the same global logout workflow when the button is clicked.',
    ],
  },

  {
    id: 32,
    label: 'Multi-step form — 3 wizard steps',
    turns: [
      'Create an onboarding wizard with 3 steps: Step 1 collects name, Step 2 collects email, Step 3 shows a summary. Store the current step (1, 2, or 3) in a variable. Each step section is shown with condition. "Next" buttons advance the step, "Back" goes to the previous. Step 3 shows the entered name and email as a summary.',
    ],
  },

  {
    id: 33,
    label: 'Accordion — expand/collapse items',
    turns: [
      'Create a pricing FAQ accordion with 5 items. Store the currently open item index in a variable (null = all collapsed). Each item has a question header that toggles: clicking it opens it (or closes it if it was already open). The answer is shown with condition when its index matches the open variable. Use classFormulas to rotate the arrow icon 180deg when open.',
    ],
  },

  {
    id: 34,
    label: 'Loading state — spinner during data fetch',
    turns: [
      'Create a news feed page. Add a REST datasource that fetches from https://jsonplaceholder.typicode.com/posts?_limit=10. Add a "isLoading" store boolean variable (default true). Add a pageLoad trigger that fetches the datasource and sets isLoading to false after. Show a spinner (animated Box) while isLoading is true and the post list when false.',
    ],
  },

  {
    id: 35,
    label: 'Multi-turn: find and rename a node (2-turn)',
    initialFiles: FIXTURE_VFS,
    turns: [
      {
        message: 'Find the "pricingCard" node and rename it to "planCard".',
        checks: [
          (result) => {
            const searched = result.toolsUsed.some(t => t === 'grep' || t === 'codebase_search');
            if (!searched) {
              result._routingIssue = 'Should search before editing to find the pricingCard node';
            }
            const edited = result.writes.length > 0;
            if (!edited) {
              result._routingIssue = 'Should write a file to rename the node';
            }
          },
        ],
      },
    ],
  },

  {
    id: 36,
    label: 'Pagination — next/prev page with variable',
    turns: [
      'Create a blog posts page. Store a "currentPage" variable (default 1). Fetch posts from https://jsonplaceholder.typicode.com/posts?_page={{variables["currentPage"]}}&_limit=5 as a datasource. Add "Previous" and "Next" buttons. Previous decrements (min 1), Next increments. Add a pageLoad trigger and also re-fetch when currentPage changes by adding a trigger on the variable. Show the current page number.',
    ],
  },

  {
    id: 37,
    label: 'Navigate to another page in workflow',
    turns: [
      'Create two pages: "login" and "home". On the login page, create a form with email and password inputs and a "Sign In" button. The workflow checks if email is not empty; if so it sets a "isLoggedIn" store variable to true and navigates to the home page. On home, show a welcome message with a logout button that sets isLoggedIn to false and navigates back to login.',
    ],
  },

  {
    id: 38,
    label: 'Input validation — show inline error',
    turns: [
      'Create a registration form page with an email input and a password input. Add a store variable "emailError" (empty string by default). On blur of the email field, run a workflow that checks if the email contains "@"; if not, set emailError to "Please enter a valid email". Show the error text below the email field conditionally when emailError is not empty. Clear the error when the user starts typing again.',
    ],
  },

  {
    id: 39,
    label: 'Dark mode toggle — body-level classFormulas',
    turns: [
      'Create a page with a dark mode toggle. Store a "isDarkMode" boolean variable (default false). The root box of the page uses classFormulas to switch between a light background (bg-[#ffffff] text-[#111111]) and dark background (bg-[#111111] text-[#ffffff]) based on the variable. Add a toggle button in the top-right corner that flips isDarkMode. Show some sample content (heading + paragraph) that inherits the color.',
    ],
  },
];

// ── Scenarios 40-49 ──────────────────────────────────────────────────────────

const EXTENDED_SCENARIOS_3 = [
  {
    id: 40,
    label: 'Style-only edit — change colors without touching structure',
    initialFiles: FIXTURE_VFS,
    turns: [
      {
        message: 'Change the background color of the pricingCard to dark navy (#0a192f) and the text inside it to white (#ffffff). Do not restructure anything.',
        checks: [
          (result) => {
            const searched = result.toolsUsed.some(t => t === 'grep' || t === 'codebase_search');
            if (!searched) {
              result._routingIssue = 'Should search before editing';
            }
          },
        ],
      },
    ],
  },

  {
    id: 41,
    label: 'Complex {js} expression — dynamic text from multiple variables',
    turns: [
      'Create a profile page. Store "firstName" (default "Ahmad") and "lastName" (default "Zraiq") variables. Display a greeting text that says "Hello, {firstName} {lastName}!" using a {js} expression. Also show their initials (first letters combined) in a circle avatar using a {js} expression.',
    ],
  },

  {
    id: 42,
    label: 'valueChange trigger — re-fetch when variable changes',
    turns: [
      'Create a country selector page. Store a "selectedCountry" variable (default "us"). Add a row of 3 country buttons (US, UK, DE). Clicking each sets the variable. Add a REST datasource that fetches from https://restcountries.com/v3.1/alpha/{selectedCountry} using the variable in the URL. Add a valueChange trigger on the variable to re-fetch the datasource. Show the country name from the fetched data.',
    ],
  },

  {
    id: 43,
    label: 'Move content between sections — restructure a page',
    initialFiles: FIXTURE_VFS,
    turns: [
      {
        message: 'On pageA, move the pricingCard node out of the Pricing group and place it at the top level of the page, before the Hero group.',
        checks: [
          (result) => {
            const edited = result.writes.some(w => w.path.includes('pageA'));
            if (!edited) {
              result._routingIssue = 'Should edit pageA to move the node';
            }
          },
        ],
      },
    ],
  },

  {
    id: 44,
    label: 'Remove variable and all its references',
    initialFiles: FIXTURE_VFS,
    turns: [
      {
        message: 'The "greetingVar" store variable is no longer needed. Remove it and also find and remove any nodes or workflows that reference it.',
        checks: [
          (result) => {
            const searched = result.toolsUsed.some(t => t === 'grep' || t === 'codebase_search');
            if (!searched) {
              result._routingIssue = 'Should search for all references to greetingVar before removing';
            }
            const deleted = result.deletes.length > 0 || result.writes.some(w => w.path.includes('greetingVar'));
            if (!deleted) {
              result._routingIssue = 'Should delete or modify the greetingVar file';
            }
          },
        ],
      },
    ],
  },

  {
    id: 45,
    label: 'Deeply nested node — find and edit 4 levels deep',
    turns: [
      {
        message: 'Create a card component with this structure: card (Box) > header (Box) > titleRow (Box) > badge (Box) > badgeText (Text) that says "New". Then find the badgeText node and change its text to "Featured".',
        checks: [
          (result) => {
            if (result.writes.length === 0) {
              result._routingIssue = 'Should create the nested card structure';
            }
          },
        ],
      },
    ],
  },

  {
    id: 46,
    label: 'Counter with min/max bounds',
    turns: [
      'Create a counter page. Store a "count" variable (default 0). Show the count number in a large centered display. Add Decrement (-) and Increment (+) buttons. Decrement workflow: only decrements if count > 0 (minimum 0). Increment workflow: only increments if count < 10 (maximum 10). Show a "Min reached!" message conditionally when count is 0 and a "Max reached!" message when count is 10.',
    ],
  },

  {
    id: 47,
    label: 'Theme file — add a new color and use it',
    turns: [
      'Add a new theme color called "success" with value #16a34a to the design/theme file. Then create a simple status banner page that uses var(--theme-success) as its background color.',
    ],
  },

  {
    id: 48,
    label: 'Multi-turn: build table then add sorting (2-turn)',
    turns: [
      'Create a data table page showing 5 users (id, name, role). Store the data as a variable. Display it as a table-like layout using map with a header row and data rows.',
      {
        message: 'Add a "sort by name" toggle. Store a "sortAsc" boolean variable (default true). Add a sort button in the header that flips sortAsc. Use a {js} expression in the map dataSource to sort the users array by name based on the sortAsc variable.',
        checks: [
          (result) => {
            const searched = result.toolsUsed.some(t => t === 'grep' || t === 'read_file');
            if (!searched) {
              result._routingIssue = 'Turn 2 should read the existing page before adding sort';
            }
          },
        ],
      },
    ],
  },

  {
    id: 49,
    label: 'Tooltip on hover — conditional with animation',
    turns: [
      'Create an info card page with 3 cards. Each card has an info icon (ⓘ). Hovering the icon shows a tooltip text below it. Implement this using a store variable "hoveredCard" (null default) and classFormulas to show/hide the tooltip (opacity-0 vs opacity-100). The card uses onMouseEnter-like approach: a hover animation on the icon and a condition on the tooltip text based on hoveredCard matching the card index. Clicking the icon sets/clears hoveredCard.',
    ],
  },
];

// ── Scenarios 50-59 ──────────────────────────────────────────────────────────

const EXTENDED_SCENARIOS_4 = [
  {
    id: 50,
    label: 'Counter with min/max bounds (clamped)',
    turns: [
      'Create a counter page. Store a "count" variable (default 0). Show the count in a large centered display. Add Decrement (−) and Increment (+) buttons. Decrement only works if count > 0 (minimum 0). Increment only works if count < 10 (maximum 10). Show a "Min reached!" label conditionally when count === 0 and "Max reached!" when count === 10.',
    ],
  },

  {
    id: 51,
    label: 'Theme file — add new color and use it',
    turns: [
      'Add a new theme color called "success" with hex value #16a34a to the design/theme file. Then create a simple status banner page. The banner box uses var(--theme-success) as its background color via a style property. Show a "All systems operational" text inside it.',
    ],
  },

  {
    id: 52,
    label: 'Deeply nested node — 4-level structure, then find and edit leaf',
    turns: [
      'Create a card page with this exact nesting: card Box > header Box > titleRow Box > badge Box > badgeText Text that reads "New". Then find the badgeText node and change its text to "Featured".',
    ],
  },

  {
    id: 53,
    label: '2-turn: build data table then add live sorting',
    turns: [
      'Create a users table page. Store 5 users as a variable: [{id:1,name:"Alice",role:"Admin"},{id:2,name:"Charlie",role:"User"},{id:3,name:"Bob",role:"Editor"},{id:4,name:"Diana",role:"User"},{id:5,name:"Eve",role:"Admin"}]. Render them using map with a header row and data rows showing id, name, role.',
      {
        message: 'Add a sort toggle to the table. Store a "sortAsc" boolean variable (default true). Add a "Sort by Name" button that flips sortAsc. Change the map dataSource to a {js} expression that sorts the users array by name ascending or descending based on sortAsc.',
        checks: [
          (result) => {
            const searched = result.toolsUsed.some(t => t === 'grep' || t === 'read_file');
            if (!searched) {
              result._routingIssue = 'Turn 2 should read existing page before adding sort';
            }
          },
        ],
      },
    ],
  },

  {
    id: 54,
    label: 'Tooltip on click — classFormulas opacity show/hide',
    turns: [
      'Create an info card page with 3 info icons. Store a "hoveredCard" variable (null default). Clicking an icon sets hoveredCard to that card\'s index (or back to null if it was already selected). Each tooltip text uses classFormulas to toggle between "opacity-0 pointer-events-none" (hidden) and "opacity-100" (visible) based on whether hoveredCard matches its index.',
    ],
  },

  {
    id: 55,
    label: 'Skeleton loading pattern',
    turns: [
      'Create a profile card page. Store "isLoading" boolean (default true). Add a pageLoad trigger that sets isLoading to false after 1 second by using a workflow with a delayMs step. Show a skeleton placeholder (gray animated boxes using loop animation) when isLoading is true, and the real profile content when false.',
    ],
  },

  {
    id: 56,
    label: 'Multi-turn: add a new page and cross-link it (2-turn)',
    turns: [
      'Create a landing page at /landing with a hero section that has a "Get Started" button.',
      {
        message: 'Now create a signup page at /signup. Go back to the landing page and make the "Get Started" button navigate to /signup when clicked.',
        checks: [
          (result) => {
            const editedLanding = result.writes.some(w => w.path.toLowerCase().includes('landing'));
            const createdSignup = result.writes.some(w => w.path.toLowerCase().includes('signup'));
            if (!editedLanding && !createdSignup) {
              result._routingIssue = 'Should write both the signup page and update the landing page button';
            }
          },
        ],
      },
    ],
  },

  {
    id: 57,
    label: 'Shared component — reuse across 3 pages',
    turns: [
      'Create a reusable "Footer" shared component with company name "Acme Inc." and three nav links: Home, About, Contact. Add this footer component to three pages: home, about, and contact. Each page should have some unique content above the footer.',
    ],
  },

  {
    id: 58,
    label: 'Error state — show fallback when datasource fails',
    turns: [
      'Create a product detail page. Add a REST datasource to fetch from https://fakestoreapi.com/products/1. Store an "fetchError" boolean (default false). The pageLoad trigger fetches the datasource; on failure it sets fetchError to true. Show the product details when data is available, and an error card ("Failed to load product") conditionally when fetchError is true.',
    ],
  },

  {
    id: 59,
    label: 'Star rating widget — interactive 5 stars',
    turns: [
      'Create a product review page with a 5-star rating widget. Store "selectedRating" variable (default 0). Render 5 star icons using map over [1,2,3,4,5]. Each star uses classFormulas to be filled yellow (text-[#fbbf24]) when its index is <= selectedRating, otherwise gray (text-[#d1d5db]). Clicking a star sets selectedRating to that star\'s value. Show the selected rating as text below.',
    ],
  },
];

// ── Scenarios 60-69 ──────────────────────────────────────────────────────────

const EXTENDED_SCENARIOS_5 = [
  {
    id: 60,
    label: 'Staggered enter animations — list with delay per index',
    turns: [
      'Create a team page with 4 team member cards in a row. Each card has a photo placeholder, name, and role. Apply a slideInUp enter animation to each card with a staggered delay: card 1 = 0ms, card 2 = 100ms, card 3 = 200ms, card 4 = 300ms. Use a map over a team members variable.',
    ],
  },

  {
    id: 61,
    label: 'Formula utility — reusable {js} calculation',
    turns: [
      'Create a shopping cart page. Store a cart variable with 3 items: [{name:"Shirt",price:29,qty:2},{name:"Pants",price:49,qty:1},{name:"Shoes",price:89,qty:1}]. Show each item with a subtotal (price * qty) using a {js} expression per row. Show the grand total at the bottom using a {js} expression that sums all (price * qty) across items.',
    ],
  },

  {
    id: 62,
    label: 'Map with condition inside — filter visible items',
    turns: [
      'Create a tasks page. Store tasks variable with 5 items, each having title and completed boolean. Store a "showCompleted" boolean (default true). Use map to render all tasks. Each task item uses condition to show only if: showCompleted is true OR the task is not completed. Add a toggle button that flips showCompleted to show/hide completed tasks.',
    ],
  },

  {
    id: 63,
    label: 'Workflow chain — one workflow calls another',
    turns: [
      'Create a checkout page. When the user clicks "Confirm Order": first run a "validateCart" workflow that checks if a cartTotal variable is > 0; if valid it runs a "processOrder" workflow that sets orderStatus to "confirmed" and increments an orderCount variable. Store all three variables. Show the orderStatus and orderCount on screen.',
    ],
  },

  {
    id: 64,
    label: 'Multi-turn: 3-turn refactor — add, move, then restyle',
    turns: [
      'Create a simple blog post page with a title "Hello World", a date "June 2026", and body text "This is my first post."',
      {
        message: 'Add a tags section below the body with three tag chips: "react", "nextjs", "typescript". Each chip is a small rounded box with the tag text.',
        checks: [
          (result) => {
            const searched = result.toolsUsed.some(t => t === 'grep' || t === 'read_file');
            if (!searched) result._routingIssue = 'Turn 2 should read existing page before editing';
          },
        ],
      },
      {
        message: 'Find the date text and move it to appear after the tags section, not before the body.',
        checks: [
          (result) => {
            const searched = result.toolsUsed.some(t => t === 'grep' || t === 'read_file');
            if (!searched) result._routingIssue = 'Turn 3 should search/read before restructuring';
          },
        ],
      },
    ],
  },

  {
    id: 65,
    label: 'Component with dynamic data passed via props',
    turns: [
      'Create a reusable "StatCard" component that displays a label and value using context.props.label and context.props.value. Then create a stats page that uses the StatCard component 3 times, passing different label/value pairs: ("Users", "1,234"), ("Revenue", "$45,678"), ("Orders", "89").',
    ],
  },

  {
    id: 66,
    label: 'Debounced search — input + delayed fetch',
    turns: [
      'Create a search page. Store a "searchQuery" variable (default empty string). Add a text input that updates searchQuery on change. Add a REST datasource that searches https://jsonplaceholder.typicode.com/posts?q={searchQuery}. Add a valueChange trigger on searchQuery to re-fetch the datasource. Show results using map, displaying the post title for each.',
    ],
  },

  {
    id: 67,
    label: 'Cross-page state — cart badge shared across pages',
    turns: [
      'Create three pages: shop, cart, and checkout. Store a global "cartCount" variable (default 0). All three pages show a cart badge in their header that displays the cartCount. On the shop page there is an "Add to Cart" button that increments cartCount. On the cart page there is a "Remove item" button that decrements it. Navigate between pages using header nav links.',
    ],
  },

  {
    id: 68,
    label: '2-turn: create form, then wire up submission to datasource',
    turns: [
      'Create a contact form page with name, email, and message fields. Store the three values as variables. Add a Submit button.',
      {
        message: 'Now wire up the Submit button to POST the form data to https://jsonplaceholder.typicode.com/posts. Create a REST datasource with POST method and body containing the form variables. Add a workflow that fetches the datasource on submit. Show a "Sent!" success message conditionally after submit.',
        checks: [
          (result) => {
            const searched = result.toolsUsed.some(t => t === 'grep' || t === 'read_file');
            if (!searched) result._routingIssue = 'Turn 2 should read existing page/variables before adding datasource';
          },
        ],
      },
    ],
  },

  {
    id: 69,
    label: 'Responsive layout — 1-col mobile, 3-col desktop via classFormulas',
    turns: [
      'Create a features section page with 6 feature cards. Store a "screenWidth" variable (default 1200). Use classFormulas on the grid container to apply "flex-col" when screenWidth < 768, and "flex-row flex-wrap" when >= 768. Add two buttons: "Simulate Mobile" (sets screenWidth to 375) and "Simulate Desktop" (sets screenWidth to 1200). Each card has an icon, title, and description.',
    ],
  },
];

// ── Scenarios 70-75 — edge cases ─────────────────────────────────────────────

const EXTENDED_SCENARIOS_6 = [
  {
    id: 70,
    label: 'Breakpoint responsive — globalContext.browser.breakpoint',
    turns: [
      'Create a landing page hero. The headline font size should be 56px on desktop and 32px on mobile — use the responsive field with a "mobile" breakpoint override on the Text node (set styles.fontSize). The layout should be two-column (flex-row) on desktop and single-column (flex-col) on mobile — use the responsive breakpoint override on the container Box (styles.flexDirection). Do NOT use classFormulas or Tailwind responsive prefixes.',
    ],
  },

  {
    id: 71,
    label: 'forEach workflow step — loop over array variable',
    turns: [
      'Create an inventory page. Store an "items" variable with 3 objects: [{id:"a",name:"Widget",qty:5},{id:"b",name:"Gadget",qty:0},{id:"c",name:"Doohickey",qty:12}]. Add a "Restock All" button. The workflow uses a forEach step to loop over the items and for each item where qty === 0, run a changeVariableValue step that sets a "restockAlert" variable to the item name. Show the restockAlert on screen.',
    ],
  },

  {
    id: 72,
    label: 'Multi-datasource page — two parallel fetches',
    turns: [
      'Create a dashboard page that fetches two datasources in parallel on pageLoad: "recent-posts" from https://jsonplaceholder.typicode.com/posts?_limit=3 and "recent-users" from https://jsonplaceholder.typicode.com/users?_limit=3. Use fetchCollectionsParallel in the pageLoad trigger workflow. Show both lists side by side using a flex-row layout.',
    ],
  },

  {
    id: 73,
    label: 'Auth flow — authenticate step + clearSession',
    turns: [
      'Create a login page. When the user submits the form (email + password), call a REST datasource POST to https://jsonplaceholder.typicode.com/posts (simulated login). On success, use an authenticate workflow step to set auth.token to the response id and auth.user to {email: local.data.form.formData.email}. Navigate to /home. On /home show the auth.user.email and a Logout button that runs clearSession and navigates to /login.',
    ],
  },

  {
    id: 74,
    label: 'Scroll-triggered animations — scroll enter on cards',
    turns: [
      'Create a features page with 6 feature cards in a 3-column grid. Each card uses a scroll-triggered enter animation (slideInUp type, 400ms duration, 0.2 threshold, once:true) instead of a mount-time animation. The cards should appear as the user scrolls them into view.',
    ],
  },

  {
    id: 75,
    label: 'imperativeTrigger animation — shake on error',
    turns: [
      'Create a login form page with email and password inputs. Store an "loginErrorCount" number variable (default 0). Add a "Sign In" button. The workflow checks if email is empty; if so, increments loginErrorCount and shows an error message. The email input Box has an imperativeTrigger animation of type "shake" that watches variables[\'loginErrorCount\'] — it shakes the input every time an error occurs. Show/hide an error text conditionally.',
    ],
  },
];

// ── Scenario 76 — Calculator (map-based buttons, workflows, no hover/active classes) ──────────
const EXTENDED_SCENARIOS_7 = [
  {
    id: 76,
    label: 'Calculator — map buttons, workflows, no hover/active classes',
    turns: [
      'Build a calculator page (iOS-style, dark theme). Store 4 variables: displayValue (string, "0"), previousValue (string, ""), operationPending (string, ""), shouldResetDisplay (boolean, false). The digit buttons (0–9) should be rendered using a map node so clicking each appends the correct digit to the display. The operator buttons (+, -, ×, ÷) each trigger a shared handleOperation workflow. An equals button runs handleEquals. A clear button runs handleClear. The display shows the current displayValue variable. Do NOT use hover:, active:, focus:, or transition in className. For hover effects use props.animation.hover.',
    ],
    check(files) {
      const issues = [];
      // Must create a Calculator page
      const pageFile = files['pages/Calculator/page'];
      if (!pageFile) {
        issues.push({ level: 'VIOLATION', msg: 'pages/Calculator/page not created' });
        return issues;
      }
      let page;
      try { page = JSON.parse(pageFile); } catch { issues.push({ level: 'VIOLATION', msg: 'pages/Calculator/page invalid JSON' }); return issues; }

      // Must have a store variable for displayValue
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 1) {
        issues.push({ level: 'VIOLATION', msg: 'No store variables created' });
      }
      const hasDisplayVar = storeFiles.some(([, c]) => {
        try { const v = JSON.parse(c); return v.name === 'displayValue' || (typeof v.initialValue === 'string' && v.initialValue === '0'); } catch { return false; }
      });
      if (!hasDisplayVar) issues.push({ level: 'VIOLATION', msg: 'No store variable for displayValue (name:"displayValue", initialValue:"0")' });

      // Must have at least 3 page-scoped workflows (appendDigit, handleOperation, handleEquals, handleClear)
      const wfFiles = Object.entries(files).filter(([p]) => p.startsWith('pages/Calculator/workflows/'));
      if (wfFiles.length < 3) {
        issues.push({ level: 'VIOLATION', msg: `Only ${wfFiles.length} workflows created — expected at least 3 (appendDigit, handleOperation, handleEquals/handleClear)` });
      }

      // Display text must be bound to a variable (js expression)
      function findDisplayBinding(node) {
        if (!node || typeof node !== 'object') return false;
        if (Array.isArray(node)) return node.some(findDisplayBinding);
        if (node.type === 'Text' && node.text && typeof node.text === 'object' && node.text.js) {
          if (/variables\[/.test(node.text.js)) return true;
        }
        if (node.children) return findDisplayBinding(node.children);
        return false;
      }
      if (page.ui && !findDisplayBinding(page.ui)) {
        issues.push({ level: 'VIOLATION', msg: 'No Text node bound to a variable for the display' });
      }

      // At least one map node (for digit buttons)
      function hasMapNode(node) {
        if (!node || typeof node !== 'object') return false;
        if (Array.isArray(node)) return node.some(hasMapNode);
        if (node.map) return true;
        if (node.children) return hasMapNode(node.children);
        return false;
      }
      if (page.ui && !hasMapNode(page.ui)) {
        issues.push({ level: 'VIOLATION', msg: 'No map node found — digit/operator buttons should use map to pass context.item.data to the workflow' });
      }

      // Workflow using context.item.data.toString() (would produce [object Object]) rather than context.item.data.<field>
      for (const [wfPath, wfContent] of wfFiles) {
        // Flag bare context.item.data.toString() without a field accessor
        if (/context\.item\.data\.toString\(\)/.test(wfContent)) {
          issues.push({ level: 'VIOLATION', msg: `${wfPath}: uses context.item.data.toString() — context.item.data is an object, access a specific field: context.item.data.digit or context.item.data.num` });
        }
        // Flag context.item.data used as a direct string value without field (e.g. "context.item.data" alone, not "context.item.data.something")
        const bare = wfContent.match(/["']context\.item\.data["']/g);
        if (bare) {
          issues.push({ level: 'VIOLATION', msg: `${wfPath}: uses context.item.data as a string literal — it's an object; access a field like context.item.data.digit` });
        }
      }

      return issues;
    },
  },
];

// ── Scenarios 77-80 — full pages, search, datasource ─────────────────────────
const EXTENDED_SCENARIOS_8 = [
  {
    id: 77,
    label: 'Full landing page — 4 _group sections',
    turns: [
      'Create a full landing page with 4 sections: Hero (headline + CTA button), Features (3 feature cards in a grid), Pricing (2 plan cards side by side), and Footer (links + copyright). Mark each top-level section with _group ("Hero", "Features", "Pricing", "Footer"). The page should be well-designed with dark/light contrast, readable text, and proper spacing. Add the route.',
    ],
    check(files) {
      const issues = [];
      const pageFile = files['pages/Landing/page'];
      if (!pageFile) {
        issues.push({ level: 'VIOLATION', msg: 'pages/Landing/page not created' });
        return issues;
      }
      // Must have _group nodes
      let page;
      try { page = JSON.parse(pageFile); } catch { issues.push({ level: 'VIOLATION', msg: 'pages/Landing/page invalid JSON' }); return issues; }
      const groups = [];
      function findGroups(node) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(findGroups); return; }
        if (node._group) groups.push(node._group);
        if (node.children) findGroups(node.children);
      }
      if (page.ui) findGroups(page.ui);
      if (groups.length < 3) {
        issues.push({ level: 'VIOLATION', msg: `Only ${groups.length} _group markers found — expected at least 3 sections (Hero, Features, Pricing, Footer)` });
      }
      // Route must exist
      const routeFile = files['routes'];
      if (!routeFile) {
        issues.push({ level: 'VIOLATION', msg: 'routes file not updated — must add route for Landing page' });
      } else {
        let routes;
        try { routes = JSON.parse(routeFile); } catch { /* ignore */ }
        const hasLanding = routes?.routes?.some(r => r.config === 'Landing' || r.config === 'landing');
        if (!hasLanding) issues.push({ level: 'VIOLATION', msg: 'Route for Landing page not added to routes' });
      }
      return issues;
    },
  },

  {
    id: 78,
    label: 'Grep search — find node by name and update text',
    initialFiles: {
      routes: JSON.stringify({ routes: [{ path: '/', config: 'Home' }] }, null, 2),
      'pages/Home/page': JSON.stringify({
        ui: [{
          type: 'Box', id: 'a1b2c3d4-e5f6-4a7b-8c9d-000000000001', name: 'heroSection',
          props: { className: 'flex flex-col items-center justify-center min-h-[100vh] bg-[#0a0a0a]' },
          children: [
            { type: 'Text', id: 'a1b2c3d4-e5f6-4a7b-8c9d-000000000002', name: 'heroHeadline', props: { className: 'text-[64px] font-bold !text-[#fff]' }, text: 'Welcome to the Platform' },
            { type: 'Text', id: 'a1b2c3d4-e5f6-4a7b-8c9d-000000000003', name: 'heroSubtext', props: { className: 'text-[20px] !text-[#aaa]' }, text: 'Build anything, fast.' },
            { type: 'Box', id: 'a1b2c3d4-e5f6-4a7b-8c9d-000000000004', name: 'ctaButton', props: { className: 'bg-[#6c47ff] rounded-[12px] px-[32px] py-[16px] mt-[32px] cursor-pointer' }, children: [
              { type: 'Text', id: 'a1b2c3d4-e5f6-4a7b-8c9d-000000000005', name: 'ctaButtonText', props: { className: 'text-[18px] font-semibold !text-[#fff]' }, text: 'Get Started' }
            ]}
          ]
        }]
      }, null, 2),
    },
    turns: [
      'Change the hero headline text to "Ship faster with AI" and the hero subtext to "The all-in-one platform for modern teams." Also change the CTA button background from purple to green (#22c55e).',
    ],
    check(files) {
      const issues = [];
      const pageFile = files['pages/Home/page'];
      if (!pageFile) { issues.push({ level: 'VIOLATION', msg: 'pages/Home/page not updated' }); return issues; }
      // Headline text must be updated
      if (!pageFile.includes('Ship faster with AI')) issues.push({ level: 'VIOLATION', msg: 'Hero headline not updated to "Ship faster with AI"' });
      if (!pageFile.includes('The all-in-one platform for modern teams')) issues.push({ level: 'VIOLATION', msg: 'Hero subtext not updated' });
      // Button color changed from purple to green
      if (pageFile.includes('#6c47ff')) issues.push({ level: 'VIOLATION', msg: 'Old purple button color #6c47ff still present — should be replaced with green' });
      if (!pageFile.includes('#22c55e')) issues.push({ level: 'VIOLATION', msg: 'Green button color #22c55e not found' });
      return issues;
    },
  },

  {
    id: 79,
    label: 'Semantic search — find conceptual node and update',
    initialFiles: {
      routes: JSON.stringify({ routes: [{ path: '/', config: 'Home' }] }, null, 2),
      'pages/Home/page': JSON.stringify({
        ui: [{
          type: 'Box', id: 'b1c2d3e4-f5a6-4b7c-8d9e-000000000001', name: 'pageWrapper',
          props: { className: 'flex flex-col bg-[#fff]' },
          children: [
            { type: 'Box', id: 'b1c2d3e4-f5a6-4b7c-8d9e-000000000002', name: 'navBar', props: { className: 'flex flex-row items-center justify-between px-[48px] py-[20px] bg-[#fff] border-b border-[#e5e7eb]' },
              children: [
                { type: 'Text', id: 'b1c2d3e4-f5a6-4b7c-8d9e-000000000003', name: 'brandName', props: { className: 'text-[24px] font-bold !text-[#111]' }, text: 'Acme' },
              ]
            },
            { type: 'Box', id: 'b1c2d3e4-f5a6-4b7c-8d9e-000000000004', name: 'mainContent', props: { className: 'flex flex-col p-[48px]' },
              children: [
                { type: 'Text', id: 'b1c2d3e4-f5a6-4b7c-8d9e-000000000005', name: 'pageTitle', props: { className: 'text-[48px] font-bold !text-[#111]' }, text: 'Dashboard' },
                { type: 'Text', id: 'b1c2d3e4-f5a6-4b7c-8d9e-000000000006', name: 'pageSubtitle', props: { className: 'text-[18px] !text-[#666]' }, text: 'Welcome back' }
              ]
            }
          ]
        }]
      }, null, 2),
    },
    turns: [
      'Add a red notification badge (a small red circle) to the top-right corner of the navigation bar. The badge should show the text "3".',
    ],
    check(files) {
      const issues = [];
      const pageFile = files['pages/Home/page'];
      if (!pageFile) { issues.push({ level: 'VIOLATION', msg: 'pages/Home/page not updated' }); return issues; }
      let page;
      try { page = JSON.parse(pageFile); } catch { issues.push({ level: 'VIOLATION', msg: 'pages/Home/page invalid JSON' }); return issues; }
      // Must have a red background box (badge)
      const hasRed = pageFile.includes('#ef4444') || pageFile.includes('#dc2626') || pageFile.includes('#f00') || pageFile.includes('#ff0000') || pageFile.includes('#e53e3e') || pageFile.includes('#ff4444') || /bg-\[#[ef][0-9a-f]{5}\]/.test(pageFile);
      if (!hasRed) issues.push({ level: 'VIOLATION', msg: 'No red badge color found — should add a red circle badge to the navbar' });
      // Text "3" should appear
      if (!pageFile.includes('"3"') && !pageFile.includes("'3'")) issues.push({ level: 'VIOLATION', msg: 'Badge text "3" not found' });
      return issues;
    },
  },

  {
    id: 80,
    label: 'REST datasource + pageLoad trigger + dynamic list',
    turns: [
      'Create a "Posts" page that fetches posts from https://jsonplaceholder.typicode.com/posts?_limit=5 on pageLoad. Store a "isLoading" boolean variable (default true). The pageLoad trigger workflow: sets isLoading=true, fetches the datasource, then sets isLoading=false. Show a loading text when isLoading is true, otherwise render the posts list using a map. Each post item shows the post title (context.item.data.title) in bold. Add the route.',
    ],
    check(files) {
      const issues = [];
      // Must create a datasource
      const dsFiles = Object.entries(files).filter(([p]) => p.startsWith('data/'));
      if (dsFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No datasource file created in data/' });
      else {
        const [, dsContent] = dsFiles[0];
        let ds; try { ds = JSON.parse(dsContent); } catch { issues.push({ level: 'VIOLATION', msg: 'Datasource file invalid JSON' }); }
        if (ds && !ds.url?.includes('jsonplaceholder')) issues.push({ level: 'VIOLATION', msg: 'Datasource URL does not point to jsonplaceholder API' });
      }
      // Must create a pageLoad trigger
      const triggerFiles = Object.entries(files).filter(([p]) => p.includes('/triggers/pageLoad') || p.includes('/triggers/page'));
      if (triggerFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No pageLoad trigger file created' });
      // Must create a store variable
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No store variable created (expected isLoading)' });
      // Page must exist with a map node
      const pageFile = files['pages/Posts/page'];
      if (!pageFile) { issues.push({ level: 'VIOLATION', msg: 'pages/Posts/page not created' }); return issues; }
      let page; try { page = JSON.parse(pageFile); } catch { issues.push({ level: 'VIOLATION', msg: 'pages/Posts/page invalid JSON' }); return issues; }
      function hasMapNode(node) {
        if (!node || typeof node !== 'object') return false;
        if (Array.isArray(node)) return node.some(hasMapNode);
        if (node.map) return true;
        if (node.children) return hasMapNode(node.children);
        return false;
      }
      if (!hasMapNode(page.ui)) issues.push({ level: 'VIOLATION', msg: 'No map node in pages/Posts/page — posts list should use map to render items' });
      // condition check for loading state
      const hasCondition = pageFile.includes('"condition"');
      if (!hasCondition) issues.push({ level: 'VIOLATION', msg: 'No conditional rendering found — loading text should use "condition" field' });
      return issues;
    },
  },
];

// ── Scenarios 81-84 ── multi-step, classFormulas, utils, complex search ──────
const EXTENDED_SCENARIOS_9 = [
  {
    id: 81,
    label: 'classFormulas — dynamic active tab styling',
    turns: [
      'Create a page with 3 navigation tabs: "Overview", "Features", "Pricing". Store the selected tab as a string variable (default "Overview"). Clicking each tab sets the variable. Use classFormulas on each tab Box to switch between active style (bg-[#6c47ff] !text-[#fff]) and inactive style (bg-[#f3f4f6] !text-[#111]) depending on the variable value.',
    ],
    check(files) {
      const issues = [];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No store variable created for selected tab' });
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('classFormulas')) issues.push({ level: 'VIOLATION', msg: 'No classFormulas found — tab active/inactive state should use classFormulas' });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No workflow created — each tab click should trigger a workflow to update the variable' });
      return issues;
    },
  },

  {
    id: 82,
    label: 'Multi-turn: add feature then add animation',
    turns: [
      'Create a simple card page with a single product card: name "Pro Plan", price "$49/mo", a short description, and a CTA button.',
      'Now add a scroll-triggered animation to the product card: slideInUp type, 500ms duration, threshold 0.2, once:true.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      // Must have animation with scroll type
      if (!pageContent.includes('"scroll"')) issues.push({ level: 'VIOLATION', msg: 'No scroll animation found — card should have props.animation.scroll' });
      if (!pageContent.includes('slideInUp')) issues.push({ level: 'VIOLATION', msg: 'No slideInUp animation type found' });
      if (!pageContent.includes('500')) issues.push({ level: 'VIOLATION', msg: 'Animation duration 500ms not found' });
      return issues;
    },
  },

  {
    id: 83,
    label: 'Utils formula + binding',
    turns: [
      'Create a product page that shows a price with a discount. Store two variables: originalPrice (number, 100) and discountPercent (number, 20). Create a utils formula "discountedPrice" with params originalPrice and discountPercent that returns the final price after discount. Display the original price and the discounted price on the page by calling the formula in a Text node expression.',
    ],
    check(files) {
      const issues = [];
      // Must create a utils formula
      const utilsFiles = Object.entries(files).filter(([p]) => p.startsWith('utils/'));
      if (utilsFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No utils formula created in utils/' });
      else {
        const [, utilsContent] = utilsFiles[0];
        let utils; try { utils = JSON.parse(utilsContent); } catch { issues.push({ level: 'VIOLATION', msg: 'Utils formula invalid JSON' }); }
        if (utils && !utils.formula) issues.push({ level: 'VIOLATION', msg: 'Utils formula missing "formula" field' });
        // params can be inline in arrow function formula — warn if missing but don't fail
        if (utils && (!utils.params || utils.params.length < 2) && utils.formula && !utils.formula.includes('=>')) issues.push({ level: 'WARN', msg: 'Utils formula has no separate params array — recommended to use { "params": [...], "formula": "..." } rather than an arrow function formula' });
      }
      // Must create 2 store variables
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variables — expected 2 (originalPrice, discountPercent)` });
      return issues;
    },
  },

  {
    id: 84,
    label: 'Multi-page search: find workflow across pages',
    initialFiles: {
      routes: JSON.stringify({ routes: [{ path: '/', config: 'Home' }, { path: '/profile', config: 'Profile' }] }, null, 2),
      'pages/Home/page': JSON.stringify({
        ui: [{ type: 'Box', id: 'c1d2e3f4-a5b6-4c7d-8e9f-000000000001', name: 'homeWrapper', props: { className: 'flex flex-col p-[48px]' },
          children: [{ type: 'Text', id: 'c1d2e3f4-a5b6-4c7d-8e9f-000000000002', name: 'homeTitle', props: { className: 'text-[32px] font-bold !text-[#111]' }, text: 'Home Page' }]
        }]
      }, null, 2),
      'pages/Profile/page': JSON.stringify({
        ui: [{ type: 'Box', id: 'd1e2f3a4-b5c6-4d7e-8f9a-000000000001', name: 'profileWrapper', props: { className: 'flex flex-col p-[48px]' },
          children: [{ type: 'Text', id: 'd1e2f3a4-b5c6-4d7e-8f9a-000000000002', name: 'profileTitle', props: { className: 'text-[32px] font-bold !text-[#111]' }, text: 'Profile Page' }]
        }]
      }, null, 2),
    },
    turns: [
      'Add a navigation bar to BOTH the Home and Profile pages. The navbar should have two links: "Home" (navigates to /) and "Profile" (navigates to /profile). Each link is a Box with a Text child. Clicking each navigates to the appropriate page.',
    ],
    check(files) {
      const issues = [];
      const homePage = files['pages/Home/page'];
      const profilePage = files['pages/Profile/page'];
      if (!homePage) issues.push({ level: 'VIOLATION', msg: 'pages/Home/page not updated' });
      if (!profilePage) issues.push({ level: 'VIOLATION', msg: 'pages/Profile/page not updated' });
      // Both pages should have nav workflows (navigateTo)
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${wfFiles.length} workflow(s) — expected at least 2 (one navigateTo for each page)` });
      // Check navigateTo steps
      const hasNavHome = wfFiles.some(([, c]) => c.includes('"navigateTo"') && c.includes('"/profiles"') || c.includes('"/"') || c.includes('"/home"') || c.includes('"/profile"'));
      if (wfFiles.length >= 2 && !wfFiles.some(([, c]) => c.includes('"navigateTo"'))) {
        issues.push({ level: 'VIOLATION', msg: 'No navigateTo step found in workflows' });
      }
      return issues;
    },
  },
];

// ── Scenarios 85-88 — deep search, conditions, form submit, responsive ───────
const EXTENDED_SCENARIOS_10 = [
  {
    id: 85,
    label: 'Deep semantic search — conceptual rename',
    initialFiles: {
      routes: JSON.stringify({ routes: [{ path: '/', config: 'Dashboard' }] }, null, 2),
      'pages/Dashboard/page': JSON.stringify({
        ui: [{
          type: 'Box', id: 'e1f2a3b4-c5d6-4e7f-8a9b-000000000001', name: 'dashWrapper',
          props: { className: 'flex flex-col p-[48px] bg-[#f9fafb]' },
          children: [
            { type: 'Box', id: 'e1f2a3b4-c5d6-4e7f-8a9b-000000000002', name: 'topBar', props: { className: 'flex flex-row items-center justify-between mb-[32px]' },
              children: [
                { type: 'Text', id: 'e1f2a3b4-c5d6-4e7f-8a9b-000000000003', name: 'pageHeading', props: { className: 'text-[32px] font-bold !text-[#111]' }, text: 'Analytics' },
                { type: 'Box', id: 'e1f2a3b4-c5d6-4e7f-8a9b-000000000004', name: 'userAvatarArea', props: { className: 'flex flex-row items-center gap-[12px]' },
                  children: [
                    { type: 'Box', id: 'e1f2a3b4-c5d6-4e7f-8a9b-000000000005', name: 'avatarCircle', props: { className: 'w-[40px] h-[40px] rounded-[50%] bg-[#6c47ff]' }, children: [] },
                    { type: 'Text', id: 'e1f2a3b4-c5d6-4e7f-8a9b-000000000006', name: 'userNameLabel', props: { className: 'text-[16px] font-medium !text-[#111]' }, text: 'John Doe' }
                  ]
                }
              ]
            },
            { type: 'Box', id: 'e1f2a3b4-c5d6-4e7f-8a9b-000000000007', name: 'kpiRow', props: { className: 'flex flex-row gap-[24px] mb-[32px]' },
              children: [
                { type: 'Box', id: 'e1f2a3b4-c5d6-4e7f-8a9b-000000000008', name: 'kpiCard1', props: { className: 'flex flex-col flex-1 p-[24px] bg-[#fff] rounded-[16px]' },
                  children: [
                    { type: 'Text', id: 'e1f2a3b4-c5d6-4e7f-8a9b-000000000009', name: 'kpiLabel1', props: { className: 'text-[14px] !text-[#666]' }, text: 'Total Revenue' },
                    { type: 'Text', id: 'e1f2a3b4-c5d6-4e7f-8a9b-000000000010', name: 'kpiValue1', props: { className: 'text-[32px] font-bold !text-[#111]' }, text: '$48,295' }
                  ]
                }
              ]
            }
          ]
        }]
      }, null, 2),
    },
    turns: [
      'Change the page heading text from "Analytics" to "Dashboard Overview". Also increase the font size of the KPI value (currently "$48,295") to 40px.',
    ],
    check(files) {
      const issues = [];
      const pageFile = files['pages/Dashboard/page'];
      if (!pageFile) { issues.push({ level: 'VIOLATION', msg: 'pages/Dashboard/page not updated' }); return issues; }
      if (!pageFile.includes('Dashboard Overview')) issues.push({ level: 'VIOLATION', msg: 'Page heading not updated to "Dashboard Overview"' });
      if (!pageFile.includes('40px') && !pageFile.includes('text-[40px]')) issues.push({ level: 'VIOLATION', msg: 'KPI value font size not changed to 40px' });
      return issues;
    },
  },

  {
    id: 86,
    label: 'Multi-file grep update — change color across files',
    initialFiles: {
      routes: JSON.stringify({ routes: [{ path: '/', config: 'Home' }, { path: '/about', config: 'About' }] }, null, 2),
      'pages/Home/page': JSON.stringify({
        ui: [{ type: 'Box', id: 'f1a2b3c4-d5e6-4f7a-8b9c-000000000001', name: 'homeWrapper', props: { className: 'flex flex-col' }, children: [
          { type: 'Box', id: 'f1a2b3c4-d5e6-4f7a-8b9c-000000000002', name: 'heroCTA', props: { className: 'bg-[#ff4500] rounded-[12px] px-[32px] py-[16px]' }, children: [
            { type: 'Text', id: 'f1a2b3c4-d5e6-4f7a-8b9c-000000000003', props: { className: '!text-[#fff] font-bold' }, text: 'Start Free Trial' }
          ]}
        ]}]
      }, null, 2),
      'pages/About/page': JSON.stringify({
        ui: [{ type: 'Box', id: 'a2b3c4d5-e6f7-4a8b-9c0d-000000000001', name: 'aboutWrapper', props: { className: 'flex flex-col' }, children: [
          { type: 'Box', id: 'a2b3c4d5-e6f7-4a8b-9c0d-000000000002', name: 'contactCTA', props: { className: 'bg-[#ff4500] rounded-[12px] px-[24px] py-[12px]' }, children: [
            { type: 'Text', id: 'a2b3c4d5-e6f7-4a8b-9c0d-000000000003', props: { className: '!text-[#fff] font-semibold' }, text: 'Contact Us' }
          ]}
        ]}]
      }, null, 2),
    },
    turns: [
      'Change all orange buttons (bg-[#ff4500]) on both the Home and About pages to indigo (bg-[#4f46e5]).',
    ],
    check(files) {
      const issues = [];
      const homePage = files['pages/Home/page'];
      const aboutPage = files['pages/About/page'];
      if (!homePage) issues.push({ level: 'VIOLATION', msg: 'pages/Home/page not updated' });
      if (!aboutPage) issues.push({ level: 'VIOLATION', msg: 'pages/About/page not updated' });
      if (homePage && homePage.includes('#ff4500')) issues.push({ level: 'VIOLATION', msg: 'Old orange color #ff4500 still in pages/Home/page' });
      if (aboutPage && aboutPage.includes('#ff4500')) issues.push({ level: 'VIOLATION', msg: 'Old orange color #ff4500 still in pages/About/page' });
      if (homePage && !homePage.includes('#4f46e5')) issues.push({ level: 'VIOLATION', msg: 'Indigo #4f46e5 not applied to pages/Home/page' });
      if (aboutPage && !aboutPage.includes('#4f46e5')) issues.push({ level: 'VIOLATION', msg: 'Indigo #4f46e5 not applied to pages/About/page' });
      return issues;
    },
  },

  {
    id: 87,
    label: 'Form with submit workflow — contact form',
    turns: [
      'Create a contact form page with: name input, email input, message textarea, and a submit button. Store the three field values as variables (bound to the inputs). Add a "submitted" boolean variable (default false). On submit: set submitted=true, then reset name/email/message variables to empty string using resetVariableValue or changeVariableValue. Conditionally show a success text "Message sent successfully!" when submitted=true.',
    ],
    check(files) {
      const issues = [];
      // At least 3 store variables (name, email, message; "submitted" is a bonus)
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 3) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variables — expected at least 3 (name, email, message)` });
      // At least one page workflow for submit
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No workflow created for form submit' });
      else {
        const allWfContent = wfFiles.map(([, c]) => c).join('\n');
        // reset: changeVariableValue with empty value OR resetVariableValue
        const hasReset = allWfContent.includes('"resetVariableValue"') || (allWfContent.includes('"changeVariableValue"') && (allWfContent.includes('""') || allWfContent.includes("''")));
        if (!hasReset) issues.push({ level: 'VIOLATION', msg: 'No form reset found in submit workflow — should use resetVariableValue or changeVariableValue with ""' });
      }
      // Page must have Input + Textarea nodes
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"Input"')) issues.push({ level: 'VIOLATION', msg: 'No Input nodes in form page' });
      if (!pageContent.includes('"Textarea"')) issues.push({ level: 'VIOLATION', msg: 'No Textarea node for message field' });
      // Success message should be conditionally shown
      if (!pageContent.includes('"condition"') && !pageContent.includes('submitted')) {
        issues.push({ level: 'VIOLATION', msg: 'Success message not conditionally rendered (no "condition" or "submitted" variable reference found)' });
      }
      return issues;
    },
  },

  {
    id: 88,
    label: 'Responsive layout — show/hide sections per breakpoint',
    turns: [
      'Create a page with a top navigation bar. On desktop, the nav shows 4 text links inline. On mobile (sm breakpoint), hide the desktop links and show a menu icon button instead. Use the responsive skill to handle breakpoints.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      // Must use the responsive key (NOT Tailwind prefixes — engine uses its own responsive object)
      // Expect nodes to have "responsive": { "mobile": { ... } } or similar breakpoint overrides
      const hasResponsive = pageContent.includes('"responsive"') || pageContent.includes('"mobile"') || pageContent.includes('"tablet"') || pageContent.includes('"laptop"');
      if (!hasResponsive) issues.push({ level: 'VIOLATION', msg: 'No responsive overrides found — use the node "responsive" key with breakpoint objects (mobile, tablet, laptop) to show/hide at different screen sizes. Do NOT use sm:/md: Tailwind prefixes.' });
      return issues;
    },
  },
];

// ── Scenarios 89-96 ── app triggers, global wf, group edit, conditions, e-comm
const EXTENDED_SCENARIOS_11 = [
  {
    id: 89,
    label: 'E-commerce product listing — filter state + map render',
    turns: [
      'Create a product listing page with: a search/filter bar at the top (store variable "filterText" string), and a product grid using a map node. Each product item (context.item.data) shows an image (use search_images), name (context.item.data.name), price (context.item.data.price), and an "Add to Cart" button. Add the route.',
    ],
    check(files) {
      const issues = [];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No store variable created for filterText' });
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"map"')) issues.push({ level: 'VIOLATION', msg: 'No map node found — product grid should use map to render items' });
      if (!pageContent.includes('context.item.data')) issues.push({ level: 'VIOLATION', msg: 'No context.item.data access — map item data not referenced' });
      if (!pageContent.includes('"Input"')) issues.push({ level: 'VIOLATION', msg: 'No Input node for search/filter bar' });
      const routeFile = files['routes'];
      if (!routeFile) issues.push({ level: 'VIOLATION', msg: 'No routes file updated' });
      return issues;
    },
  },

  {
    id: 90,
    label: 'App-level appLoad trigger — init global state',
    turns: [
      'Create an app-level appLoad trigger that initializes two global store variables: "appReady" (boolean, default false) and "currentUser" (object, default null). The trigger workflow should: set appReady=true, then set currentUser to the JS object { id: "guest", name: "Guest User", role: "viewer" }.',
    ],
    check(files) {
      const issues = [];
      // Must have 2 store variables
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variables — expected 2 (appReady, currentUser)` });
      // Must have an appLoad trigger
      const triggerFiles = Object.entries(files).filter(([p]) => p.includes('triggers/appLoad') || (p.startsWith('triggers/') && p.includes('appLoad')));
      if (triggerFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No appLoad trigger file created — expected at triggers/appLoad' });
      else {
        const [, triggerContent] = triggerFiles[0];
        let trig; try { trig = JSON.parse(triggerContent); } catch { issues.push({ level: 'VIOLATION', msg: 'appLoad trigger invalid JSON' }); }
        if (trig && trig.meta?.trigger !== 'appLoad') issues.push({ level: 'VIOLATION', msg: `Trigger meta.trigger is "${trig?.meta?.trigger}" — expected "appLoad"` });
        if (trig && trig.meta?.isAppTrigger !== true) issues.push({ level: 'VIOLATION', msg: 'Trigger meta.isAppTrigger must be true for app-level triggers' });
        // Should have 2 changeVariableValue steps
        const allContent = JSON.stringify(trig?.steps ?? []);
        if (!allContent.includes('changeVariableValue')) issues.push({ level: 'VIOLATION', msg: 'Trigger workflow missing changeVariableValue steps' });
      }
      return issues;
    },
  },

  {
    id: 91,
    label: 'Global reusable workflow — create and use from page',
    turns: [
      'Create a global reusable workflow called "showSuccessToast" that sets a global store variable "toastMessage" (string) to "Action completed successfully!" and a "toastVisible" boolean variable to true. Then create a simple page with a button that, when clicked, triggers this global workflow.',
    ],
    check(files) {
      const issues = [];
      // Global workflow in workflows/ (not pages/)
      const globalWfs = Object.entries(files).filter(([p]) => p.startsWith('workflows/') && !p.startsWith('workflows/pages/'));
      if (globalWfs.length < 1) issues.push({ level: 'VIOLATION', msg: 'No global workflow created in workflows/' });
      else {
        const [, wfContent] = globalWfs[0];
        let wf; try { wf = JSON.parse(wfContent); } catch { issues.push({ level: 'VIOLATION', msg: 'Global workflow invalid JSON' }); }
        // Global workflows must NOT have meta.pageScope
        if (wf?.meta?.pageScope) issues.push({ level: 'VIOLATION', msg: 'Global workflow has meta.pageScope — global workflows must not have pageScope' });
      }
      // 2 store variables
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variables — expected 2 (toastMessage, toastVisible)` });
      // Page must exist with a button that delegates to global workflow
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length > 0 && globalWfs.length > 0) {
        const pageContent = pageEntries[0][1];
        const globalWfId = JSON.parse(globalWfs[0][1])?.id;
        if (globalWfId && !pageContent.includes(globalWfId)) {
          issues.push({ level: 'VIOLATION', msg: `Page button does not reference global workflow id "${globalWfId}" — button action must delegate to the global workflow` });
        }
      }
      return issues;
    },
  },

  {
    id: 92,
    label: 'Deep group edit — find node inside _group and update',
    initialFiles: {
      routes: JSON.stringify({ routes: [{ path: '/', config: 'Landing' }] }, null, 2),
      'pages/Landing/page': JSON.stringify({
        ui: [{
          type: 'Box', id: 'c3d4e5f6-a7b8-4c9d-0e1f-000000000001', name: 'pageRoot',
          props: { className: 'flex flex-col' },
          children: [
            { _group: 'Hero', type: 'Box', id: 'c3d4e5f6-a7b8-4c9d-0e1f-000000000002', name: 'heroSection',
              props: { className: 'flex flex-col items-center justify-center min-h-[100vh] bg-[#0a0a0a]' },
              children: [
                { type: 'Text', id: 'c3d4e5f6-a7b8-4c9d-0e1f-000000000003', name: 'heroTitle', props: { className: 'text-[64px] font-bold !text-[#fff]' }, text: 'Old Headline' },
                { type: 'Box', id: 'c3d4e5f6-a7b8-4c9d-0e1f-000000000004', name: 'heroCTA', props: { className: 'bg-[#6c47ff] rounded-[12px] px-[32px] py-[16px] mt-[32px] cursor-pointer' }, children: [
                  { type: 'Text', id: 'c3d4e5f6-a7b8-4c9d-0e1f-000000000005', props: { className: '!text-[#fff] font-semibold text-[18px]' }, text: 'Get Started' }
                ]}
              ]
            },
            { _group: 'Footer', type: 'Box', id: 'c3d4e5f6-a7b8-4c9d-0e1f-000000000006', name: 'footerSection',
              props: { className: 'flex flex-col items-center py-[48px] bg-[#111]' },
              children: [
                { type: 'Text', id: 'c3d4e5f6-a7b8-4c9d-0e1f-000000000007', name: 'footerCopy', props: { className: 'text-[14px] !text-[#888]' }, text: '© 2024 Company' }
              ]
            }
          ]
        }]
      }, null, 2),
    },
    turns: [
      'Update the hero section: change the headline text from "Old Headline" to "The Future is Now". Also change the CTA button background from purple (#6c47ff) to red (#ef4444). Leave the footer unchanged.',
    ],
    check(files) {
      const issues = [];
      const pageFile = files['pages/Landing/page'];
      if (!pageFile) { issues.push({ level: 'VIOLATION', msg: 'pages/Landing/page not updated' }); return issues; }
      if (!pageFile.includes('The Future is Now')) issues.push({ level: 'VIOLATION', msg: 'Hero headline not updated to "The Future is Now"' });
      if (pageFile.includes('#6c47ff')) issues.push({ level: 'VIOLATION', msg: 'Old purple CTA color #6c47ff still present' });
      if (!pageFile.includes('#ef4444')) issues.push({ level: 'VIOLATION', msg: 'New red CTA color #ef4444 not found' });
      // Footer must still have its copyright text
      if (!pageFile.includes('© 2024 Company')) issues.push({ level: 'VIOLATION', msg: 'Footer copyright text was removed — only hero should be changed' });
      return issues;
    },
  },

  {
    id: 93,
    label: 'Branch step — conditional workflow with true/false path',
    turns: [
      'Create a page with a "Check Stock" button. Store a boolean variable "inStock" (default true). Clicking the button triggers a workflow with a branch step: if inStock is true, set a "statusMessage" string variable to "Item is available!", otherwise set it to "Out of stock". Show the statusMessage in a Text node on the page.',
    ],
    check(files) {
      const issues = [];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variables — expected at least 2 (inStock, statusMessage)` });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No workflow created' });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('"branch"')) issues.push({ level: 'VIOLATION', msg: 'No branch step found in workflow — conditional logic must use branch step type' });
        if (!allContent.includes('trueBranch')) issues.push({ level: 'VIOLATION', msg: 'Branch step missing trueBranch array' });
        if (!allContent.includes('falseBranch')) issues.push({ level: 'VIOLATION', msg: 'Branch step missing falseBranch array' });
      }
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      return issues;
    },
  },

  {
    id: 94,
    label: 'Theme customization — design/theme file',
    turns: [
      'Update the design theme to use a dark color scheme: set the primary color to #6c47ff, background to #0a0a0a, surface to #1a1a2e, text to #ffffff, and border-radius to 12px. Write the design/theme file.',
    ],
    check(files) {
      const issues = [];
      const themeFile = files['design/theme'];
      if (!themeFile) { issues.push({ level: 'VIOLATION', msg: 'design/theme file not written' }); return issues; }
      let theme; try { theme = JSON.parse(themeFile); } catch { issues.push({ level: 'VIOLATION', msg: 'design/theme invalid JSON' }); return issues; }
      // Should contain color values (flexible check — any theme object)
      const themeStr = JSON.stringify(theme);
      if (!themeStr.includes('#6c47ff') && !themeStr.includes('6c47ff')) issues.push({ level: 'VIOLATION', msg: 'Primary color #6c47ff not found in theme' });
      if (!themeStr.includes('#0a0a0a') && !themeStr.includes('0a0a0a')) issues.push({ level: 'VIOLATION', msg: 'Background color #0a0a0a not found in theme' });
      return issues;
    },
  },

  {
    id: 95,
    label: 'Full dashboard page — KPI cards + activity list',
    turns: [
      'Create a full Admin Dashboard page with: (1) a top header bar with page title "Dashboard" and a user avatar area. (2) a row of 4 KPI stat cards: Total Users, Revenue, Active Sessions, Conversion Rate — each card has a label, a value (hardcoded placeholder), and a trend indicator text (e.g., "+12%"). (3) a recent activity section with a map node showing activity items. Add the route.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      // Must have at least 4 KPI-like cards (look for 4 occurrences of "card" or the 4 metrics)
      const hasStats = ['Users', 'Revenue', 'Sessions', 'Conversion'].some(kw => pageContent.includes(kw)) ||
        (pageContent.match(/card/gi) ?? []).length >= 4;
      if (!hasStats) issues.push({ level: 'VIOLATION', msg: 'KPI cards not found — should have 4 stat cards (Total Users, Revenue, Active Sessions, Conversion Rate)' });
      if (!pageContent.includes('"map"')) issues.push({ level: 'VIOLATION', msg: 'No map node found — activity list should use map to render items' });
      const routeFile = files['routes'];
      if (!routeFile) issues.push({ level: 'VIOLATION', msg: 'No routes file updated' });
      return issues;
    },
  },

  {
    id: 96,
    label: 'Multi-turn 3 turns: create + semantic search + refine',
    turns: [
      'Create a pricing page with two plan cards: "Starter" ($9/mo, 3 features) and "Pro" ($29/mo, 6 features). Add the route.',
      'Find the Starter plan card and add a "Most Popular" badge to the Pro plan card instead. The badge should be a small rounded Box with text "Most Popular" and a purple background.',
      'Now increase the Pro plan price text to "$49/mo" and add a subtle box shadow to both cards using props.style.boxShadow.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('Most Popular')) issues.push({ level: 'VIOLATION', msg: '"Most Popular" badge not added to Pro plan card' });
      if (!pageContent.includes('$49')) issues.push({ level: 'VIOLATION', msg: 'Pro plan price not updated to $49/mo' });
      if (!pageContent.includes('boxShadow')) issues.push({ level: 'VIOLATION', msg: 'No props.style.boxShadow found on cards' });
      return issues;
    },
  },
];

// ── Scenarios 97-104 ── condition, forEach, multiOptionBranch, timeDelay, Video
const EXTENDED_SCENARIOS_12 = [
  {
    id: 97,
    label: 'Node condition field — show/hide nodes based on variable',
    turns: [
      'Create a page with a toggle button. Store a boolean variable "showDetails" (default false). Clicking the button sets showDetails to !showDetails. Show a details panel (Box with some Text) only when showDetails is true — use the node-level "condition" field with a JS expression. The button text should always be visible.',
    ],
    check(files) {
      const issues = [];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No store variable created for showDetails' });
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"condition"')) issues.push({ level: 'VIOLATION', msg: 'No "condition" field found on any node — details panel should use node-level condition' });
      // condition should reference the variable id
      const storeId = storeFiles[0]?.[0]?.replace('store/', '');
      if (storeId && !pageContent.includes(storeId)) {
        issues.push({ level: 'VIOLATION', msg: `Condition does not reference store variable id "${storeId}" — condition expression must use the variable UUID` });
      }
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No toggle workflow created' });
      return issues;
    },
  },

  {
    id: 98,
    label: 'forEach step — process array in workflow',
    turns: [
      'Create a page with a "Process Items" button. Store an array variable "items" (default value: [1, 2, 3, 4, 5]) and a "total" number variable (default 0). Clicking the button runs a workflow with a forEach step that iterates over the items array and for each item adds context.item to the total using a changeVariableValue step. Display the total in a Text node.',
    ],
    check(files) {
      const issues = [];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variables — expected 2 (items, total)` });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No workflow created' });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('"forEach"')) issues.push({ level: 'VIOLATION', msg: 'No forEach step found — workflow must use forEach to iterate the array' });
        if (!allContent.includes('loopBody')) issues.push({ level: 'VIOLATION', msg: 'forEach step missing loopBody array' });
      }
      return issues;
    },
  },

  {
    id: 99,
    label: 'multiOptionBranch — multi-case status routing',
    turns: [
      'Create a page with a status selector. Store a "orderStatus" string variable (default "pending"). When a workflow runs, use a multiOptionBranch step: if orderStatus is "pending" set a "statusColor" variable to "#f59e0b", if "shipped" set it to "#3b82f6", if "delivered" set it to "#22c55e". Show the statusColor as the background of a status badge Box on the page.',
    ],
    check(files) {
      const issues = [];
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No workflow created' });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('"multiOptionBranch"')) issues.push({ level: 'VIOLATION', msg: 'No multiOptionBranch step found — must use multiOptionBranch for multi-case logic' });
        if (!allContent.includes('"branches"')) issues.push({ level: 'VIOLATION', msg: 'multiOptionBranch missing "branches" array' });
        const branchCount = (allContent.match(/"label"/g) ?? []).length;
        if (branchCount < 3) issues.push({ level: 'VIOLATION', msg: `Only ${branchCount} branch labels found — expected 3 (pending, shipped, delivered)` });
      }
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variables — expected 2 (orderStatus, statusColor)` });
      return issues;
    },
  },

  {
    id: 100,
    label: 'Video node — search and embed',
    turns: [
      'Create a media showcase page with a hero video background and below it an image gallery with 3 images (search for each). Add the route.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"Video"')) issues.push({ level: 'VIOLATION', msg: 'No Video node found — page should have a hero video' });
      if (!pageContent.includes('"Image"')) issues.push({ level: 'VIOLATION', msg: 'No Image nodes found — gallery should have 3 images' });
      const imgCount = (pageContent.match(/"Image"/g) ?? []).length;
      if (imgCount < 3) issues.push({ level: 'VIOLATION', msg: `Only ${imgCount} Image node(s) found — expected at least 3 in the gallery` });
      const routeFile = files['routes'];
      if (!routeFile) issues.push({ level: 'VIOLATION', msg: 'No routes file updated' });
      return issues;
    },
  },

  {
    id: 101,
    label: 'Full multi-page SaaS app — 3 pages shared nav',
    turns: [
      'Build a 3-page SaaS app: (1) Home page — hero section with headline and CTA, (2) Features page — 3 feature cards with icons, (3) Contact page — a simple contact form (name, email, message, submit button). All 3 pages share a navigation bar at the top with links to each page. Create a shared global "navigateTo" workflow for each nav link. Add all routes.',
    ],
    check(files) {
      const issues = [];
      // All 3 pages must exist
      const homeExists = files['pages/Home/page'] || Object.keys(files).some(p => p.match(/pages\/Home\/page/i));
      const featuresExists = Object.keys(files).some(p => p.match(/pages\/Features\/page/i));
      const contactExists = Object.keys(files).some(p => p.match(/pages\/Contact\/page/i));
      if (!homeExists) issues.push({ level: 'VIOLATION', msg: 'Home page not created' });
      if (!featuresExists) issues.push({ level: 'VIOLATION', msg: 'Features page not created' });
      if (!contactExists) issues.push({ level: 'VIOLATION', msg: 'Contact page not created' });
      // routes
      const routeFile = files['routes'];
      if (!routeFile) issues.push({ level: 'VIOLATION', msg: 'routes file not updated' });
      else {
        let routes; try { routes = JSON.parse(routeFile); } catch { /* ignore */ }
        if ((routes?.routes?.length ?? 0) < 3) issues.push({ level: 'VIOLATION', msg: `Only ${routes?.routes?.length ?? 0} route(s) — expected 3` });
      }
      // navigation workflows
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/') || p.startsWith('workflows/'));
      if (wfFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${wfFiles.length} workflow(s) — expected at least 2 nav workflows` });
      return issues;
    },
  },

  {
    id: 102,
    label: 'timeDelay step — delayed state transition',
    turns: [
      'Create a page with a "Send" button. When clicked, the button workflow: sets a "sending" boolean variable to true, waits 2000ms using a timeDelay step, then sets "sending" to false and sets "sent" boolean to true. Show "Sending..." text when sending=true, show "Message Sent ✓" text when sent=true (use the condition field on each Text node).',
    ],
    check(files) {
      const issues = [];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variables — expected 2 (sending, sent)` });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No workflow created' });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('"timeDelay"')) issues.push({ level: 'VIOLATION', msg: 'No timeDelay step found — should use timeDelay to wait 2000ms' });
        if (!allContent.includes('2000')) issues.push({ level: 'VIOLATION', msg: 'timeDelay duration 2000ms not found' });
      }
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length > 0) {
        const pageContent = pageEntries[0][1];
        if (!pageContent.includes('"condition"')) issues.push({ level: 'VIOLATION', msg: 'No condition field on nodes — status text nodes should use condition to show/hide' });
      }
      return issues;
    },
  },

  {
    id: 103,
    label: 'Map + classFormulas — selected item highlight',
    turns: [
      'Create a page with a list of items rendered via a map node. Store a "selectedId" variable (string, default ""). Each item in the list is a Box with a Text showing context.item.data.label. Clicking an item sets selectedId to context.item.data.id. Use classFormulas on each item Box: active item (context.item.data.id === variables[selectedIdVarUUID]) gets bg-[#6c47ff] !text-[#fff], inactive gets bg-[#f3f4f6] !text-[#111].',
    ],
    check(files) {
      const issues = [];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No store variable created for selectedId' });
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"map"')) issues.push({ level: 'VIOLATION', msg: 'No map node found — list should use map node' });
      if (!pageContent.includes('classFormulas')) issues.push({ level: 'VIOLATION', msg: 'No classFormulas found — selected item styling must use classFormulas' });
      if (!pageContent.includes('context.item.data')) issues.push({ level: 'VIOLATION', msg: 'No context.item.data access found' });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No click workflow for setting selectedId' });
      return issues;
    },
  },

  {
    id: 104,
    label: 'Full page — multi-step wizard with page navigation',
    turns: [
      'Create a 3-step onboarding wizard on a single page. Store a "currentStep" number variable (default 1). Show step 1 content (name + email inputs) when currentStep=1, step 2 content (role selection as 3 buttons) when currentStep=2, step 3 content (a summary Text + confirm button) when currentStep=3. Use the condition field on each step container. "Next" button increments currentStep, "Back" decrements. Show a progress indicator (3 dots) with the current dot highlighted using classFormulas.',
    ],
    check(files) {
      const issues = [];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      const hasStep = storeFiles.some(([, c]) => {
        let v; try { v = JSON.parse(c); } catch { return false; }
        return v.name === 'currentStep' || (v.type === 'Number' || v.initialValue === 1);
      });
      if (!hasStep && storeFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No currentStep variable created' });
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"condition"')) issues.push({ level: 'VIOLATION', msg: 'No condition field found — each step should be conditionally shown' });
      if (!pageContent.includes('classFormulas')) issues.push({ level: 'VIOLATION', msg: 'No classFormulas found — progress dots should use classFormulas for active highlight' });
      // Should have Next and Back workflows
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${wfFiles.length} workflow(s) — expected at least 2 (next, back)` });
      return issues;
    },
  },
];

// ── Scenarios 105-112 ── FormContainer, whileLoop, hover, store-folders, auth
const EXTENDED_SCENARIOS_13 = [
  {
    id: 105,
    label: 'FormContainer — login form with validation',
    turns: [
      'Create a login page with a FormContainer. Inside it: an email Input with _validation {required:true, type:"email"} and a password Input with _validation {required:true, minLength:8}. A submit Box (props.type:"submit") with Text "Sign In". The form background should be white with rounded corners. Add the route.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"FormContainer"')) issues.push({ level: 'VIOLATION', msg: 'No FormContainer node — login form must use FormContainer' });
      if (!pageContent.includes('_validation')) issues.push({ level: 'VIOLATION', msg: 'No _validation field on inputs — email and password should have _validation' });
      if (!pageContent.includes('"required"') && !pageContent.includes("'required'")) issues.push({ level: 'VIOLATION', msg: 'No required validation found' });
      if (!pageContent.includes('"submit"')) issues.push({ level: 'VIOLATION', msg: 'No submit button — FormContainer needs a Box with props.type:"submit"' });
      if (!pageContent.includes('"email"')) issues.push({ level: 'VIOLATION', msg: 'Email Input type not found — should have type:"email" validation' });
      return issues;
    },
  },

  {
    id: 106,
    label: 'whileLoop step — countdown workflow',
    turns: [
      'Create a page with a "Start Countdown" button. Store a "counter" number variable (default 5). Clicking the button runs a workflow with a whileLoop step: while counter > 0, decrement counter by 1 using a changeVariableValue step. Display the current counter value in a large Text node.',
    ],
    check(files) {
      const issues = [];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No store variable for counter' });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No workflow created' });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('"whileLoop"')) issues.push({ level: 'VIOLATION', msg: 'No whileLoop step found — countdown must use whileLoop' });
        if (!allContent.includes('loopBody')) issues.push({ level: 'VIOLATION', msg: 'whileLoop step missing loopBody array' });
        if (!allContent.includes('"condition"') && !allContent.includes("condition")) issues.push({ level: 'VIOLATION', msg: 'whileLoop missing condition' });
      }
      return issues;
    },
  },

  {
    id: 107,
    label: 'Store folders — grouped variables in a namespace',
    turns: [
      'Create a settings page. Store user settings using store folder paths: store/settings/<uuid> for theme (string, default "light") and store/settings/<uuid> for language (string, default "en"). Add a settings card showing current theme and language, and two buttons that toggle each setting.',
    ],
    check(files) {
      const issues = [];
      // Must create store variables in a folder (store/settings/<uuid>)
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      const folderedVars = storeFiles.filter(([p]) => p.split('/').length > 2);
      if (folderedVars.length < 2) {
        issues.push({ level: 'VIOLATION', msg: `Only ${folderedVars.length} foldered store variable(s) — expected 2 in store/settings/<uuid> format` });
      } else {
        // All foldered vars should be in same folder
        const folder = folderedVars[0][0].split('/')[1];
        if (folder !== 'settings') issues.push({ level: 'VIOLATION', msg: `Store folder is "${folder}" — expected "settings"` });
      }
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${wfFiles.length} workflow(s) — expected 2 toggle workflows` });
      return issues;
    },
  },

  {
    id: 108,
    label: 'Hover animation — props.animation.hover (no hover: className)',
    turns: [
      'Create a card gallery page with 3 cards. Each card should have a hover animation: scale up to 1.05, 200ms duration, ease-out easing. Use props.animation.hover — NEVER use hover: className prefixes. Each card has an icon (search for it), title, and description.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      // Must use props.animation.hover
      if (!pageContent.includes('"hover"')) issues.push({ level: 'VIOLATION', msg: 'No hover animation found — cards should use props.animation.hover' });
      // Must NOT use hover: className prefix
      if (/hover:[a-z]/.test(pageContent)) issues.push({ level: 'VIOLATION', msg: 'hover: className prefix found — blacklisted, use props.animation.hover instead' });
      if (!pageContent.includes('scale') && !pageContent.includes('1.05')) issues.push({ level: 'VIOLATION', msg: 'Hover scale animation not found (expected scale: 1.05)' });
      return issues;
    },
  },

  {
    id: 109,
    label: 'Deep codebase_search — find across a large existing app',
    initialFiles: (() => {
      const makeNode = (id, name, text, color) => ({ type: 'Text', id, name, props: { className: `text-[18px] font-medium !text-[${color}]` }, text });
      return {
        routes: JSON.stringify({ routes: [{ path: '/', config: 'Home' }, { path: '/about', config: 'About' }, { path: '/pricing', config: 'Pricing' }] }, null, 2),
        'pages/Home/page': JSON.stringify({ ui: [{ type: 'Box', id: 'a0000001-0000-4000-0000-000000000001', name: 'homeWrapper', props: { className: 'flex flex-col p-[48px] bg-[#fff]' }, children: [makeNode('a0000001-0000-4000-0000-000000000002', 'homeTitle', 'Welcome to Our Platform', '#111'), makeNode('a0000001-0000-4000-0000-000000000003', 'homeSubtitle', 'The best solution for your needs', '#666')] }] }, null, 2),
        'pages/About/page': JSON.stringify({ ui: [{ type: 'Box', id: 'b0000001-0000-4000-0000-000000000001', name: 'aboutWrapper', props: { className: 'flex flex-col p-[48px] bg-[#fff]' }, children: [makeNode('b0000001-0000-4000-0000-000000000002', 'aboutTitle', 'About Us', '#111'), makeNode('b0000001-0000-4000-0000-000000000003', 'missionText', 'We are a team of passionate builders', '#666')] }] }, null, 2),
        'pages/Pricing/page': JSON.stringify({ ui: [{ type: 'Box', id: 'c0000001-0000-4000-0000-000000000001', name: 'pricingWrapper', props: { className: 'flex flex-col p-[48px] bg-[#f9fafb]' }, children: [makeNode('c0000001-0000-4000-0000-000000000002', 'pricingTitle', 'Simple Pricing', '#111'), makeNode('c0000001-0000-4000-0000-000000000003', 'pricingSubtitle', 'Start for free, scale as you grow', '#666')] }] }, null, 2),
      };
    })(),
    turns: [
      'Find all pages that have a subtitle text node and update the text color from #666 to #4b5563 on ALL of them.',
    ],
    check(files) {
      const issues = [];
      // All 3 pages should be updated
      const updatedFiles = Object.keys(files).filter(p => p.startsWith('pages/') && p.endsWith('/page'));
      if (updatedFiles.length < 3) issues.push({ level: 'VIOLATION', msg: `Only ${updatedFiles.length} page(s) updated — all 3 pages have subtitle nodes and should be updated` });
      // Old color should be gone, new color present
      const allContent = Object.entries(files).filter(([p]) => p.startsWith('pages/')).map(([, c]) => c).join('\n');
      if (allContent.includes('#666')) issues.push({ level: 'VIOLATION', msg: 'Old color #666 still present in at least one page — all subtitle nodes should be updated' });
      if (!allContent.includes('#4b5563')) issues.push({ level: 'VIOLATION', msg: 'New color #4b5563 not found — pages should use updated color' });
      return issues;
    },
  },

  {
    id: 110,
    label: 'Auth workflow — authenticate + navigate on success',
    turns: [
      'Create a sign-in page with email and password inputs (store variables) and a "Sign In" button. The button workflow: runs a branch step — if both email and password are non-empty, use the authenticate step with config.accessToken: {js: "btoa(variables[emailVarId] + \':\' + variables[passwordVarId])"} and config.user: {js: "{email: variables[emailVarId], role: \'user\'}"} then navigate to "/" — else set an "errorMessage" string variable to "Please fill in all fields". Show the error message conditionally.',
    ],
    check(files) {
      const issues = [];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variables — expected at least 2 (email, password)` });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No workflow created' });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('"authenticate"')) issues.push({ level: 'VIOLATION', msg: 'No authenticate step found — sign-in should use authenticate step' });
        if (!allContent.includes('"branch"')) issues.push({ level: 'VIOLATION', msg: 'No branch step — workflow should check if fields are non-empty before authenticating' });
        if (!allContent.includes('"navigateTo"')) issues.push({ level: 'VIOLATION', msg: 'No navigateTo step — should navigate to "/" after successful auth' });
      }
      return issues;
    },
  },

  {
    id: 111,
    label: 'Scroll animations — staggered entrance on page sections',
    turns: [
      'Create a landing page with 4 sections (Hero, Features, Testimonials, CTA). Each section should have a scroll entrance animation: section 1 — fadeIn, section 2 — slideInLeft, section 3 — slideInRight, section 4 — slideInUp. All with 600ms duration, once:true, threshold:0.2. Add the route.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"scroll"')) issues.push({ level: 'VIOLATION', msg: 'No scroll animation found — sections should use props.animation.scroll' });
      if (!pageContent.includes('600')) issues.push({ level: 'VIOLATION', msg: 'Animation duration 600ms not found' });
      if (!pageContent.includes('once')) issues.push({ level: 'VIOLATION', msg: 'once:true not found in scroll animation' });
      if (!pageContent.includes('fadeIn')) issues.push({ level: 'VIOLATION', msg: 'fadeIn animation not found for hero section' });
      if (!pageContent.includes('slideInLeft') && !pageContent.includes('slideIn')) issues.push({ level: 'VIOLATION', msg: 'No slideIn animation found for features/testimonials sections' });
      return issues;
    },
  },

  {
    id: 112,
    label: 'navigatePrev + external link — back button and mailto',
    turns: [
      'Create a detail page with a "Back" button that uses navigatePrev step to go back in history (with config.defaultPath: "/"). Also add a "Contact Support" link that opens "mailto:support@example.com" in a new tab using navigateTo with linkType:"external". Add the route.',
    ],
    check(files) {
      const issues = [];
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${wfFiles.length} workflow(s) — expected 2 (navigatePrev, external navigateTo)` });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('"navigatePrev"')) issues.push({ level: 'VIOLATION', msg: 'No navigatePrev step found — back button must use navigatePrev' });
        if (!allContent.includes('"external"')) issues.push({ level: 'VIOLATION', msg: 'No external link found — contact link should use navigateTo with linkType:"external"' });
        if (!allContent.includes('mailto')) issues.push({ level: 'VIOLATION', msg: 'No mailto URL found in external link' });
        if (!allContent.includes('newTab') && !allContent.includes('new_tab') && !allContent.includes('"newTab"')) issues.push({ level: 'VIOLATION', msg: 'External link should use newTab:true' });
      }
      return issues;
    },
  },
];

// ── Scenarios 113-120 ── full pages, tabs, search, multi-datasource, animations
const EXTENDED_SCENARIOS_14 = [
  {
    id: 113,
    label: 'Full product detail page — variants, quantity, classFormulas',
    turns: [
      'Create a product detail page. It should have: a product image (search for a placeholder product image), title "Wireless Headphones", price "$149.99", a description paragraph. Below that: 3 color variant buttons (Black, White, Blue) — store a selectedColor string variable (default "Black"). Each variant button uses classFormulas to highlight it when it matches selectedColor (e.g. bg-[#111] text-[#fff] when selected, bg-[#f0f0f0] text-[#111] when not). A quantity input (store variable, default 1). An "Add to Cart" button. Add the route.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variable(s) — expected at least 2 (selectedColor, quantity)` });
      if (!pageContent.includes('classFormulas')) issues.push({ level: 'VIOLATION', msg: 'No classFormulas found — variant buttons must use classFormulas to show selected state' });
      if (!pageContent.includes('selectedColor') && !pageContent.includes('variables[')) issues.push({ level: 'VIOLATION', msg: 'No variable reference in classFormulas — must check selectedColor variable' });
      // variant buttons: at least 3 workflow actions wired to color variant
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 3) issues.push({ level: 'VIOLATION', msg: `Only ${wfFiles.length} workflow(s) — expected at least 3 (one per color variant click)` });
      return issues;
    },
  },

  {
    id: 114,
    label: 'Admin data table — map rows with classFormulas status badge',
    turns: [
      'Create an admin users page. Store a "users" array variable (default: [{name:"Alice",email:"alice@example.com",role:"admin",status:"active"},{name:"Bob",email:"bob@example.com",role:"editor",status:"inactive"},{name:"Carol",email:"carol@example.com",role:"viewer",status:"active"}]). Use a map node to render each row. Each row shows: name, email, role, and a status badge — use classFormulas to give the badge "bg-[#dcfce7] text-[#166534]" if status is "active" else "bg-[#fee2e2] text-[#991b1b]". Add a page title "Users". Add the route.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"map"')) issues.push({ level: 'VIOLATION', msg: 'No map node found — rows must use a map node iterating the users array' });
      if (!pageContent.includes('classFormulas')) issues.push({ level: 'VIOLATION', msg: 'No classFormulas for status badge' });
      if (!pageContent.includes('active') && !pageContent.includes('status')) issues.push({ level: 'VIOLATION', msg: 'No status condition in classFormulas' });
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No store variable for users array' });
      return issues;
    },
  },

  {
    id: 115,
    label: 'Tabs UI — controlled by store variable + classFormulas active tab',
    turns: [
      'Create a page with 3 tabs: Overview, Analytics, Settings. Store an "activeTab" string variable (default "Overview"). Each tab button sets activeTab on click. Tab button uses classFormulas: when tab matches activeTab use "border-b-[2px] border-[#2563eb] text-[#2563eb] font-semibold" else "text-[#6b7280]". Show tab content panels — each has a node-level condition to only render when activeTab matches. Add the route.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('classFormulas')) issues.push({ level: 'VIOLATION', msg: 'No classFormulas for active tab styling' });
      if (!pageContent.includes('"condition"')) issues.push({ level: 'VIOLATION', msg: 'No condition on tab panels — each panel needs a node-level condition' });
      if (!pageContent.includes('activeTab') && !pageContent.includes('variables[')) issues.push({ level: 'VIOLATION', msg: 'No activeTab variable reference found in classFormulas or condition' });
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No store variable for activeTab' });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 3) issues.push({ level: 'VIOLATION', msg: `Only ${wfFiles.length} workflow(s) — expected 3 (one per tab click to set activeTab)` });
      return issues;
    },
  },

  {
    id: 116,
    label: 'Live search — Input onChange filters a list',
    turns: [
      'Create a search page. Store a "searchQuery" string variable (default ""). Store a "fruits" array (default: [{name:"Apple"},{name:"Banana"},{name:"Cherry"},{name:"Date"},{name:"Elderberry"}]). An Input bound to searchQuery with onChange that calls changeVariableValue to update searchQuery with event.value. A map node renders filtered results — use classFormulas or condition based on: context.item.data.name.toLowerCase().includes(variables[searchQueryId].toLowerCase()). Show "No results" Text with condition when search returns nothing. Add the route.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"map"')) issues.push({ level: 'VIOLATION', msg: 'No map node — filtered results need a map node' });
      if (!pageContent.includes('"Input"')) issues.push({ level: 'VIOLATION', msg: 'No Input node for search query' });
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variable(s) — expected 2 (searchQuery, fruits)` });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No workflow for Input onChange' });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('event.value')) issues.push({ level: 'VIOLATION', msg: 'No event.value in onChange workflow — should use event.value to update searchQuery' });
      }
      return issues;
    },
  },

  {
    id: 117,
    label: 'Multi-datasource dashboard — two REST endpoints on pageLoad',
    turns: [
      'Create a dashboard page that loads data from two REST datasources on page load. Datasource 1: GET https://jsonplaceholder.typicode.com/users (store result in "usersList" variable). Datasource 2: GET https://jsonplaceholder.typicode.com/posts?_limit=5 (store result in "recentPosts" variable). Show two sections: a users list (map node rendering user name and email) and a posts list (map node rendering post title). Trigger both datasources with a pageLoad trigger. Add the route.',
    ],
    check(files) {
      const issues = [];
      const dataFiles = Object.entries(files).filter(([p]) => p.startsWith('data/'));
      if (dataFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${dataFiles.length} datasource file(s) — expected 2 (users, posts)` });
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variable(s) — expected 2 (usersList, recentPosts)` });
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"map"')) issues.push({ level: 'VIOLATION', msg: 'No map nodes — users and posts should use map nodes' });
      // Check for pageLoad trigger
      const triggerFiles = Object.entries(files).filter(([p]) => p.includes('/triggers/'));
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      const hasTrigger = triggerFiles.length > 0 || wfFiles.some(([, c]) => c.includes('pageLoad'));
      if (!hasTrigger) issues.push({ level: 'VIOLATION', msg: 'No pageLoad trigger — datasources must be triggered on page load' });
      const allDataContent = dataFiles.map(([, c]) => c).join('\n');
      if (!allDataContent.includes('jsonplaceholder')) issues.push({ level: 'VIOLATION', msg: 'Datasource URLs not matching — expected jsonplaceholder.typicode.com' });
      return issues;
    },
  },

  {
    id: 118,
    label: 'Profile page with edit/view mode toggle',
    turns: [
      'Create a profile page. Store these variables: name (string, default "Jane Doe"), bio (string, default "Product Designer"), isEditing (boolean, default false). View mode shows name and bio as Text nodes, and an "Edit Profile" button that sets isEditing to true. Edit mode shows Input fields bound to name/bio and a "Save" button (sets isEditing to false) and "Cancel" button (sets isEditing to false). Use node-level condition on each mode: view mode renders when isEditing is false, edit mode renders when isEditing is true. Add the route.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"condition"')) issues.push({ level: 'VIOLATION', msg: 'No condition on mode containers — view and edit mode need node-level conditions' });
      if (!pageContent.includes('"Input"')) issues.push({ level: 'VIOLATION', msg: 'No Input nodes in edit mode' });
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 3) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variable(s) — expected 3 (name, bio, isEditing)` });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 3) issues.push({ level: 'VIOLATION', msg: `Only ${wfFiles.length} workflow(s) — expected at least 3 (edit, save, cancel)` });
      return issues;
    },
  },

  {
    id: 119,
    label: 'Press + flip animations — card press scale and flip on click',
    turns: [
      'Create a page with two interactive cards. Card 1: has a press animation (scale: 0.95, duration: 150ms) AND a hover animation (scale: 1.03, duration: 200ms). Card 2: has a flip animation on click (trigger: "click", duration: 500ms, perspective: 1000) with a front face showing a question Text and a back face showing an answer Text. Search for icons to use in the cards.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"press"')) issues.push({ level: 'VIOLATION', msg: 'No press animation found — card 1 should have props.animation.press' });
      if (!pageContent.includes('"hover"')) issues.push({ level: 'VIOLATION', msg: 'No hover animation — card 1 should have props.animation.hover' });
      if (!pageContent.includes('"flip"')) issues.push({ level: 'VIOLATION', msg: 'No flip animation found — card 2 should use props.animation.flip' });
      if (!pageContent.includes('perspective')) issues.push({ level: 'VIOLATION', msg: 'No perspective in flip animation (expected perspective: 1000)' });
      if (!pageContent.includes('0.95') && !pageContent.includes('"scale"')) issues.push({ level: 'VIOLATION', msg: 'Press scale 0.95 not found in press animation' });
      return issues;
    },
  },

  {
    id: 120,
    label: 'Notification toast — show then auto-hide with timeDelay',
    turns: [
      'Create a page with a "Submit" button. Store a "showNotification" boolean variable (default false) and "notificationMsg" string (default ""). Clicking Submit: (1) set notificationMsg to "Saved successfully!", (2) set showNotification to true, (3) timeDelay 3000ms, (4) set showNotification back to false. A toast Box with condition (showNotification === true) appears at top-right with a success icon and the notificationMsg text. Add the route.',
    ],
    check(files) {
      const issues = [];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variable(s) — expected 2 (showNotification, notificationMsg)` });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No workflow for Submit button' });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('"timeDelay"')) issues.push({ level: 'VIOLATION', msg: 'No timeDelay step — toast must auto-hide after 3000ms delay' });
        if (!allContent.includes('3000')) issues.push({ level: 'VIOLATION', msg: '3000ms delay not found in timeDelay step' });
      }
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length > 0) {
        const pageContent = pageEntries[0][1];
        if (!pageContent.includes('"condition"')) issues.push({ level: 'VIOLATION', msg: 'No condition on toast node — must render conditionally based on showNotification' });
      }
      return issues;
    },
  },
];

// ── Scenarios 121-128 ── pagination+utils, blog, semantic-refine, Iframe, reset, classFormulas, pricing page
const EXTENDED_SCENARIOS_15 = [
  {
    id: 121,
    label: 'Pagination with utils formula — slice array by page',
    turns: [
      'Create a paginated list page. Store: currentPage (number, default 1), allItems (array, default [{label:"Item 1"},{label:"Item 2"},{label:"Item 3"},{label:"Item 4"},{label:"Item 5"},{label:"Item 6"},{label:"Item 7"},{label:"Item 8"},{label:"Item 9"},{label:"Item 10"},{label:"Item 11"},{label:"Item 12"}]). Create a utils file "paginatedSlice" with params [{name:"items"},{name:"page"},{name:"perPage"}] and formula: `parameters?.["items"]?.slice((parameters?.["page"]-1)*parameters?.["perPage"], parameters?.["page"]*parameters?.["perPage"])`. Bind the map node to the paginatedSlice formula passing allItems, currentPage, and perPage=4. Add Previous and Next buttons: Previous decrements currentPage (disabled when currentPage is 1), Next increments it. Show "Page X" Text. Add the route.',
    ],
    check(files) {
      const issues = [];
      const utilsFiles = Object.entries(files).filter(([p]) => p.startsWith('utils/'));
      if (utilsFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No utils file created — pagination must use a utils formula for slicing' });
      else {
        const [, content] = utilsFiles[0];
        if (!content.includes('"formula"')) issues.push({ level: 'VIOLATION', msg: 'Utils file missing "formula" field' });
        if (!content.includes('slice') && !content.includes('parameters')) issues.push({ level: 'VIOLATION', msg: 'Utils formula should use slice and parameters access' });
        if (!content.includes('"params"')) issues.push({ level: 'VIOLATION', msg: 'Utils file missing "params" array' });
      }
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variable(s) — expected currentPage and allItems` });
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"map"')) issues.push({ level: 'VIOLATION', msg: 'No map node for paginated items list' });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${wfFiles.length} workflow(s) — expected 2 (prev, next)` });
      return issues;
    },
  },

  {
    id: 122,
    label: 'Full blog post page — rich content, author card, tags',
    turns: [
      'Create a full blog post page. It should have: a hero header image (search for a relevant image), article title "The Future of UI Development", author card with avatar image (search), author name "Alex Chen", publish date "June 2026", estimated read time "5 min read". Then 3 article body paragraphs as Text nodes with generous padding. A tags section with 3 tag badges (tag nodes styled as pills: rounded-[999px] px-[12px] py-[4px] bg-[#f0f9ff] text-[#0284c7] text-[13px]). A "Related Articles" section with 2 article cards. A back button using navigatePrev (with config.defaultPath:"/blog"). Add the route /blog/post.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file created' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"Image"')) issues.push({ level: 'VIOLATION', msg: 'No Image nodes — page needs hero + author avatar images' });
      if ((pageContent.match(/"Text"/g) || []).length < 4) issues.push({ level: 'VIOLATION', msg: 'Not enough Text nodes — need title, paragraphs, author, date, readtime' });
      if (!pageContent.includes('rounded-[999px]') && !pageContent.includes('rounded-full')) issues.push({ level: 'WARN', msg: 'Tag pill styling not clearly rounded — expected rounded-[999px] or rounded-full' });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No navigatePrev workflow for back button' });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('navigatePrev')) issues.push({ level: 'VIOLATION', msg: 'Back button must use navigatePrev step' });
      }
      return issues;
    },
  },

  {
    id: 123,
    label: 'Multi-turn: create pricing page → semantic search badge → hover refine',
    turns: [
      'Create a 3-tier pricing page (Basic $9, Pro $29, Enterprise $99). The Pro plan should have a "Most Popular" badge with a green background. Each plan has a list of 3 features and a CTA button. Add the route.',
      'Find the "Most Popular" badge node on the pricing page and change its background color from green to purple (use #7c3aed).',
      'Find the CTA button in the Pro plan card and add a hover animation: scale 1.04, duration 200ms, ease-out easing.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No pricing page' }); return issues; }
      const pageContent = pageEntries[0][1];
      // Turn 2: badge color changed to purple
      if (pageContent.includes('#16a34a') || pageContent.includes('#22c55e') || pageContent.includes('green')) {
        issues.push({ level: 'VIOLATION', msg: 'Badge still appears green — should be updated to #7c3aed purple' });
      }
      if (!pageContent.includes('#7c3aed')) issues.push({ level: 'VIOLATION', msg: 'Purple #7c3aed not found — badge color was not updated' });
      // Turn 3: hover animation on pro CTA
      if (!pageContent.includes('"hover"')) issues.push({ level: 'VIOLATION', msg: 'No hover animation added — Pro CTA button should have props.animation.hover' });
      if (!pageContent.includes('1.04') && !pageContent.includes('scale')) issues.push({ level: 'VIOLATION', msg: 'Hover scale 1.04 not found' });
      return issues;
    },
  },

  {
    id: 124,
    label: 'Iframe embed page — YouTube video and map embed',
    turns: [
      'Create a media embed page with two sections. Section 1: an Iframe node embedding a YouTube video (src: "https://www.youtube.com/embed/dQw4w9WgXcQ", width 100%, height 400px, no border). Section 2: an Iframe embedding a Google Maps location (src: "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3940.0", width 100%, height 300px). Add page title "Media Embeds" and descriptive Text nodes above each iframe. Add the route.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"Iframe"')) issues.push({ level: 'VIOLATION', msg: 'No Iframe nodes found — page needs 2 Iframe embeds' });
      else if ((pageContent.match(/"Iframe"/g) || []).length < 2) issues.push({ level: 'VIOLATION', msg: 'Only 1 Iframe found — expected 2 (YouTube + Maps)' });
      if (!pageContent.includes('youtube.com')) issues.push({ level: 'VIOLATION', msg: 'YouTube Iframe src not found' });
      if (!pageContent.includes('google.com/maps')) issues.push({ level: 'VIOLATION', msg: 'Google Maps Iframe src not found' });
      return issues;
    },
  },

  {
    id: 125,
    label: 'resetVariableValue step — clear form fields',
    turns: [
      'Create a contact form page with a FormContainer. Store variables: contactName (string, default ""), contactEmail (string, default ""), contactMessage (string, default ""). Input fields bound to each variable. Two buttons: "Submit" (sets a submitted boolean variable to true), and "Clear" (uses resetVariableValue for all 3 variables: contactName, contactEmail, contactMessage). Show a success message Box conditionally when submitted is true. Add the route.',
    ],
    check(files) {
      const issues = [];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 4) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variable(s) — expected 4 (contactName, contactEmail, contactMessage, submitted)` });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${wfFiles.length} workflow(s) — expected at least 2 (submit, clear)` });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('"resetVariableValue"')) issues.push({ level: 'VIOLATION', msg: 'No resetVariableValue step — Clear button must use resetVariableValue' });
        if (!allContent.includes('"changeVariableValue"')) issues.push({ level: 'VIOLATION', msg: 'No changeVariableValue for setting submitted variable on Submit' });
      }
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length > 0) {
        const pageContent = pageEntries[0][1];
        if (!pageContent.includes('"condition"')) issues.push({ level: 'VIOLATION', msg: 'No condition on success message node' });
        if (!pageContent.includes('"FormContainer"')) issues.push({ level: 'VIOLATION', msg: 'No FormContainer — form must use FormContainer node' });
      }
      return issues;
    },
  },

  {
    id: 126,
    label: 'Complex classFormulas — 3-level priority color indicator',
    turns: [
      'Create a task manager page. Store a "tasks" array variable (default: [{title:"Fix critical bug",priority:"high"},{title:"Write documentation",priority:"medium"},{title:"Update dependencies",priority:"low"},{title:"Security audit",priority:"high"},{title:"Refactor auth module",priority:"medium"}]). Use a map node to render each task row. Each row has: the task title, and a priority badge with classFormulas that resolves to: "bg-[#fee2e2] text-[#dc2626] font-semibold" when priority is "high", "bg-[#fef9c3] text-[#ca8a04] font-semibold" when priority is "medium", "bg-[#dcfce7] text-[#16a34a] font-semibold" when priority is "low". Also display the priority label text inside the badge. Add the route.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"map"')) issues.push({ level: 'VIOLATION', msg: 'No map node — tasks must use map node' });
      if (!pageContent.includes('classFormulas')) issues.push({ level: 'VIOLATION', msg: 'No classFormulas — priority badge needs classFormulas' });
      // Should have a 3-level ternary or if/else
      const hasHighColor = pageContent.includes('#fee2e2') || pageContent.includes('#dc2626');
      const hasMedColor = pageContent.includes('#fef9c3') || pageContent.includes('#ca8a04');
      const hasLowColor = pageContent.includes('#dcfce7') || pageContent.includes('#16a34a');
      if (!hasHighColor) issues.push({ level: 'VIOLATION', msg: 'High priority color not found (#fee2e2 or #dc2626)' });
      if (!hasMedColor) issues.push({ level: 'VIOLATION', msg: 'Medium priority color not found (#fef9c3 or #ca8a04)' });
      if (!hasLowColor) issues.push({ level: 'VIOLATION', msg: 'Low priority color not found (#dcfce7 or #16a34a)' });
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No store variable for tasks array' });
      return issues;
    },
  },

  {
    id: 127,
    label: 'Semantic search — find dark-bg sections across multi-page app and update text color',
    initialFiles: (() => {
      const makeSection = (id, bg, textId, textColor, label) => ({
        type: 'Box', id, name: `${label}Section`,
        props: { className: `flex flex-col p-[48px] bg-[${bg}]` },
        children: [{ type: 'Text', id: textId, name: `${label}Text`, props: { className: `text-[${textColor}] text-[24px]` }, text: `${label} content here` }],
      });
      return {
        routes: JSON.stringify({ routes: [{ path: '/', config: 'Home' }, { path: '/features', config: 'Features' }] }, null, 2),
        'pages/Home/page': JSON.stringify({ ui: [makeSection('aa000001-0000-4000-0000-000000000001', '#111827', 'aa000001-0000-4000-0000-000000000002', '#9ca3af', 'heroDark'), makeSection('aa000001-0000-4000-0000-000000000003', '#ffffff', 'aa000001-0000-4000-0000-000000000004', '#374151', 'heroLight'), makeSection('aa000001-0000-4000-0000-000000000005', '#1e293b', 'aa000001-0000-4000-0000-000000000006', '#94a3b8', 'ctaDark')] }, null, 2),
        'pages/Features/page': JSON.stringify({ ui: [makeSection('bb000001-0000-4000-0000-000000000001', '#0f172a', 'bb000001-0000-4000-0000-000000000002', '#64748b', 'featureDark'), makeSection('bb000001-0000-4000-0000-000000000003', '#f8fafc', 'bb000001-0000-4000-0000-000000000004', '#1e293b', 'featureLight')] }, null, 2),
      };
    })(),
    turns: [
      'Find all sections that have a dark background (bg darker than #333) and make their text color white (#ffffff). There are dark sections on multiple pages.',
    ],
    check(files) {
      const issues = [];
      const updatedFiles = Object.keys(files).filter(p => p.startsWith('pages/') && p.endsWith('/page'));
      // Both pages have dark sections, both should be updated
      if (updatedFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${updatedFiles.length} page(s) updated — both pages have dark-bg sections and should be updated` });
      const allContent = Object.entries(files).filter(([p]) => p.startsWith('pages/')).map(([, c]) => c).join('\n');
      if (allContent.includes('#9ca3af') || allContent.includes('#94a3b8') || allContent.includes('#64748b')) {
        issues.push({ level: 'VIOLATION', msg: 'Old muted text colors still present on dark sections — all dark-bg section text should be #ffffff' });
      }
      if (!allContent.includes('#ffffff')) issues.push({ level: 'VIOLATION', msg: 'New white #ffffff color not found — dark section text should be updated to white' });
      // Light sections should NOT be changed
      const homeContent = files['pages/Home/page'] || '';
      if (homeContent.includes('"heroLight"') || homeContent.includes('heroLight')) {
        // The light section text (#374151) should remain unchanged
        if (!homeContent.includes('#374151')) issues.push({ level: 'WARN', msg: 'Light section text color #374151 may have been changed — only dark sections should be updated' });
      }
      return issues;
    },
  },

  {
    id: 128,
    label: 'Full SaaS pricing page — tiers, FAQ accordion, feature comparison',
    turns: [
      'Create a full SaaS pricing page. It should have: 1) A hero section with title "Simple, transparent pricing" and subtitle. 2) 3 pricing cards (Starter $0/mo, Growth $29/mo, Pro $99/mo), each with a list of features and a CTA button. The Growth card has a "Most Popular" badge. 3) A feature comparison section: a map node rendering rows from a "features" array variable (default: [{feature:"API access",starter:false,growth:true,pro:true},{feature:"Custom domain",starter:false,growth:true,pro:true},{feature:"Analytics",starter:true,growth:true,pro:true},{feature:"Priority support",starter:false,growth:false,pro:true}]) — each row shows feature name and checkmark/cross icons using classFormulas or condition. 4) A FAQ section with 3 questions — store an "openFaq" number variable (default -1) — clicking a question sets openFaq to its index, clicking again sets it to -1; the answer panel has a condition showing when openFaq equals the question index. Add the route.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('"map"')) issues.push({ level: 'VIOLATION', msg: 'No map node — feature comparison must use map node' });
      if (!pageContent.includes('"condition"')) issues.push({ level: 'VIOLATION', msg: 'No condition — FAQ answers need node-level condition' });
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variable(s) — expected at least 2 (features, openFaq)` });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      // 1 shared FAQ workflow is valid (map pattern shares across items)
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No workflows — FAQ toggle needs at least 1 workflow' });
      return issues;
    },
  },
];

// ── Scenarios 129-136 ── fetchCollection, wwLib, graphql, _group split, cacheTTL, multi-turn deep edit
const EXTENDED_SCENARIOS_16 = [
  {
    id: 129,
    label: 'fetchCollection step — manual reload on button click',
    turns: [
      'Create a news feed page. Datasource: GET https://jsonplaceholder.typicode.com/posts?_limit=5, trigger "action" (not mount), store result in "newsFeed" array variable. A "Load Feed" button triggers a workflow with a fetchCollection step (passing the datasource ID) to load the data. A map node shows each post title. Show a "No posts loaded yet" Text with condition when newsFeed is empty. Add the route.',
    ],
    check(files) {
      const issues = [];
      const dataFiles = Object.entries(files).filter(([p]) => p.startsWith('data/'));
      if (dataFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No datasource file created' });
      else {
        const [, content] = dataFiles[0];
        if (!content.includes('"action"')) issues.push({ level: 'VIOLATION', msg: 'Datasource trigger must be "action" (not "mount") — it is fetched manually' });
      }
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No workflow for Load Feed button' });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('"fetchCollection"')) issues.push({ level: 'VIOLATION', msg: 'No fetchCollection step — manual reload must use fetchCollection' });
      }
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length > 0) {
        const pageContent = pageEntries[0][1];
        if (!pageContent.includes('"map"')) issues.push({ level: 'VIOLATION', msg: 'No map node — news feed must render items with map' });
        if (!pageContent.includes('"condition"')) issues.push({ level: 'VIOLATION', msg: 'No condition — empty state Text needs node-level condition' });
      }
      return issues;
    },
  },

  {
    id: 130,
    label: 'runJavaScript with wwLib.variables.set — BMI calculator',
    turns: [
      'Create a BMI calculator page. Store: weight (number, default 70), height (number, default 175), bmi (number, default 0), bmiCategory (string, default ""). Two Input fields bound to weight (kg) and height (cm). A "Calculate BMI" button triggers a workflow with a single runJavaScript step that: (1) computes bmi = weight / ((height/100) ** 2), rounds to 1 decimal, (2) determines category: <18.5 = "Underweight", 18.5-24.9 = "Normal weight", 25-29.9 = "Overweight", >=30 = "Obese", (3) uses wwLib.variables.set(bmiUuid, roundedBmi) and wwLib.variables.set(categoryUuid, category). Display the BMI result and category. Add the route.',
    ],
    check(files) {
      const issues = [];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 4) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variable(s) — expected 4 (weight, height, bmi, bmiCategory)` });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No workflow for Calculate button' });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('"runJavaScript"')) issues.push({ level: 'VIOLATION', msg: 'No runJavaScript step — BMI calculation must use runJavaScript' });
        if (!allContent.includes('wwLib.variables.set')) issues.push({ level: 'VIOLATION', msg: 'No wwLib.variables.set call — must use wwLib API to set bmi and bmiCategory variables' });
        if (!allContent.includes('wwLib.variables.get') && !allContent.includes('variables[')) issues.push({ level: 'WARN', msg: 'Consider using variables[] or wwLib.variables.get to read weight/height in runJavaScript' });
      }
      return issues;
    },
  },

  {
    id: 131,
    label: 'GraphQL datasource — query and display results',
    turns: [
      'Create a countries page. Set up a GraphQL datasource (type: "graphql") with endpoint "https://countries.trevorblades.com/graphql", query: "{ countries { code name emoji } }", responsePath: "countries", trigger "mount". Store result in "countriesList" array variable. Display countries in a map node showing flag emoji, country code, and name. Add a search input to filter the list (store searchCountry string variable, onChange sets the variable). Add the route.',
    ],
    check(files) {
      const issues = [];
      const dataFiles = Object.entries(files).filter(([p]) => p.startsWith('data/'));
      if (dataFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No datasource file created' });
      else {
        const [, content] = dataFiles[0];
        if (!content.includes('"graphql"')) issues.push({ level: 'VIOLATION', msg: 'Datasource type must be "graphql"' });
        if (!content.includes('countries.trevorblades.com')) issues.push({ level: 'VIOLATION', msg: 'GraphQL endpoint URL not found' });
        if (!content.includes('"query"')) issues.push({ level: 'VIOLATION', msg: 'GraphQL datasource missing "query" field' });
      }
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length > 0) {
        const pageContent = pageEntries[0][1];
        if (!pageContent.includes('"map"')) issues.push({ level: 'VIOLATION', msg: 'No map node for countries list' });
        if (!pageContent.includes('"Input"')) issues.push({ level: 'VIOLATION', msg: 'No search Input node' });
      }
      return issues;
    },
  },

  {
    id: 132,
    label: 'Large page split with _group nodes — hero, features, CTA sections',
    turns: [
      'Create a large marketing landing page split into 3 _group sections: "Hero", "Features", "CTA". Each section is a _group node. The Hero _group has a headline, subtitle, and two CTA buttons. The Features _group has 4 feature cards in a 2x2 grid (search for icons). The CTA _group has a bold call-to-action with a gradient background. Each _group node must have the _group property set (e.g. "Hero"). Write each group to its own path: pages/Marketing/groups/Hero, pages/Marketing/groups/Features, pages/Marketing/groups/CTA. Add the route.',
    ],
    check(files) {
      const issues = [];
      // Should write group files, not just the full page
      const groupFiles = Object.keys(files).filter(p => p.includes('/groups/'));
      if (groupFiles.length < 3) issues.push({ level: 'VIOLATION', msg: `Only ${groupFiles.length} group file(s) — expected 3 (Hero, Features, CTA)` });
      else {
        const hasHero = groupFiles.some(p => p.endsWith('/Hero'));
        const hasFeatures = groupFiles.some(p => p.endsWith('/Features'));
        const hasCTA = groupFiles.some(p => p.endsWith('/CTA'));
        if (!hasHero) issues.push({ level: 'VIOLATION', msg: 'No Hero group file — expected pages/Marketing/groups/Hero' });
        if (!hasFeatures) issues.push({ level: 'VIOLATION', msg: 'No Features group file — expected pages/Marketing/groups/Features' });
        if (!hasCTA) issues.push({ level: 'VIOLATION', msg: 'No CTA group file — expected pages/Marketing/groups/CTA' });
      }
      // Each group file should have _group property
      const allGroupContent = groupFiles.map(p => files[p] || '').join('\n');
      if (!allGroupContent.includes('"_group"')) issues.push({ level: 'VIOLATION', msg: 'Group files missing "_group" property on root node' });
      return issues;
    },
  },

  {
    id: 133,
    label: 'REST datasource with cacheTag + cacheTTL',
    turns: [
      'Create a weather info page. Set up a REST datasource: GET https://wttr.in/London?format=j1, trigger "mount", responsePath "current_condition.0", cacheTag "weather-london", cacheTTL 300 (5 minutes). Store result in "weatherData" object variable. Display temperature (weatherData.temp_C) and weather description in a card. Add a "Refresh" button with a fetchCollection workflow step. Add the route.',
    ],
    check(files) {
      const issues = [];
      const dataFiles = Object.entries(files).filter(([p]) => p.startsWith('data/'));
      if (dataFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No datasource file created' });
      else {
        const [, content] = dataFiles[0];
        if (!content.includes('cacheTag') && !content.includes('"cacheTag"')) issues.push({ level: 'VIOLATION', msg: 'cacheTag not set on datasource' });
        if (!content.includes('cacheTTL') && !content.includes('"cacheTTL"')) issues.push({ level: 'VIOLATION', msg: 'cacheTTL not set on datasource' });
        if (!content.includes('300')) issues.push({ level: 'VIOLATION', msg: 'cacheTTL should be 300 (5 minutes)' });
      }
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length > 0) {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('"fetchCollection"')) issues.push({ level: 'VIOLATION', msg: 'Refresh button should use fetchCollection step' });
      }
      return issues;
    },
  },

  {
    id: 134,
    label: 'fetchCollectionsParallel — load two datasources simultaneously',
    turns: [
      'Create a combined stats page. Two REST datasources: (1) GET https://jsonplaceholder.typicode.com/users (trigger "action", store to "usersList"), (2) GET https://jsonplaceholder.typicode.com/posts (trigger "action", store to "postsList"). A single "Load All" button uses a workflow with ONE fetchCollectionsParallel step that fetches both datasources at the same time. Display stats: total users count and total posts count. Add the route.',
    ],
    check(files) {
      const issues = [];
      const dataFiles = Object.entries(files).filter(([p]) => p.startsWith('data/'));
      if (dataFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${dataFiles.length} datasource file(s) — expected 2` });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No workflow for Load All button' });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('"fetchCollectionsParallel"')) issues.push({ level: 'VIOLATION', msg: 'No fetchCollectionsParallel step — parallel loading must use fetchCollectionsParallel' });
        if (!allContent.includes('"collectionIds"') && !allContent.includes('collectionIds')) issues.push({ level: 'VIOLATION', msg: 'fetchCollectionsParallel missing collectionIds array' });
      }
      return issues;
    },
  },

  {
    id: 135,
    label: 'Deep 5-turn multi-edit — card component iterative refinement',
    turns: [
      'Create a simple profile card page: a Box card with an avatar Image (search for it), a name Text "John Doe", and a title Text "Senior Engineer". Add the route.',
      'Find the avatar image on the profile card and give it a circular shape (rounded-full, w-[80px], h-[80px], object-cover).',
      'Add a hover animation to the entire card: scale 1.02, duration 250ms, ease-out easing.',
      'Add two things to the profile card: (1) A "Follow" Box button (bg-[#2563eb], white text "Follow", rounded-[8px]). (2) A "Following ✓" Text node directly below the Follow button — this Text node must have a node-level condition: `variables["isFollowingId"] === true`. Create a "isFollowing" boolean store variable (default false). Wire the Follow button to a workflow that sets isFollowing to true.',
      'Search for the Follow button node on the profile card page and update it to use classFormulas for its background: when isFollowing is true use bg-[#16a34a], else bg-[#2563eb].',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file' }); return issues; }
      const pageContent = pageEntries[0][1];
      // Turn 2: circular avatar
      if (!pageContent.includes('rounded-full') && !pageContent.includes('rounded-[50%]')) issues.push({ level: 'VIOLATION', msg: 'Avatar not circular — expected rounded-full' });
      // Turn 3: hover animation on card
      if (!pageContent.includes('"hover"')) issues.push({ level: 'VIOLATION', msg: 'No hover animation on card' });
      // Turn 4: Follow button + condition
      if (!pageContent.includes('"condition"')) issues.push({ level: 'VIOLATION', msg: 'No condition — "Following ✓" text needs node-level condition' });
      // Turn 5: classFormulas on button
      if (!pageContent.includes('classFormulas')) issues.push({ level: 'VIOLATION', msg: 'No classFormulas on Follow button — should switch color based on isFollowing' });
      if (!pageContent.includes('#16a34a') && !pageContent.includes('green')) issues.push({ level: 'VIOLATION', msg: 'Green color for "following" state not found in classFormulas' });
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No store variable for isFollowing' });
      return issues;
    },
  },

  {
    id: 136,
    label: 'Semantic search — multi-file refactor: rename button style across 3 pages',
    initialFiles: (() => {
      const makeBtn = (id, label, bg) => ({ type: 'Box', id, name: 'primaryBtn', props: { className: `flex items-center justify-center px-[16px] py-[10px] bg-[${bg}] rounded-[8px] cursor-pointer` }, children: [{ type: 'Text', id: id.replace('a0000001', 'a0001111').replace('b0000001', 'b0001111').replace('c0000001', 'c0001111'), name: 'btnText', props: { className: 'text-[#ffffff] font-semibold text-[14px]' }, text: label }] });
      const makePage = (wrapId, nodes) => JSON.stringify({ ui: [{ type: 'Box', id: wrapId, name: 'wrapper', props: { className: 'flex flex-col gap-[24px] p-[32px]' }, children: nodes }] }, null, 2);
      return {
        routes: JSON.stringify({ routes: [{ path: '/', config: 'Home' }, { path: '/shop', config: 'Shop' }, { path: '/contact', config: 'Contact' }] }, null, 2),
        'pages/Home/page': makePage('a0000001-0000-4000-0000-000000000099', [makeBtn('a0000001-0000-4000-0000-000000000001', 'Get Started', '#2563eb'), makeBtn('a0000001-0000-4000-0000-000000000002', 'Learn More', '#2563eb')]),
        'pages/Shop/page': makePage('b0000001-0000-4000-0000-000000000099', [makeBtn('b0000001-0000-4000-0000-000000000001', 'Shop Now', '#2563eb'), makeBtn('b0000001-0000-4000-0000-000000000002', 'View All', '#2563eb')]),
        'pages/Contact/page': makePage('c0000001-0000-4000-0000-000000000099', [makeBtn('c0000001-0000-4000-0000-000000000001', 'Send Message', '#2563eb'), makeBtn('c0000001-0000-4000-0000-000000000002', 'Contact Sales', '#2563eb')]),
      };
    })(),
    turns: [
      'Find all primary buttons (blue #2563eb background) across all pages and change their background color to #7c3aed (purple). There are multiple buttons on multiple pages.',
    ],
    check(files) {
      const issues = [];
      const updatedPages = Object.keys(files).filter(p => p.startsWith('pages/') && p.endsWith('/page'));
      if (updatedPages.length < 3) issues.push({ level: 'VIOLATION', msg: `Only ${updatedPages.length} page(s) updated — all 3 pages have blue buttons and should be updated` });
      const allContent = Object.entries(files).filter(([p]) => p.startsWith('pages/')).map(([, c]) => c).join('\n');
      if (allContent.includes('#2563eb')) issues.push({ level: 'VIOLATION', msg: 'Old blue #2563eb still present — all primary buttons should be updated to #7c3aed' });
      if (!allContent.includes('#7c3aed')) issues.push({ level: 'VIOLATION', msg: 'New purple #7c3aed not found — buttons should be updated' });
      return issues;
    },
  },
];

// ── Scenarios 137-144 ── dynamic URL, checkout wizard, Textarea, nested data, auth flow, appLoad+pageLoad
const EXTENDED_SCENARIOS_17 = [
  {
    id: 137,
    label: 'Dynamic URL datasource — {{variables[uuid]}} interpolation',
    turns: [
      'Create a user profile viewer page. Store: "userId" number variable (default 1). A REST datasource with dynamic URL: "https://jsonplaceholder.typicode.com/users/{{variables[\'userIdUuid\']}}" (where userIdUuid is the UUID of the userId store variable). Store result in "profileData" object. Display: user name, email, and company name (profileData.company.name) as Text nodes. Add a "Prev" button (decrements userId, min 1) and "Next" button (increments userId, max 10). Each button also has a fetchCollection step to reload the datasource. Add the route.',
    ],
    check(files) {
      const issues = [];
      const dataFiles = Object.entries(files).filter(([p]) => p.startsWith('data/'));
      if (dataFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No datasource file' });
      else {
        const [, content] = dataFiles[0];
        if (!content.includes('{{variables[') && !content.includes('variables[')) issues.push({ level: 'VIOLATION', msg: 'Dynamic URL not using {{variables[uuid]}} interpolation' });
        if (!content.includes('jsonplaceholder')) issues.push({ level: 'VIOLATION', msg: 'Datasource URL not pointing to jsonplaceholder' });
      }
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variable(s) — expected 2 (userId, profileData)` });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${wfFiles.length} workflow(s) — expected 2 (prev, next)` });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('"fetchCollection"')) issues.push({ level: 'VIOLATION', msg: 'No fetchCollection step — buttons should reload the datasource after changing userId' });
      }
      return issues;
    },
  },

  {
    id: 138,
    label: 'Multi-step checkout wizard — cart → shipping → payment',
    turns: [
      'Create a 3-step checkout page. Store: "checkoutStep" number (default 1). Show 3 steps with classFormulas for a progress indicator: step gets "bg-[#2563eb] text-[#fff]" when its index === checkoutStep, else "bg-[#e5e7eb] text-[#6b7280]". Step 1 panel (condition: checkoutStep===1): shows "Order Summary" with a list of 2 items and total price. Step 2 panel (condition: checkoutStep===2): shows shipping form with 2 inputs (name, address). Step 3 panel (condition: checkoutStep===3): shows payment with card number input. Each step has "Continue" button (increments checkoutStep, max 3) and "Back" button (decrements checkoutStep, min 1, hidden on step 1). Add the route.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page file' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (!pageContent.includes('classFormulas')) issues.push({ level: 'VIOLATION', msg: 'No classFormulas for step progress indicator' });
      if (!pageContent.includes('"condition"')) issues.push({ level: 'VIOLATION', msg: 'No conditions — each step panel needs a node-level condition' });
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No store variable for checkoutStep' });
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${wfFiles.length} workflow(s) — expected multiple (continue, back, etc.)` });
      return issues;
    },
  },

  {
    id: 139,
    label: 'Textarea with character counter — onChange updates charCount',
    turns: [
      'Create a feedback form page. Store: "feedbackText" string (default ""), "charCount" number (default 0). A Textarea node (props.placeholder "Share your feedback...") with an onChange workflow that: (1) sets feedbackText to event.value, (2) sets charCount to event.value.length. Show "X / 500 characters" Text below the textarea using the charCount variable. Show a warning Text "Too long! Maximum 500 characters." with condition when charCount > 500, using red text color. A "Submit" button. Add the route.',
    ],
    check(files) {
      const issues = [];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variable(s) — expected 2 (feedbackText, charCount)` });
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length > 0) {
        const pageContent = pageEntries[0][1];
        if (!pageContent.includes('"Textarea"')) issues.push({ level: 'VIOLATION', msg: 'No Textarea node — feedback form needs a Textarea' });
        if (!pageContent.includes('"condition"')) issues.push({ level: 'VIOLATION', msg: 'No condition — warning text needs node-level condition (charCount > 500)' });
      }
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No onChange workflow for Textarea' });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('event.value')) issues.push({ level: 'VIOLATION', msg: 'onChange workflow must use event.value to update feedbackText' });
        if (!allContent.includes('.length') && !allContent.includes('length')) issues.push({ level: 'VIOLATION', msg: 'charCount workflow step should compute event.value.length' });
      }
      return issues;
    },
  },

  {
    id: 140,
    label: 'Complex condition — &&/|| operators in node condition',
    turns: [
      'Create a content gating page. Store: "isLoggedIn" boolean (default false), "isPremium" boolean (default false), "age" number (default 0). Show 4 content panels with different conditions: (1) "Public content" — no condition (always visible). (2) "Members only content" — condition: isLoggedIn === true. (3) "Premium content" — condition: isLoggedIn === true && isPremium === true. (4) "Age restricted" — condition: isLoggedIn === true && age >= 18. Add toggle buttons for each variable. Display the current state of each variable. Add the route.',
    ],
    check(files) {
      const issues = [];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 3) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variable(s) — expected 3 (isLoggedIn, isPremium, age)` });
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length > 0) {
        const pageContent = pageEntries[0][1];
        if (!pageContent.includes('"condition"')) issues.push({ level: 'VIOLATION', msg: 'No conditions on content panels' });
        // Should have && operator in conditions
        if (!pageContent.includes('&&')) issues.push({ level: 'VIOLATION', msg: 'No && operator found — premium and age-restricted panels need compound conditions' });
      }
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 3) issues.push({ level: 'VIOLATION', msg: `Only ${wfFiles.length} workflow(s) — expected 3 toggle workflows` });
      return issues;
    },
  },

  {
    id: 141,
    label: 'Nested data binding — context.item.data.author.name from API',
    turns: [
      'Create a blog posts page. REST datasource: GET https://jsonplaceholder.typicode.com/posts?_limit=5 with trigger "mount". Each post in the API has {id, title, body, userId}. Create a SECOND REST datasource: GET https://jsonplaceholder.typicode.com/users?_limit=5 with trigger "mount", store in "authorsList". Store posts in "postsList". A map node renders post cards. Each card shows: post title (context.item.data.title), first 100 chars of post body (use runJavaScript or a formula). Also show post ID. Add a "Load More" button using fetchCollection on the posts datasource. Add the route.',
    ],
    check(files) {
      const issues = [];
      const dataFiles = Object.entries(files).filter(([p]) => p.startsWith('data/'));
      if (dataFiles.length < 1) issues.push({ level: 'VIOLATION', msg: 'No datasource files' });
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length > 0) {
        const pageContent = pageEntries[0][1];
        if (!pageContent.includes('"map"')) issues.push({ level: 'VIOLATION', msg: 'No map node for posts list' });
        if (!pageContent.includes('context.item.data')) issues.push({ level: 'VIOLATION', msg: 'No context.item.data binding — post map items should access context.item.data.title etc.' });
      }
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length > 0) {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('"fetchCollection"')) issues.push({ level: 'VIOLATION', msg: 'No fetchCollection — Load More button should reload the posts datasource' });
      } else {
        issues.push({ level: 'VIOLATION', msg: 'No workflows — Load More button needs a fetchCollection workflow' });
      }
      return issues;
    },
  },

  {
    id: 142,
    label: 'Full auth flow — 2-page app: login sets variable, protected page checks it',
    turns: [
      'Create a 2-page auth app. Page 1: "Login" page (/login). Store: "isLoggedIn" boolean (default false), "loggedInUser" string (default ""). A simple login form: username Input (store "username" string variable), password Input (store "password" string variable). "Login" button workflow: branch step — if username is not empty AND password is not empty, set isLoggedIn to true and set loggedInUser to the username value, then navigateTo "/" — else set an "authError" string to "Invalid credentials". Show authError conditionally. Page 2: "Dashboard" page (/). Show two containers: one with condition (isLoggedIn === true) showing "Welcome back " + loggedInUser, and one with condition (isLoggedIn === false) showing "Please login" with a navigateTo /login button.',
    ],
    check(files) {
      const issues = [];
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 5) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variable(s) — expected 5 (isLoggedIn, loggedInUser, username, password, authError)` });
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${pageEntries.length} page(s) — expected 2 (Login, Dashboard)` });
      else {
        const allContent = pageEntries.map(([, c]) => c).join('\n');
        if (!allContent.includes('"condition"')) issues.push({ level: 'VIOLATION', msg: 'No conditions — protected content must use node-level conditions' });
      }
      const wfFiles = Object.entries(files).filter(([p]) => p.includes('/workflows/'));
      if (wfFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${wfFiles.length} workflow(s) — expected login workflow + navigation workflow(s)` });
      else {
        const allContent = wfFiles.map(([, c]) => c).join('\n');
        if (!allContent.includes('"branch"')) issues.push({ level: 'VIOLATION', msg: 'No branch step — login should validate credentials with a branch' });
        if (!allContent.includes('"navigateTo"')) issues.push({ level: 'VIOLATION', msg: 'No navigateTo — login should navigate on success' });
      }
      return issues;
    },
  },

  {
    id: 143,
    label: 'appLoad + pageLoad triggers on same page — global + local data',
    turns: [
      'Create an app with two triggers on the "Home" page. (1) An app-level appLoad trigger (at triggers/appLoad): loads global config via fetchCollection from a REST datasource "https://jsonplaceholder.typicode.com/todos/1" (store in "globalConfig" object variable). (2) A page-level pageLoad trigger (at pages/Home/triggers/pageLoad): loads page-specific data via fetchCollection from a REST datasource "https://jsonplaceholder.typicode.com/posts/1" (store in "pageContent" object variable). The page shows: globalConfig title (from appLoad data) and pageContent title (from pageLoad data) in two separate sections. Add the route.',
    ],
    check(files) {
      const issues = [];
      const appTrigger = Object.keys(files).find(p => p === 'triggers/appLoad' || p.startsWith('triggers/'));
      if (!appTrigger) issues.push({ level: 'VIOLATION', msg: 'No app-level trigger file — appLoad must be at triggers/appLoad (global)' });
      const pageTrigger = Object.keys(files).find(p => p.includes('/triggers/') && p.includes('pageLoad'));
      if (!pageTrigger) issues.push({ level: 'VIOLATION', msg: 'No page-level pageLoad trigger — must be at pages/Home/triggers/pageLoad' });
      const dataFiles = Object.entries(files).filter(([p]) => p.startsWith('data/'));
      if (dataFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${dataFiles.length} datasource(s) — expected 2 (global + page-specific)` });
      const storeFiles = Object.entries(files).filter(([p]) => p.startsWith('store/'));
      if (storeFiles.length < 2) issues.push({ level: 'VIOLATION', msg: `Only ${storeFiles.length} store variable(s) — expected 2 (globalConfig, pageContent)` });
      return issues;
    },
  },

  {
    id: 144,
    label: 'Bulk semantic search + update — find all price Text nodes and change color',
    initialFiles: (() => {
      const makeCard = (id, name, price, priceTxtId) => ({
        type: 'Box', id, name: `${name}Card`,
        props: { className: 'flex flex-col gap-[8px] p-[16px] bg-[#fff] rounded-[12px]' },
        children: [
          { type: 'Text', id: id.replace('0000', '1111'), name: `${name}Title`, props: { className: 'text-[#111] font-semibold text-[16px]' }, text: `${name} Plan` },
          { type: 'Text', id: priceTxtId, name: `${name}Price`, props: { className: 'text-[#2563eb] font-bold text-[24px]' }, text: price },
          { type: 'Text', id: id.replace('0000', '3333'), name: `${name}Desc`, props: { className: 'text-[#6b7280] text-[14px]' }, text: 'per month' },
        ],
      });
      return {
        routes: JSON.stringify({ routes: [{ path: '/pricing', config: 'Pricing' }] }, null, 2),
        'pages/Pricing/page': JSON.stringify({
          ui: [{
            type: 'Box', id: 'a0000001-0000-4000-0000-000000000099', name: 'wrapper',
            props: { className: 'flex flex-row gap-[24px] p-[48px] bg-[#f9fafb]' },
            children: [
              makeCard('a0000001-0000-4000-0000-000000000001', 'Starter', '$0', 'a0000001-2222-4000-0000-000000000001'),
              makeCard('a0000001-0000-4000-0000-000000000004', 'Pro', '$29', 'a0000001-2222-4000-0000-000000000004'),
              makeCard('a0000001-0000-4000-0000-000000000007', 'Enterprise', '$99', 'a0000001-2222-4000-0000-000000000007'),
            ],
          }],
        }, null, 2),
      };
    })(),
    turns: [
      'Find all price Text nodes on the pricing page (the ones showing "$0", "$29", "$99" with blue color #2563eb) and change their color to #7c3aed (purple). There are 3 price nodes.',
    ],
    check(files) {
      const issues = [];
      const pageEntries = Object.entries(files).filter(([p]) => p.startsWith('pages/') && p.endsWith('/page'));
      if (pageEntries.length < 1) { issues.push({ level: 'VIOLATION', msg: 'No page updated' }); return issues; }
      const pageContent = pageEntries[0][1];
      if (pageContent.includes('#2563eb')) issues.push({ level: 'VIOLATION', msg: 'Old blue #2563eb still present on price nodes — all 3 should be updated' });
      if (!pageContent.includes('#7c3aed')) issues.push({ level: 'VIOLATION', msg: 'New purple #7c3aed not found — price nodes should be updated to purple' });
      // Check all 3 price text nodes are updated (they should have purple color)
      const purpleCount = (pageContent.match(/#7c3aed/g) || []).length;
      if (purpleCount < 3) issues.push({ level: 'VIOLATION', msg: `Only ${purpleCount} purple color instance(s) found — all 3 price nodes should be updated` });
      return issues;
    },
  },
];

// Extend main scenario list
const ALL_SCENARIOS = [...SCENARIOS, ...ROUTING_SCENARIOS, ...EXTENDED_SCENARIOS, ...EXTENDED_SCENARIOS_2, ...EXTENDED_SCENARIOS_3, ...EXTENDED_SCENARIOS_4, ...EXTENDED_SCENARIOS_5, ...EXTENDED_SCENARIOS_6, ...EXTENDED_SCENARIOS_7, ...EXTENDED_SCENARIOS_8, ...EXTENDED_SCENARIOS_9, ...EXTENDED_SCENARIOS_10, ...EXTENDED_SCENARIOS_11, ...EXTENDED_SCENARIOS_12, ...EXTENDED_SCENARIOS_13, ...EXTENDED_SCENARIOS_14, ...EXTENDED_SCENARIOS_15, ...EXTENDED_SCENARIOS_16, ...EXTENDED_SCENARIOS_17];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const isRoutingOnly = args.includes('--routing');
  const scenarioList = isRoutingOnly ? ROUTING_SCENARIOS : ALL_SCENARIOS;

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log(`║     File Agent Test Suite — ${scenarioList.length} Scenarios${' '.repeat(Math.max(0, 45 - scenarioList.length.toString().length))}║`);
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`API: ${API_URL}`);
  console.log(`Model: ${MODEL ?? 'default'}`);
  console.log(`Verbose: ${VERBOSE}`);
  if (ONLY_SCENARIO !== null) console.log(`Running only scenario ${ONLY_SCENARIO}`);
  if (isRoutingOnly) console.log('Mode: routing scenarios only (12-19)');
  console.log();

  let scenariosToRun = ONLY_SCENARIO !== null
    ? scenarioList.filter(s => s.id === ONLY_SCENARIO)
    : FROM_SCENARIO !== null
      ? scenarioList.filter(s => s.id >= FROM_SCENARIO)
      : scenarioList;

  if (scenariosToRun.length === 0) {
    console.error(`No scenario found (--scenario ${ONLY_SCENARIO ?? ''} --from ${FROM_SCENARIO ?? ''}).`);
    process.exit(1);
  }
  if (FROM_SCENARIO !== null) {
    console.log(`Running from scenario ${FROM_SCENARIO} (${scenariosToRun.length} scenarios)`);
  }

  const results = [];
  for (const scenario of scenariosToRun) {
    const result = await runScenario(scenario);
    results.push(result);
  }

  // ── Summary table ─────────────────────────────────────────────────────────
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                         SUMMARY                                     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log();

  const colId    = 3;
  const colLabel = 45;
  const colWrites = 7;
  const colStatus = 8;
  const colTokens = 12;

  const header = `${'#'.padEnd(colId)} ${'Scenario'.padEnd(colLabel)} ${'Writes'.padEnd(colWrites)} ${'Result'.padEnd(colStatus)} ${'Tokens'.padEnd(colTokens)} Issues`;
  console.log(header);
  console.log('─'.repeat(header.length));

  let totalPass = 0;
  let totalFail = 0;
  let totalSkip = 0;
  let grandTotalIn = 0;
  let grandTotalOut = 0;

  for (const r of results) {
    const violations = r.issues.filter(i => i.level === 'VIOLATION').length;
    const warnings   = r.issues.filter(i => i.level === 'WARN').length;
    const status     = r.skipped ? 'SKIP' : r.passed ? 'PASS' : 'FAIL';
    const issueStr   = r.skipped ? 'credit exhausted'
      : violations > 0
        ? `${violations} violation(s)${warnings > 0 ? `, ${warnings} warn(s)` : ''}`
        : warnings > 0 ? `${warnings} warn(s)` : 'clean';
    const tokIn  = r.inputTokens  ?? 0;
    const tokOut = r.outputTokens ?? 0;
    const tokStr = tokIn > 0 ? `${(tokIn + tokOut).toLocaleString()}` : '—';
    grandTotalIn  += tokIn;
    grandTotalOut += tokOut;

    console.log(
      `${String(r.id).padEnd(colId)} ${r.label.padEnd(colLabel)} ${String(r.writeCount).padEnd(colWrites)} ${status.padEnd(colStatus)} ${tokStr.padEnd(colTokens)} ${issueStr}`
    );

    if (!r.passed && !r.skipped) {
      for (const v of r.issues.filter(i => i.level === 'VIOLATION')) {
        console.log(`   ✗ ${v.msg}`);
      }
    }

    if (r.skipped) totalSkip++;
    else if (r.passed) totalPass++; else totalFail++;
  }

  console.log('─'.repeat(header.length));
  const skipNote = totalSkip > 0 ? `, ${totalSkip} skipped` : '';
  const grandTotal = grandTotalIn + grandTotalOut;
  if (grandTotal > 0) {
    console.log(`📊 Total tokens — in: ${grandTotalIn.toLocaleString()}  out: ${grandTotalOut.toLocaleString()}  total: ${grandTotal.toLocaleString()}`);
  }
  console.log(`\nTotal: ${totalPass} passed, ${totalFail} failed${skipNote} out of ${results.length} scenarios`);

  if (totalFail > 0) {
    process.exit(1);
  }
}

main().catch(err => { console.error('\nFATAL:', err); process.exit(1); });
