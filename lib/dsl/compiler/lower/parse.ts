/**
 * parse.ts — Thin wrappers around @babel/parser and @babel/generator.
 *
 * All lowerers call parseExpr / parseStmts to obtain a Babel AST, then call
 * print() to turn it back into a string exactly once at the end.
 */

import babelParse from '@babel/parser'
import generate from '@babel/generator'
import type * as t from '@babel/types'

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

/**
 * Parse `code` as a single expression.
 * Wraps in parens so object literals / arrow functions are valid expressions.
 */
export function parseExpr(code: string): t.Expression {
  const wrapped = `(${code})`
  const file = babelParse.parse(wrapped, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
    errorRecovery: true,
  })
  const stmt = file.program.body[0]
  if (!stmt || stmt.type !== 'ExpressionStatement') {
    throw new Error(`parseExpr: expected ExpressionStatement, got ${stmt?.type} for: ${code}`)
  }
  const expr = (stmt as t.ExpressionStatement).expression
  // Unwrap the synthetic parens wrapper
  if (expr.type === 'ParenthesizedExpression') {
    return (expr as t.ParenthesizedExpression).expression
  }
  return expr
}

/**
 * Parse `code` as a list of statements (workflow action body).
 */
export function parseStmts(code: string): t.Statement[] {
  const file = babelParse.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
    errorRecovery: true,
  })
  return file.program.body as t.Statement[]
}

/**
 * Parse a complete file.  Used for scope-building in lowerExpression.
 */
export function parseFile(code: string): t.File {
  return babelParse.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
    errorRecovery: true,
  })
}

// ---------------------------------------------------------------------------
// Print helper
// ---------------------------------------------------------------------------

/**
 * Serialise a Babel AST node back to a JS string.
 * We suppress extra parens around top-level expressions and use compact output.
 */
export function print(node: t.Node): string {
  // @babel/generator default options produce clean output
  const result = generate(node as any, {
    compact: false,
    concise: false,
    jsescOption: { minimal: true },
  })
  return result.code.trim()
}

/**
 * Print an expression, removing any outer parentheses added by generate.
 */
export function printExpr(expr: t.Expression): string {
  const raw = print(expr)
  // Babel sometimes wraps expressions in extra parens; strip one level.
  if (raw.startsWith('(') && raw.endsWith(')')) {
    // Only strip if the parens are balanced at the outer level
    let depth = 0
    for (let i = 0; i < raw.length - 1; i++) {
      if (raw[i] === '(') depth++
      else if (raw[i] === ')') depth--
      if (depth === 0 && i < raw.length - 1) {
        // Parens close before end — don't strip
        return raw
      }
    }
    return raw.slice(1, -1).trim()
  }
  return raw
}
