'use client';

import { Button, Input, Label, Select } from '@pb/ui';
import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { IDLE } from '@/lib/form';
import { BOOTH_TIMEZONES } from '@/lib/timezones';
import { createOrgAction } from './actions';

export function OrgForm() {
  const [state, action, pending] = useActionState(createOrgAction, IDLE);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Nama usaha / organisasi</Label>
        <Input
          id="name"
          name="name"
          placeholder="mis. Senyum Photobooth"
          required
          minLength={2}
          maxLength={80}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="timezone">Zona waktu</Label>
        <Select id="timezone" name="timezone" defaultValue="Asia/Jakarta">
          {BOOTH_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </Select>
      </div>
      <FormMessage state={state} />
      <Button type="submit" className="w-full" disabled={pending}>
        Buat organisasi
      </Button>
    </form>
  );
}
