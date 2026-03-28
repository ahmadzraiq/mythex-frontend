'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSduiStore } from '@/store/sdui-store';
import { SDUIEngine } from '@/lib/sdui/sdui-engine';
import type { SDUIConfig } from '@/lib/sdui/types';
const AUTH_USER_PATH = 'auth.user';

export function SDUIWithAuth({
  config,
  requireAuth = false,
}: {
  config: SDUIConfig;
  requireAuth?: boolean;
}) {
  const isAuthenticated = !!useSduiStore((s) => s.data[AUTH_USER_PATH]);
  const router = useRouter();

  useEffect(() => {
    if (requireAuth && !isAuthenticated) {
      router.replace('/login');
    }
  }, [requireAuth, isAuthenticated, router]);

  if (requireAuth && !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--theme-muted-foreground)]">Redirecting...</p>
      </div>
    );
  }

  return <SDUIEngine config={config} />;
}
