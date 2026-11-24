'use client';

import { Button, Input, Label } from '@pb/ui';
import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { IDLE } from '@/lib/form';
import { updatePaperAction } from './actions';

export function PaperForm({ deviceId, capacity }: { deviceId: string; capacity: number | null }) {
  const [state, action, pending] = useActionState(updatePaperAction, IDLE);
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-2"
      data-testid={`paper-form-${deviceId}`}
    >
      <input type="hidden" name="deviceId" value={deviceId} />
      <div className="space-y-1">
        <Label htmlFor={`cap-${deviceId}`}>Kapasitas roll (lembar 4×6)</Label>
        <Input
          id={`cap-${deviceId}`}
          name="capacity"
          type="number"
          min={1}
          max={100000}
          defaultValue={capacity ?? ''}
          placeholder="mis. 700"
          className="w-36"
        />
      </div>
      <label className="flex items-center gap-1 pb-2 text-sm">
        <input type="checkbox" name="newRoll" /> Roll baru dipasang
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Simpan
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
