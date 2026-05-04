/**
 * identifiers.test.ts — Tests for the identifier generator.
 */

import { describe, it, expect } from 'vitest';
import { toIdent, uniqueIdent, routeToComponentName, routeToFilePath } from '../identifiers';

describe('toIdent', () => {
  it('converts simple strings to camelCase', () => {
    expect(toIdent('my-var name')).toBe('myVarName');
  });

  it('handles UUIDs by removing dashes', () => {
    const result = toIdent('abc0d6f3-1234-5678-abcd-ef0123456789');
    expect(result).toMatch(/^[a-zA-Z_$]/);
    expect(result).not.toContain('-');
  });

  it('prepends n for strings starting with digit', () => {
    expect(toIdent('123abc')).toMatch(/^n/);
  });

  it('renames reserved JS words', () => {
    expect(toIdent('if')).not.toBe('if');
    expect(toIdent('switch')).not.toBe('switch');
    expect(toIdent('class')).not.toBe('class');
  });

  it('renames reserved state scope names', () => {
    const result = toIdent('variables');
    expect(result).not.toBe('variables');
  });

  it('handles empty string', () => {
    const result = toIdent('');
    expect(result).toMatch(/^[a-zA-Z_$]/);
  });
});

describe('uniqueIdent', () => {
  it('returns base ident when no collision', () => {
    const used = new Set<string>();
    expect(uniqueIdent('cart', 'uuid-1', used)).toBe('cart');
    expect(used.has('cart')).toBe(true);
  });

  it('appends numeric suffix on collision', () => {
    const used = new Set<string>(['cart']);
    expect(uniqueIdent('cart', 'uuid-2', used)).toBe('cart2');
  });

  it('falls back to uuid when label is undefined', () => {
    const used = new Set<string>();
    const result = uniqueIdent(undefined, 'abc-def-ghi', used);
    expect(result).toMatch(/^[a-zA-Z_$]/);
  });
});

describe('routeToComponentName', () => {
  it('converts "/" to "HomePage"', () => {
    expect(routeToComponentName('/')).toBe('HomePage');
  });

  it('converts "/about" to "AboutPage"', () => {
    expect(routeToComponentName('/about')).toBe('AboutPage');
  });

  it('converts "/products/[id]" to "ProductsIdPage"', () => {
    expect(routeToComponentName('/products/[id]')).toBe('ProductsIdPage');
  });
});

describe('routeToFilePath', () => {
  it('converts "/" to "app/page.tsx"', () => {
    expect(routeToFilePath('/')).toBe('app/page.tsx');
  });

  it('converts "/about" to "app/about/page.tsx"', () => {
    expect(routeToFilePath('/about')).toBe('app/about/page.tsx');
  });

  it('converts "/blog/[slug]" to "app/blog/[slug]/page.tsx"', () => {
    expect(routeToFilePath('/blog/[slug]')).toBe('app/blog/[slug]/page.tsx');
  });
});
