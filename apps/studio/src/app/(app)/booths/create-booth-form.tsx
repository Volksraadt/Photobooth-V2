'use client';

import { Button, Input, Label, Select } from '@pb/ui';
import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { IDLE } from '@/lib/form';
import { BOOTH_TIMEZONES } from '@/lib/timezones';
import { createBoothAction } from './actions';

export function CreateBoothForm({ defaultTimezone }: { defaultTimezone: string }) {
  const [state, action, pending] = useActionState(createBoothAction, IDLE);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-[1fr_220px_auto] sm:items-end">
      <div className="space-y-2">
        <Label htmlFor="booth-name">Nama booth</Label>
        <Input
          id="booth-name"
          name="name"
          placeholder="mis. Booth Mall Kelapa Gading"
          required
          minLength={2}
          maxLength={80}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="booth-timezone">Zona waktu</Label>
        <Select id="booth-timezone" name="timezone" defaultValue={defaultTimezone}>
          {BOOTH_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" disabled={pending}>
        Buat booth
      </Button>
      <div className="sm:col-span-3">
        <FormMessage state={state} />
      </div>
    </form>
  );
}
