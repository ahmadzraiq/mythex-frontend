/**
 * Shared workflow validation utilities.
 *
 * Importable from both lib/ai/tool-executor.ts (client) and
 * app/api/ai/builder-chat/route.ts (server) without pulling in Zustand.
 *
 * These enforce system-level constraints only — no domain-specific logic.
 */

import { FORMULA_FNS } from '@/lib/sdui/formula-functions';

const KNOWN_FN_NAMES = new Set(Object.keys(FORMULA_FNS));

export const PROHIBITED_STEP_TYPES = new Set(['customJavaScript', 'animate']);

/**
 * Validates a single formula expression string for security and correctness.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateFormula(expr: string): string | null {
  if (/\beval\s*\(/.test(expr)) {
    return 'eval() is not allowed in formulas. Use multiOptionBranch with explicit arithmetic instead: toNumber(variables[\'prevUUID\']) + toNumber(variables[\'currUUID\']), etc.';
  }
  if (/\bMath\s*\./.test(expr)) {
    const matches = expr.match(/\bMath\s*\.\s*(\w+)/g) ?? [];
    const names = matches.map(m => m.replace(/\bMath\s*\.\s*/, ''));
    const suggestions = names.map(n => {
      const lower = n.toLowerCase();
      const found = [...KNOWN_FN_NAMES].find(k => k.toLowerCase() === lower);
      return found ? `Math.${n}() → ${found}()` : `Math.${n}() (not available as a formula function)`;
    });
    return `Formula uses JavaScript globals (${matches.join(', ')}). Use the formula functions directly instead: ${suggestions.join('; ')}. Available math functions: ${[...KNOWN_FN_NAMES].filter(k => ['abs','ceil','floor','round','max','min','clamp','pow','sqrt','mod','sum'].includes(k)).join(', ')}.`;
  }
  // Balanced parentheses check — catches truncated switch()/toText()/if() calls.
  // Skip characters inside single-quoted string literals to avoid false positives.
  {
    let depth = 0;
    let inStr = false;
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (ch === "'" && (i === 0 || expr[i - 1] !== '\\')) {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth < 0) {
        return `Unbalanced parentheses in formula — extra ')' found. Check all opening '(' have a matching ')'.`;
      }
    }
    if (depth > 0) {
      return `Unbalanced parentheses in formula — ${depth} unclosed '(' found. A closing ')' is likely missing at the end of a switch(), if(), or other nested function call. Count your opening and closing parentheses and fix before retrying.`;
    }
  }
  return null;
}

/**
 * Validates all changeVariableValue formula steps in a workflow, including nested branches/loops.
 * Returns an error string if any step has an invalid formula, or null if all pass.
 */
export function validateWorkflowFormulas(steps: Array<Record<string, unknown>>): string | null {
  for (const step of steps) {
    if (step.type === 'changeVariableValue') {
      const cfg = step.config as Record<string, unknown> | undefined;
      const value = cfg?.value as Record<string, unknown> | undefined;
      if (typeof value?.formula === 'string') {
        const err = validateFormula(value.formula);
        if (err) return `Step "${step.id ?? '?'}": ${err}`;
      }
    }
    // Validate condition formulas in branching/loop steps.
    if (['branch', 'multiOptionBranch', 'whileLoop', 'passThroughCondition'].includes(step.type as string)) {
      const cfg = step.config as Record<string, unknown> | undefined;
      if (typeof cfg?.condition === 'string') {
        const err = validateFormula(cfg.condition);
        if (err) return `Step "${step.id ?? '?'}" condition: ${err}`;
      }
    }
    for (const branch of ['trueBranch', 'falseBranch', 'loopBody', 'defaultBranch'] as const) {
      if (Array.isArray(step[branch])) {
        const err = validateWorkflowFormulas(step[branch] as Array<Record<string, unknown>>);
        if (err) return err;
      }
    }
    if (Array.isArray(step.branches)) {
      for (const b of step.branches as Array<Record<string, unknown>>) {
        if (Array.isArray(b.steps)) {
          const err = validateWorkflowFormulas(b.steps as Array<Record<string, unknown>>);
          if (err) return err;
        }
      }
    }
  }
  return null;
}

/**
 * Recursively checks all steps (including nested branches/loops) for prohibited types.
 * Returns an error string if any prohibited type is found, or null if all pass.
 */
export function findProhibitedStep(
  steps: Array<Record<string, unknown>>,
  prohibited: Set<string> = PROHIBITED_STEP_TYPES,
): string | null {
  for (const step of steps) {
    const t = step.type as string | undefined;
    if (t && prohibited.has(t)) {
      return `Step "${step.id ?? '?'}": type "${t}" is not supported. Use changeVariableValue, navigateTo, or other supported types instead.`;
    }
    for (const branch of ['trueBranch', 'falseBranch', 'loopBody', 'defaultBranch'] as const) {
      if (Array.isArray(step[branch])) {
        const err = findProhibitedStep(step[branch] as Array<Record<string, unknown>>, prohibited);
        if (err) return err;
      }
    }
    if (Array.isArray(step.branches)) {
      for (const b of step.branches as Array<Record<string, unknown>>) {
        if (Array.isArray(b.steps)) {
          const err = findProhibitedStep(b.steps as Array<Record<string, unknown>>, prohibited);
          if (err) return err;
        }
      }
    }
  }
  return null;
}
