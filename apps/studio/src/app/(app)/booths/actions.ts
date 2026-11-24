'use server';

import { createBoothFromTemplate, PlanLimitError } from '@pb/db';
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
  const templateId = field(form, 'templateId') || null;
  if (name.length < 2 || name.length > 80)
    return { status: 'error', message: 'Nama booth 2–80 karakter.' };
  if (!isBoothTimezone(timezone)) return { status: 'error', message: 'Zona waktu tidak valid.' };

  let boothId: string;
  try {
    const booth = await asUser(user, (tx) =>
      createBoothFromTemplate(tx, { orgId: org.id, name, timezone, userId: user.id, templateId }),
    );
    boothId = booth.id;
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return {
        status: 'error',
        message: `Paket ${err.planName} hanya mengizinkan ${err.max} booth. Upgrade paket untuk menambah booth.`,
      };
    }
    throw err;
  }
  revalidatePath('/booths');
  redirect(`/booths/${boothId}`);
}
