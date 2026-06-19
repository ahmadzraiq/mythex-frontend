/**
 * Compile-probe: returns true if `code` is a valid JavaScript expression
 * (i.e. can be used as the body of `return (expr);`).
 *
 * Uses the same V8 parser that will execute the code, so it handles every edge
 * case correctly — object literals, template literals containing semicolons,
 * identifiers that start with reserved words (`variables`, `letCount`), and
 * multi-line ternary expressions.
 *
 * This replaces all regex-based keyword sniffing (`STMT_START`, `hasStatements`,
 * `isCodeBlock`, etc.) in the evaluators.
 */
export function isExpression(code: string): boolean {
  if (!code || !code.trim()) return false;
  try {
    // eslint-disable-next-line no-new-func
    new Function(`return (${code.trim()});`);
    return true;
  } catch {
    return false;
  }
}
