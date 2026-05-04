/**
 * theme.test.ts — Verify CSS variable emission for theme.
 */

import { describe, it, expect } from 'vitest';
import { emitGlobalsCss } from '../theme';
import type { CodegenCtx } from '../types';

function makeCtx(overrides: Record<string, string>, darkOverrides: Record<string, string>, customColors: Array<{ name: string; light: string; dark: string }>): CodegenCtx {
  return {
    store: {
      themeOverrides: overrides,
      themeDarkOverrides: darkOverrides,
      customVars: [],
      pageDataSources: [],
      pages: [],
    } as never,
    symbols: { vars: new Map(), collections: new Map(), workflows: new Map(), routes: new Map() },
    flags: {} as never,
    varsByName: new Map(),
    varsById: new Map(),
    dsById: new Map(),
    dsByStoreIn: new Map(),
    customColors,
  };
}

describe('emitGlobalsCss', () => {
  it('emits :root block with light theme overrides', () => {
    const ctx = makeCtx({ 'primary': '#3b82f6' }, {}, []);
    const css = emitGlobalsCss(ctx, new Set());
    expect(css).toContain(':root');
    expect(css).toContain('--primary');
  });

  it('emits .dark block with dark overrides', () => {
    const ctx = makeCtx({}, { 'primary': '#1e40af' }, []);
    const css = emitGlobalsCss(ctx, new Set());
    expect(css).toContain('.dark');
    expect(css).toContain('--primary');
  });

  it('emits custom color tokens in both blocks', () => {
    const ctx = makeCtx({}, {}, [{ name: 'brand', light: '#ff0000', dark: '#cc0000' }]);
    const css = emitGlobalsCss(ctx, new Set());
    expect(css).toContain('--brand');
    // Should appear in both :root and .dark
    const rootIdx = css.indexOf(':root');
    const darkIdx = css.indexOf('.dark');
    const brandCount = (css.match(/--brand/g) ?? []).length;
    expect(brandCount).toBeGreaterThanOrEqual(2);
  });

  it('converts hex to RGB triplet format', () => {
    const ctx = makeCtx({ 'primary': '#3b82f6' }, {}, []);
    const css = emitGlobalsCss(ctx, new Set());
    // #3b82f6 = 59 130 246
    expect(css).toContain('59 130 246');
  });

  it('emits @keyframes for used animations', () => {
    const ctx = makeCtx({}, {}, []);
    const usedAnimations = new Set(['glowPulse', 'fadeIn']);
    const css = emitGlobalsCss(ctx, usedAnimations);
    expect(css).toContain('@keyframes glowPulse');
    expect(css).toContain('@keyframes fadeIn');
  });

  it('does not emit @keyframes for unused animations', () => {
    const ctx = makeCtx({}, {}, []);
    const css = emitGlobalsCss(ctx, new Set());
    expect(css).not.toContain('@keyframes glowPulse');
  });

  it('includes tailwind directives', () => {
    const ctx = makeCtx({}, {}, []);
    const css = emitGlobalsCss(ctx, new Set());
    expect(css).toContain('@tailwind base');
    expect(css).toContain('@tailwind components');
    expect(css).toContain('@tailwind utilities');
  });
});
