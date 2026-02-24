'use client';

/**
 * BuilderContext — signals to the SDUI renderer that it's running inside
 * the visual page builder. When active, every node gets annotated with
 * data-builder-id / data-builder-type and condition evaluation is bypassed.
 */

import React, { createContext, useContext } from 'react';

export interface BuilderContextValue {
  builderMode: boolean;
}

export const BuilderContext = createContext<BuilderContextValue>({ builderMode: false });

export function useBuilderMode(): BuilderContextValue {
  return useContext(BuilderContext);
}
