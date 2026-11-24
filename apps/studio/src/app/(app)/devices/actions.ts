'use server';

import { revokeDevice, updatePaper } from '@pb/db';
import { revalidatePath } from 'next/cache';
import { field, type FormState } from '@/lib/form';
import { asUser, requireOrg } from '@/lib/org';

async function editor() {
  const ctx = await requireOrg();
  if (ctx.org.role === 'operator') throw new Error('Operator tidak dapat mengubah perangkat.');
  return ctx;
}

/** Revokes the device token: the next request of that laptop is refused and it must be paired again. */
export async function revokeDeviceFromListAction(form: FormData): Promise<void> {
  const { user } = await editor();
  await asUser(user, (tx) => revokeDevice(tx, field(form, 'deviceId'), user.id));
  revalidatePath('/devices');
}

/** Owner enters the roll capacity (sheets) and/or starts a new roll (counter back to zero). */
export async function updatePaperAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, org } = await editor();
  const raw = field(form, 'capacity').trim();
  const capacity = raw === '' ? null : Number(raw);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000))
    return { status: 'error', message: 'Kapasitas roll harus bilangan bulat 1–100000.' };
  try {
    await asUser(user, (tx) =>
      updatePaper(tx, {
        orgId: org.id,
        deviceId: field(form, 'deviceId'),
        capacity,
        newRoll: field(form, 'newRoll') === 'on',
        userId: user.id,
      }),
    );
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'Gagal menyimpan.' };
  }
  revalidatePath('/devices');
  return { status: 'info', message: 'Tersimpan.' };
}
