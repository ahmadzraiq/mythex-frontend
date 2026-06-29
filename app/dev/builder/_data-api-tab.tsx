'use client';
/**
 * Data & API tab — top-level section in the builder.
 *
 * Navigation is handled by the TopBar — this component is a pure pass-through
 * that mounts the correct section panel based on the `section` prop.
 *
 * Sub-panels:
 *   models            → _models-designer.tsx
 *   enums             → _enums-panel.tsx
 *   tables            → _tables-designer.tsx
 *   backend-workflows → _server-workflows-panel.tsx
 *   storage           → _storage-browser.tsx
 */
import React from 'react';
import { TablesDesigner } from './_tables-designer';
import { ModelsDesigner } from './_models-designer';
import { EnumsPanel } from './_enums-panel';
import { StorageBrowser } from './_storage-browser';
import { ServerWorkflowsPanel } from './_server-workflows-panel';

export type DataApiSection =
  | 'models'
  | 'enums'
  | 'tables'
  | 'backend-workflows'
  | 'storage';

interface DataApiTabProps {
  projectId: string;
  section: DataApiSection;
}

export function DataApiTab({ projectId, section }: DataApiTabProps) {
  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', height: '100%' }}>
      {section === 'models'            && <ModelsDesigner projectId={projectId} />}
      {section === 'enums'             && <EnumsPanel projectId={projectId} />}
      {section === 'tables'            && <TablesDesigner projectId={projectId} />}
      {section === 'backend-workflows' && <ServerWorkflowsPanel projectId={projectId} />}
      {section === 'storage'           && <StorageBrowser projectId={projectId} />}
    </div>
  );
}
