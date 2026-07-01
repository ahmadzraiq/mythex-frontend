'use client';

import React, {
  useState, useRef, useCallback, useEffect, useLayoutEffect, cloneElement,
  type ReactElement, type ReactNode, type CSSProperties,
} from 'react';
import {
  getGlobalVariableStore,
  getComponentInstanceVar,
  setComponentInstanceVar,
} from '../global-variable-store';
import type { PopoverConfig, PopoverPlacement } from '../types/node';

export interface PopoverHostProps {
  popoverConfig?: PopoverConfig;
  nodeId?: string;
  trigger: ReactElement;
  renderPopoverContent?: () => ReactNode;
  builderMode?: boolean;
  builderPopoverShown?: boolean;
  /**
   * Component instance id — when set AND popoverConfig.openVariable is a UUID
   * that matches a scoped component variable, the open state is read/written
   * to the per-instance slot instead of the global flat variable store.
   * This prevents sibling instances of the same shared component from all
   * opening when only one trigger is clicked.
   */
  instanceId?: string;
  /**
   * True when popoverConfig.openVariable is a scoped component variable on
   * this instance. Renderer decides this because only it knows the model
   * definition; PopoverHost only uses the flag to choose read/write routing.
   */
  openVariableIsComponentScoped?: boolean;
}

// ── Placement → CSS (pixel-based, relative to wrapper DOMRect) ───────────────

/**
 * Computes pixel-based absolute positioning for the floating panel so it is
 * anchored to the trigger element's actual bounding box. All values are
 * relative to wrapperRect so the panel is correctly placed even when the
 * wrapper is scrolled or inside a transformed ancestor.
 */
function computeRelativePlacementStyle(
  side: string,
  align: string | undefined,
  gap: number,
  triggerRect: DOMRect,
  wrapperRect: DOMRect,
): CSSProperties {
  const style: CSSProperties = { position: 'absolute', visibility: 'visible', zIndex: 9999 };

  const relTop    = triggerRect.top    - wrapperRect.top;
  const relBottom = triggerRect.bottom - wrapperRect.top;
  const relLeft   = triggerRect.left   - wrapperRect.left;
  const relRight  = triggerRect.right  - wrapperRect.left;

  if (side === 'top' || side === 'bottom') {
    if (side === 'top') {
      style.bottom = wrapperRect.height - relTop + gap;
    } else {
      style.top = relBottom + gap;
    }
    if (align === 'start')     { style.left = relLeft; }
    else if (align === 'end')  { style.right = wrapperRect.width - relRight; }
    else { style.left = relLeft + triggerRect.width / 2; style.transform = 'translateX(-50%)'; }
  } else {
    if (side === 'right') { style.left = relRight + gap; }
    else                  { style.right = wrapperRect.width - relLeft + gap; }
    if (align === 'start')     { style.top = relTop; }
    else if (align === 'end')  { style.bottom = wrapperRect.height - relBottom; }
    else { style.top = relTop + triggerRect.height / 2; style.transform = 'translateY(-50%)'; }
  }

  return style;
}

/** Fallback for builder mode — percentage-based, trigger-width agnostic. */
function computePlacementStyle(placement: PopoverPlacement, gap: number): CSSProperties {
  const parts = placement.split('-');
  const side = parts[0] as string;
  const align = parts[1] as string | undefined;
  const style: CSSProperties = {};
  switch (side) {
    case 'bottom': style.top = '100%'; style.paddingTop = gap; break;
    case 'top':    style.bottom = '100%'; style.paddingBottom = gap; break;
    case 'right':  style.left = '100%'; style.paddingLeft = gap; break;
    case 'left':   style.right = '100%'; style.paddingRight = gap; break;
  }
  if (side === 'top' || side === 'bottom') {
    if (align === 'start')     style.left = 0;
    else if (align === 'end')  style.right = 0;
    else { style.left = '50%'; style.transform = 'translateX(-50%)'; }
  } else {
    if (align === 'start')     style.top = 0;
    else if (align === 'end')  style.bottom = 0;
    else { style.top = '50%'; style.transform = 'translateY(-50%)'; }
  }
  return style;
}

const HIDDEN_PANEL: CSSProperties = { position: 'absolute', visibility: 'hidden', top: 0, left: 0 };

// ── Variable-synced open state ───────────────────────────────────────────────

function usePopoverState(
  nodeId: string | undefined,
  config: PopoverConfig | undefined,
  instanceId: string | undefined,
  openVariableIsComponentScoped: boolean | undefined,
) {
  const [localOpen, setLocalOpen] = useState(false);
  const variableUuid = config?.openVariable;
  const useInstanceSlot = !!(variableUuid && instanceId && openVariableIsComponentScoped);
  const storePath = variableUuid || (nodeId ? `_popover.popover.${nodeId}` : '');

  const setOpen = useCallback((val: boolean) => {
    setLocalOpen(val);
    if (useInstanceSlot && variableUuid && instanceId) {
      try {
        setComponentInstanceVar(instanceId, variableUuid, val);
      } catch { /* noop */ }
      return;
    }
    if (storePath) {
      try {
        getGlobalVariableStore().getState().set(storePath, val);
      } catch { /* noop */ }
    }
  }, [storePath, useInstanceSlot, variableUuid, instanceId]);

  useEffect(() => {
    if (!variableUuid) return;
    const store = getGlobalVariableStore();
    const unsub = store.subscribe((state) => {
      let val: unknown;
      if (useInstanceSlot && instanceId) {
        val = getComponentInstanceVar(instanceId, variableUuid);
      } else {
        val = state.data[variableUuid];
      }
      setLocalOpen(!!val);
    });
    return unsub;
  }, [variableUuid, useInstanceSlot, instanceId]);

  return { isOpen: localOpen, setOpen };
}

// ── PopoverHost ──────────────────────────────────────────────────────────────

export default function PopoverHost({
  popoverConfig,
  nodeId,
  trigger,
  renderPopoverContent,
  builderMode,
  builderPopoverShown,
  instanceId,
  openVariableIsComponentScoped,
}: PopoverHostProps) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const wrapperRef  = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const active = !!popoverConfig;
  const { isOpen, setOpen } = usePopoverState(nodeId, popoverConfig, instanceId, openVariableIsComponentScoped);
  const effectiveOpen = active && (builderMode ? !!builderPopoverShown : isOpen);

  const isClick = active && popoverConfig?.trigger === 'click' && !builderMode;
  const isHover = active && popoverConfig?.trigger === 'hover' && !builderMode;

  // ── Ref forwarding ─────────────────────────────────────────────────────────

  const triggerPropRef = useRef(trigger);
  triggerPropRef.current = trigger;

  const handleTriggerRef = useCallback((el: HTMLElement | null) => {
    triggerRef.current = el;
    const t = triggerPropRef.current;
    const origRef = (t as unknown as { ref?: React.Ref<HTMLElement> }).ref;
    if (typeof origRef === 'function') origRef(el);
    else if (origRef && typeof origRef === 'object')
      (origRef as React.MutableRefObject<HTMLElement | null>).current = el;
  }, []);

  // ── Click handler (merged with existing onClick) ───────────────────────────

  const handleClick = useCallback((e: React.MouseEvent) => {
    const orig = (triggerPropRef.current.props as Record<string, unknown>)?.onClick;
    if (typeof orig === 'function') (orig as (e: React.MouseEvent) => void)(e);
    if (isClick) setOpen(!isOpen);
  }, [isClick, isOpen, setOpen]);

  // ── Hover handlers on the wrapper ──────────────────────────────────────────

  const handleMouseEnter = useCallback(() => {
    if (!isHover) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpen(true), 150);
  }, [isHover, setOpen]);

  const handleMouseLeave = useCallback(() => {
    if (!isHover) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpen(false), 100);
  }, [isHover, setOpen]);

  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

  // ── Outside-click dismiss ──────────────────────────────────────────────────

  useEffect(() => {
    if (!effectiveOpen || builderMode || popoverConfig?.closeOnOutsideClick === false) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || floatingRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [effectiveOpen, builderMode, popoverConfig?.closeOnOutsideClick, setOpen]);

  // ── Escape dismiss ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!effectiveOpen || builderMode || popoverConfig?.closeOnEscape === false) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [effectiveOpen, builderMode, popoverConfig?.closeOnEscape, setOpen]);


  // ── Panel positioning (pixel-based, trigger-relative) ────────────────────

  const configured = (popoverConfig?.placement ?? 'bottom') as PopoverPlacement;
  const flipDone = useRef(false);

  const [panelStyle, setPanelStyle] = useState<CSSProperties>(HIDDEN_PANEL);

  // Reset when the panel closes or configured placement changes.
  useEffect(() => {
    if (!effectiveOpen) { flipDone.current = false; setPanelStyle(HIDDEN_PANEL); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveOpen]);
  useEffect(() => { flipDone.current = false; setPanelStyle(HIDDEN_PANEL); }, [configured]);

  // After the (invisible) panel mounts: detect flip, then compute pixel offsets.
  useLayoutEffect(() => {
    if (!effectiveOpen || builderMode || !floatingRef.current || !triggerRef.current || !wrapperRef.current || flipDone.current) return;
    flipDone.current = true;

    const panelRect   = floatingRef.current.getBoundingClientRect();
    const parts = configured.split('-');
    const side  = parts[0] as string;
    const align = parts[1] as string | undefined;

    let finalSide = side;
    if      (side === 'bottom' && panelRect.bottom > window.innerHeight) finalSide = 'top';
    else if (side === 'top'    && panelRect.top    < 0)                  finalSide = 'bottom';
    else if (side === 'right'  && panelRect.right  > window.innerWidth)  finalSide = 'left';
    else if (side === 'left'   && panelRect.left   < 0)                  finalSide = 'right';

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const wrapperRect = wrapperRef.current.getBoundingClientRect();
    const gap = popoverConfig?.offset ?? 4;

    setPanelStyle({
      ...computeRelativePlacementStyle(finalSide, align, gap, triggerRect, wrapperRect),
      pointerEvents: 'auto',
    });
  }, [effectiveOpen, builderMode, configured, popoverConfig?.offset]);

  // ── matchTriggerWidth ──────────────────────────────────────────────────────

  useLayoutEffect(() => {
    if (!effectiveOpen || !popoverConfig?.matchTriggerWidth) return;
    if (!triggerRef.current || !floatingRef.current) return;
    floatingRef.current.style.minWidth = `${triggerRef.current.offsetWidth}px`;
  }, [effectiveOpen, popoverConfig?.matchTriggerWidth]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const triggerProps: Record<string, unknown> = { ref: handleTriggerRef };
  if (isClick) triggerProps.onClick = handleClick;
  const triggerEl = cloneElement(trigger, triggerProps);

  // Builder mode: use the legacy percentage-based placement (trigger size is irrelevant in builder).
  const builderPanelStyle: CSSProperties = builderMode
    ? { position: 'absolute', zIndex: 9999, pointerEvents: 'auto', ...computePlacementStyle((popoverConfig?.placement ?? 'bottom') as PopoverPlacement, popoverConfig?.offset ?? 4) }
    : panelStyle;

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative' }}
      onMouseEnter={isHover ? handleMouseEnter : undefined}
      onMouseLeave={isHover ? handleMouseLeave : undefined}
    >
      {triggerEl}

      {effectiveOpen && renderPopoverContent && (
        <div
          ref={floatingRef}
          style={builderPanelStyle}
          data-popover-host="popover"
          data-popover-node-id={nodeId}
        >
          {renderPopoverContent()}
        </div>
      )}
    </div>
  );
}
