import { sha256Hex } from '@pb/crypto';
import { devices } from '@pb/db';
import { and, eq, isNull } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';
import { bearerToken, unauthorized } from './bearer';

/**
 * `Authorization: Bearer <device token>`. Only the sha256 of the token is stored;
 * revoked devices are rejected. Sets c.var.device (scoping every device query to its org).
 */
export const deviceAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearerToken(c.req.header('authorization'));
  if (!token || token.length < 32) return c.json(unauthorized, 401);

  const { db } = c.var.deps;
  const [device] = await db
    .select({ id: devices.id, orgId: devices.orgId, boothId: devices.boothId, name: devices.name })
    .from(devices)
    .where(and(eq(devices.tokenHash, sha256Hex(token)), isNull(devices.revokedAt)))
    .limit(1);
  if (!device) return c.json(unauthorized, 401);

  c.set('device', device);
  await next();
});
