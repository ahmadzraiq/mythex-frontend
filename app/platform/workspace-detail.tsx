'use client';

import { Suspense } from 'react';
import WorkspacePage from './_workspace-page';

export default function WorkspaceDetailPage() {
  return (
    <Suspense fallback={null}>
      <WorkspacePage />
    </Suspense>
  );
}
