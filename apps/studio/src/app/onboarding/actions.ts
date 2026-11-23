'use server';

import { createOrg } from '@pb/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { field, type FormState } from '@/lib/form';
import { asUser, ORG_COOKIE } from '@/lib/org';
import { isBoothTimezone } from '@/lib/timezones';

export async function createOrgAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = field(form, 'name').trim();
  const timezone = field(form, 'timezone');
  if (name.length < 2 || name.length > 80)
    return { status: 'error', message: 'Nama organisasi 2–80 karakter.' };
  if (!isBoothTimezone(timezone)) return { status: 'error', message: 'Zona waktu tidak valid.' };

  const org = await asUser(user, (tx) => createOrg(tx, { name, timezone }));
  (await cookies()).set(ORG_COOKIE, org.id, { httpOnly: true, sameSite: 'lax', path: '/' });
  redirect('/booths');
}
