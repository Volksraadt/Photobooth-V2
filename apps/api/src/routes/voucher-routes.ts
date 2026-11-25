import { createId } from '@paralleldrive/cuid2';
import {
  formatVoucherCode,
  generateVoucherCode,
  hashVoucherCodeAsync,
  SecretBoxError,
  voucherCodeAad,
} from '@pb/crypto';
import {
  auditLogs,
  getBooth,
  insertVouchers,
  listEncryptedVoucherCodes,
  PaymentRepoError,
  setBoothVoucherOffline,
  withUserContext,
} from '@pb/db';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { requireOrgEditor } from '../middleware/org-access';
import type { AppEnv } from '../types';

const MAX_BATCH = 500;

const CreateBody = z.object({
  count: z.number().int().min(1).max(MAX_BATCH),
  valueType: z.enum(['full', 'amount']),
  value: z.number().int().min(0).max(100_000_000),
  /** End of the chosen day in the booth's zone (Studio computes it), or null. */
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  note: z.string().trim().max(120).nullable(),
});

const OfflineBody = z.object({ enabled: z.boolean() });

const encryptionUnavailable = (c: Context<AppEnv>) =>
  c.json(
    { error: 'encryption_unavailable', message: 'SECRET_MASTER_KEY belum diatur di server API.' },
    503,
  );

/**
 * Vouchers (Studio, owner/manager). Codes are generated here because only the API holds the
 * master key: each code is stored as a scrypt hash (lookup, device list) and encrypted
 * (SecretBox, AAD bound to the booth) so the owner can see and copy it again later.
 */
export function studioVoucherRoutes() {
  const app = new Hono<AppEnv>();

  /** The booth if it belongs to the org and the user may edit it (RLS), else an error response. */
  const editableBooth = async (c: Context<AppEnv>) => {
    const orgId = c.req.param('orgId')!;
    const boothId = c.req.param('boothId')!;
    const denied = await requireOrgEditor(c, orgId);
    if (denied) return { denied };
    const row = await withUserContext(c.var.deps.db, c.var.user.userId, (tx) =>
      getBooth(tx, boothId),
    );
    if (!row || row.booth.orgId !== orgId)
      return { denied: c.json({ error: 'not_found', message: 'Booth tidak ditemukan.' }, 404) };
    return { booth: row.booth };
  };

  app.post('/orgs/:orgId/booths/:boothId/vouchers', async (c) => {
    const { denied, booth } = await editableBooth(c);
    if (denied) return denied;
    const box = c.var.deps.secretBox;
    if (!box) return encryptionUnavailable(c);
    const body = CreateBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body', message: 'Data tidak valid.' }, 400);
    const { count, valueType, value, expiresAt, note } = body.data;
    if (valueType === 'amount' && value < 1000)
      return c.json({ error: 'invalid_body', message: 'Nominal voucher minimal Rp1.000.' }, 400);
    const expires = expiresAt ? new Date(expiresAt) : null;
    if (expires && expires.getTime() < Date.now())
      return c.json({ error: 'invalid_body', message: 'Tanggal berlaku sudah lewat.' }, 400);

    const unique = new Set<string>();
    while (unique.size < count) unique.add(generateVoucherCode());
    const codes = [...unique];
    const hashes = await Promise.all(codes.map((code) => hashVoucherCodeAsync(booth.id, code)));
    const aad = voucherCodeAad(booth.id);
    const batchId = createId();
    try {
      await withUserContext(c.var.deps.db, c.var.user.userId, (tx) =>
        insertVouchers(tx, {
          orgId: booth.orgId,
          boothId: booth.id,
          batchId,
          note: note || null,
          valueType,
          value: valueType === 'amount' ? value : 0,
          expiresAt: expires,
          codes: codes.map((code, i) => ({
            codeHash: hashes[i]!,
            last4: code.slice(-4),
            codeEncrypted: box.encrypt(code, aad),
          })),
          userId: c.var.user.userId,
        }),
      );
    } catch (err) {
      // Two codes of the booth with the same hash: practically only a repeated random code.
      if (err instanceof Error && /vouchers_booth_code_uq/.test(err.message))
        return c.json({ error: 'conflict', message: 'Kode bentrok, coba lagi.' }, 409);
      throw err;
    }
    return c.json({
      batchId,
      codes: codes.map((code) => ({ code, formatted: formatVoucherCode(code) })),
    });
  });

  /** Full codes for the owner (`?ids=a,b`; none = all of the booth). Audited. */
  app.get('/orgs/:orgId/booths/:boothId/vouchers/codes', async (c) => {
    const { denied, booth } = await editableBooth(c);
    if (denied) return denied;
    const box = c.var.deps.secretBox;
    if (!box) return encryptionUnavailable(c);
    const idsParam = c.req.query('ids');
    const ids = idsParam
      ? idsParam
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 1000)
      : null;
    const aad = voucherCodeAad(booth.id);
    const rows = await withUserContext(c.var.deps.db, c.var.user.userId, async (tx) => {
      const list = await listEncryptedVoucherCodes(tx, { boothId: booth.id, voucherIds: ids });
      await tx.insert(auditLogs).values({
        orgId: booth.orgId,
        actorId: c.var.user.userId,
        action: 'voucher.reveal',
        entity: 'booth',
        entityId: booth.id,
        after: { count: list.length },
      });
      return list;
    });
    c.header('Cache-Control', 'no-store');
    return c.json({
      codes: rows.map((r) => {
        let code: string | null = null;
        if (r.codeEncrypted) {
          try {
            code = box.decrypt(r.codeEncrypted, aad);
          } catch (err) {
            if (!(err instanceof SecretBoxError)) throw err;
          }
        }
        return { id: r.id, code, formatted: code ? formatVoucherCode(code) : null };
      }),
    });
  });

  app.put('/orgs/:orgId/booths/:boothId/voucher-offline', async (c) => {
    const { denied, booth } = await editableBooth(c);
    if (denied) return denied;
    const body = OfflineBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body', message: 'Data tidak valid.' }, 400);
    try {
      await withUserContext(c.var.deps.db, c.var.user.userId, (tx) =>
        setBoothVoucherOffline(tx, {
          boothId: booth.id,
          enabled: body.data.enabled,
          userId: c.var.user.userId,
        }),
      );
    } catch (err) {
      if (err instanceof PaymentRepoError)
        return c.json({ error: err.code, message: err.message }, 404);
      throw err;
    }
    return c.json({ enabled: body.data.enabled });
  });

  return app;
}
