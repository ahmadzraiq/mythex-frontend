/**
 * lib/dsl/compiler/lower/index.ts — Public API of the Babel-based lowering module.
 */
export { lowerExpression } from './lower-expression'
export { lowerAction } from './lower-action'
export { makeEnv, type LoweringEnv, type MapFrame } from './env'
export { lowerError, LowerError, isUnsupported } from './subset'
export { parseExpr, parseStmts, parseFile, print, printExpr } from './parse'
