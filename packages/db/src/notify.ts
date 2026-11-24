import postgres from 'postgres';
import { BOOTH_CONFIG_CHANNEL } from './booth-repo';

/** In-process fan-out of "booth config changed" signals, keyed by booth id. */
export class BoothConfigEvents {
  private readonly listeners = new Map<string, Set<() => void>>();

  subscribe(boothId: string, listener: () => void): () => void {
    let set = this.listeners.get(boothId);
    if (!set) this.listeners.set(boothId, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(boothId);
    };
  }

  emit(boothId: string): void {
    for (const l of [...(this.listeners.get(boothId) ?? [])]) l();
  }

  get size(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}

/**
 * LISTEN on `pb_booth_config` (sent by publishConfig via pg_notify) with a dedicated connection.
 * postgres-js re-subscribes after reconnects.
 */
export async function listenBoothConfig(
  url: string,
  events: BoothConfigEvents,
): Promise<{ close: () => Promise<void> }> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.listen(BOOTH_CONFIG_CHANNEL, (boothId) => events.emit(boothId));
  return { close: () => sql.end() };
}
