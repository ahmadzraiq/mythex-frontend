/**
 * Detects the file type of a DSL source file by reading its top-level define*() call.
 * Returns the compiler type and the resolved config target path.
 *
 * No folder conventions required — the AI can put files anywhere in src/.
 */

import ts from 'typescript'
import fs from 'fs'

export type CompilerType =
  | 'var'
  | 'workflow'
  | 'page'
  | 'trigger'
  | 'component'
  | 'formula'
  | 'datasource'
  | 'route'
  | 'theme'
  | 'group'
  | 'unknown'

export interface DetectResult {
  type: CompilerType
  /** Value of the `path` option from the define*() call, if present */
  configPath: string | null
  /** Value of additional option fields */
  options: Record<string, string>
}

const DEFINE_MAP: Record<string, CompilerType> = {
  definePage: 'page',
  defineWorkflow: 'workflow',
  defineVar: 'var',
  defineTrigger: 'trigger',
  defineComponent: 'component',
  defineFormula: 'formula',
  defineDatasource: 'datasource',
  defineRoute: 'route',
  defineTheme: 'theme',
  defineGroup: 'group',
}

function getStringLiteralValue(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node)) return node.text
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

function extractOptionsFromObjectLiteral(
  obj: ts.ObjectLiteralExpression,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const key = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
      ? prop.name.text
      : null
    if (!key) continue
    const val = getStringLiteralValue(prop.initializer)
    if (val !== null) result[key] = val
  }
  return result
}

/**
 * Detect file type by scanning for the first define*() call expression.
 * Works on both `export default definePage(...)` and `export const x = defineVar(...)`.
 */
export function detectFileType(srcPath: string): DetectResult {
  let source: string
  try {
    source = fs.readFileSync(srcPath, 'utf-8')
  } catch {
    return { type: 'unknown', configPath: null, options: {} }
  }

  const sf = ts.createSourceFile(srcPath, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)

  let result: DetectResult = { type: 'unknown', configPath: null, options: {} }

  function visit(node: ts.Node): boolean {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression)
    ) {
      const fnName = node.expression.text
      const compilerType = DEFINE_MAP[fnName]
      if (compilerType) {
        result.type = compilerType

        // Most define*() calls have an options object as first arg
        const firstArg = node.arguments[0]
        if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
          result.options = extractOptionsFromObjectLiteral(firstArg)
          result.configPath = result.options.path ?? result.options.id ?? null
        }

        // defineVar first arg is the type string (no options object)
        if (fnName === 'defineVar') {
          result.configPath = null
          result.options = {}
        }

        return true
      }
    }

    return ts.forEachChild(node, visit) ?? false
  }

  visit(sf)
  return result
}

/**
 * Detect ALL define*() calls in a file (for files with multiple exports like store files).
 * Returns a list of (exportName, compilerType, options) for each found.
 */
export interface ExportedDefine {
  exportName: string
  type: CompilerType
  options: Record<string, string>
  /** Line number (0-indexed) */
  line: number
}

export function detectAllDefines(srcPath: string): ExportedDefine[] {
  let source: string
  try {
    source = fs.readFileSync(srcPath, 'utf-8')
  } catch {
    return []
  }

  const sf = ts.createSourceFile(srcPath, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const results: ExportedDefine[] = []

  function visit(node: ts.Node) {
    // export const x = defineVar(...)
    if (
      ts.isVariableStatement(node) &&
      (node.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (!decl.initializer) continue
        const init = decl.initializer
        if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
          const fnName = init.expression.text
          const compilerType = DEFINE_MAP[fnName]
          if (!compilerType) continue
          const exportName = ts.isIdentifier(decl.name) ? decl.name.text : 'unknown'
          const firstArg = init.arguments[0]
          const options: Record<string, string> = {}
          if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
            Object.assign(options, extractOptionsFromObjectLiteral(firstArg))
          }
          const line = sf.getLineAndCharacterOfPosition(node.getStart()).line
          results.push({ exportName, type: compilerType, options, line })
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  return results
}
