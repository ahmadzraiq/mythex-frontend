/**
 * lib/dsl/diagnostics.ts
 *
 * Two-layer diagnostics gate for the DSL agent:
 *
 * 1. runTypeDiagnostics(sources) — builds an in-memory TypeScript program,
 *    runs getPreEmitDiagnostics, and returns all type errors.
 *
 * 2. runAllowlistLint(sources) — AST walk that flags constructs the closed DSL
 *    API forbids, with an actionable canonical fix in each message.
 *
 * Both return Diagnostic[]; combineAllDiagnostics() merges them.
 * The `validate` MCP tool exposed in dsl-agent/route.ts calls both.
 */

import ts from 'typescript'
import path from 'path'

// ─── Diagnostic type ──────────────────────────────────────────────────────────

export interface Diagnostic {
  file:    string
  line:    number   // 1-based
  col:     number   // 1-based
  code:    string   // 'TS2322' or 'DSL/rule-name'
  message: string
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function nodeText(n: ts.Node): string {
  return n.getText().trim()
}

// ─── 1. Type diagnostics via ts.Program ───────────────────────────────────────

/**
 * Build an in-memory TypeScript program from the provided sources and return
 * all pre-emit diagnostics (type errors, missing symbols, etc.).
 *
 * `builderSrc` is the content of builder.ts — passed as a virtual file so the
 * program can type-check imports from './builder'.
 */
export function runTypeDiagnostics(
  sources: Record<string, string>,
  builderSrc: string,
): Diagnostic[] {
  const allFiles: Record<string, string> = {
    'builder.ts': builderSrc,
    ...sources,
  }

  const compilerOptions: ts.CompilerOptions = {
    target:     ts.ScriptTarget.ES2020,
    module:     ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx:        ts.JsxEmit.ReactJSX,
    jsxImportSource: 'react',
    strict:     true,
    skipLibCheck: true,
    noEmit:     true,
  }

  const host = ts.createCompilerHost(compilerOptions)
  const origGetSourceFile = host.getSourceFile.bind(host)

  host.getSourceFile = (fileName, langVersion) => {
    const rel = path.basename(fileName)
    if (rel in allFiles) {
      return ts.createSourceFile(rel, allFiles[rel], langVersion, true)
    }
    // Also try exact match for paths like 'pages/catalog.tsx'
    if (fileName in allFiles) {
      return ts.createSourceFile(fileName, allFiles[fileName], langVersion, true)
    }
    return origGetSourceFile(fileName, langVersion)
  }

  host.fileExists = (fileName) => {
    const rel = path.basename(fileName)
    return rel in allFiles || fileName in allFiles || ts.sys.fileExists(fileName)
  }

  host.readFile = (fileName) => {
    const rel = path.basename(fileName)
    if (rel in allFiles) return allFiles[rel]
    if (fileName in allFiles) return allFiles[fileName]
    return ts.sys.readFile(fileName)
  }

  const program = ts.createProgram(Object.keys(allFiles), compilerOptions, host)
  const allDiagnostics = ts.getPreEmitDiagnostics(program)

  const results: Diagnostic[] = []
  for (const diag of allDiagnostics) {
    if (!diag.file) continue
    const fileName = path.basename(diag.file.fileName)
    // Skip diagnostics from builder.ts itself (it uses `any` intentionally)
    if (fileName === 'builder.ts') continue
    // Skip lib errors (we don't bundle @types/react etc.)
    if (!diag.file.fileName || diag.file.fileName.includes('node_modules')) continue

    const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start ?? 0)
    const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n')
    results.push({
      file:    fileName,
      line:    line + 1,
      col:     character + 1,
      code:    `TS${diag.code}`,
      message,
    })
  }

  return results
}

// ─── 2. Allowlist lint rules ───────────────────────────────────────────────────

const EVENT_PROPS = new Set(['onClick', 'onChange', 'onSubmit'])
const DEFINE_NAMES = new Set(['defineVar', 'defineWorkflow', 'defineFunction',
  'defineDatasource', 'defineComponent', 'defineTrigger', 'definePage', 'defineRoute',
  'defineTheme'])

/**
 * Walk all provided source files and return DSL-specific lint violations.
 * Every violation includes the exact canonical fix.
 */
export function runAllowlistLint(sources: Record<string, string>): Diagnostic[] {
  const results: Diagnostic[] = []

  for (const [filename, src] of Object.entries(sources)) {
    if (filename === 'builder.ts') continue
    const sf = ts.createSourceFile(filename, src, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX)
    lintFile(sf, filename, results)
  }

  return results
}

function lintFile(sf: ts.SourceFile, filename: string, out: Diagnostic[]): void {
  function pos(node: ts.Node): { line: number; col: number } {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    return { line: line + 1, col: character + 1 }
  }

  function report(node: ts.Node, code: string, message: string) {
    const { line, col } = pos(node)
    out.push({ file: filename, line, col, code, message })
  }

  // Track whether we're inside a render body (definePage / defineComponent render fn)
  // so we can distinguish render-body `let` from workflow-body `let`.
  const renderBodyDepth = { value: 0 }

  // ─── Top-level checks ────────────────────────────────────────────────────────
  ts.forEachChild(sf, (topNode) => {

    // 1. enum at top level
    if (ts.isEnumDeclaration(topNode)) {
      report(topNode, 'DSL/no-enum',
        `Enums emit runtime JS. Replace with a const object: const ${topNode.name.text} = { ... } as const`)
      return
    }

    // 2. npm imports (only './builder' and relative paths allowed)
    if (ts.isImportDeclaration(topNode)) {
      const specifier = (topNode.moduleSpecifier as ts.StringLiteral).text
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
        report(topNode, 'DSL/import-allowlist',
          `Imports from npm packages ('${specifier}') are not allowed. Import only from './builder' and local files.`)
      }
      return
    }

    // 3. Top-level side effects (expression statements that are not variable declarations)
    if (ts.isExpressionStatement(topNode)) {
      const expr = topNode.expression
      // Allow: call expressions that ARE define* calls are fine
      if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) &&
          DEFINE_NAMES.has(expr.expression.text)) return
      report(topNode, 'DSL/no-top-level-side-effect',
        `Top-level side effects are not allowed. Use defineTrigger('pageLoad', () => { ... }) for lifecycle effects.`)
      return
    }

    // Walk into variable statements to check for local component consts
    if (ts.isVariableStatement(topNode)) {
      for (const decl of topNode.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        const init = decl.initializer

        // Check for local component: const X = () => <JSX/>  OR  const X = () => { return <JSX/> }
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          if (returnsJsx(init)) {
            // It's a define* call? Fine.
            // Is the initializer itself directly an arrow returning JSX (not wrapped in define*)?
            const exported = topNode.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
            if (!exported || !isDefineWrap(init.parent)) {
              // Only flag if it's a raw arrow/function, not inside defineComponent
              if (!isInsideDefineCall(init)) {
                report(decl, 'DSL/no-local-component',
                  `Local components must be declared with defineComponent. Use: export const ${decl.name.text} = defineComponent('${decl.name.text}', { props: {} }, (props) => <JSX/>)`)
              }
            }
          }
        }
      }
    }
  })

  // ─── TypeScript syntax check (files must be plain JS+JSX) ──────────────────
  // Skip: builder.ts is the only allowed TypeScript file.
  if (filename !== 'builder.ts') {
    function checkNoTs(node: ts.Node) {
      // Type annotations on parameters or variable declarators: (n: number), const x: Type
      if (ts.isParameter(node) && node.type) {
        report(node.type, 'DSL/no-typescript',
          'Write plain JavaScript — no TypeScript type annotations. Remove the `: Type` part.')
      }
      if (ts.isVariableDeclaration(node) && node.type) {
        report(node.type, 'DSL/no-typescript',
          'Write plain JavaScript — no TypeScript type annotations. Remove the `: Type` part.')
      }
      // type Foo = ...
      if (ts.isTypeAliasDeclaration(node)) {
        report(node, 'DSL/no-typescript',
          'Type aliases are not allowed. Use plain JavaScript — no TypeScript syntax.')
      }
      // interface Foo { ... }
      if (ts.isInterfaceDeclaration(node)) {
        report(node, 'DSL/no-typescript',
          'Interfaces are not allowed. Use plain JavaScript — no TypeScript syntax.')
      }
      // x as Type
      if (ts.isAsExpression(node)) {
        report(node, 'DSL/no-typescript',
          'Type casts (`as Type`) are not allowed. Remove the cast.')
      }
      // <Type>x
      if (ts.isTypeAssertionExpression(node)) {
        report(node, 'DSL/no-typescript',
          'Type assertions (`<Type>x`) are not allowed. Remove the assertion.')
      }
      // fn<Type>() — generic type arguments on call expressions
      if (ts.isCallExpression(node) && node.typeArguments && node.typeArguments.length > 0) {
        report(node.typeArguments[0], 'DSL/no-typescript',
          'Generic type arguments are not allowed. Call the function without `<Type>` parameters.')
      }
      ts.forEachChild(node, checkNoTs)
    }
    ts.forEachChild(sf, checkNoTs)
  }

  // ─── Deep JSX walk ──────────────────────────────────────────────────────────
  walkJsx(sf)

  function walkJsx(node: ts.Node) {
    // Detect entering a render body (definePage / defineComponent render arg)
    const enteringRender = isRenderBodyArrow(node)
    if (enteringRender) renderBodyDepth.value++

    // Check JSX attribute values
    if (ts.isJsxAttribute(node)) {
      const attrName = node.name.getText(sf)
      const expr = node.initializer

    }

    // 6. .map() / ternary / && returning JSX — these are all valid now (compiler handles them)

    // 7. `let` in render bodies (not workflow/function bodies)
    if (renderBodyDepth.value > 0 && ts.isVariableStatement(node)) {
      if (node.declarationList.flags & ts.NodeFlags.Let) {
        const names = node.declarationList.declarations
          .map(d => ts.isIdentifier(d.name) ? d.name.text : '?')
          .join(', ')
        report(node, 'DSL/no-let-in-render',
          `Mutable 'let' in a render body is not allowed. For reactive state use: const ${names} = defineVar(initialValue); update it with set(${names}, newValue) on events.`)
      }
    }

    ts.forEachChild(node, walkJsx)

    if (enteringRender) renderBodyDepth.value--
  }
}

// ─── AST helpers ──────────────────────────────────────────────────────────────

/** True if this node is an arrow/function that is the render argument of definePage/defineComponent */
function isRenderBodyArrow(node: ts.Node): boolean {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false
  const parent = node.parent
  if (!ts.isCallExpression(parent)) return false
  const callee = parent.expression
  if (!ts.isIdentifier(callee)) return false
  return callee.text === 'definePage' || callee.text === 'defineComponent'
}

/** True if the arrow/function immediately returns JSX (not inside another define call) */
function returnsJsx(fn: ts.ArrowFunction | ts.FunctionExpression): boolean {
  if (!ts.isBlock(fn.body)) {
    return ts.isJsxElement(fn.body) || ts.isJsxFragment(fn.body) || ts.isJsxSelfClosingElement(fn.body) ||
           ts.isParenthesizedExpression(fn.body) && returnsJsxExpr((fn.body as ts.ParenthesizedExpression).expression)
  }
  for (const stmt of fn.body.statements) {
    if (ts.isReturnStatement(stmt) && stmt.expression) {
      if (returnsJsxExpr(stmt.expression)) return true
    }
  }
  return false
}

function returnsJsxExpr(expr: ts.Expression): boolean {
  return ts.isJsxElement(expr) || ts.isJsxFragment(expr) || ts.isJsxSelfClosingElement(expr) ||
    (ts.isParenthesizedExpression(expr) && returnsJsxExpr(expr.expression))
}

/** True if this node is inside a defineComponent() call expression */
function isInsideDefineCall(node: ts.Node): boolean {
  let cur: ts.Node | undefined = node.parent
  while (cur) {
    if (ts.isCallExpression(cur) && ts.isIdentifier(cur.expression)) {
      if (DEFINE_NAMES.has(cur.expression.text)) return true
    }
    cur = cur.parent
  }
  return false
}

/** True if init's parent is a define* call (used to allow defineComponent render arg) */
function isDefineWrap(parent: ts.Node | undefined): boolean {
  if (!parent) return false
  if (!ts.isCallExpression(parent)) return false
  if (!ts.isIdentifier(parent.expression)) return false
  return DEFINE_NAMES.has(parent.expression.text)
}

/** True if expr is a .map() call that returns JSX */
function isJsxMapCall(expr: ts.Expression, sf: ts.SourceFile): boolean {
  if (!ts.isCallExpression(expr)) return false
  const access = expr.expression
  if (!ts.isPropertyAccessExpression(access)) return false
  if (access.name.text !== 'map') return false
  // Check if the callback returns JSX
  const cb = expr.arguments[0]
  if (!cb) return false
  if (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) {
    return returnsJsx(cb as ts.ArrowFunction | ts.FunctionExpression)
  }
  return false
}

/** True if the expression might return JSX (top-level check) */
function expressionMayReturnJsx(expr: ts.Expression): boolean {
  if (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr) || ts.isJsxFragment(expr)) return true
  if (ts.isParenthesizedExpression(expr)) return expressionMayReturnJsx(expr.expression)
  return false
}

// ─── Combined ────────────────────────────────────────────────────────────────

export function combineAllDiagnostics(
  sources: Record<string, string>,
  builderSrc: string,
): Diagnostic[] {
  const type = runTypeDiagnostics(sources, builderSrc)
  const lint = runAllowlistLint(sources)
  return [...type, ...lint].sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col,
  )
}

/** Format diagnostics as a human-readable string for the agent */
export function formatDiagnostics(diags: Diagnostic[]): string {
  if (diags.length === 0) return 'No errors. All files are valid.'
  const lines = diags.map(d =>
    `${d.file}:${d.line}:${d.col}  ${d.code}  ${d.message}`,
  )
  return `${diags.length} problem${diags.length === 1 ? '' : 's'}:\n\n${lines.join('\n')}\n\nFix all problems, then call validate again. The compiled output is blocked until clean.`
}
