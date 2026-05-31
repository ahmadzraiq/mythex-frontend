/**
 * formula-rewrite.ts
 *
 * Rewrites engine formula strings into clean React/JS expressions:
 *   variables['UUID']          → state.variables.cartCount
 *   collections['UUID']        → state.collections.products
 *   context.item               → item  (inside a .map() callback)
 *   context.index              → index
 *   pages['UUID']              → state.pages.home
 *   if(cond, a, b)             → ifThen(cond, a, b)  [reserved-word rename]
 *   switch(expr, ...)          → switchOn(expr, ...)  [reserved-word rename]
 *   globalContext.browser.*    → globalContext.browser.*  (kept as-is)
 *
 * Formula functions from FORMULA_FNS are available from lib/utils.ts in the
 * emitted project, re-exported under the same names EXCEPT `if` → `ifThen`
 * and `switch` → `switchOn`.
 */

import type { SymbolMap } from './types';

// UUID pattern (captures all 5 groups: 8-4-4-4-12 hex chars)
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Rewrite a formula string using the symbol map */
export function rewriteFormula(formula: string, symbols: SymbolMap, inMapScope = false): string {
  if (!formula || typeof formula !== 'string') return formula;

  let out = formula;

  // variables['UUID'] or variables?.['UUID'] or variables["UUID"] → state.variables.<ident>
  out = out.replace(/\bvariables\s*(?:\?\.)?\[\s*['"]([^'"]+)['"]\s*\]/g, (_, uuid) => {
    const ident = symbols.vars.get(uuid);
    if (ident) return `state.variables.${ident}`;
    return `state.variables['${uuid}']`;
  });

  // variables.UUID (dot notation with raw UUID — invalid JS, rewrite immediately)
  out = out.replace(
    new RegExp(`\\bvariables\\.(${UUID_RE.source})`, 'gi'),
    (_, uuid) => {
      const ident = symbols.vars.get(uuid.toLowerCase()) ?? symbols.vars.get(uuid);
      if (ident) return `state.variables.${ident}`;
      return `state.variables['${uuid}']`;
    },
  );

  // collections['UUID'] or collections?.['UUID'] or collections["UUID"] → state.collections.<ident>
  out = out.replace(/\bcollections\s*(?:\?\.)?\[\s*['"]([^'"]+)['"]\s*\]/g, (_, uuid) => {
    const ident = symbols.collections.get(uuid);
    if (ident) return `state.collections.${ident}`;
    return `state.collections['${uuid}']`;
  });

  // collections.UUID (dot notation with raw UUID — invalid JS, rewrite immediately)
  out = out.replace(
    new RegExp(`\\bcollections\\.(${UUID_RE.source})`, 'gi'),
    (_, uuid) => {
      const ident = symbols.collections.get(uuid.toLowerCase()) ?? symbols.collections.get(uuid);
      if (ident) return `state.collections.${ident}`;
      return `state.collections['${uuid}']`;
    },
  );

  // variables.humanName or variables?.humanName (non-UUID plain identifier) → state.variables.humanName
  // Handles { js: "variables.cartCount" } style JS mode blocks that use human-readable names.
  // Negative lookbehind (?<!\.) excludes `state.variables.xxx` (already rewritten).
  out = out.replace(/(?<!\.)\bvariables\??\.([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g, (_, name) =>
    `state.variables.${name}`,
  );

  // collections.humanName or collections?.humanName (non-UUID plain identifier) → state.collections.humanName
  out = out.replace(/(?<!\.)\bcollections\??\.([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g, (_, name) =>
    `state.collections.${name}`,
  );

  // pages['UUID'] → state.pages.<ident>
  out = out.replace(/\bpages\s*\[\s*['"]([^'"]+)['"]\s*\]/g, (_, uuid) => {
    return `state.pages['${uuid}']`;
  });

  // context?.item or context.item → _item  (map-scope loop variable)
  // context?.index or context.index → index
  // $item and $index are also used as shorthand for the loop variables
  if (inMapScope) {
    out = out.replace(/\bcontext\??\.item\b/g, '_item');
    out = out.replace(/\bcontext\??\.index\b/g, 'index');
    out = out.replace(/\bcontext\??\.parent\b/g, '_parent');
    // bare `item.` prefix (without context.) in map context → _item
    out = out.replace(/(?<![._$\w])item\??\./g, '_item?.');
    // $item and $index — engine shorthand for loop variables
    out = out.replace(/\$item\b/g, '_item');
    out = out.replace(/\$index\b/g, 'index');
    // Make all `_item.field` → `_item?.field` (safe access on potentially-undefined items)
    out = out.replace(/_item((?:\??\.(?:[a-zA-Z_$][a-zA-Z0-9_$]*)|\??\[\d+\])+)/g, (_, chain) => {
      const safeChain = chain.replace(/(?<!\?)\.([a-zA-Z_$])/g, '?.$1');
      return `_item${safeChain}`;
    });
  } else {
    // Outside map scope, $item should still not become state.$item
    out = out.replace(/\$item\b/g, '_item');
    out = out.replace(/\$index\b/g, 'index');
  }

  // Form validation error state — engine stores errors as local.data.form.fields.X.isValid
  // In the exported app, this maps to RHF's errors object (errors.X?.message)
  // Note: `isValid` in this engine context actually stores the ERROR MESSAGE, not a boolean
  out = out.replace(
    /(?:state\??\.)?local\??\.data\??\.form\??\.fields\??\.?(\w+)\??\.isValid/g,
    (_, field) => `(errors as any)?.[${JSON.stringify(field)}]?.message`,
  );

  // context?.component?.* — engine self-prop reference not available post-inline; substitute undefined
  // Consume the entire chain after context?.component to avoid dangling ?.something
  out = out.replace(/\bcontext\??\.component(?:\??\.(?:[a-zA-Z_$][a-zA-Z0-9_$]*)|\??\[[^\]]*\])*/g, 'undefined');

  // wwLib engine API rewrites — for pure { formula } expressions (not JS code blocks).
  // JS code blocks get the full `wwLib` polyfill object declared at the top of each workflow function.
  // wwLib.variables.get('name') → look up in state (safe in both formula and JS contexts)
  out = out.replace(/\bwwLib\s*\??\.variables\s*\??\.get\s*\(\s*['"]([^'"]+)['"]\s*\)/g, (_, name) => {
    const varIdent = symbols.vars.get(name);
    if (varIdent) return `state.variables?.${varIdent}`;
    // Fallback: try human-readable name lookup
    const fallbackIdent = [...symbols.vars.entries()].find(([, v]) => v === name)?.[1];
    if (fallbackIdent) return `state.variables?.${fallbackIdent}`;
    return `(state.variables as any)?.['${name}']`;
  });

  // theme.colors['key'] or theme?.['colors']?.['key'] → CSS variable var(--theme-key)
  out = out.replace(
    /\btheme\s*(?:\?\.)?\s*\[?\s*['"]?colors?['"]?\s*\]?\s*\??\.\s*\[?\s*['"]([^'"]+)['"]\s*\]?/g,
    (_, key) => `'var(--theme-${key.toLowerCase().replace(/\s+/g, '-')})'`,
  );
  // Also handle theme?.colors?.key (dot notation)
  out = out.replace(/\btheme\??\.colors?\??\.([a-zA-Z][a-zA-Z0-9_-]*)/g,
    (_, key) => `'var(--theme-${key.toLowerCase().replace(/([A-Z])/g, '-$1').toLowerCase()})'`,
  );

  // get('path') — engine formula accessor → resolve against symbol map or fall back to local scope
  out = out.replace(/\bget\s*\(\s*['"]([^'"]+)['"]\s*\)/g, (_, path) => {
    if (path.startsWith('$parent.')) {
      // $parent.FIELD — refers to the enclosing map item (outer _item in nested maps).
      // inMapScope=true → JSX context, _parentItem is captured; else workflow context.
      const field = path.slice('$parent.'.length);
      if (inMapScope) return field === 'id' ? '_parentItemId' : `_parentItem?.data?.${field}`;
      return field === 'id' ? '(context as any)?.parentItemId' : `(context as any)?.parentItem?.data?.${field}`;
    }
    if (path.startsWith('$')) {
      // Other $-prefixed context refs — not resolvable statically
      return 'undefined /* get($context) */';
    }
    // Try global variables map first
    const varIdent = symbols.vars.get(path);
    if (varIdent) return `state.variables.${varIdent}`;
    const collIdent = symbols.collections.get(path);
    if (collIdent) return `state.collections.${collIdent}`;
    // Page-local state variable — use the `local` scope (typed as Record<string, unknown>)
    const parts = path.split('.');
    let expr = '(state.local as Record<string, unknown>)';
    for (const p of parts) expr += /^\d+$/.test(p) ? `?.[${p}]` : `?.${p}`;
    return expr;
  });

  // $parent.FIELD — bare usage (e.g. in template strings {{$parent.id}}) that wasn't
  // inside a get('...') call. Must run AFTER the get() handler above so that
  // get('$parent.id') is handled first and doesn't leave $parent.id for this rule.
  // When inMapScope=true (JSX with _parentItem captured): use _parentItemId / _parentItem?.data?.FIELD.
  // When inMapScope=false (workflow function body): use (context as any)?.parentItemId passed via ctx.
  out = out.replace(/\$parent\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g, (_, field) => {
    if (inMapScope) {
      return field === 'id' ? '_parentItemId' : `_parentItem?.data?.${field}`;
    }
    return field === 'id' ? '(context as any)?.parentItemId' : `(context as any)?.parentItem?.data?.${field}`;
  });

  // Rename reserved-word formula functions — ONLY the functional form `if(cond, a, b)`
  // NOT JS `if (cond) { ... }` statements. Detect the functional form by requiring a comma
  // in the argument list (formula `if` always has at least 2 args; JS `if` has none).
  out = out.replace(/(?<![.\w])\bif\s*\((?=[^)]*,)/g, 'ifThen(');
  out = out.replace(/(?<![.\w])\bswitch\s*\((?=[^)]*,)/g, 'switchOn(');

  // local.* or local?.* → state.local?.* (page-local state scope)
  // Convert ALL subsequent dots to optional chains so deep paths don't throw when intermediate values are undefined.
  out = out.replace(/(?<![.\w])\blocal\??\.([a-zA-Z_$][\w.]*)/g, (_, rest) => {
    const parts = rest.split('.');
    return 'state.local?.' + parts.map(p => (/^\d+$/.test(p) ? `[${p}]` : p)).join('?.');
  });
  // Fallback: bare `local?.` with no identifier after (edge case)
  out = out.replace(/(?<![.\w])\blocal\?\./g, 'state.local?.');

  // FormContainer live state: state.local?.data?.form?.* → RHF reactive vars
  // These are generated after `local.*` → `state.local?.*` rewrites above.
  // formData: live field values from form.watch()
  out = out.replace(/\bstate\.local\?\.data\?\.form\?\.formData\b/g, '_formData');
  // isSubmitted: only true when the form was submitted and validation passed
  out = out.replace(/\bstate\.local\?\.data\?\.form\?\.isSubmitted\b/g, '_formIsSubmitSuccessful');
  // Aggregate fields object → build from RHF errors (only covers error fields; valid fields absent).
  // isValid maps to the error message string (matching SDUI engine's convention) or false if no message.
  out = out.replace(
    /\bstate\.local\?\.data\?\.form\?\.fields\b/g,
    // eslint-disable-next-line no-useless-escape
    '(Object.fromEntries(Object.entries(form?.formState?.errors??{}).map(([_fk,_fv]):[string,{isValid:unknown}]=>[_fk,{isValid:(_fv as any)?.message||false}])))',
  );

  // route.* or route?.* → state.route.*
  out = out.replace(/\broute\??\./, 'state.route?.');

  // auth.* or auth?.* → state.auth.*
  out = out.replace(/\bauth\??\./, 'state.auth?.');

  // _workflow?.* or _workflow.* → state._workflow.*
  out = out.replace(/\b_workflow\??\./, 'state._workflow?.');

  // globalContext?.browser?.* — runtime browser context not available during SSR.
  // Rewrite to _globalCtx which is declared as a safe SSR fallback in each page.
  out = out.replace(/\bglobalContext\b/g, '_globalCtx');

  // Numeric index via dot or optional-chain dot notation is invalid JS/TS:
  //   ?.0?.  →  ?.[0]?.       items.0.name  →  items?.[0].name
  // Guard with (?<!\d) so decimal literals (1.5, 1.0) are NOT touched.
  out = out.replace(/(?<!\d)(\??)\.(\d+)(?=\??[.[]|$)/g, (_, _q, n) => `?.[${n}]`);

  // Mixing `||` or `&&` with `??` at the same precedence level is a JS syntax error.
  // Fix the most common pattern: `expr || fallback ?? default`  → `(expr || fallback) ?? default`
  out = out.replace(/([^()\s][^()]*?(?:\|\||&&)[^()]*?)\s*\?\?\s*(\[\]|undefined|null)/g,
    (_, lhs, rhs) => `(${lhs.trim()}) ?? ${rhs}`,
  );

  // Final safety pass: ensure state-scoped paths don't throw on null intermediate values.
  // Converts `state.collections.ident.field` → `state.collections.ident?.field` (etc.)
  // Also handles bracket-notation: `state.variables['UUID'].field` → `state.variables['UUID']?.field`
  out = out.replace(
    /\bstate\.(collections|variables|auth|route|local|_workflow|pages)((?:(?:\??\.(?:[a-zA-Z_$][a-zA-Z0-9_$]*))|(?:\??\[['"][^\]'"]*['"]\]))+)/g,
    (_, scope, chain) => {
      // Re-write all non-optional `.ident` to `?.ident` within the chain
      const safeChain = chain
        .replace(/(?<!\?)\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g, '?.$1')
        .replace(/(?<!\?)\[/g, '?.[');
      return `state.${scope}${safeChain}`;
    },
  );
  // Also fix bracket-notation fallbacks like `state.variables['UUID'].field`
  out = out.replace(
    /(\bstate\.(?:collections|variables)\??\[['"][^\]'"]*['"]\])\.([a-zA-Z_$])/g,
    (_, prefix, firstChar) => `${prefix}?.${firstChar}`,
  );

  return out;
}

/**
 * Rewrite a "text" field which may be:
 *   - string with {{path}} templates → JSX template literal or simple expression
 *   - { var: "path" } → optional-chained expression
 *   - { formula: "..." } → rewritten formula
 *   - { js: "..." } → rewritten JS
 */
export function rewriteTextValue(
  text: string | Record<string, unknown> | undefined,
  symbols: SymbolMap,
  inMapScope = false,
): string {
  if (text == null) return "''";

  if (typeof text === 'string') {
    // Check for {{path}} templates
    if (text.includes('{{')) {
      return rewriteTemplate(text, symbols, inMapScope);
    }
    return JSON.stringify(text);
  }

  if (typeof text === 'object') {
    if ('formula' in text) {
      const f = (text as { formula: string }).formula;
      if (typeof f === 'string') {
        return rewriteFormula(f, symbols, inMapScope);
      }
    }
    if ('js' in text) {
      const f = (text as { js: string }).js;
      if (typeof f === 'string') {
        const rewritten = rewriteFormula(f, symbols, inMapScope);
        // Multi-statement JS (has `const/let/var/return`) cannot be a JSX expression —
        // wrap in a self-invoking arrow so {(() => { ... })()} works in JSX.
        if (/\b(const|let|var|return)\b/.test(f)) {
          const indented = rewritten.split('\n').map(l => `  ${l}`).join('\n');
          return `(() => {\n${indented}\n})()`;
        }
        return rewritten;
      }
    }
    if ('var' in text) {
      const v = (text as { var: string | [string, unknown] }).var;
      const path = Array.isArray(v) ? String(v[0]) : String(v);
      const fallback = Array.isArray(v) ? v[1] : undefined;
      const expr = pathToExpr(path, symbols);
      if (fallback != null) return `(${expr} ?? ${JSON.stringify(fallback)})`;
      return expr;
    }
    // prefix/suffix/template wrappers
    if ('prefix' in text || 'suffix' in text || 'template' in text) {
      const inner = text as { formula?: string; js?: string; prefix?: string; suffix?: string; template?: string };
      const core = inner.formula ? rewriteFormula(inner.formula as string, symbols, inMapScope)
        : inner.js ? rewriteFormula(inner.js, symbols, inMapScope)
        : "''";
      if (inner.template) return `${JSON.stringify(inner.template)}.replace('{0}', String(${core}))`;
      const pre = inner.prefix ? `${JSON.stringify(inner.prefix)} + ` : '';
      const suf = inner.suffix ? ` + ${JSON.stringify(inner.suffix)}` : '';
      return `${pre}String(${core})${suf}`;
    }
  }

  return JSON.stringify(String(text));
}

/** Rewrite a {{path}} template string to a JS template literal */
function rewriteTemplate(template: string, symbols: SymbolMap, inMapScope: boolean): string {
  // Build a template literal by replacing {{ }} with ${...}
  const parts = template.split(/\{\{([^}]+)\}\}/g);
  if (parts.length === 1) return JSON.stringify(template);

  const segments: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // Literal segment
      segments.push(parts[i]!.replace(/`/g, '\\`').replace(/\$/g, '\\$'));
    } else {
      // Expression segment — first run formula rewriting (for variables['UUID'] etc.)
      const raw = parts[i]!.trim();
      let expr = rewriteFormula(raw, symbols, inMapScope);

      // JS keywords / literals should never be passed to pathToExpr
      const JS_LITERALS = new Set(['undefined', 'null', 'true', 'false', 'NaN', 'Infinity', '_item', '_parentItem', '_parentItemId', 'index']);
      // Runtime identifiers: expressions starting with these are already valid JS and must NOT
      // be processed by pathToExpr (which would prepend `state?.`).
      const RUNTIME_PREFIXES = new Set(['state', 'context', 'router', 'api', '_item', '_parentItem', '_parentItemId', 'useStore', 'index', 'event', 'form', 'popover', 'wwLib']);
      const topIdent = /^([a-zA-Z_$][a-zA-Z0-9_$]*)/.exec(expr)?.[1] ?? '';
      // If the expression is still a simple dotted path (no parens, operators, etc.)
      // treat it as a state path and run it through pathToExpr (which handles map scope)
      if (!JS_LITERALS.has(expr) && /^[a-zA-Z_$][a-zA-Z0-9_.]*$/.test(expr) && !RUNTIME_PREFIXES.has(topIdent)) {
        expr = pathToExpr(expr, symbols, inMapScope);
      }

      // Null-coalesce to empty string so undefined/null values show as '' not "undefined"/"null"
      segments.push('${(' + expr + ') ?? \'\'}');
    }
  }
  return '`' + segments.join('') + '`';
}

/**
 * Convert a state path (e.g. "cart.totalQuantity") to an optional-chained expression.
 * When inMapScope=true, paths starting with "item" resolve to the loop variable `_item`.
 */
export function pathToExpr(path: string, symbols: SymbolMap, inMapScope = false): string {
  // Check if it's a variable reference by UUID — resolved to camelCase ident for dot-notation access
  if (symbols.vars.has(path)) {
    return `state.variables.${symbols.vars.get(path)}`;
  }
  // Check if it's a collection reference by UUID
  if (symbols.collections.has(path)) {
    return `state.collections.${symbols.collections.get(path)}`;
  }

  const parts = path.split('.');

  // Inside a .map() callback, bare "item" means the loop variable _item
  if (inMapScope && (parts[0] === 'item' || parts[0] === '_item')) {
    const [, ...rest] = parts;
    if (rest.length === 0) return '_item';
    return '_item' + rest.map(p => (/^\d+$/.test(p) ? `?.[${p}]` : `?.${p}`)).join('');
  }

  // Build optional chain: "cart.lines.0.quantity" → state?.cart?.lines?.[0]?.quantity
  let out = 'state';
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      out += `?.[${part}]`;
    } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(part)) {
      out += `?.${part}`;
    } else {
      out += `?.['${part}']`;
    }
  }
  return out;
}

/**
 * Returns true when a rewritten formula result is a static CSS value that has no
 * runtime JavaScript references and therefore must be emitted as a quoted string.
 * Examples: "calc(100% - 80px)", "60px", "2rem", "rgba(0,0,0,0.5)"
 */
function isCSSLiteral(expr: string): boolean {
  const s = expr.trim();
  // Has runtime JS references — keep as expression
  if (s.includes('state.') || s.includes('_item') || s.includes('variables.') || s.includes('collections.') || s.includes('_globalCtx') || s.includes('context.') || s.includes('router.') || s.includes('api.')) return false;
  // CSS function calls: calc(), rgb(), rgba(), hsl(), linear-gradient(), var(), env()
  if (/^(calc|rgb|rgba|hsl|hsla|linear-gradient|radial-gradient|conic-gradient|var|env|min|max|clamp|url)\s*\(/.test(s)) return true;
  // CSS dimension or percentage: 60px, 2.5rem, 100%, 1em, 50vw, etc.
  if (/^\d+(\.\d+)?(px|em|rem|vh|vw|vmin|vmax|%|pt|cm|mm|deg|fr|ch|ex|s|ms)$/.test(s)) return true;
  // CSS named color or bare hex color
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return true;
  return false;
}

/**
 * Rewrite a prop value (which may be a binding) into a JSX-safe expression.
 */
export function rewritePropValue(
  value: unknown,
  symbols: SymbolMap,
  inMapScope = false,
): string {
  if (value === null || value === undefined) return 'undefined';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value.includes('{{')) {
      return rewriteTemplate(value, symbols, inMapScope);
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('formula' in obj && typeof obj.formula === 'string') {
      const result = rewriteFormula(obj.formula, symbols, inMapScope);
      // If the formula had no runtime references it is a static CSS/string value — quote it.
      if (isCSSLiteral(result)) return JSON.stringify(result);
      return result;
    }
    if ('js' in obj && typeof obj.js === 'string') {
      const rewritten = rewriteFormula(obj.js, symbols, inMapScope);
      if (/\b(const|let|var|return)\b/.test(obj.js)) {
        const indented = rewritten.split('\n').map(l => `  ${l}`).join('\n');
        return `(() => {\n${indented}\n})()`;
      }
      return rewritten;
    }
    if ('var' in obj) {
      const v = obj.var;
      const path = Array.isArray(v) ? String(v[0]) : String(v);
      const fallback = Array.isArray(v) ? v[1] : undefined;
      const expr = pathToExpr(path, symbols);
      if (fallback != null) return `(${expr} ?? ${JSON.stringify(fallback)})`;
      return expr;
    }
    // Action callback — wired by action emitter
    if ('action' in obj) return `() => { /* action: ${String(obj.action)} */ }`;
    // Plain object
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}
