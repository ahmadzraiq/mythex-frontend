'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppSelector } from '@/store/hooks';
import { ReduxSDUIEngine } from '@/lib/sdui/redux-engine';
import type { SDUIConfig } from '@/lib/sdui/types';

export function ReduxSDUIWithAuth({
  config,
  requireAuth = false,
}: {
  config: SDUIConfig;
  requireAuth?: boolean;
}) {
  const isAuthenticated = !!useAppSelector((state) =>
    (state as { config?: { data?: Record<string, unknown> } })?.config?.data?.['auth.user']
  );
  const router = useRouter();

  useEffect(() => {
    if (requireAuth && !isAuthenticated) {
      router.replace('/login');
    }
  }, [requireAuth, isAuthenticated, router]);

  if (requireAuth && !isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-typography-600">Redirecting...</p>
      </div>
    );
  }

  return <ReduxSDUIEngine config={config} />;
}
