'use client';

/**
 * Standalone render target for the section browser iframe.
 *
 * Handles two modes:
 *   /dev/sections/render?variantId=hero.overlay-centered   — section library variant
 *   /dev/sections/render?layoutPart=navbar                 — navbar / footer / drawer
 *
 * Fetches the SDUI screen config from the appropriate API and renders it
 * directly using SDUIEngine. Dark mode and theme are applied client-side.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useColorScheme } from 'nativewind';
import { SDUIEngine } from '@/lib/sdui/sdui-engine';
import { resolveScreenConfig, type ConfigRegistry } from '@/lib/sdui/config-resolver';
import appConfig from '@/config/app';
import type { AppConfig } from '@/config/types';

const app = appConfig as AppConfig;
const registry = (appConfig as { registry?: ConfigRegistry }).registry;

export default function SectionRenderPage() {
  const searchParams = useSearchParams();
  const variantId = searchParams.get('variantId');
  const layoutPart = searchParams.get('layoutPart');
  const dark = searchParams.get('dark') === 'true';

  const { setColorScheme } = useColorScheme();
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewKey, setPreviewKey] = useState('');

  useEffect(() => {
    setColorScheme(dark ? 'dark' : 'light');
  }, [dark, setColorScheme]);

  useEffect(() => {
    const id = variantId ?? layoutPart;
    if (!id) {
      setError('Missing variantId or layoutPart param');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const url = variantId
      ? `/api/dev/section-preview?variantId=${encodeURIComponent(variantId)}`
      : `/api/dev/layout-part-preview?part=${encodeURIComponent(layoutPart!)}`;

    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setError(data.error);
          return;
        }
        const raw = data.screen as Record<string, unknown>;
        const resolved = (registry && raw.layout)
          ? resolveScreenConfig(raw as Parameters<typeof resolveScreenConfig>[0], registry) as Record<string, unknown>
          : raw;
        setConfig(resolved);
        setPreviewKey(id);
      })
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, [variantId, layoutPart]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: '#94a3b8', fontFamily: 'system-ui', fontSize: 13 }}>
        Loading preview…
      </div>
    );
  }

  if (error || !config) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: '#f87171', fontFamily: 'system-ui', fontSize: 13 }}>
        {error ?? 'Unknown error'}
      </div>
    );
  }

  return (
    <SDUIEngine
      key={previewKey}
      config={config}
      configName={`preview-${previewKey}`}
      actionsConfig={(app as { actions?: Record<string, unknown> }).actions ?? {}}
      routes={app.routes ?? []}
    />
  );
}
