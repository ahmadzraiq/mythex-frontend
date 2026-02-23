'use client';

/**
 * When ?navbarPreview=<base64json> is in the URL, sets navbar config in the store.
 * When ?authPreview=1 is also present, sets auth.user so conditional Menu items (Profile, Orders, etc.) render.
 * Used for visual/E2E testing - Playwright can navigate to /?navbarPreview=...&authPreview=1 to test.
 */

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLayoutGeneratorStore } from '@/store/layout-generator-store';
import { useSduiStore } from '@/store/sdui-store';
import storeConfig from '@/config/store-config';

const AUTH_USER_PATH =
  (storeConfig as { paths?: { authUser?: string } }).paths?.authUser ?? 'auth.user';

const MOCK_AUTH_USER = { id: '1', identifier: 'test@example.com' };

export function NavbarPreviewFromUrl() {
  const searchParams = useSearchParams();
  const setGenerated = useLayoutGeneratorStore((s) => s.setGenerated);
  const setNavbar = useLayoutGeneratorStore((s) => s.setNavbar);
  const setGeneratedTheme = useLayoutGeneratorStore((s) => s.setGeneratedTheme);
  const setGeneratedStyle = useLayoutGeneratorStore((s) => s.setGeneratedStyle);
  const setData = useSduiStore((s) => s.setData);

  useEffect(() => {
    const encoded = searchParams.get('navbarPreview');
    if (!encoded) return;
    try {
      const json = JSON.parse(atob(encoded)) as Record<string, unknown>;
      if (json && typeof json === 'object') {
        if (json.screen && typeof json.screen === 'object') {
          setGenerated(
            json.screen as Record<string, unknown>,
            (json.style as string) ?? null,
            (json.theme as Record<string, unknown>) ?? undefined
          );
        } else {
          const theme = json.theme as { style?: string; fonts?: { heading?: string; body?: string } } | undefined;
          if (theme?.style) setGeneratedStyle(theme.style);
          if (theme?.fonts) setGeneratedTheme({ fonts: theme.fonts });
          setNavbar(json);
        }
      }
      const authPreview = searchParams.get('authPreview');
      if (authPreview === '1' || authPreview === 'true') {
        setData(AUTH_USER_PATH, MOCK_AUTH_USER);
      }
    } catch {
      // invalid base64 or JSON
    }
  }, [searchParams, setGenerated, setNavbar, setGeneratedTheme, setGeneratedStyle, setData]);

  return null;
}
