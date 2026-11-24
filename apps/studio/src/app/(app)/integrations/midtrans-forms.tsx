'use client';

import { Button, Input, Label } from '@pb/ui';
import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { IDLE } from '@/lib/form';
import { saveMidtransAction, testMidtransAction } from './actions';

export type CredentialView = {
  env: 'sandbox' | 'production';
  merchantId: string | null;
  clientKey: string | null;
  isActive: boolean;
  status: 'untested' | 'ok' | 'failed' | 'revoked';
  lastTestedAt: string | null;
  lastTestMessage: string | null;
};

export function MidtransForm({
  env,
  credential,
}: {
  env: 'sandbox' | 'production';
  credential: CredentialView | null;
}) {
  const [state, action, pending] = useActionState(saveMidtransAction, IDLE);
  const id = (n: string) => `${env}-${n}`;
  return (
    <form action={action} className="space-y-3" data-testid={`midtrans-form-${env}`}>
      <input type="hidden" name="env" value={env} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={id('merchant')}>Merchant ID</Label>
          <Input
            id={id('merchant')}
            name="merchantId"
            defaultValue={credential?.merchantId ?? ''}
            placeholder="G123456789"
            maxLength={100}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('client')}>Client key</Label>
          <Input
            id={id('client')}
            name="clientKey"
            defaultValue={credential?.clientKey ?? ''}
            placeholder={env === 'sandbox' ? 'SB-Mid-client-…' : 'Mid-client-…'}
            maxLength={200}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={id('server')}>Server key</Label>
        <Input
          id={id('server')}
          name="serverKey"
          type="password"
          autoComplete="off"
          placeholder={
            credential
              ? 'Tersimpan terenkripsi — kosongkan untuk tetap memakai key lama'
              : env === 'sandbox'
                ? 'SB-Mid-server-…'
                : 'Mid-server-…'
          }
          required={!credential}
          maxLength={200}
        />
        <p className="text-xs text-muted-foreground">
          Server key hanya dikirim ke server API, disimpan terenkripsi, dan tidak pernah ditampilkan
          lagi atau dikirim ke perangkat booth.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={credential?.isActive ?? env === 'sandbox'}
        />
        Pakai lingkungan ini untuk QRIS pembeli
      </label>
      <Button type="submit" disabled={pending}>
        Simpan
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

export function TestConnectionButton({ env }: { env: 'sandbox' | 'production' }) {
  const [state, action, pending] = useActionState(testMidtransAction, IDLE);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="env" value={env} />
      <Button
        type="submit"
        variant="outline"
        disabled={pending}
        data-testid={`midtrans-test-${env}`}
      >
        {pending ? 'Menguji…' : 'Tes koneksi'}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
