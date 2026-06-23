/**
 * subset.ts — Supported-subset contract and lowerError.
 *
 * Defines which Babel node types the lowerers handle.  Any node type that
 * the traversal reaches but has no lowering rule calls lowerError(), which
 * throws a precise compile-time error (file, line/column, source snippet)
 * instead of emitting silent wrong output.
 *
 * This is INTERNAL to the compiler — no MCP / tsconfig / eslint involvement.
 */
import type * as t from '@babel/types'

// ---------------------------------------------------------------------------
// Supported expression node types (formula mode)
// ---------------------------------------------------------------------------
export const SUPPORTED_EXPR_TYPES = new Set<string>([
  // Identifiers & literals
  'Identifier',
  'StringLiteral',
  'NumericLiteral',
  'BooleanLiteral',
  'NullLiteral',
  'BigIntLiteral',
  // Template literals
  'TemplateLiteral',
  'TemplateElement',
  // Member / optional access
  'MemberExpression',
  'OptionalMemberExpression',
  'ChainExpression',
  // Calls
  'CallExpression',
  'OptionalCallExpression',
  // Operators
  'UnaryExpression',
  'BinaryExpression',
  'LogicalExpression',
  'ConditionalExpression',
  'AssignmentExpression',
  // Literals (structured)
  'ArrayExpression',
  'ObjectExpression',
  'ObjectProperty',
  'ObjectMethod',
  'SpreadElement',
  'RestElement',
  'AssignmentPattern',
  // Arrow / function for callbacks
  'ArrowFunctionExpression',
  'FunctionExpression',
  // Sequence (comma operator — appears in some compiled output)
  'SequenceExpression',
  // Parenthesized
  'ParenthesizedExpression',
  // TypeScript — ignored during lowering (stripped by Babel)
  'TSAsExpression',
  'TSTypeAssertion',
  'TSNonNullExpression',
  'TSInstantiationExpression',
])

// ---------------------------------------------------------------------------
// Supported statement node types (workflow / action mode)
// ---------------------------------------------------------------------------
export const SUPPORTED_STMT_TYPES = new Set<string>([
  'ExpressionStatement',
  'BlockStatement',
  'IfStatement',
  'ReturnStatement',
  'VariableDeclaration',
  'VariableDeclarator',
  // Allow in workflow bodies
  'ThrowStatement',
  'TryStatement',
  'CatchClause',
  // TypeScript
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
  'ImportDeclaration',
])

// ---------------------------------------------------------------------------
// Explicitly OUT-OF-SUBSET (must fail loud)
// ---------------------------------------------------------------------------
export const UNSUPPORTED_TYPES = new Set<string>([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'LabeledStatement',
  'WithStatement',
  'DebuggerStatement',
  'ClassDeclaration',
  'ClassExpression',
  'TaggedTemplateExpression',
  'YieldExpression',
  'AwaitExpression',    // only allowed in workflow statements, not formulas
])

// ---------------------------------------------------------------------------
// lowerError
// ---------------------------------------------------------------------------

export class LowerError extends Error {
  readonly node: t.Node
  readonly sourceFile: string
  readonly snippet: string

  constructor(node: t.Node, sourceFile: string, message: string) {
    const loc = node.loc
    const locStr = loc
      ? `${sourceFile}:${loc.start.line}:${loc.start.column}`
      : sourceFile
    // Build a snippet from the node's source if available
    const snippet = (node as any).extra?.raw ?? (node as any).name ?? node.type

    super(`[DSL compiler] ${message}\n  at ${locStr}\n  node: ${node.type} (${snippet})`)
    this.name = 'LowerError'
    this.node = node
    this.sourceFile = sourceFile
    this.snippet = snippet
  }
}

/**
 * Throw a LowerError for an unsupported or unhandled node type.
 * Call this from a lowering rule when it encounters a construct with no rule.
 */
export function lowerError(node: t.Node, sourceFile: string, message?: string): never {
  const msg = message ?? `unsupported construct: ${node.type}`
  throw new LowerError(node, sourceFile, msg)
}

/**
 * Return true if the node type is explicitly out-of-subset.
 */
export function isUnsupported(node: t.Node): boolean {
  return UNSUPPORTED_TYPES.has(node.type)
}
