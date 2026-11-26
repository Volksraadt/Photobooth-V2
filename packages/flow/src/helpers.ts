import type { BoothConfig, ButtonActionKind, Frame, PageType } from '@pb/schema';
import type { FlowSession } from './types';

export function enabledFrames(config: BoothConfig): Frame[] {
  return config.frames.filter((f) => f.enabled).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function findFrame(config: BoothConfig, frameId: string | null): Frame | undefined {
  return frameId ? config.frames.find((f) => f.id === frameId && f.enabled) : undefined;
}

export function defaultFilterId(config: BoothConfig): string {
  const filter =
    config.filters.find((f) => f.isDefault && f.enabled) ?? config.filters.find((f) => f.enabled);
  return filter?.id ?? '';
}

export function framePrice(config: BoothConfig, frameId: string | null): number {
  return findFrame(config, frameId)?.price ?? config.pricing.basePrice;
}

/** Amount charged at Payment (frame price). */
export function paymentAmount(config: BoothConfig, session: FlowSession | null): number {
  return framePrice(config, session?.frameId ?? null);
}

/** Frame price (0 for free / event-mode sessions) + extra prints bought at Review. */
export function sessionTotal(config: BoothConfig, session: FlowSession | null): number {
  const extra = session?.extraPrints ?? 0;
  const frame = session?.free ? 0 : framePrice(config, session?.frameId ?? null);
  return frame + extra * (config.pricing.extraPrintPrice ?? 0);
}

/** Sheets to print (1 sheet = 2 strips). */
export function printSheets(config: BoothConfig, session: FlowSession | null): number {
  return config.pricing.includedPrints + (session?.extraPrints ?? 0);
}

export function slotCount(config: BoothConfig, session: FlowSession | null): number {
  return findFrame(config, session?.frameId ?? null)?.slots.length ?? 0;
}

/** Page has a visible button with one of the given actions. */
export function pageHasButton(
  config: BoothConfig,
  page: PageType,
  kinds: readonly ButtonActionKind[],
): boolean {
  return config.pages[page].elements.some(
    (e) => e.type === 'button' && e.visible && kinds.includes(e.action.kind),
  );
}

export function idleTimeoutMs(config: BoothConfig, page: PageType | null): number | null {
  if (!page) return null;
  const sec = config.flow.idleTimeoutSec[page];
  return sec ? sec * 1000 : null;
}
