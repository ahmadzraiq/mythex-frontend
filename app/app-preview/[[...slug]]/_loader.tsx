'use client';
import { lazy, Suspense } from 'react';
const AppPreviewPage = lazy(() => import('./_preview-page'));
export default function Loader() {
  return (
    <Suspense fallback={null}>
      <AppPreviewPage />
    </Suspense>
  );
}
