/**
 * formula-rewrite.test.ts — Tests for formula and binding rewriting.
 */

import { describe, it, expect } from 'vitest';
import { rewriteFormula, rewriteTextValue, pathToExpr } from '../formula-rewrite';
import type { SymbolMap } from '../types';

function makeSymbols(
  vars: Record<string, string> = {},
  collections: Record<string, string> = {},
): SymbolMap {
  return {
    vars: new Map(Object.entries(vars)),
    collections: new Map(Object.entries(collections)),
    workflows: new Map(),
    routes: new Map(),
  };
}

describe('rewriteFormula', () => {
  it('rewrites variables UUID references', () => {
    const symbols = makeSymbols({ 'cart-uuid': 'cartCount' });
    const result = rewriteFormula("variables['cart-uuid'] > 0", symbols);
    expect(result).toBe('state.variables.cartCount > 0');
  });

  it('rewrites collections UUID references', () => {
    const symbols = makeSymbols({}, { 'products-uuid': 'products' });
    const result = rewriteFormula("collections['products-uuid'].length", symbols);
    expect(result).toBe('state.collections.products.length');
  });

  it('renames `if` to `ifThen`', () => {
    const symbols = makeSymbols();
    const result = rewriteFormula('if(x > 0, "yes", "no")', symbols);
    expect(result).toBe('ifThen(x > 0, "yes", "no")');
  });

  it('does NOT rename method calls like obj.if()', () => {
    const symbols = makeSymbols();
    const result = rewriteFormula('foo.if(bar)', symbols);
    // Should NOT rename object.if() — only bare if(
    expect(result).toContain('foo.if(bar)');
  });

  it('renames `switch` to `switchOn`', () => {
    const symbols = makeSymbols();
    const result = rewriteFormula('switch(val, "a", 1, "b", 2)', symbols);
    expect(result).toBe('switchOn(val, "a", 1, "b", 2)');
  });

  it('rewrites route.* references', () => {
    const symbols = makeSymbols();
    const result = rewriteFormula('route.id === "123"', symbols);
    expect(result).toBe('state.route?.id === "123"');
  });

  it('rewrites auth.* references', () => {
    const symbols = makeSymbols();
    const result = rewriteFormula('auth.user.name', symbols);
    expect(result).toBe('state.auth?.user.name');
  });

  it('rewrites context.item in map scope', () => {
    const symbols = makeSymbols();
    const result = rewriteFormula('context.item.name', symbols, true);
    expect(result).toBe('_item.name');
  });

  it('does NOT rewrite context.item outside map scope', () => {
    const symbols = makeSymbols();
    const result = rewriteFormula('context.item.name', symbols, false);
    expect(result).toBe('context.item.name');
  });
});

describe('rewriteTextValue', () => {
  it('handles plain strings', () => {
    const symbols = makeSymbols();
    expect(rewriteTextValue('hello', symbols)).toBe('"hello"');
  });

  it('handles {{path}} template strings', () => {
    const symbols = makeSymbols({ 'cart': 'cartCount' });
    const result = rewriteTextValue('Total: {{cart.total}}', symbols);
    expect(result).toContain('`');
    expect(result).toContain('Total:');
    expect(result).toContain('cart?.total');
    expect(result).toContain('state');
  });

  it('handles { var: "path" } bindings', () => {
    const symbols = makeSymbols();
    const result = rewriteTextValue({ var: 'user.name' }, symbols);
    // pathToExpr builds optional chains: state?.user?.name
    expect(result).toContain('user?.name');
    expect(result).toContain('state');
  });

  it('handles { formula: "..." } bindings', () => {
    const symbols = makeSymbols({ 'count': 'itemCount' });
    const result = rewriteTextValue({ formula: "variables['count'] > 0" }, symbols);
    expect(result).toBe('state.variables.itemCount > 0');
  });

  it('handles { var: ["path", fallback] } with fallback', () => {
    const symbols = makeSymbols();
    const result = rewriteTextValue({ var: ['user.email', 'Anonymous'] }, symbols);
    expect(result).toContain('??');
    expect(result).toContain('"Anonymous"');
  });

  it('returns empty string for null/undefined', () => {
    const symbols = makeSymbols();
    expect(rewriteTextValue(undefined, symbols)).toBe("''");
  });
});

describe('pathToExpr', () => {
  it('converts dot-path to optional chain', () => {
    const symbols = makeSymbols();
    expect(pathToExpr('cart.total', symbols)).toBe('state?.cart?.total');
  });

  it('converts numeric segment to bracket notation', () => {
    const symbols = makeSymbols();
    expect(pathToExpr('items.0.name', symbols)).toBe('state?.items?.[0]?.name');
  });

  it('resolves variable UUIDs via symbol map', () => {
    const symbols = makeSymbols({ 'some-uuid': 'cartCount' });
    expect(pathToExpr('some-uuid', symbols)).toBe('state.variables.cartCount');
  });
});
