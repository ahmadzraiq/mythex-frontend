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

// ── Placement → CSS ──────────────────────────────────────────────────────────

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

const OPPOSITE: Record<string, string> = {
  top: 'bottom', bottom: 'top', left: 'right', right: 'left',
};

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

  // ── Placement + flip ───────────────────────────────────────────────────────

  const configured = (popoverConfig?.placement ?? 'bottom') as PopoverPlacement;
  const [activePlacement, setActivePlacement] = useState(configured);
  const flipDone = useRef(false);

  useEffect(() => { setActivePlacement(configured); flipDone.current = false; }, [configured]);
  useEffect(() => { if (!effectiveOpen) flipDone.current = false; }, [effectiveOpen]);

  useLayoutEffect(() => {
    if (!effectiveOpen || builderMode || !floatingRef.current || flipDone.current) return;
    flipDone.current = true;
    const rect = floatingRef.current.getBoundingClientRect();
    const side = configured.split('-')[0] as string;
    const align = configured.split('-')[1] as string | undefined;
    let flip = false;
    if (side === 'bottom' && rect.bottom > window.innerHeight) flip = true;
    else if (side === 'top' && rect.top < 0) flip = true;
    else if (side === 'right' && rect.right > window.innerWidth) flip = true;
    else if (side === 'left' && rect.left < 0) flip = true;
    if (flip) {
      const opp = OPPOSITE[side] ?? side;
      setActivePlacement((align ? `${opp}-${align}` : opp) as PopoverPlacement);
    }
  }, [effectiveOpen, builderMode, configured, activePlacement]);

  // ── matchTriggerWidth ──────────────────────────────────────────────────────

  useLayoutEffect(() => {
    if (!effectiveOpen || !popoverConfig?.matchTriggerWidth) return;
    if (!triggerRef.current || !floatingRef.current) return;
    floatingRef.current.style.minWidth = `${triggerRef.current.offsetWidth}px`;
  }, [effectiveOpen, popoverConfig?.matchTriggerWidth]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const placementStyle = computePlacementStyle(activePlacement, popoverConfig?.offset ?? 4);

  const triggerProps: Record<string, unknown> = { ref: handleTriggerRef };
  if (isClick) triggerProps.onClick = handleClick;
  const triggerEl = cloneElement(trigger, triggerProps);

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={isHover ? handleMouseEnter : undefined}
      onMouseLeave={isHover ? handleMouseLeave : undefined}
    >
      {triggerEl}

      {effectiveOpen && renderPopoverContent && (
        <div
          ref={floatingRef}
          style={{ position: 'absolute', zIndex: 9999, ...placementStyle, pointerEvents: 'auto' }}
          data-popover-host="popover"
          data-popover-node-id={nodeId}
        >
          {renderPopoverContent()}
        </div>
      )}
    </div>
  );
}
