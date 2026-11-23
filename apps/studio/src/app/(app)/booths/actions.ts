'use server';

import { createBooth } from '@pb/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { field, type FormState } from '@/lib/form';
import { asUser, requireOrg } from '@/lib/org';
import { isBoothTimezone } from '@/lib/timezones';

export async function createBoothAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, org } = await requireOrg();
  if (org.role === 'operator')
    return { status: 'error', message: 'Operator tidak dapat membuat booth.' };
  const name = field(form, 'name').trim();
  const timezone = field(form, 'timezone');
  if (name.length < 2 || name.length > 80)
    return { status: 'error', message: 'Nama booth 2–80 karakter.' };
  if (!isBoothTimezone(timezone)) return { status: 'error', message: 'Zona waktu tidak valid.' };

  // Plan limits (maxBooths) are enforced in F6.
  const booth = await asUser(user, (tx) =>
    createBooth(tx, { orgId: org.id, name, timezone, userId: user.id }),
  );
  revalidatePath('/booths');
  redirect(`/booths/${booth.id}`);
}
