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
      if (raw) setData(JSON.parse(raw) as PreviewData);
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
