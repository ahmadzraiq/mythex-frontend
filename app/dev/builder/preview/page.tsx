'use client';

import { useEffect, useMemo, useState } from 'react';
import { SDUIEngine } from '@/lib/sdui/sdui-engine';
import appConfig from '@/config/app';
import type { SDUIConfig } from '@/lib/sdui/types';
import type { SDUINode } from '@/lib/sdui/types/node';
import { BUILDER_PREVIEW_KEY } from '../page';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const app = appConfig as any;

interface PreviewData {
  nodes: SDUINode[];
  pageName: string;
  pageRoute: string;
  themeOverrides?: Record<string, string>;
  themeDarkOverrides?: Record<string, string>;
}

/** Convert hex → space-separated RGB triplet (matches ThemeStyles format). */
function hexToRgbTriplet(value: string): string {
  if (!value.startsWith('#')) return value;
  const clean = value.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

const GLUESTACK_PRIMARY_BRIDGE = [
  '  --color-primary-400: var(--primary) !important;',
  '  --color-primary-500: var(--primary) !important;',
  '  --color-primary-600: var(--primary) !important;',
  '  --color-primary-700: var(--primary) !important;',
  '  --color-primary-800: var(--primary) !important;',
].join('\n');

function applyPreviewTheme(light: Record<string, string>, dark: Record<string, string>) {
  const getOrCreate = (id: string) => {
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    return el;
  };

  const lightEl = getOrCreate('preview-light-overrides');
  const colorLines: string[] = [];
  const baseLines: string[] = [];
  for (const [k, v] of Object.entries(light)) {
    if (v.startsWith('#')) colorLines.push(`  --${k}: ${hexToRgbTriplet(v)};`);
    else baseLines.push(`  --${k}: ${v};`);
  }
  const parts: string[] = [];
  if (baseLines.length) parts.push(`:root {\n${baseLines.join('\n')}\n}`);
  parts.push(`html:not(.dark) {\n${colorLines.join('\n')}${colorLines.length ? '\n' : ''}${GLUESTACK_PRIMARY_BRIDGE}\n}`);
  lightEl.textContent = parts.join('\n\n');

  const darkEl = getOrCreate('preview-dark-overrides');
  const darkVars = Object.entries(dark).map(([k, v]) => `  --${k}: ${hexToRgbTriplet(v)};`).join('\n');
  darkEl.textContent = `html.dark {\n${darkVars ? darkVars + '\n' : ''}${GLUESTACK_PRIMARY_BRIDGE}\n}`;
}

export default function PreviewPage() {
  const [data, setData] = useState<PreviewData | null>(null);

  useEffect(() => {
    // Mark <html> so globals.css can break the React Native View overflow:hidden clip.
    document.documentElement.classList.add('preview-mode');
    return () => document.documentElement.classList.remove('preview-mode');
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BUILDER_PREVIEW_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PreviewData;
        setData(parsed);
        // Apply theme overrides saved from the builder
        if (parsed.themeOverrides || parsed.themeDarkOverrides) {
          applyPreviewTheme(parsed.themeOverrides ?? {}, parsed.themeDarkOverrides ?? {});
        }
      }
    } catch { /* ignore */ }
  }, []);

  const config = useMemo<SDUIConfig>(() => ({
    state: {},
    ui: {
      type: 'Box',
      props: { className: 'flex flex-col w-full min-h-screen' },
      children: (data?.nodes ?? []) as SDUINode[],
    } as SDUIConfig['ui'],
  }), [data]);

  if (!data) return null;

  return (
    <SDUIEngine
      config={config}
      configName={data.pageRoute?.replace(/[^a-zA-Z0-9]/g, '_') ?? 'preview'}
      actionsConfig={app.actions ?? {}}
      routes={app.routes ?? []}
    />
  );
}
