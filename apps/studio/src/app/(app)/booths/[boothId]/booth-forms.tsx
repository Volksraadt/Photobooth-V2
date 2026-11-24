'use client';

import { Button, Input } from '@pb/ui';
import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { IDLE } from '@/lib/form';
import { pairDeviceAction, rollbackAction } from './actions';

export function PairDeviceForm({ boothId }: { boothId: string }) {
  const [state, action, pending] = useActionState(pairDeviceAction, IDLE);
  return (
    <form action={action} className="space-y-2" data-testid="pair-form">
      <input type="hidden" name="boothId" value={boothId} />
      <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
        <Input
          name="code"
          placeholder="Kode 6 digit"
          inputMode="numeric"
          maxLength={7}
          required
          aria-label="Kode pairing"
        />
        <Input
          name="name"
          placeholder="Nama perangkat, mis. Laptop booth 1"
          maxLength={80}
          aria-label="Nama perangkat"
        />
        <Button type="submit" disabled={pending}>
          Pasang
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function RollbackButton({ boothId, version }: { boothId: string; version: number }) {
  const [state, action, pending] = useActionState(rollbackAction, IDLE);
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="boothId" value={boothId} />
      <input type="hidden" name="version" value={version} />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending}
        data-testid={`rollback-${version}`}
      >
        Aktifkan lagi
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
