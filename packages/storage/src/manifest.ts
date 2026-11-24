import { z } from 'zod';

/** Drive subfolders of a session (PRD §8), in display order. */
export const OUTPUT_KINDS = [
  'original',
  'mirrored',
  'filtered',
  'composite',
  'gif',
  'video',
] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

/** What the agent uploads itself; the rest is made by the worker. */
export const AGENT_KINDS = ['original', 'composite'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const FileIdSchema = z.string().regex(/^[a-z0-9]{8,64}$/);

/**
 * Sent by the agent to `POST /device/sessions/:id/complete` once every file is in storage.
 * Carries what the worker needs to build the other outputs (no booth config copy: the worker
 * loads the published `configVersion`).
 */
export const SessionManifestSchema = z.object({
  version: z.literal(1),
  configVersion: z.number().int().nonnegative(),
  frameId: z.string().min(1).max(64),
  filterId: z.string().max(64),
  /** Short link printed on the strip (a rebuilt composite must show the same QR). */
  downloadUrl: z.string().max(300).nullable().default(null),
  /** Selected take per slot (these are the `original` files that get uploaded). */
  shots: z
    .array(
      z.object({
        slotIndex: z.number().int().min(1).max(16),
        takeNumber: z.number().int().min(1).max(100),
        fileId: FileIdSchema,
      }),
    )
    .min(1)
    .max(16),
  files: z
    .array(
      z.object({
        id: FileIdSchema,
        kind: z.enum(AGENT_KINDS),
        name: z.string().min(1).max(120),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        bytes: z.number().int().positive(),
        mimeType: z.string().max(100),
        slotIndex: z.number().int().min(1).max(16).nullable(),
      }),
    )
    .min(1)
    .max(40),
});
export type SessionManifest = z.infer<typeof SessionManifestSchema>;

/** Keep only characters that are safe in a storage key and a Drive file name. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
  return cleaned.slice(0, 120) || 'file';
}

/** `<orgId>/sessions/<sessionId>/<kind>/<name>`: scoped by org (invariant: every path has org_id). */
export function sessionObjectKey(
  orgId: string,
  sessionId: string,
  kind: OutputKind,
  name: string,
): string {
  return `${orgId}/sessions/${sessionId}/${kind}/${safeFileName(name)}`;
}

/**
 * The download link to draw in a rebuilt composite's QR (audit R5). The QR must always point at
 * this session's short link `/s/<code>` (CLAUDE.md invariant), so the device-sent URL is used only
 * when it is exactly that path (any host: a custom QR domain is allowed); otherwise the link is
 * rebuilt from `fallbackBase` (PB_SHORT_LINK_BASE / PB_PUBLIC_API_URL), or no QR at all.
 */
export function safeDownloadUrl(
  sent: string | null,
  code: string,
  fallbackBase: string | null,
): string | null {
  if (sent) {
    try {
      const u = new URL(sent);
      if (
        (u.protocol === 'https:' || u.protocol === 'http:') &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        u.pathname === `/s/${code}`
      )
        return u.href;
    } catch {
      // fall through
    }
  }
  return fallbackBase ? `${fallbackBase.replace(/\/+$/, '')}/s/${code}` : null;
}
