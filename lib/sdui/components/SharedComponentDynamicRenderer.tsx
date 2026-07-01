'use client';

/**
 * SharedComponentDynamicRenderer — renders dynamically added shared component
 * instances as fixed overlays.
 *
 * Builder mode (viewportHeight set):
 *   Renders inline with position:absolute, clipped to the canvas frame.
 *
 * Production / Preview mode (no viewportHeight):
 *   Renders via ReactDOM.createPortal on document.body so position:fixed
 *   works correctly regardless of ancestor transforms.
 *
 * Structure:
 *   Outer shell div (positioning only)
 *   └── SDURendererScoped(model.content)
 *         with scope.context.component = { props, instanceId, id, name }
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSharedComponentInstanceStore, type SharedComponentInstance } from '../shared-component-instance-store';
import { SDURendererScoped, type RendererContext } from '../renderer';
import type { SDUINode } from '../types/node';
import { triggerExitAnimation } from './animated-node';
import sharedComponentsJson from '../../../config/shared-components.json';

interface ModelLike {
  id: string;
  name: string;
  properties: Array<{ id: string; name: string; type: string; defaultValue?: unknown }>;
  content: Record<string, unknown>;
}

const staticModels = sharedComponentsJson as Record<string, ModelLike>;

function getModels(): Record<string, ModelLike> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const scData = require('@/lib/builder/shared-component-data');
    const live = scData.getSharedComponents() as Record<string, ModelLike>;
    if (live && Object.keys(live).length > 0) {
      const merged: Record<string, ModelLike> = { ...staticModels };
      for (const [id, liveModel] of Object.entries(live)) {
        const liveContent = liveModel.content as { children?: unknown[] } | undefined;
        const hasValidContent = liveContent && Array.isArray(liveContent.children) && liveContent.children.length > 0;
        merged[id] = hasValidContent ? liveModel : (staticModels[id] ? { ...liveModel, content: staticModels[id].content } : liveModel);
      }
      return merged;
    }
  } catch { /* builder data not available */ }
  return staticModels;
}

function getOverlayStyle(viewportHeight?: number): React.CSSProperties {
  return viewportHeight
    ? { position: 'absolute', top: 0, left: 0, right: 0, height: viewportHeight, zIndex: 9000, overflow: 'hidden' }
    // pointer-events: none lets clicks fall through to page content.
    // Individual SC children re-enable pointer events with pointerEvents:'auto'
    // (e.g. modal backdrops, toast dismiss buttons, popover panels).
    : { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9000, overflow: 'hidden', pointerEvents: 'none' };
}

interface VisibleEntry {
  instance: SharedComponentInstance;
  model: ModelLike;
  closing: boolean;
}

interface SharedComponentDynamicRendererProps {
  context: RendererContext;
  viewportHeight?: number;
}

export function SharedComponentDynamicRenderer({ context, viewportHeight }: SharedComponentDynamicRendererProps) {
  const storeInstances = useSharedComponentInstanceStore(s => s.instances);

  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  useEffect(() => {
    if (viewportHeight === undefined) setPortalTarget(document.body);
  }, [viewportHeight]);

  const ghostMapRef = useRef<Map<string, SharedComponentInstance>>(new Map());
  const [closingIds, setClosingIds] = useState<Set<string>>(new Set());
  const prevRef = useRef<SharedComponentInstance[]>([]);
  const exitingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const prev = prevRef.current;
    const currIds = new Set(storeInstances.map(i => i.instanceId));

    prev.forEach(inst => {
      if (!currIds.has(inst.instanceId) && !exitingRef.current.has(inst.instanceId)) {
        exitingRef.current.add(inst.instanceId);
        ghostMapRef.current.set(inst.instanceId, inst);
        setClosingIds(ids => new Set([...ids, inst.instanceId]));

        const models = getModels();
        const model = models[inst.componentId];
        const contentNode = model?.content as { id?: string; children?: Array<{ id?: string }> } | undefined;
        const backdropNodeId = contentNode?.id ?? (inst.componentId + '-backdrop');
        const cardNodeId = contentNode?.children?.[0]?.id ?? (inst.componentId + '-card');

        Promise.all([
          triggerExitAnimation(backdropNodeId),
          triggerExitAnimation(cardNodeId),
        ]).then(() => {
          ghostMapRef.current.delete(inst.instanceId);
          exitingRef.current.delete(inst.instanceId);
          setClosingIds(ids => {
            const next = new Set(ids);
            next.delete(inst.instanceId);
            return next;
          });
        });
      }
    });

    prevRef.current = storeInstances;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeInstances]);

  const models = getModels();

  const liveEntries: VisibleEntry[] = storeInstances
    .map(inst => {
      const model = models[inst.componentId];
      if (!model) return null;
      return { instance: inst, model, closing: false };
    })
    .filter(Boolean) as VisibleEntry[];

  const closingEntries: VisibleEntry[] = [...closingIds]
    .filter(id => !storeInstances.find(i => i.instanceId === id))
    .map(id => {
      const inst = ghostMapRef.current.get(id);
      if (!inst) return null;
      const model = models[inst.componentId];
      if (!model) return null;
      return { instance: inst, model, closing: true };
    })
    .filter(Boolean) as VisibleEntry[];

  const allEntries = [...liveEntries, ...closingEntries];
  if (allEntries.length === 0) return null;

  const isBuilderMode = viewportHeight !== undefined;

  const handleEscape = () => {
    (context.runAction as (a: unknown) => void)({ type: 'deleteAllSharedComponents' });
  };

  const content = (
    <>
      {allEntries.map(({ instance, model }, idx) => {
        const mergedProps: Record<string, unknown> = {};
        for (const prop of model.properties) {
          mergedProps[prop.name] = prop.name in instance.props ? instance.props[prop.name] : prop.defaultValue;
        }
        for (const [key, val] of Object.entries(instance.props)) {
          if (!(key in mergedProps)) mergedProps[key] = val;
        }

        const scope = {
          context: {
            component: {
              props: mergedProps,
              instanceId: instance.instanceId,
              id: instance.componentId,
              name: model.name,
            },
          },
        };

        return (
          <div
            key={instance.instanceId}
            data-testid="shared-component-overlay"
            data-sc-instance={instance.instanceId}
            data-sc-component={instance.componentId}
            style={getOverlayStyle(viewportHeight)}
            onKeyDown={isBuilderMode ? undefined : (e => { if (e.key === 'Escape') handleEscape(); })}
          >
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: viewportHeight ?? '100vh', pointerEvents: 'none' }}>
              <SDURendererScoped
                node={model.content as unknown as SDUINode}
                context={context}
                scope={scope}
              />
            </div>
          </div>
        );
      })}
    </>
  );

  if (isBuilderMode) return content;
  if (!portalTarget) return null;
  return createPortal(content, portalTarget);
}
