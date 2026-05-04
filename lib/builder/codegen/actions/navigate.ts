import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

interface NavigateStep { type: 'navigate' | 'navigateWithQuery' | 'goToPage'; url?: string; href?: string; page?: string; pageName?: string; query?: Record<string, unknown>; payload?: Record<string, unknown> }

export function emitNavigate(step: NavigateStep, symbols: SymbolMap): string {
  const url = step.url ?? step.href ?? (step.payload?.url as string) ?? (step.payload?.href as string) ?? '';
  const pageName = step.page ?? step.pageName ?? (step.payload?.page as string) ?? (step.payload?.pageName as string) ?? '';

  if (step.type === 'goToPage' && pageName) {
    // Map named pages to their routes
    const route = symbols.routes.get(pageName) ?? pageName;
    return `router.push(${JSON.stringify(route)});`;
  }

  if (step.type === 'navigateWithQuery' && step.query) {
    const queryExpr = rewritePropValue(step.query, symbols);
    const urlExpr = url.includes('{{') ? rewritePropValue(url, symbols) : JSON.stringify(url);
    return `router.push(${urlExpr} + buildQueryString(${queryExpr}));`;
  }

  if (!url) {
    return `/* navigate: missing url */`;
  }

  if (url.includes('{{')) {
    return `router.push(${rewritePropValue(url, symbols)});`;
  }

  return `router.push(${JSON.stringify(url)});`;
}
