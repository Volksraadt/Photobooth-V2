'use client';

import { createContext, useContext } from 'react';
import type { RendererAction, RendererContextValue } from './types';

export const RendererContext = createContext<RendererContextValue | null>(null);

export function useRenderer(): RendererContextValue {
  const ctx = useContext(RendererContext);
  if (!ctx) throw new Error('Renderer components must be used inside <PageRenderer>.');
  return ctx;
}

/** True when the action may be triggered right now (live mode + host allows it). */
export function useActionEnabled(action: RendererAction | null): boolean {
  const { mode, runtime } = useRenderer();
  if (!action || mode !== 'live') return true;
  return runtime.canAction ? runtime.canAction(action) : true;
}
