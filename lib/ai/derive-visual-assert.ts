/**
 * Derives visual assertions from AI-generated navbar overrides.
 * Used when visualTest.deriveFrom is set instead of hardcoded visualAssert.
 * Config-driven: palette, roleMapping, textNodeTypes from config/ai/derive-visual-assert.json.
 * Parses arbitrary colors (bg-[#hex], bg-[rgb(...)]) from className without config.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { VisualAssert } from './visual-navbar-runner';

export type DeriveConfig = {
  palette?: Record<string, Record<string, string>>;
  roleMapping?: Record<string, 'button' | 'link' | 'textbox'>;
  textNodeTypes?: string[];
};

const CONFIG_PATH = join(process.cwd(), 'config', 'ai', 'derive-visual-assert.json');
const TAILWIND_PALETTE_PATH = join(process.cwd(), 'config', 'ai', 'tailwind-palette.json');

const DEFAULT_CONFIG: DeriveConfig = {
  palette: {},
  roleMapping: { Button: 'button', Pressable: 'button', Link: 'link', Input: 'textbox', InputField: 'textbox' },
  textNodeTypes: ['ButtonText', 'Text'],
};

let cachedConfig: DeriveConfig | null = null;

function loadConfig(): DeriveConfig {
  if (cachedConfig) return cachedConfig;
  let config: DeriveConfig = { ...DEFAULT_CONFIG };
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as DeriveConfig;
      config = {
        palette: raw.palette ?? config.palette,
        roleMapping: raw.roleMapping ?? config.roleMapping,
        textNodeTypes: raw.textNodeTypes ?? config.textNodeTypes,
      };
    } catch {
      // use defaults on parse error
    }
  }
  if (existsSync(TAILWIND_PALETTE_PATH)) {
    try {
      const tailwind = JSON.parse(readFileSync(TAILWIND_PALETTE_PATH, 'utf8')) as Record<string, Record<string, string>>;
      config.palette = { ...tailwind, ...config.palette };
    } catch {
      // ignore tailwind palette on error
    }
  }
  cachedConfig = config;
  return config;
}

/** Convert hex to rgb(r,g,b) */
function hexToRgb(hex: string): string | null {
  const m = hex.match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (!m) return null;
  const h = m[1];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r},${g},${b})`;
}

/** Extract first bg-* color from className. Priority: arbitrary values first, then palette. */
function extractBgFromClassName(className: string | undefined, palette: Record<string, Record<string, string>>): string | null {
  if (!className || typeof className !== 'string') return null;

  const hexMatch = className.match(/(?:^|\s)(?:!)?bg-\[#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})\]/);
  if (hexMatch) return hexToRgb('#' + hexMatch[1]);

  const rgbMatch = className.match(/(?:^|\s)(?:!)?bg-\[rgb\(([^)]+)\)\]/);
  if (rgbMatch) {
    const inner = rgbMatch[1].trim();
    return `rgb(${inner})`;
  }

  const rgbaMatch = className.match(/(?:^|\s)(?:!)?bg-\[rgba\(([^)]+)\)\]/);
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(',').map((p) => p.trim());
    if (parts.length >= 3) {
      const [r, g, b] = parts.slice(0, 3);
      return `rgb(${r},${g},${b})`;
    }
  }

  const colorNames = Object.keys(palette);
  if (colorNames.length) {
    const regex = new RegExp(`(?:^|\\s)(?:!)?bg-(${colorNames.join('|')})-(\\d{2,3})`);
    const match = className.match(regex);
    if (match) {
      const [, color, shadeStr] = match;
      const shade = palette[color]?.[shadeStr];
      if (shade) return `rgb(${shade})`;
    }
  }

  return null;
}

/** Recursively extract text from config-defined text node types */
function extractTextFromNode(node: unknown, textNodeTypes: string[]): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as Record<string, unknown>;
  if (textNodeTypes.includes(String(n.type ?? ''))) {
    const t = n.text;
    if (typeof t === 'string') return t;
    if (t && typeof t === 'object' && 'expr' in t) return undefined;
  }
  const children = n.children;
  if (Array.isArray(children)) {
    for (const c of children) {
      const found = extractTextFromNode(c, textNodeTypes);
      if (found) return found;
    }
  }
  return undefined;
}

/** Determine role from node type using config */
function roleFromType(type: string, roleMapping: Record<string, 'button' | 'link' | 'textbox'>): 'button' | 'link' | 'textbox' {
  return roleMapping[type] ?? 'button';
}

export type DeriveFrom = 'addNodes';

/**
 * Derives VisualAssert from AI overrides when deriveFrom is "addNodes".
 * Finds first addNode with Button/Pressable, extracts text and bg from className.
 * Parses arbitrary colors (bg-[#hex], bg-[rgb(...)]) from className; falls back to palette for bg-{color}-{shade}.
 */
export function deriveVisualAssertFromOverrides(
  overrides: Record<string, unknown>,
  deriveFrom: DeriveFrom
): VisualAssert | null {
  if (deriveFrom !== 'addNodes') return null;

  const config = loadConfig();
  const palette = config.palette ?? {};
  const roleMapping = config.roleMapping ?? DEFAULT_CONFIG.roleMapping!;
  const textNodeTypes = config.textNodeTypes ?? DEFAULT_CONFIG.textNodeTypes!;

  const addNodes = overrides.addNodes as Array<{ node?: Record<string, unknown> }> | undefined;
  if (!Array.isArray(addNodes) || addNodes.length === 0) return null;

  const buttonTypes = ['Button', 'Pressable'];
  for (const entry of addNodes) {
    const node = entry?.node;
    if (!node || typeof node !== 'object') continue;

    const type = String(node.type ?? '');
    if (!buttonTypes.includes(type)) continue;

    const role = roleFromType(type, roleMapping);
    const text = extractTextFromNode(node, textNodeTypes);
    if (!text) continue;
    // Skip badge counts (single digits) - they may not be accessible; prefer descriptive labels
    if (/^\d+$/.test(text.trim())) continue;

    const props = node.props as Record<string, unknown> | undefined;
    const className = props?.className as string | undefined;
    const backgroundColor = extractBgFromClassName(className, palette);

    const assertions: NonNullable<VisualAssert['assertions']> = {};
    if (backgroundColor) assertions.backgroundColor = backgroundColor;
    if (Object.keys(assertions).length === 0) assertions.visibility = 'visible';

    return {
      role,
      name: text,
      assertions,
    };
  }

  return null;
}
