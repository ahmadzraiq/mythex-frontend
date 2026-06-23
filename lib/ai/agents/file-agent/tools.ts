/**
 * Anthropic tool definitions for the file-based builder agent.
 *
 * The agent operates exclusively on the virtual file tree — no artifact UUIDs,
 * no specialised node/variable tools. Every action goes through a path string.
 */

export interface FileTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const FILE_AGENT_TOOLS: FileTool[] = [
  // ── Read ────────────────────────────────────────────────────────────────────
  {
    name: 'read_file',
    description: 'Read a virtual file\'s JSON content with optional line range. Returns line-numbered output (  1|{). Use start_line/end_line to read a slice without loading the full file.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'VFS file path.',
        },
        start_line: {
          type: 'number',
          description: 'First line to return (1-based, inclusive). Omit to start from line 1.',
        },
        end_line: {
          type: 'number',
          description: 'Last line to return (1-based, inclusive). Omit to read to end of file.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'grep',
    description: 'Search all entities (every node + every resource: store vars, workflows, triggers, datasources, formulas, theme) by matching a regex against each entity\'s full theme-expanded blob. Returns path:line: type name="..." — snippet. One hit per matching entity. Use regex alternation to expand a concept.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for.',
        },
        path_prefix: {
          type: 'string',
          description: 'Restrict search to paths starting with this prefix.',
        },
        limit: {
          type: 'number',
          description: 'Maximum matches to return (default 50).',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'codebase_search',
    description: 'Hybrid lexical+semantic search over all entities (nodes + resources). Use when the target is conceptual and the literal words won\'t appear in the JSON. Falls back to grep-based term matching fused with vector results via RRF. Returns [score] path:line  type name="..." — snippet. Use read_file on the returned path to see full content.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query describing what you are looking for.',
        },
        top_k: {
          type: 'number',
          description: 'Maximum number of results to return (default 8).',
        },
      },
      required: ['query'],
    },
  },

  {
    name: 'list_dir',
    description: 'List immediate children (files and sub-folders) under a path prefix, as full paths. Use to reveal what exists in a folder. Returns one full path per line.',
    input_schema: {
      type: 'object',
      properties: {
        prefix: {
          type: 'string',
          description: 'Path prefix to list under. Omit or pass "" to list top-level entries.',
        },
      },
      required: [],
    },
  },

  // ── Page writer (typed recursive schema) ─────────────────────────────────────
  {
    name: 'write_page',
    description: 'Create or fully replace a page file at pages/<Name>/page. Use this instead of write_file for ALL page writes. The ui array is fully typed — StyleParams enums enforce correct direction/weight/text values automatically. Write all page content in a single call. Surgical node edit → edit_page.',
    input_schema: {
      type: 'object',
      $defs: {
        StyleParams: {
          type: 'object',
          description: 'Style shorthand keys. Converted to inline styles on save. Unknown keys are passed through as raw CSS.\n\nRESPONSIVE: Any property marked with (*) can be a responsive object instead of a primitive: { "default": <desktop>, "xl": <val>, "lg": <val>, "md": <val> }. Use "default" for the desktop base (xl≤1280px lg≤1024px md≤768px). Omit breakpoints that match desktop. Do NOT use the node-level responsive field for style property changes — use this inline format instead.',
          properties: {
            display:    { description: '(*) flex | grid | block | inline-block | inline | inline-flex | hidden. Responsive.' },
            direction:  { description: '(*) flex-direction: row | col | row-reverse | col-reverse. Responsive.' },
            items:      { description: '(*) align-items: start | center | end | stretch | baseline. Responsive.' },
            justify:    { description: '(*) justify-content: start | center | end | between | around | evenly. Responsive.' },
            self:       { type: 'string', enum: ['auto','start','center','end','stretch','baseline'], description: 'align-self' },
            wrap:       { type: 'string', enum: ['wrap','nowrap','wrap-reverse'], description: 'flex-wrap' },
            flex1:      { type: 'boolean', description: 'flex-1' },
            flex:       { type: 'integer', enum: [1], description: 'Alias for flex1:true. Only value 1 is supported — outputs flex-1. For flex-grow > 1 use the node-level responsive styles field with flexGrow.' },
            gridCols:   { description: '(*) grid-template-columns count. Responsive.' },
            gridRows:   { type: 'number', description: 'grid-template-rows count' },
            gridFlow:   { type: 'string', enum: ['row','col','dense','row-dense','col-dense'] },
            colSpan:    { type: 'number' },
            colSpanFull:{ type: 'boolean' },
            rowSpan:    { type: 'number' },
            gap:        { description: '(*) gap in px. Responsive.' },
            gapX:       { description: '(*) column-gap in px. Responsive.' },
            gapY:       { description: '(*) row-gap in px. Responsive.' },
            w:          { description: '(*) width in px, or "full"/"screen"/"fit"/"auto". Responsive.' },
            h:          { description: '(*) height in px, or "full"/"screen"/"fit"/"auto". Responsive.' },
            minW:       { description: '(*) min-width in px, or "full"/"fit"/"auto". Responsive.' },
            maxW:       { description: '(*) max-width in px, or "full"/"fit"/"auto". Responsive.' },
            minH:       { description: '(*) min-height in px, or "full"/"screen"/"fit"/"auto". Responsive.' },
            maxH:       { description: '(*) max-height in px, or "full"/"screen"/"fit"/"auto". Responsive.' },
            p:          { description: '(*) padding all sides in px. Responsive.' },
            px:         { description: '(*) padding left+right in px. Responsive.' },
            py:         { description: '(*) padding top+bottom in px. Responsive.' },
            pt:         { description: '(*) padding-top in px. Responsive.' },
            pr:         { description: '(*) padding-right in px. Responsive.' },
            pb:         { description: '(*) padding-bottom in px. Responsive.' },
            pl:         { description: '(*) padding-left in px. Responsive.' },
            m:          { description: '(*) margin all sides: number (px) or "auto". Responsive.' },
            mx:         { description: '(*) margin left+right: number (px) or "auto". Responsive.' },
            my:         { description: '(*) margin top+bottom: number (px) or "auto". Responsive.' },
            mt:         { description: '(*) margin-top in px. Responsive.' },
            mr:         { description: '(*) margin-right in px. Responsive.' },
            mb:         { description: '(*) margin-bottom in px. Responsive.' },
            ml:         { description: '(*) margin-left in px. Responsive.' },
            bg:         { description: '(*) Background: hex (#1a1a1a), rgba(...), or var(--theme-*). Never CSS named colors — use #ffffff not white. Responsive.' },
            text:       { description: '(*) font-size in px. Responsive.' },
            weight:     { type: 'string', enum: ['thin','extralight','light','normal','medium','semibold','bold','extrabold','black'], description: 'font-weight' },
            leading:    { type: 'string', enum: ['none','tight','snug','normal','relaxed','loose'] },
            tracking:   { type: 'string', enum: ['tighter','tight','normal','wide','wider','widest'] },
            textAlign:  { type: 'string', enum: ['left','center','right','justify'] },
            textColor:  { description: '(*) Text color: hex, rgba, or var(--theme-*). Never CSS named colors — use #ffffff not white. Responsive.' },
            textDecoration: { type: 'string', enum: ['underline','line-through','no-underline','overline'] },
            textTransform:  { type: 'string', enum: ['uppercase','lowercase','capitalize','normal-case'] },
            textOverflow:   { type: 'string', enum: ['truncate'] },
            whitespace:     { type: 'string', enum: ['nowrap','pre','normal'] },
            wordBreak:      { type: 'string', enum: ['all','words','keep'] },
            border:         { description: '(*) border-width in px. Responsive.' },
            borderStyle:    { type: 'string', enum: ['solid','dashed','dotted','double','none'] },
            borderColor:    { description: '(*) border-color: hex or var(--theme-*). Never CSS named colors — use #ffffff not white. Responsive.' },
            radius:         { description: '(*) border-radius in px. Responsive.' },
            radiusTL:       { type: 'number' },
            radiusTR:       { type: 'number' },
            radiusBR:       { type: 'number' },
            radiusBL:       { type: 'number' },
            position:   { description: '(*) static | relative | absolute | fixed | sticky. Responsive.' },
            inset0:     { type: 'boolean' },
            top:        { description: '(*) top inset in px. Responsive.' },
            right:      { description: '(*) right inset in px. Responsive.' },
            bottom:     { description: '(*) bottom inset in px. Responsive.' },
            left:       { description: '(*) left inset in px. Responsive.' },
            z:          { description: '(*) z-index. Responsive.' },
            overflow:   { description: '(*) hidden | auto | visible | scroll | x-auto | y-auto. Responsive.' },
            cursor:     { type: 'string', enum: ['auto','default','pointer','not-allowed','grab','move','text','crosshair'] },
            opacity:    { description: '(*) opacity 0.0–1.0. Responsive.' },
            objectFit:  { type: 'string', enum: ['cover','contain','fill','none'] },
            extra:      { type: 'string', description: 'Extra raw tokens (space-separated). Use sparingly.' },
          },
        },
        UINode: {
          type: 'object',
          required: ['type'],
          properties: {
            type:      { type: 'string', enum: ['Box','Text','Input','Textarea','FormContainer','Image','Icon','Video','Iframe'] },
            name:      { type: 'string', description: 'Descriptive camelCase label. Used to reference this node by name in workflow steps (scrollToElement, controlAnimation, targetNodeId).' },
            text:      { description: 'Static string or { "js": "expr" }. Text nodes only.' },
            condition: { type: 'string', description: 'Raw JS expression. Node renders only when truthy.' },
            map:       { type: 'object', properties: { js: { type: 'string' } }, required: ['js'], description: 'Repeats this node once per array element — each iteration is a full clone of this node, not a child inside it. context.item.data holds the current element. To render items inside a grid or list container: the container node is static (no map), and the inner item node carries map. Example: Box(grid) → Box(map) → Text. Any JS expression is valid: a variable reference or an inline literal array.' },
            key:       { type: 'string', description: 'Unique key per map item.' },
            props: {
              type: 'object',
              properties: {
                style:        { type: 'object' },
                animation: {
                  type: 'object',
                  description: 'Animation config. All keys are optional and composable:\n• enter: { type, duration(ms), delay, easing, stagger, from } — types: fadeIn, slideInUp, slideInDown, slideInLeft, slideInRight, zoomIn, bounceIn, flipInX, flipInY, blurIn, glowIn, revealUp, charFall, charBounce, dropIn, riseFade, expandIn, skewIn, tiltIn, rollIn\n• exit: { type, duration, delay, easing } — types: fadeOut, slideOutUp, slideOutDown, slideOutLeft, slideOutRight, zoomOut, blurOut\n• loop: { type, duration, delay, repeatCount(-1=infinite), direction } — types: pulse, breathe, float, flash, spin, shake, wiggle, bounce, heartbeat, glowPulse, gradientDrift\n• scroll: { type(same as enter), duration, delay, threshold(0–1), once(bool) } — scroll-triggered enter\n• hover: { scale, opacity, y(translateY px), x, duration, easing, styles(CSS props map) }\n• press: { scale, opacity, y, x, duration, easing, styles }\n• tilt: { enabled, maxX(deg), maxY(deg), perspective(px), scale }\n• parallax: { enabled, speed, direction("vertical"|"horizontal"), clamp }\n• filter: { enabled, blur, backdropBlur, brightness, contrast, grayscale, saturate, hueRotate }\n• shimmer: { baseColor, highlightColor, duration(ms) }\n• states: { watchVar(expr string), duration, defaultState, states(stateName→CSS map) }\n• imperativeTrigger: { type(loop or enter preset), watchVar(expr string), duration }\n• timeline: [{ property, from, to, startMs, endMs, easing }] — properties: opacity, translateX, translateY, rotate, scale\n• splitText: { text, split("char"|"word"), type(enter preset), duration, stagger, delay }\n• flip: { trigger("hover"|"click"), duration, perspective }\n• mouseParallax: { enabled, strength, axis("both"|"x"|"y") }\n• scrollProgress: { enabled, property(CSS prop), from, to, unit, start(0–100), end(0–100) }\nEasing values: linear, easeIn, easeOut, easeInOut, backIn, backOut, backInOut, circIn, circOut',
                },
                classFormulas:{ type: 'object', description: 'Dynamic class tokens: { label: { js: "expr" } }' },
                src:          { description: 'Image/Video src: string URL or { js: "expr" }' },
                alt:          { type: 'string' },
                icon:         { type: 'string', description: 'Iconify icon name. ALWAYS from search_icons.' },
                size:         { type: 'number', description: 'Icon size in px' },
                color:        { type: 'string', description: 'Icon color: hex, rgba, or var(--theme-*). Never CSS named colors — use #ffffff not white.' },
                loop:         { type: 'boolean' },
                autoPlay:     { type: 'boolean' },
                muted:        { type: 'boolean' },
                controls:     { type: 'boolean' },
                placeholder:  { type: 'string' },
                type_:        { type: 'string', description: 'Input type: text, email, password, number, etc.' },
              },
            },
            actions: {
              type: 'array',
              description: 'Bind workflows to this node. Each item is a workflow reference — navigate, runJavaScript, etc. all live inside the workflow\'s steps, not here.',
              items: {
                type: 'object',
                required: ['action'],
                additionalProperties: false,
                properties: {
                  action: { type: 'string', description: 'Workflow path to trigger — page-scoped ("pages/Page/workflows/name") or global ("workflows/name"). Multiple nodes may reference the same global workflow if each has different params.' },
                  params: { type: 'object', description: 'Per-node parameter values passed as parameters[\'name\'] inside the triggered global workflow — same as runProjectWorkflow params. Use this to share one global workflow across multiple nodes with different values.' },
                  trigger: { type: 'string', enum: ['click','change','valueChange','dragStart','dragUpdate','dragEnd','created','mounted'], description: 'Optional. Override which event fires this workflow. Normally omit — the workflow\'s own trigger is used automatically.' },
                },
              },
            },
            children:   { type: 'array', items: { type: 'object' }, description: 'Child nodes. Box and FormContainer only.' },
            _shared:    { type: 'object', description: '{ "id": "<sc-id>", "name": "<display name>" } — marks node as a shared component instance.' },
            _validation:{ type: 'object', description: 'Form field validation. Only on Input/Textarea inside FormContainer. Shape: { "trigger": "submit"|"change", "rules": [{ "type": "required"|"email"|"minLength"|"maxLength"|"phone"|"pattern"|"equalsField", "message": "...", "value"?: "..." }] }. Custom formula rule: { "type": "formula", "formula": { "js": "booleanExpr" }, "message": "..." }' },
            responsive: {
              type: 'object',
              description: 'Breakpoint overrides (desktop-first). Keys: laptop(≤1280px), tablet(≤1024px), mobile(≤768px). Desktop base goes directly in props — no responsive key needed for desktop.\n\nEach breakpoint key is an object with optional fields:\n• styles — camelCase CSS property names with CSS-formatted values (fontSize, flexDirection, padding). NOT style shorthand keys (p, text, flex1, w) — they are ignored here.\n• style — inline style merge\n• props — partial props override\n• condition — show/hide override\n• text — text content override\n• map — plain string expression override. NOT the {js:"..."} object format.\n• actions — replaces actions array\n• animation — animation override',
              additionalProperties: {
                type: 'object',
                properties: {
                  styles:    { type: 'object', description: 'camelCase CSS props (fontSize, padding, flexDirection, width, display, etc.) with CSS string values.' },
                  style:     { type: 'object', description: 'Inline style merge.' },
                  props:     { type: 'object', description: 'Partial props override.' },
                  condition: { type: 'string' },
                  text:      {},
                  animation: { type: 'object' },
                },
              },
            },
          },
        },
      },
      properties: {
        path: {
          type: 'string',
          description: 'Page file path.',
        },
        meta: {
          type: 'object',
          properties: {
            title:       { type: 'string' },
            description: { type: 'string' },
          },
        },
        ui: {
          type: 'array',
          items: { type: 'object' },
          description: 'Root UI nodes. Pass as a JSON array literal — never as a JSON string.',
        },
      },
      required: ['path', 'ui'],
    } as unknown as { type: 'object'; properties: Record<string, unknown>; required?: string[] },
  },

  // ── Typed structured writers ──────────────────────────────────────────────────

  {
    name: 'write_variable',
    description: 'Create or replace a store variable. The UUID in the path becomes the variable\'s runtime id.',
    input_schema: {
      type: 'object',
      properties: {
        path:             { type: 'string', description: 'Human-readable path: "store/displayValue", "store/counter". This path is how you reference this variable everywhere — in variableName fields and in variables[\'store/displayValue\'] expressions.' },
        name:             { type: 'string', description: 'camelCase display label.' },
        type:             { type: 'string', enum: ['string','number','boolean','object','array'], description: 'Variable type.' },
        initialValue:     { description: 'Initial value — JS type MUST match type exactly: "string" → string literal e.g. "0", "number" → number literal e.g. 0, "boolean" → true/false, "object" → {}, "array" → [].' },
        description:      { type: 'string', description: 'What this variable represents.' },
        persist:          { type: 'string', enum: ['session','local'], description: 'Persist across navigation.' },
        resetOnNavigate:  { type: 'boolean', description: 'Clear on route change.' },
        urlParam:         { type: 'object', properties: { param: { type: 'string' }, default: { type: 'string' } }, description: 'Sync with URL query param.' },
      },
      required: ['path', 'name', 'type', 'initialValue'],
    },
  },

  {
    name: 'write_workflow',
    description: 'Create or replace a workflow file. The UUID in the path becomes the workflow id used in node action fields.',
    input_schema: {
      type: 'object',
      $defs: {
        WorkflowStep: {
          type: 'object',
          required: ['type'],
          properties: {
            type: {
              type: 'string',
              enum: ['changeVariableValue','resetVariableValue','branch','multiOptionBranch','navigateTo','navigatePrev','runJavaScript','graphql','fetchCollection','fetchCollectionsParallel','forEach','whileLoop','timeDelay','setFormState','authenticate','setUser','clearSession','restoreSession','copyToClipboard','scrollToElement','controlAnimation','runProjectWorkflow','returnValue','stopPropagation','breakLoop','continueLoop','fetchData','updateCollection','resetForm','passThroughCondition','executeComponentAction','pickFile','printPdf','downloadFileFromUrl','createUrlFromBase64','encodeFileAsBase64'],
              description: 'Step type.',
            },
            id: { type: 'string', description: 'Optional. If you need to reference this step\'s result via context.workflow[\'id\'].result in a later step, set a short name here (e.g. "calcResult") and use that exact name in the reference. If omitted, the server auto-assigns.' },
            name: { type: 'string', description: 'Descriptive step name.' },
            config: {
              type: 'object',
              description: 'Step configuration (all fields go inside config — shape by type):\n• changeVariableValue: variableName(store path), value(literal or { js })\n• resetVariableValue: variableName(store path)\n• branch: condition({ js: \"booleanExpr\" }) — MUST be a { js } binding so variables[\"store/path\"] resolves correctly; plus top-level trueBranch/falseBranch arrays (REQUIRED, use [] if empty)\n• multiOptionBranch: condition({ js: \"booleanExpr\" }) — MUST be a { js } binding; plus top-level branches array + defaultBranch\n• navigateTo: path(route string), linkType("internal"|"external"), externalUrl, newTab(bool), queryParams(object), replace(bool)\n• navigatePrev: defaultPath(fallback route)\n• runJavaScript: code(JS string) — see code property below for globals and rules\n• graphql: query(GQL string), variables(object of literals or { js })\n• fetchCollection: collectionId(datasource path)\n• fetchCollectionsParallel: collectionIds(array of datasource paths)\n• fetchData: collectionId(datasource path), body({ js }), params(object)\n• updateCollection: collectionId(datasource path), body(object or { js })\n• forEach: items({ js: "expr" evaluating to array }) — plus top-level loopBody\n• whileLoop: condition({ js: \"booleanExpr\" }) — MUST be a { js } binding; plus top-level loopBody\n• breakLoop / continueLoop: no config\n• timeDelay: ms(number)\n• setFormState: path(dot-path into form state), value(literal or { js }), isSubmitting(bool)\n• resetForm: no config\n• authenticate: accessToken({ js }), user({ js }), persist(bool)\n• setUser: user({ js })\n• clearSession / restoreSession: no config\n• copyToClipboard: text(string or { js })\n• scrollToElement: targetNodeId(node name)\n• controlAnimation: targetNodeId(node name), action("trigger"|"exit"|"startLoop"|"stopLoop"|"enter")\n• runProjectWorkflow: workflowId(global workflow path), params(object of literals or { js })\n• returnValue: value(literal or { js })\n• stopPropagation: no config\n• passThroughCondition: condition({ js: \"booleanExpr\" }) — MUST be a { js } binding\n• executeComponentAction / pickFile / printPdf / downloadFileFromUrl / createUrlFromBase64 / encodeFileAsBase64: see builder UI',
              properties: {
                variableName: { type: 'string', description: 'Path of the variable — e.g. "store/displayValue". Same path you used in write_variable.' },
                value:        { description: 'New value or { js: "expr" } (changeVariableValue / setFormState).' },
                condition:    { description: "Branch/loop condition — MUST be a { js: 'booleanExpr' } binding so variables['store/path'] resolves correctly. Example: { js: \"variables['store/displayValue'] === '0'\" }" },
                path:         { type: 'string', description: 'Route path (navigateTo) or form dot-path (setFormState).' },
                linkType:     { type: 'string', enum: ['internal','external'], description: 'navigateTo link type.' },
                externalUrl:  { type: 'string', description: 'External URL (navigateTo external).' },
                newTab:       { type: 'boolean', description: 'Open in new tab (navigateTo).' },
                queryParams:  { type: 'object', description: 'Query param key/value pairs (navigateTo).' },
                replace:      { type: 'boolean', description: 'Replace history entry (navigateTo).' },
                defaultPath:  { type: 'string', description: 'Fallback path (navigatePrev).' },
                code:         { type: 'string', description: 'JS code string (runJavaScript). Multi-line: use \\n in the JSON string. Available globals: variables, fns, wwLib, globalContext, auth, context (workflow step results ONLY — context.workflow[\'stepId\'].result — no triggering-node identity exists), event is not available in click workflows — no event.target, event.currentTarget, event.x, or event.y. Return a value to expose it as context.workflow[\'stepId\'].result to later steps.' },
                query:        { type: 'string', description: 'GraphQL query/mutation string (graphql).' },
                variables:    { type: 'object', description: 'GraphQL variables (graphql).' },
                ms:           { type: 'number', description: 'Milliseconds (timeDelay).' },
                collectionId: { type: 'string', description: 'Path of the datasource — e.g. "data/products". Same path you used in write_datasource.' },
                collectionIds:{ type: 'array', items: { type: 'string' }, description: 'Paths of datasources — e.g. ["data/products", "data/categories"].' },
                items:        { description: '{ js: "expr" } evaluating to array (forEach).' },
                isSubmitting: { type: 'boolean', description: 'Set form submitting state (setFormState).' },
                accessToken:  { description: '{ js: "expr" } resolving to JWT (authenticate).' },
                user:         { description: '{ js: "expr" } resolving to user object (authenticate / setUser).' },
                persist:      { type: 'boolean', description: 'Save session across reloads (authenticate).' },
                targetNodeId: { type: 'string', description: 'Name of the target node (the "name" field you set on that node) — e.g. "ButtonAC". Used in scrollToElement / controlAnimation.' },
                action:       { type: 'string', enum: ['trigger','exit','startLoop','stopLoop','enter'], description: 'controlAnimation action.' },
                text:         { description: 'Text or { js: expr } (copyToClipboard).' },
                workflowId:   { type: 'string', description: 'Path of the global workflow — e.g. "workflows/sharedHandler". Must be a workflows/ path (global, no pageScope). Page-scoped workflows under pages/*/workflows/* cannot be called here — only global workflows receive parameters[].' },
                params:       { type: 'object', description: 'Values passed to the global workflow (runProjectWorkflow). Literals or { js: "expr" }. Received as parameters[\'name\'] in the called workflow.' },
              },
            },
            trueBranch:  { type: 'array', items: { type: 'object' }, description: 'REQUIRED on branch steps. Use [] if empty.' },
            falseBranch: { type: 'array', items: { type: 'object' }, description: 'REQUIRED on branch steps. Use [] if empty.' },
            branches:    { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, steps: { type: 'array', items: { type: 'object' } } }, required: ['label','steps'] }, description: 'multiOptionBranch branches.' },
            defaultBranch: { type: 'array', items: { type: 'object' }, description: 'multiOptionBranch default.' },
            loopBody:    { type: 'array', items: { type: 'object' }, description: 'forEach / whileLoop body.' },
          },
        },
      },
      properties: {
        path:      { type: 'string', description: '"pages/<PageName>/workflows/<name>" for page-scoped workflows. "workflows/<name>" for global reusable workflows.' },
        meta: {
          type: 'object',
          required: ['name', 'trigger'],
          properties: {
            name:      { type: 'string', description: 'Short action phrase.' },
            trigger:   { type: 'string', enum: ['click','change','focus','blur','valueChange','enterKey','submit','submitValidationError','appLoad','pageLoad','swipe','drag','scroll'], description: 'Event trigger.' },
            pageScope: { type: 'string', description: 'Required for pages/ path workflows (value = page name, e.g. "Calculator"). Omit for workflows/ path. A page-scoped workflow belongs to exactly one node. For logic used by multiple nodes, write a global workflow (no pageScope) and call it via runProjectWorkflow with params — each node keeps its own thin wrapper. If only one node needs the logic, put the steps directly in the page-local workflow.' },
          },
        },
        steps: { type: 'array', items: { type: 'object' }, description: 'Workflow steps. Must be a native JSON array of step objects — never a JSON string.' },
      },
      required: ['path', 'meta', 'steps'],
    } as unknown as { type: 'object'; properties: Record<string, unknown>; required?: string[] },
  },

  {
    name: 'write_trigger',
    description: 'Create or replace a lifecycle trigger file. Use pages/<name>/triggers/<type> for page triggers. Use triggers/<type> for app-level triggers.',
    input_schema: {
      type: 'object',
      $defs: {
        TriggerStep: {
          type: 'object',
          required: ['type'],
          properties: {
            type: { type: 'string', enum: ['changeVariableValue','resetVariableValue','branch','multiOptionBranch','navigateTo','navigatePrev','runJavaScript','graphql','fetchCollection','fetchCollectionsParallel','forEach','whileLoop','timeDelay','setFormState','authenticate','setUser','clearSession','restoreSession','copyToClipboard','scrollToElement','controlAnimation','runProjectWorkflow','stopPropagation','breakLoop','continueLoop','fetchData','updateCollection','resetForm','passThroughCondition','executeComponentAction'], description: 'Step type.' },
            id: { type: 'string', description: 'Optional. Set a short name (e.g. "fetchResult") only when a later step needs context.workflow[\'id\'].result. Server auto-assigns if omitted.' },
            name: { type: 'string' },
            config: { type: 'object' },
            trueBranch:   { type: 'array', items: { type: 'object' } },
            falseBranch:  { type: 'array', items: { type: 'object' } },
            branches:     { type: 'array' },
            loopBody:     { type: 'array', items: { type: 'object' } },
          },
        },
      },
      properties: {
        path:         { type: 'string', description: 'Trigger path: "pages/<PageName>/triggers/pageLoad" or "triggers/appLoad".' },
        name:         { type: 'string', description: 'Trigger name.' },
        trigger:      { type: 'string', enum: ['appLoad','appLoadBefore','pageLoad','pageLoadBefore','pageUnload','scroll','resize','keydown','keyup'], description: 'Lifecycle trigger type.' },
        pageScope:    { type: 'string', description: 'Page name for page-scoped triggers.' },
        isAppTrigger: { type: 'boolean', description: 'True for app-level triggers (appLoad, appLoadBefore).' },
        steps:        { type: 'array', items: { type: 'object' }, description: 'Trigger steps.' },
      },
      required: ['path', 'name', 'trigger', 'steps'],
    } as unknown as { type: 'object'; properties: Record<string, unknown>; required?: string[] },
  },

  {
    name: 'write_routes',
    description: 'Create or fully replace the routes file. Always use this instead of write_file for the routes file. Automatically wraps in { routes: [] } — never write a flat array.',
    input_schema: {
      type: 'object',
      properties: {
        routes: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'config', 'name'],
            properties: {
              path:         { type: 'string', description: 'URL path.' },
              config:       { type: 'string', description: 'Page name matching pages/<name>/page.' },
              name:         { type: 'string', description: 'Human-readable route name.' },
              layout:       { type: 'string', enum: ['full','centered','admin','none'], description: 'Layout wrapper.' },
              auth:         { type: 'boolean', description: 'True for authenticated-only pages.' },
              guestOnly:    { type: 'boolean', description: 'True for guest-only pages (login, register).' },
              authRedirect: { type: 'string', description: 'Redirect unauthenticated users here.' },
              dynamic:      { type: 'boolean', description: 'True for dynamic route segments.' },
            },
          },
          description: 'All app routes.',
        },
        defaultRedirect: { type: 'string', description: 'Default redirect path.' },
      },
      required: ['routes'],
    },
  },

  {
    name: 'write_datasource',
    description: 'Create or replace a datasource file. The UUID in the path becomes the datasource id used in collections[\'id\'] expressions. Only for external HTTP/GraphQL API calls — never for static or config data. For a static array or object, use write_variable.',
    input_schema: {
      type: 'object',
      properties: {
        path:          { type: 'string', description: 'Human-readable path: "data/products", "data/users". This path is how you reference this datasource everywhere — in collectionId fields.' },
        name:          { type: 'string', description: 'Display name.' },
        type:          { type: 'string', enum: ['rest','graphql'], description: 'Datasource type.' },
        url:           { type: 'string', description: 'REST endpoint URL. Embed {{variables[\'store/varName\']}} for dynamic values.' },
        method:        { type: 'string', enum: ['GET','POST','PUT','PATCH','DELETE'], description: 'HTTP method (REST only).' },
        headers:       { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' }, enabled: { type: 'boolean' } } }, description: 'Request headers.' },
        queryParams:   { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' }, enabled: { type: 'boolean' } } }, description: 'Query parameters.' },
        body:          { description: 'Request body: string or { js: "expr" }.' },
        responsePath:  { type: 'string', description: 'Dot-path into response to extract data.' },
        trigger:       { type: 'string', enum: ['mount','action'], description: 'When to fetch: mount (automatic) or action (manual).' },
        cacheTTL:      { type: 'number', description: 'Cache duration in seconds.' },
        cacheTag:      { type: 'string', description: 'Cache tag string.' },
        endpoint:      { type: 'string', description: 'GraphQL endpoint URL.' },
        query:         { type: 'string', description: 'GraphQL query or mutation string.' },
        variables:     { type: 'object', description: 'GraphQL variables object.' },
        skipStoreWhenNull: { type: 'boolean', description: 'Skip storing result when null.' },
      },
      required: ['path', 'name', 'type'],
    },
  },

  {
    name: 'write_formula',
    description: 'Create or replace a formula (util) file at utils/<name>. Formulas are reusable JS expressions with typed parameters. For computed/derived values only — not for static config data. For a static array or object, use write_variable.',
    input_schema: {
      type: 'object',
      properties: {
        path:        { type: 'string', description: 'File path: "utils/<name>".' },
        name:        { type: 'string', description: 'Formula name.' },
        description: { type: 'string', description: 'What this formula does.' },
        formula:     { type: 'string', description: 'JS expression string. Access params via parameters?.[\'paramName\']. MUST be "formula" — not "code" or "expression".' },
        params: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'type'],
            properties: {
              name:      { type: 'string', description: 'Parameter name (used in expression as parameters?.[\'name\']).' },
              type:      { type: 'string', enum: ['Text','Number','Boolean','Object','Array'], description: 'Parameter type. Note: "Text" not "string", "Number" not "number".' },
              testValue: { description: 'Test value for preview.' },
            },
          },
          description: 'Formula parameters.',
        },
      },
      required: ['path', 'name', 'formula', 'params'],
    },
  },

  {
    name: 'write_component',
    description: 'Create or replace a shared component model at components/<id> or components/<folder>/<id>. Covers the full model: content (UINode tree), properties, variables, workflows, formulas, and triggers. Handler appends /component to the path.\n\nSC rules:\n• Sub-paths (components/<id>/store/, components/<id>/workflows/, components/<id>/utils/) are READ-ONLY views. To update SC-internal variables, workflows, or formulas: read the full model from components/<id>/component, modify the relevant section, then rewrite via write_component.\n• id is auto-derived from the last path segment — never pass a top-level id.\n• Place an SC instance on a page with a Box node: _shared: { "id": "<sc-id>", "name": "<display name>" }.\n• workflows[uuid].trigger: "execution" (callable), DOM events ("click","change","focus","blur","mouseEnter","mouseLeave","etc."), or a custom ComponentTrigger id.\n• triggers fired externally via emitComponentTrigger step inside the SC; consumed on page instances via the trigger id.',
    input_schema: {
      type: 'object',
      $defs: {
        StyleParams: {
          type: 'object',
          properties: {
            display:    { type: 'string', enum: ['flex','grid','block','inline-block','inline','hidden'] },
            direction:  { type: 'string', enum: ['row','col','row-reverse','col-reverse'] },
            items:      { type: 'string', enum: ['start','end','center','baseline','stretch'] },
            justify:    { type: 'string', enum: ['start','end','center','between','around','evenly'] },
            self:       { type: 'string', enum: ['auto','start','end','center','stretch'] },
            wrap:       { type: 'string', enum: ['wrap','nowrap','wrap-reverse'] },
            flex1:      { type: 'boolean' },
            gridCols:   { type: 'number' }, gridRows: { type: 'number' }, gridFlow: { type: 'string' },
            colSpan:    { type: 'number' }, colSpanFull: { type: 'boolean' }, rowSpan: { type: 'number' },
            gap: { type: 'number' }, gapX: { type: 'number' }, gapY: { type: 'number' },
            w: {}, h: {}, minW: {}, maxW: {}, minH: {}, maxH: {},
            p: { type: 'number' }, px: { type: 'number' }, py: { type: 'number' },
            pt: { type: 'number' }, pr: { type: 'number' }, pb: { type: 'number' }, pl: { type: 'number' },
            m: {}, mx: {}, my: {}, mt: {}, mr: {}, mb: {}, ml: {},
            bg:       { type: 'string', description: 'hex, rgba, or var(--theme-*). Never CSS named colors.' },
            text:     { type: 'number' },
            weight:   { type: 'string', enum: ['thin','extralight','light','normal','medium','semibold','bold','extrabold','black'] },
            leading:  { type: 'string', enum: ['none','tight','snug','normal','relaxed','loose'] },
            tracking: { type: 'string', enum: ['tighter','tight','normal','wide','wider','widest'] },
            textAlign: { type: 'string', enum: ['left','center','right','justify'] },
            textColor: { type: 'string', description: 'hex, rgba, or var(--theme-*). Never CSS named colors — use #ffffff not white.' },
            textDecoration: { type: 'string', enum: ['underline','line-through','no-underline','overline'] },
            textTransform:  { type: 'string', enum: ['uppercase','lowercase','capitalize','normal-case'] },
            textOverflow:   { type: 'string', enum: ['truncate'] },
            whitespace:     { type: 'string', enum: ['nowrap','pre','normal'] },
            wordBreak:      { type: 'string', enum: ['all','words','keep'] },
            border: { type: 'number' }, borderStyle: { type: 'string', enum: ['solid','dashed','dotted','double','none'] },
            borderColor: { type: 'string', description: 'hex or var(--theme-*). Never CSS named colors.' },
            radius: { type: 'number' }, radiusTL: { type: 'number' }, radiusTR: { type: 'number' },
            radiusBR: { type: 'number' }, radiusBL: { type: 'number' },
            position: { type: 'string', enum: ['static','relative','absolute','fixed','sticky'] },
            inset0: { type: 'boolean' },
            top: { type: 'number' }, right: { type: 'number' }, bottom: { type: 'number' }, left: { type: 'number' },
            z: { type: 'number' },
            overflow: { type: 'string', enum: ['hidden','auto','visible','scroll','x-auto','y-auto'] },
            cursor:   { type: 'string', enum: ['auto','default','pointer','not-allowed','grab','move','text','crosshair'] },
            opacity:  { type: 'number' }, objectFit: { type: 'string', enum: ['cover','contain','fill','none'] },
            extra: { type: 'string' },
          },
        },
        UINode: {
          type: 'object',
          required: ['type'],
          properties: {
            type:      { type: 'string', enum: ['Box','Text','Input','Textarea','FormContainer','Image','Icon','Video','Iframe'] },
            name:      { type: 'string' },
            text:      { description: 'Static string or { "js": "expr" }. Text nodes only.' },
            condition: { type: 'string' },
            map:       { type: 'object', properties: { js: { type: 'string' } }, required: ['js'], description: 'Repeats this node once per array element — each iteration is a full clone of this node, not a child inside it. context.item.data holds the current element. To render items inside a grid or list container: the container node is static (no map), and the inner item node carries map. Example: Box(grid) → Box(map) → Text. Any JS expression is valid: a variable reference or an inline literal array.' },
            key:       { type: 'string' },
            props: {
              type: 'object',
              properties: {
                style:         { type: 'object' },
                animation:     { type: 'object' },
                classFormulas: { type: 'object' },
                src:           {},
                alt:           { type: 'string' },
                icon:          { type: 'string' },
                size:          { type: 'number' },
                color:         { type: 'string' },
                loop:          { type: 'boolean' }, autoPlay: { type: 'boolean' },
                muted:         { type: 'boolean' }, controls: { type: 'boolean' },
                placeholder:   { type: 'string' },
              },
            },
            actions: {
              type: 'array',
              description: 'Bind workflows to this node. Each item is a workflow reference — navigate, runJavaScript, etc. all live inside the workflow\'s steps, not here.',
              items: {
                type: 'object',
                required: ['action'],
                additionalProperties: false,
                properties: {
                  action: { type: 'string', description: 'Workflow path to trigger — page-scoped ("pages/Page/workflows/name") or global ("workflows/name"). Multiple nodes may reference the same global workflow if each has different params.' },
                  params: { type: 'object', description: 'Per-node parameter values passed as parameters[\'name\'] inside the triggered global workflow — same as runProjectWorkflow params. Use this to share one global workflow across multiple nodes with different values.' },
                  trigger: { type: 'string', enum: ['click','change','valueChange','dragStart','dragUpdate','dragEnd','created','mounted'], description: 'Optional. Override which event fires this workflow. Normally omit.' },
                },
              },
            },
            children:    { type: 'array', items: { type: 'object' } },
            _shared:     { type: 'object', description: '{ "id": "<sc-id>", "name": "<display name>" } — SC instance.' },
            _validation: { type: 'object', description: 'Form field validation. Only on Input/Textarea inside FormContainer. { "trigger": "submit"|"change", "rules": [...] }' },
            responsive:  { type: 'object', description: 'Breakpoint overrides. Keys: laptop(≤1280px), tablet(≤1024px), mobile(≤768px). Each: { styles(camelCase CSS props), style, props, condition, text, map(plain string — NOT {js:...}), actions, animation }. styles uses CSS property names — NOT style shorthand keys.' },
          },
        },
        SCWorkflowStep: {
          type: 'object',
          required: ['type'],
          properties: {
            type: {
              type: 'string',
              enum: ['changeVariableValue','resetVariableValue','branch','multiOptionBranch','navigateTo','navigatePrev','runJavaScript','graphql','fetchCollection','fetchCollectionsParallel','forEach','whileLoop','timeDelay','setFormState','authenticate','setUser','clearSession','restoreSession','copyToClipboard','scrollToElement','controlAnimation','emitComponentTrigger'],
            },
            name: { type: 'string' },
            config: { type: 'object' },
            trueBranch:    { type: 'array', items: { type: 'object' } },
            falseBranch:   { type: 'array', items: { type: 'object' } },
            branches:      { type: 'array' },
            defaultBranch: { type: 'array', items: { type: 'object' } },
            loopBody:      { type: 'array', items: { type: 'object' } },
          },
        },
      },
      properties: {
        path:        { type: 'string', description: '"components/<id>" or "components/<folder>/<id>". The id from the path becomes the component\'s runtime id.' },
        name:        { type: 'string', description: 'Display name shown in the builder.' },
        folder:      { type: 'string', description: 'Optional folder group name.' },
        description: { type: 'string', description: 'What this component does.' },
        content: {
          type: 'object',
          description: 'Root UINode of the component. Use props.style for styling. Reference SC props via context.component.props.<name> and SC variables via context.component.variables.<varId>.',
        },
        properties: {
          type: 'array',
          description: 'Instance-configurable props. Bind them in content via context.component.props.<name>.',
          items: {
            type: 'object',
            required: ['id', 'name', 'type'],
            properties: {
              id:           { type: 'string', description: 'Stable slug.' },
              name:         { type: 'string', description: 'camelCase name used in context.component.props.<name>.' },
              type:         { type: 'string', enum: ['text','number','boolean','color','any','size','select','icon','list'] },
              defaultValue: { description: 'Default value.' },
              options:      { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } } }, description: 'Only for type "select".' },
            },
          },
        },
        variables: {
          type: 'object',
          description: 'SC-internal variables keyed by UUID v4 (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx). Referenced via context.component.variables.<varId>.',
          additionalProperties: {
            type: 'object',
            required: ['label', 'type', 'initialValue'],
            properties: {
              label:        { type: 'string' },
              type:         { type: 'string', enum: ['string','number','boolean','object','array'] },
              initialValue: { description: 'Initial value — JS type MUST match type exactly: "string" → string literal e.g. "0", "number" → number literal e.g. 0, "boolean" → true/false, "object" → {}, "array" → [].' },
              folder:       { type: 'string' },
              description:  { type: 'string' },
            },
          },
        },
        workflows: {
          type: 'object',
          description: 'SC-internal workflows keyed by UUID v4 (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx). Steps are auto-assigned IDs.',
          additionalProperties: {
            type: 'object',
            required: ['id', 'name', 'trigger', 'steps'],
            properties: {
              id:          { type: 'string', description: 'Must exactly match the object key UUID.' },
              name:        { type: 'string' },
              trigger:     { type: 'string', description: 'Lifecycle: execution|created|mounted|beforeUnmount|propertyChange. DOM: click|change|focus|blur|mouseEnter|mouseLeave|etc. Custom: any ComponentTrigger id.' },
              params:      { type: 'array', items: { type: 'object' }, description: 'Input params (for execution trigger).' },
              steps:       { type: 'array', items: { type: 'object' } },
              folder:      { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
        formulas: {
          type: 'object',
          description: 'SC-internal formulas keyed by UUID v4 (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx). Param IDs are auto-assigned.',
          additionalProperties: {
            type: 'object',
            required: ['id', 'name', 'formula', 'params'],
            properties: {
              id:          { type: 'string', description: 'Must exactly match the object key UUID.' },
              name:        { type: 'string' },
              formula:     { type: 'string', description: 'JS expression. Access params via parameters?.[\'name\']. Key is "formula" — never "code" or "expression".' },
              params:      { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', enum: ['Text','Number','Boolean','Object','Array'] }, testValue: {} }, required: ['name','type'] } },
              folder:      { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
        triggers: {
          type: 'array',
          description: 'Custom component events. Fired by emitComponentTrigger step inside the SC.',
          items: {
            type: 'object',
            required: ['id', 'name'],
            properties: {
              id:      { type: 'string', description: 'Stable slug.' },
              name:    { type: 'string', description: 'Display label.' },
              payload: { description: 'Optional payload: string expression or { formula: "..." }.' },
            },
          },
        },
      },
      required: ['path', 'name', 'content'],
    } as unknown as { type: 'object'; properties: Record<string, unknown>; required?: string[] },
  },

  // ── Typed patch/edit tools ────────────────────────────────────────────────────
  {
    name: 'edit_page',
    description: 'Deep-merge changes into a single named node in a page or group file. Objects (props, props.style, props.animation) are deep-merged — only provided keys change. Arrays (children, actions) are replaced if provided. Read the file first when you need to know existing children before adding/removing.',
    input_schema: {
      type: 'object',
      $defs: {
        StyleParams: {
          type: 'object',
          properties: {
            display:    { type: 'string', enum: ['flex','grid','block','inline-block','inline','inline-flex','hidden'] },
            direction:  { type: 'string', enum: ['row','col','row-reverse','col-reverse'] },
            items:      { type: 'string', enum: ['start','center','end','stretch','baseline'] },
            justify:    { type: 'string', enum: ['start','center','end','between','around','evenly'] },
            self:       { type: 'string', enum: ['auto','start','center','end','stretch','baseline'] },
            wrap:       { type: 'string', enum: ['wrap','nowrap','wrap-reverse'] },
            flex1:      { type: 'boolean' }, flex: {},
            gridCols: { type: 'number' }, gridRows: { type: 'number' }, gridFlow: { type: 'string' },
            colSpan: { type: 'number' }, colSpanFull: { type: 'boolean' }, rowSpan: { type: 'number' },
            gap: { type: 'number' }, gapX: { type: 'number' }, gapY: { type: 'number' },
            w: {}, h: {}, minW: {}, maxW: {}, minH: {}, maxH: {},
            p: { type: 'number' }, px: { type: 'number' }, py: { type: 'number' },
            pt: { type: 'number' }, pr: { type: 'number' }, pb: { type: 'number' }, pl: { type: 'number' },
            m: {}, mx: {}, my: {}, mt: { type: 'number' }, mr: { type: 'number' }, mb: { type: 'number' }, ml: { type: 'number' },
            bg: { type: 'string', description: 'hex, rgba, or var(--theme-*). Never CSS named colors.' }, text: { type: 'number' },
            weight: { type: 'string', enum: ['thin','extralight','light','normal','medium','semibold','bold','extrabold','black'] },
            leading: { type: 'string', enum: ['none','tight','snug','normal','relaxed','loose'] },
            tracking: { type: 'string', enum: ['tighter','tight','normal','wide','wider','widest'] },
            textAlign: { type: 'string', enum: ['left','center','right','justify'] },
            textColor: { type: 'string', description: 'hex, rgba, or var(--theme-*). Never CSS named colors — use #ffffff not white.' }, textDecoration: { type: 'string' }, textTransform: { type: 'string' },
            textOverflow: { type: 'string', enum: ['truncate'] }, whitespace: { type: 'string' }, wordBreak: { type: 'string' },
            border: { type: 'number' }, borderStyle: { type: 'string' }, borderColor: { type: 'string', description: 'hex or var(--theme-*). Never CSS named colors.' },
            radius: { type: 'number' }, radiusTL: { type: 'number' }, radiusTR: { type: 'number' },
            radiusBR: { type: 'number' }, radiusBL: { type: 'number' },
            position: { type: 'string', enum: ['static','relative','absolute','fixed','sticky'] },
            inset0: { type: 'boolean' },
            top: { type: 'number' }, right: { type: 'number' }, bottom: { type: 'number' }, left: { type: 'number' },
            z: { type: 'number' }, overflow: { type: 'string' }, cursor: { type: 'string' },
            opacity: { type: 'number' }, objectFit: { type: 'string', enum: ['cover','contain','fill','none'] },
            extra: { type: 'string' },
          },
        },
        UINode: {
          type: 'object',
          properties: {
            type:      { type: 'string', enum: ['Box','Text','Input','Textarea','FormContainer','Image','Icon','Video','Iframe'] },
            name:      { type: 'string' },
            text:      {},
            condition: { type: 'string' },
            map:       { type: 'object' },
            key:       { type: 'string' },
            props: {
              type: 'object',
              properties: {
                style: { type: 'object' },
                animation: { type: 'object' }, classFormulas: { type: 'object' },
                src: {}, alt: { type: 'string' }, icon: { type: 'string' },
                size: { type: 'number' }, color: { type: 'string' },
                loop: { type: 'boolean' }, autoPlay: { type: 'boolean' },
                muted: { type: 'boolean' }, controls: { type: 'boolean' },
                placeholder: { type: 'string' },
              },
            },
            actions:     { type: 'array', items: { type: 'object' } },
            children:    { type: 'array', items: { type: 'object' } },
            responsive:  { type: 'object' },
            _shared:     { type: 'object' },
            _validation: { type: 'object' },
          },
        },
      },
      properties: {
        path:      { type: 'string', description: 'Page or group path: "pages/<Name>/page" or "pages/<Name>/groups/<Group>".' },
        node_name: { type: 'string', description: 'Exact name field of the node to patch.' },
        changes:   { type: 'object', description: 'Partial UINode — only provided fields are merged. Objects deep-merged, arrays replaced.' },
      },
      required: ['path', 'node_name', 'changes'],
    } as unknown as { type: 'object'; properties: Record<string, unknown>; required?: string[] },
  },

  {
    name: 'edit_workflow',
    description: 'Deep-merge changes into a single named step in an existing workflow file. config is deep-merged (only provided keys change). Branch arrays (trueBranch, falseBranch, loopBody, etc.) are replaced if provided — include all steps when adding/removing from a branch. If the step is not found: read_file the workflow first to verify the exact step name (case-sensitive match on the name field).',
    input_schema: {
      type: 'object',
      $defs: {
        WorkflowStep: {
          type: 'object',
          required: ['type'],
          properties: {
            type: { type: 'string', enum: ['changeVariableValue','resetVariableValue','branch','multiOptionBranch','navigateTo','navigatePrev','runJavaScript','graphql','fetchCollection','fetchCollectionsParallel','forEach','whileLoop','timeDelay','setFormState','authenticate','setUser','clearSession','restoreSession','copyToClipboard','scrollToElement','controlAnimation','emitComponentTrigger'] },
            name: { type: 'string' },
            config: { type: 'object', properties: { variableName: { type: 'string' }, value: {}, condition: { description: "Branch/loop condition — MUST be a { js: 'booleanExpr' } binding. Example: { js: \"variables['store/displayValue'] === '0'\" }" }, path: { type: 'string' }, code: { type: 'string' }, ms: { type: 'number' }, collectionId: { type: 'string' }, targetNodeId: { type: 'string' }, action: { type: 'string' }, text: {}, linkType: { type: 'string' } } },
            trueBranch:    { type: 'array', items: { type: 'object' } },
            falseBranch:   { type: 'array', items: { type: 'object' } },
            branches:      { type: 'array' },
            defaultBranch: { type: 'array', items: { type: 'object' } },
            loopBody:      { type: 'array', items: { type: 'object' } },
          },
        },
      },
      properties: {
        path:      { type: 'string', description: 'Workflow path — same friendly path used in write_workflow, e.g. "pages/Calculator/workflows/handleClick" or "workflows/sharedHandler".' },
        step_name: { type: 'string', description: 'Exact name field of the step to patch (searched recursively through all branches).' },
        changes: {
          type: 'object',
          description: 'Partial WorkflowStep — must be a plain object, never a JSON string. config is deep-merged; branch arrays replaced if provided.',
          properties: {
            type: { type: 'string' },
            name: { type: 'string' },
            config: { type: 'object' },
            trueBranch:    { type: 'array', items: { type: 'object' } },
            falseBranch:   { type: 'array', items: { type: 'object' } },
            branches:      { type: 'array' },
            defaultBranch: { type: 'array', items: { type: 'object' } },
            loopBody:      { type: 'array', items: { type: 'object' } },
          },
        },
      },
      required: ['path', 'step_name', 'changes'],
    } as unknown as { type: 'object'; properties: Record<string, unknown>; required?: string[] },
  },

  {
    name: 'edit_trigger',
    description: 'Deep-merge changes into a single named step in a trigger file. Same merge rules as edit_workflow.',
    input_schema: {
      type: 'object',
      $defs: {
        TriggerStep: {
          type: 'object',
          required: ['type'],
          properties: {
            type: { type: 'string' },
            name: { type: 'string' },
            config: { type: 'object' },
            trueBranch:  { type: 'array', items: { type: 'object' } },
            falseBranch: { type: 'array', items: { type: 'object' } },
            loopBody:    { type: 'array', items: { type: 'object' } },
          },
        },
      },
      properties: {
        path:      { type: 'string', description: 'Trigger path: "pages/<Name>/triggers/<type>" or "triggers/<type>".' },
        step_name: { type: 'string', description: 'Exact name of the step to patch.' },
        changes: {
          type: 'object',
          properties: {
            type: { type: 'string' }, name: { type: 'string' }, config: { type: 'object' },
            trueBranch:  { type: 'array', items: { type: 'object' } },
            falseBranch: { type: 'array', items: { type: 'object' } },
            loopBody:    { type: 'array', items: { type: 'object' } },
          },
        },
      },
      required: ['path', 'step_name', 'changes'],
    } as unknown as { type: 'object'; properties: Record<string, unknown>; required?: string[] },
  },

  {
    name: 'edit_variable',
    description: 'Patch specific fields of an existing store variable. Only provided fields are updated; all others are preserved.',
    input_schema: {
      type: 'object',
      properties: {
        path:            { type: 'string', description: 'Variable path — same friendly path used in write_variable, e.g. "store/displayValue".' },
        name:            { type: 'string' },
        type:            { type: 'string', enum: ['string','number','boolean','object','array'] },
        initialValue:    { description: 'New initial value — JS type MUST match type exactly: "string" → string literal e.g. "0", "number" → number literal e.g. 0, "boolean" → true/false, "object" → {}, "array" → [].' },
        description:     { type: 'string' },
        persist:         { type: 'string', enum: ['session','local'] },
        resetOnNavigate: { type: 'boolean' },
        urlParam:        { type: 'object', properties: { param: { type: 'string' }, default: { type: 'string' } } },
      },
      required: ['path'],
    },
  },

  {
    name: 'edit_datasource',
    description: 'Patch specific fields of an existing datasource. Only provided fields are updated; all others are preserved.',
    input_schema: {
      type: 'object',
      properties: {
        path:          { type: 'string', description: 'Datasource path — same friendly path used in write_datasource, e.g. "data/products".' },
        name:          { type: 'string' },
        type:          { type: 'string', enum: ['rest','graphql'] },
        url:           { type: 'string' },
        method:        { type: 'string', enum: ['GET','POST','PUT','PATCH','DELETE'] },
        headers:       { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' }, enabled: { type: 'boolean' } } } },
        queryParams:   { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' }, enabled: { type: 'boolean' } } } },
        body:          {},
        responsePath:  { type: 'string' },
        trigger:       { type: 'string', enum: ['mount','action'] },
        cacheTTL:      { type: 'number' },
        cacheTag:      { type: 'string' },
        endpoint:      { type: 'string' },
        query:         { type: 'string' },
        variables:     { type: 'object' },
        skipStoreWhenNull: { type: 'boolean' },
      },
      required: ['path'],
    },
  },

  {
    name: 'edit_formula',
    description: 'Patch specific fields of an existing formula/util. Only provided fields are updated.',
    input_schema: {
      type: 'object',
      properties: {
        path:        { type: 'string', description: 'Formula path: "utils/<name>".' },
        name:        { type: 'string' },
        description: { type: 'string' },
        formula:     { type: 'string', description: 'Updated JS expression. Key is "formula" — never "code".' },
        params: {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', enum: ['Text','Number','Boolean','Object','Array'] }, testValue: {} }, required: ['name','type'] },
          description: 'Full params array (replaces existing params).',
        },
      },
      required: ['path'],
    },
  },

  {
    name: 'edit_route',
    description: 'Update a single route entry in the routes file. Finds the route by its URL path and merges the provided fields.',
    input_schema: {
      type: 'object',
      properties: {
        route_path:   { type: 'string', description: 'URL path of the route to update.' },
        config:       { type: 'string', description: 'Page name.' },
        name:         { type: 'string' },
        layout:       { type: 'string', enum: ['full','centered','admin','none'] },
        auth:         { type: 'boolean' },
        guestOnly:    { type: 'boolean' },
        authRedirect: { type: 'string' },
        dynamic:      { type: 'boolean' },
      },
      required: ['route_path'],
    },
  },

  {
    name: 'edit_component',
    description: 'Patch a shared component. Two modes: (1) if node_name is provided — deep-merge changes into that UINode in the content tree; (2) if node_name is omitted — merge top-level component fields (name, description, properties, variables, triggers, formulas) into the existing model.',
    input_schema: {
      type: 'object',
      $defs: {
        StyleParams: {
          type: 'object',
          properties: {
            display: { type: 'string', enum: ['flex','grid','block','inline-block','inline','inline-flex','hidden'] },
            direction: { type: 'string', enum: ['row','col','row-reverse','col-reverse'] },
            items: { type: 'string', enum: ['start','center','end','stretch','baseline'] },
            justify: { type: 'string', enum: ['start','center','end','between','around','evenly'] },
            w: {}, h: {}, minW: {}, maxW: {}, minH: {}, maxH: {},
            p: { type: 'number' }, px: { type: 'number' }, py: { type: 'number' },
            pt: { type: 'number' }, pr: { type: 'number' }, pb: { type: 'number' }, pl: { type: 'number' },
            m: {}, mx: {}, my: {}, mt: { type: 'number' }, mr: { type: 'number' }, mb: { type: 'number' }, ml: { type: 'number' },
            bg: { type: 'string', description: 'hex, rgba, or var(--theme-*). Never CSS named colors.' }, text: { type: 'number' },
            weight: { type: 'string', enum: ['thin','extralight','light','normal','medium','semibold','bold','extrabold','black'] },
            textColor: { type: 'string', description: 'hex, rgba, or var(--theme-*). Never CSS named colors — use #ffffff not white.' }, textAlign: { type: 'string' },
            radius: { type: 'number' }, border: { type: 'number' }, borderColor: { type: 'string', description: 'hex or var(--theme-*). Never CSS named colors.' },
            position: { type: 'string', enum: ['static','relative','absolute','fixed','sticky'] },
            top: { type: 'number' }, right: { type: 'number' }, bottom: { type: 'number' }, left: { type: 'number' },
            gap: { type: 'number' }, flex1: { type: 'boolean' }, flex: {},
            cursor: { type: 'string' }, opacity: { type: 'number' }, overflow: { type: 'string' },
            objectFit: { type: 'string', enum: ['cover','contain','fill','none'] },
            extra: { type: 'string' },
          },
        },
        UINode: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['Box','Text','Input','Textarea','FormContainer','Image','Icon','Video','Iframe'] },
            name: { type: 'string' }, text: {}, condition: { type: 'string' }, map: { type: 'object' }, key: { type: 'string' },
            props: { type: 'object', properties: { style: { type: 'object' }, animation: { type: 'object' }, classFormulas: { type: 'object' }, src: {}, alt: { type: 'string' }, icon: { type: 'string' }, size: { type: 'number' }, color: { type: 'string' } } },
            actions: { type: 'array', items: { type: 'object' } },
            children: { type: 'array', items: { type: 'object' } },
            responsive: { type: 'object' },
          },
        },
      },
      properties: {
        path:      { type: 'string', description: 'Component path: "components/<id>/component".' },
        node_name: { type: 'string', description: 'If provided: find this node in the content tree and deep-merge changes. If omitted: merge top-level component fields.' },
        changes: {
          type: 'object',
          description: 'Mode 1 (node_name set): partial UINode changes. Mode 2 (no node_name): top-level component fields (name, description, properties, variables, triggers, formulas).',
        },
      },
      required: ['path', 'changes'],
    } as unknown as { type: 'object'; properties: Record<string, unknown>; required?: string[] },
  },

  // ── Theme tools ───────────────────────────────────────────────────────────────
  {
    name: 'write_theme',
    description: 'Set theme CSS variable overrides for light and/or dark mode. Replaces the current overrides entirely. Use edit_theme to change individual variables without clobbering the rest.',
    input_schema: {
      type: 'object',
      properties: {
        overrides: {
          type: 'object',
          description: 'Light mode CSS variable overrides. Keys: --background, --foreground, --primary, --primary-foreground, --secondary, --secondary-foreground, --muted, --muted-foreground, --accent, --accent-foreground, --card, --card-foreground, --border, --input, --ring, --destructive, --destructive-foreground, --radius.',
          additionalProperties: { type: 'string' },
        },
        darkOverrides: {
          type: 'object',
          description: 'Dark mode CSS variable overrides. Same keys as overrides.',
          additionalProperties: { type: 'string' },
        },
      },
    },
  },

  {
    name: 'edit_theme',
    description: 'Merge specific CSS variable overrides into the existing theme. Only provided keys change. Use to update one or a few variables without touching the rest.',
    input_schema: {
      type: 'object',
      properties: {
        overrides: {
          type: 'object',
          description: 'Light mode keys to update.',
          additionalProperties: { type: 'string' },
        },
        darkOverrides: {
          type: 'object',
          description: 'Dark mode keys to update.',
          additionalProperties: { type: 'string' },
        },
      },
    },
  },

  {
    name: 'write_colors',
    description: 'Replace the full custom colors list at design/colors. Each entry is a semantic color available as var(--color-<id>) in both light and dark mode.',
    input_schema: {
      type: 'object',
      properties: {
        colors: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id','name','light','dark'],
            properties: {
              id:    { type: 'string', description: 'Stable slug.' },
              name:  { type: 'string', description: 'Display name.' },
              light: { type: 'string', description: 'Hex or rgba for light mode.' },
              dark:  { type: 'string', description: 'Hex or rgba for dark mode.' },
            },
          },
        },
      },
      required: ['colors'],
    },
  },

  {
    name: 'edit_color',
    description: 'Add or update a single custom color entry in design/colors. If a color with the given id already exists, it is updated; otherwise it is appended.',
    input_schema: {
      type: 'object',
      properties: {
        id:    { type: 'string', description: 'Stable slug identifying the color.' },
        name:  { type: 'string', description: 'Display name.' },
        light: { type: 'string', description: 'Hex or rgba for light mode.' },
        dark:  { type: 'string', description: 'Hex or rgba for dark mode.' },
      },
      required: ['id'],
    },
  },

  {
    name: 'delete_file',
    description: 'Delete a virtual file, removing the underlying resource from the builder store (variable, workflow, datasource, page, component, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to delete.',
        },
      },
      required: ['path'],
    },
  },

  // ── Media search (read-only) ──────────────────────────────────────────────
  {
    name: 'search_images',
    description: 'Search for stock photos (Unsplash / Pexels fallback). Returns [{url, alt}]. Call before setting any Image node src or Box background image.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Visual search query.' },
        count: { type: 'number', description: 'Number of results (1–8). Default 4.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_videos',
    description: 'Search for stock videos (Pexels). Returns [{src, poster}]. Call before setting any Video node src.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Visual search query.' },
        count: { type: 'number', description: 'Number of results (1–8). Default 4.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_icons',
    description: 'Search Iconify for icon names matching a concept. Returns an array of icon name strings. ALWAYS call this before placing any Icon node — never hardcode an icon name.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        prefix: { type: 'string', description: 'Optional icon set prefix to restrict results: "lucide", "heroicons", "mdi", "tabler", "phosphor".' },
        count: { type: 'number', description: 'Number of results (1–20). Default 10.' },
      },
      required: ['query'],
    },
  },
];
