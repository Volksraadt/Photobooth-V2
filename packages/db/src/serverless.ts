import { SERVERLESS_IDLE_SECONDS } from './client';

type RequestContext = { waitUntil?: (p: Promise<unknown>) => void };

const sleep = () => new Promise((r) => setTimeout(r, SERVERLESS_IDLE_SECONDS * 1000 + 500));

/** Vercel's per-request context (what `@vercel/functions` waitUntil uses); null elsewhere. */
function requestContext(): RequestContext | null {
  if (!process.env.VERCEL) return null;
  const store = (globalThis as Record<symbol, { get?: () => RequestContext } | undefined>)[
    Symbol.for('@vercel/request-context')
  ];
  return store?.get?.() ?? null;
}

/**
 * On Vercel, keep the function alive slightly longer than the DB idle timeout after a response,
 * so postgres.js closes its idle connections before the instance is frozen (a socket kept
 * across a freeze is dead on resume and queries hang: Supabase KB "hanging queries in Vercel
 * Serverless Functions"). Call while handling the request; the returned function is called once
 * the response is done. A no-op outside Vercel.
 */
export function keepAliveAfterResponse(): () => void {
  const ctx = requestContext();
  return () => ctx?.waitUntil?.(sleep());
}
