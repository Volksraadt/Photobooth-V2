import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';

/**
 * Client address for rate limiting. Behind a reverse proxy set PB_TRUST_PROXY=1 so the first
 * `X-Forwarded-For` entry is used; otherwise the socket address (a spoofed header is ignored).
 */
export function clientIp(c: Context, trustProxy = process.env.PB_TRUST_PROXY === '1'): string {
  if (trustProxy) {
    const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (xff) return xff;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown'; // app.request() in tests has no socket
  }
}

/**
 * Fixed-window counter per (bucket, client IP), in memory. Enough for the single API instance of
 * the MVP (docs/decisions.md F4); behind several instances move it to Redis or the proxy.
 * Unauthenticated endpoints only: device/user calls are already tied to a revocable token.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** true = allowed. */
  take(key: string, max: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
    const t = this.now();
    if (t - this.lastSweep > 60_000) {
      for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
      this.lastSweep = t;
    }
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      this.hits.set(key, entry);
    }
    entry.count++;
    return {
      ok: entry.count <= max,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - t) / 1000)),
    };
  }
}

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;

export function rateLimit(bucket: string, max: number, windowMs: number) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const ip = clientIp(c);
    // Dev stack + e2e run everything on this machine. In production a local reverse proxy must
    // set PB_TRUST_PROXY=1, otherwise every client would share the loopback bucket.
    if (LOOPBACK.test(ip) && process.env.NODE_ENV !== 'production') return next();
    const { ok, retryAfterSec } = c.var.deps.rateLimiter.take(`${bucket}:${ip}`, max, windowMs);
    if (!ok) {
      c.header('Retry-After', String(retryAfterSec));
      return c.json({ error: 'rate_limited', message: 'Terlalu banyak permintaan.' }, 429);
    }
    await next();
  });
}
