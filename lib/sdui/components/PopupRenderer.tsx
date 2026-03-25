'use client';

/**
 * PopupRenderer — renders all open popup instances as fixed overlays.
 *
 * Builder mode (viewportHeight set):
 *   Renders inline in the React tree with position:absolute, clipped to the
 *   canvas frame. The frame has transform:translateZ(0) which confines fixed
 *   children — popups appear inside the canvas, not over the builder chrome.
 *
 * Production / Preview mode (no viewportHeight):
 *   Renders via ReactDOM.createPortal directly on document.body. This ensures
 *   position:fixed works even when ancestor elements have transforms, filters,
 *   or overflow overrides (e.g. the globals.css preview-mode rules).
 *
 * Structure:
 *   PopupRenderer outer div  — positioning shell only (no bg, no flex)
 *   └── SDURendererScoped(model.content)
 *         └── Backdrop Box   — full-screen SDUI node (bg, centering, click-to-close)
 *               └── Card Box — popup content (stopPropagation so clicks don't close)
 *
 * Exit animation: both the backdrop node ({modelId}-backdrop) and the card node
 * ({modelId}-card) have animation.exit configured; both are triggered on close.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePopupStore, type PopupInstance } from '../popup-store';
import { SDURendererScoped, type RendererContext } from '../renderer';
import type { SDUINode } from '../types/node';
import { triggerExitAnimation } from './animated-node';
import popupsJson from '../../../config/popups.json';
import type { PopupModel } from '../actions/handlers/popup-handlers';

const staticPopupModels = popupsJson as Record<string, PopupModel>;


/** Pure positioning shell — no background, no flex, no visual styling.
 *  All visual styling lives in the backdrop SDUI node inside model.content. */
function getOverlayStyle(viewportHeight?: number): React.CSSProperties {
  return viewportHeight
    ? {
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: viewportHeight,
        zIndex: 9000,
        overflow: 'hidden',
      }
    : {
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 9000,
        overflow: 'hidden',
      };
}

interface VisibleEntry {
  instance: PopupInstance;
  model: PopupModel;
  closing: boolean;
}

interface PopupRendererProps {
  context: RendererContext;
  /** When set (builder mode), caps overlay to this height and uses position:absolute */
  viewportHeight?: number;
  /** Live popup models injected by the builder so edits are reflected without a file write. */
  popupModels?: Record<string, PopupModel>;
}

export function PopupRenderer({ context, viewportHeight, popupModels: popupModelsProp }: PopupRendererProps) {
  const popupModels = popupModelsProp ?? staticPopupModels;
  const storeInstances = usePopupStore(s => s.instances);
  // For production/preview we portal to document.body so position:fixed is
  // always relative to the viewport regardless of ancestor transforms/overflows.
  // Toast-style types render via map — no individual full-screen overlay.
  const isToast = (model: PopupModel) =>
    model.type === 'Alert' || model.type === 'StackedAlert';

  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  useEffect(() => {
    if (viewportHeight === undefined) setPortalTarget(document.body);
  }, [viewportHeight]);

  // Ghost map: instances removed from store but still playing exit animation
  const ghostMapRef = useRef<Map<string, PopupInstance>>(new Map());
  const [closingIds, setClosingIds] = useState<Set<string>>(new Set());
  const prevRef = useRef<PopupInstance[]>([]);
  // Track in-progress exit so we don't re-trigger
  const exitingRef = useRef<Set<string>>(new Set());

  // Detect instances removed from store → trigger exit animation before cleanup.
  // Toast types (Alert/StackedAlert) are skipped here — their cards re-render
  // automatically because the StackContainer uses `map="_popupInstances"` fed by
  // the live entries array. Removing an instance from that array is enough.
  useEffect(() => {
    const prev = prevRef.current;
    const currIds = new Set(storeInstances.map(i => i.instanceId));

    prev.forEach(inst => {
      if (!currIds.has(inst.instanceId) && !exitingRef.current.has(inst.instanceId)) {
        const exitModel = popupModels[inst.modelId];
        // Toast types re-render via map — no ghost/exit-animation dance needed.
        if (exitModel && isToast(exitModel)) return;

        exitingRef.current.add(inst.instanceId);
        ghostMapRef.current.set(inst.instanceId, inst);

        setClosingIds(ids => new Set([...ids, inst.instanceId]));

        // Trigger exit on both the backdrop node and the card node.
        // Read actual IDs from the model content (user-created popups use UUIDs).
        const contentNode = exitModel?.content as { id?: string; children?: Array<{ id?: string }> } | undefined;
        const backdropNodeId = contentNode?.id ?? (inst.modelId + '-backdrop');
        const cardNodeId = contentNode?.children?.[0]?.id ?? (inst.modelId + '-card');
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

  // Merge live + ghost (closing) entries
  const liveEntries: VisibleEntry[] = storeInstances
    .map(inst => {
      const model = popupModels[inst.modelId];
      if (!model) return null;
      return { instance: inst, model, closing: false };
    })
    .filter(Boolean) as VisibleEntry[];

  const closingEntries: VisibleEntry[] = [...closingIds]
    .filter(id => !storeInstances.find(i => i.instanceId === id))
    .map(id => {
      const inst = ghostMapRef.current.get(id);
      if (!inst) return null;
      const model = popupModels[inst.modelId];
      if (!model) return null;
      return { instance: inst, model, closing: true };
    })
    .filter(Boolean) as VisibleEntry[];

  const allEntries = [...liveEntries, ...closingEntries];
  if (allEntries.length === 0) return null;

  const isBuilderMode = viewportHeight !== undefined;

  const handleEscape = () => {
    (context.runAction as (a: unknown) => void)({ action: 'closeAllPopups' });
  };

  // Build the scope object for a popup instance
  const makeScope = (instance: PopupInstance, idx: number, totalCount: number) => ({
    popup: {
      props: instance.props,
      instanceId: instance.instanceId,
      modelId: instance.modelId,
    },
    context: {
      component: { props: instance.props ?? {} },
      local: {
        data: {
          popup: { instancesCount: totalCount, index: idx, totalCount },
        },
      },
    },
  });

  const normalEntries = allEntries.filter(e => !isToast(e.model));
  const toastEntries  = allEntries.filter(e =>  isToast(e.model));

  // Group toast entries by modelId — each model renders ONE shared container.
  // Multiple instances of the same model stack as cards inside that container.
  const toastByModel = new Map<string, { model: PopupModel; entries: VisibleEntry[] }>();
  for (const entry of toastEntries) {
    const key = entry.model.id;
    if (!toastByModel.has(key)) toastByModel.set(key, { model: entry.model, entries: [] });
    toastByModel.get(key)!.entries.push(entry);
  }

  const content = (
    <>
      {/* ── Modal / Sheet / Blank ─────────────────────────────────────────
          Each instance gets its own full-screen overlay div. The backdrop
          SDUI node inside model.content handles centering/bg/click-to-close. */}
      {normalEntries.map(({ instance, model }, idx) => {
        const scope = makeScope(instance, idx, normalEntries.length);
        return (
          <div
            key={instance.instanceId}
            data-testid="popup-overlay"
            data-popup-instance={instance.instanceId}
            data-popup-model={instance.modelId}
            data-popup-type={model.type}
            // All popup SDUI nodes are inside this; used by the builder hit-test
            // to distinguish popup nodes from page nodes in popup-edit mode.
            data-popup-content-root={instance.modelId}
            style={getOverlayStyle(viewportHeight)}
            onKeyDown={isBuilderMode ? undefined : (e => { if (e.key === 'Escape') handleEscape(); })}
            tabIndex={isBuilderMode ? undefined : -1}
            ref={isBuilderMode ? undefined : (el => { if (el) el.focus(); })}
          >
            {/* Raw fill wrapper: explicit width + height so that the SDUI
                backdrop node's h-full resolves correctly. CSS height:100% on a
                child only works when the parent has an *explicit* height value —
                top:0/bottom:0 gives an *implicit* height and h-full resolves to
                auto (content height). Setting an explicit height here fixes it. */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: viewportHeight ?? '100vh' }}>
              <SDURendererScoped
                node={model.content as unknown as SDUINode}
                context={context}
                scope={scope}
              />
            </div>
          </div>
        );
      })}

      {/* ── Alert / StackedAlert ──────────────────────────────────────────
          One SDURendererScoped call PER POPUP MODEL renders the full content tree
          (Backdrop → StackContainer → Card) identically to how the builder canvas
          does. The StackContainer node gets `map="_popupInstances"` injected so the
          renderer iterates over all live instances — gap, flex-direction, alignment
          and every other className on Backdrop/StackContainer are handled by the
          same SDUI Box renderer that handles the builder canvas, so they always work. */}
      {toastByModel.size > 0 && [...toastByModel.values()].map(({ model, entries }) => {
        type ToastNode = SDUINode & { props?: { className?: string }; children?: SDUINode[] };
        const backdropNode   = model.content as unknown as ToastNode;
        const stackContainer = backdropNode?.children?.[0] as ToastNode | undefined;
        const cardNode: SDUINode = (stackContainer?.children?.[0] as SDUINode | undefined)
          ?? (stackContainer as SDUINode | undefined)
          ?? (backdropNode as SDUINode);

        // Per-instance data exposed to each card via map-item scope:
        //   context.item.data.instanceId  — unique id for this instance
        //   context.item.data.popup.*     — mirrors old popup.* scope (for closePopup)
        //   context.item.data.props.*     — instance props (title, message, etc.)
        const instancesData = entries.map(({ instance }, idx) => ({
          instanceId: instance.instanceId,
          props: instance.props ?? {},
          popup: { instanceId: instance.instanceId, modelId: instance.modelId },
          index: idx,
          totalCount: entries.length,
        }));

        // IMPORTANT: `map` renders the node itself N times, NOT N children inside it.
        // Putting `map` on StackContainer would create N separate StackContainers (each
        // with one card) — gap would never apply because there is no single parent with gap.
        //
        // Correct pattern (from layout pitfalls: "Product/Item Grid"):
        //   StackContainer (renders ONCE — owns gap-*, flex-direction, etc.)
        //   └── mapWrapper  (map="_popupInstances", className="contents")
        //         renders N times; display:contents makes it invisible so each card
        //         becomes a direct flex child of StackContainer → gap applies between them.
        const mapWrapperNode: SDUINode = {
          type: 'Box',
          id: `${model.id}-map-wrapper`,
          props: { className: 'contents' },
          map: '_popupInstances',
          key: '$item.instanceId',
          children: cardNode ? [cardNode] : [],
        } as SDUINode;

        // StackContainer: unchanged — renders ONCE as the single gap container.
        const stackWithMap: SDUINode = {
          ...(stackContainer as SDUINode),
          children: [mapWrapperNode],
        };

        // Rebuild backdrop with the corrected stack as its sole child.
        const mappedContent: SDUINode = {
          ...(backdropNode as SDUINode),
          children: [stackWithMap],
        };


        return (
          <div
            key={model.id}
            data-testid="popup-toast-stack"
            data-popup-model={model.id}
            style={
              viewportHeight !== undefined
                ? { position: 'absolute', top: 0, left: 0, right: 0, height: viewportHeight, zIndex: 9000, pointerEvents: 'none' }
                : { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9000, pointerEvents: 'none' }
            }
          >
            {/* Same fill-wrapper pattern used for modals: explicit dimensions so
                the backdrop's h-full resolves correctly inside a fixed/absolute shell. */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: viewportHeight ?? '100vh' }}>
              <SDURendererScoped
                node={mappedContent}
                context={context}
                scope={{ _popupInstances: instancesData }}
              />
            </div>
          </div>
        );
      })}
    </>
  );

  // Builder mode: render inline (clipped to canvas frame by its transform).
  // Production/Preview: portal to document.body so position:fixed is always
  // relative to the real viewport, escaping any ancestor transform/overflow.
  if (isBuilderMode) return content;
  if (!portalTarget) return null;
  return createPortal(content, portalTarget);
}
