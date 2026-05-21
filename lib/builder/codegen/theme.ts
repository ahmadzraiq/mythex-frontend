/**
 * theme.ts — Emit app/globals.css with CSS variable definitions.
 *
 * Sources (merged in order, last wins):
 *   1. theme.json cssVariables.root/dark — project base theme tokens
 *   2. themeOverrides / themeDarkOverrides — user overrides saved in the builder store
 *   3. customColors — user-defined color tokens (name, light hex, dark hex)
 *
 * Also emits @keyframes for named animation loops.
 */

import type { CodegenCtx } from './types';
import { NAMED_KEYFRAMES } from './animations';
import themeJson from '@/config/theme.json';
import { resolveProjectFonts } from './files/static-files';

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    const r = parseInt(h[0]! + h[0]!, 16);
    const g = parseInt(h[1]! + h[1]!, 16);
    const b = parseInt(h[2]! + h[2]!, 16);
    return `${r} ${g} ${b}`;
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `${r} ${g} ${b}`;
  }
  return hex; // not a hex — pass through
}

function cssVarEntry(name: string, value: string): string {
  // Tailwind CSS vars for colors expect rgb triplets without the rgb() wrapper
  const isHex = /^#[0-9a-fA-F]{3,6}$/.test(value.trim());
  const cssValue = isHex ? hexToRgb(value.trim()) : value;
  return `  --${name}: ${cssValue};`;
}

/** Strip leading "--" from a CSS var name (theme.json keys have it, our map keys don't) */
function stripDashes(obj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.replace(/^--/, ''), v]));
}

/** Convert camelCase key to kebab-case (e.g. "primaryForeground" → "primary-foreground") */
function camelToKebab(key: string): string {
  return key.replace(/([A-Z])/g, '-$1').toLowerCase();
}

export function emitGlobalsCss(ctx: CodegenCtx, usedAnimations: Set<string>): string {
  const { store, customColors } = ctx;
  const lines: string[] = [];
  const tj = themeJson as unknown as Record<string, unknown>;

  // Base theme from theme.json (always present, user overrides applied on top)
  const cssVars = tj.cssVariables as { root?: Record<string, string>; dark?: Record<string, string> } | undefined;
  const baseLight = cssVars?.root ? stripDashes(cssVars.root) : {};
  const baseDark  = cssVars?.dark ? stripDashes(cssVars.dark)  : {};

  // --theme-* hex vars (used directly in className like text-[var(--theme-primary)])
  const themeColors      = (tj.colors      as Record<string, string> | undefined) ?? {};
  const themeColorsDark  = (tj.colorsDark  as Record<string, string> | undefined) ?? {};

  // Merge: base → user overrides (user overrides win)
  // Strip font-body / font-heading from themeOverrides — those are handled separately as CSS vars below.
  const rawLightOverrides = { ...(store.themeOverrides ?? {}) } as Record<string, string>;
  delete rawLightOverrides['font-body'];
  delete rawLightOverrides['font-heading'];
  const lightVars = { ...baseLight, ...rawLightOverrides };
  const darkVars  = { ...baseDark,  ...(store.themeDarkOverrides ?? {}) };

  // Font resolution
  const { bodyVarKey, headingVarKey } = resolveProjectFonts(ctx);

  lines.push(`@tailwind base;`);
  lines.push(`@tailwind components;`);
  lines.push(`@tailwind utilities;`);
  lines.push('');
  lines.push(`@layer base {`);
  lines.push(`  :root {`);

  // Light theme Tailwind RGB vars (--primary, --background, …)
  for (const [key, value] of Object.entries(lightVars)) {
    lines.push(`  ${cssVarEntry(key, value)}`);
  }

  // --theme-* hex color tokens for direct var() usage in classNames/styles
  for (const [key, value] of Object.entries(themeColors)) {
    lines.push(`    --theme-${camelToKebab(key)}: ${value};`);
  }

  // Custom color tokens (light)
  // --{name}: RGB triplet for Tailwind opacity utilities (e.g. bg-[rgb(var(--brand)/50)])
  // --theme-{name}: hex value for direct CSS var() usage (e.g. backgroundColor: var(--theme-brand))
  for (const color of customColors) {
    lines.push(`  ${cssVarEntry(color.name, color.light)}`);
    lines.push(`    --theme-${color.name}: ${color.light};`);
  }

  lines.push(`  }`);
  lines.push('');
  lines.push(`  .dark {`);

  // Dark theme Tailwind RGB vars
  for (const [key, value] of Object.entries(darkVars)) {
    lines.push(`  ${cssVarEntry(key, value)}`);
  }

  // --theme-* dark hex color tokens
  for (const [key, value] of Object.entries(themeColorsDark)) {
    lines.push(`    --theme-${camelToKebab(key)}: ${value};`);
  }

  // Custom color tokens (dark)
  for (const color of customColors) {
    lines.push(`  ${cssVarEntry(color.name, color.dark)}`);
    lines.push(`    --theme-${color.name}: ${color.dark};`);
  }

  lines.push(`  }`);
  lines.push('');

  // Typography base styles.
  // IMPORTANT: --font-body / --font-heading are declared on `body` (NOT :root) so that
  // var(--font-body) can reference --font-space-grotesk which next/font sets via a
  // class on <body>. A :root declaration cannot see a descendant's custom property, so
  // the reference would be IACVT (Invalid At Computed Value Time) and fall back to system-ui.
  lines.push(`  body {`);
  if (bodyVarKey) {
    lines.push(`    --font-body:    var(--${bodyVarKey});`);
  }
  lines.push(`    font-family: var(--font-body, system-ui), system-ui, -apple-system, sans-serif;`);
  lines.push(`    -webkit-font-smoothing: antialiased;`);
  lines.push(`    -moz-osx-font-smoothing: grayscale;`);
  // Apply the theme background to the body so the exported app matches the builder preview.
  // --background is stored as RGB triplets; rgb(var(--background)) is valid modern CSS.
  lines.push(`    background-color: rgb(var(--background));`);
  lines.push(`    color: rgb(var(--foreground));`);
  lines.push(`  }`);
  lines.push('');
  lines.push(`  h1, h2, h3, h4, h5, h6 {`);
  if (headingVarKey) {
    lines.push(`    --font-heading: var(--${headingVarKey});`);
  }
  lines.push(`    font-family: var(--font-heading, var(--font-body, system-ui)), system-ui, -apple-system, sans-serif;`);
  // Reset browser-default heading margins — Gluestack's Text/Heading components apply my-0
  // as a base class, so removing the margin here keeps spacing consistent with the builder.
  lines.push(`    margin: 0;`);
  lines.push(`  }`);
  lines.push('');
  // RNW's Text component always applies whiteSpace:'pre-wrap' as a base style.
  // Mirror this in the exported app so text wrapping behaviour is identical.
  lines.push(`  span, p, h1, h2, h3, h4, h5, h6, label {`);
  lines.push(`    white-space: pre-wrap;`);
  lines.push(`  }`);

  lines.push(`}`);
  lines.push('');

  // Always emit ALL named keyframes — both static loop nodes and workflow-triggered
  // animations (trigger/enter/exit/loop control) reference them by name at runtime.
  const allAnimNames = new Set([...Object.keys(NAMED_KEYFRAMES), ...usedAnimations]);
  for (const animName of allAnimNames) {
    const kf = NAMED_KEYFRAMES[animName];
    if (kf) {
      lines.push(kf);
      lines.push('');
    }
  }

  return lines.join('\n');
}
