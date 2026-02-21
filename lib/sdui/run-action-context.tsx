'use client';

import React, { createContext, useContext } from 'react';
import type { SDUIAction } from './types';

type RunActionFn = (action: SDUIAction | SDUIAction[], event?: unknown, scope?: Record<string, unknown>) => void;

const RunActionContext = createContext<RunActionFn | null>(null);

export const RunActionProvider = RunActionContext.Provider;

export function useRunAction(): RunActionFn | null {
  return useContext(RunActionContext);
}
