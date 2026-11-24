import type { BoothConfig, Filter, Frame } from '@pb/schema';
import type { RenderMode, RenderRuntime } from './types';

export function framesOf(config: BoothConfig, runtime: RenderRuntime): Frame[] {
  return (runtime.frames ?? config.frames)
    .filter((f) => f.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function filtersOf(config: BoothConfig, runtime: RenderRuntime): Filter[] {
  return (runtime.filters ?? config.filters).filter((f) => f.enabled);
}

/** Selected frame, or the first enabled one (editor / nothing selected yet). */
export function selectedFrame(
  config: BoothConfig,
  runtime: RenderRuntime,
  mode: RenderMode,
): Frame | undefined {
  const frames = framesOf(config, runtime);
  const found = runtime.selectedFrameId
    ? frames.find((f) => f.id === runtime.selectedFrameId)
    : undefined;
  return found ?? (mode === 'editor' || !runtime.selectedFrameId ? frames[0] : undefined);
}

export function selectedFilter(config: BoothConfig, runtime: RenderRuntime): Filter | undefined {
  if (!runtime.selectedFilterId) return undefined;
  return filtersOf(config, runtime).find((f) => f.id === runtime.selectedFilterId);
}
