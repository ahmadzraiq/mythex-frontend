'use client';

/**
 * BuilderContext — signals to the SDUI renderer that it's running inside
 * the visual page builder. When active, every node gets annotated with
 * data-builder-id / data-builder-type and condition evaluation is bypassed.
 *
 * Also carries the active responsive breakpoint so the renderer can resolve
 * per-breakpoint overrides correctly (using the builder's simulated viewport
 * width rather than the real browser window).
 */

import React, { createContext, useContext } from 'react';
import type { ActiveBreakpoint } from './responsive-resolver';

export interface BuilderContextValue {
  builderMode: boolean;
  /** Active responsive breakpoint — derived from viewport width (production) or builder viewport preset (builder) */
  activeBreakpoint?: ActiveBreakpoint;
  /** Node IDs whose popover is toggled "shown" in the builder (key = `popover:{id}`) */
  shownPopovers?: Set<string>;
}

export const BuilderContext = createContext<BuilderContextValue>({ builderMode: false });

export function useBuilderMode(): BuilderContextValue {
  return useContext(BuilderContext);
}
