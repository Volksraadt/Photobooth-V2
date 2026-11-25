'use client';

import { Button, Input } from '@pb/ui';
import { startTransition, useActionState, useState } from 'react';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { FormMessage } from '@/components/form-message';
import { IDLE } from '@/lib/form';
import {
  archiveBoothAction,
  deleteBoothAction,
  pairDeviceAction,
  restoreBoothAction,
  rollbackAction,
  savePaymentAction,
} from './actions';

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

const PAYMENT_OPTIONS = [
  {
    value: 'qris',
    label: 'QRIS',
    hint: 'Scan dengan e-wallet / m-banking (perlu Midtrans di Integrasi)',
  },
  { value: 'voucher', label: 'Voucher', hint: 'Kode 8 digit dari menu Voucher' },
  { value: 'cash', label: 'Tunai', hint: 'Dibayar ke petugas, disetujui dengan PIN admin' },
] as const;

/**
 * Payment options of the booth, saved and applied to the live booth from here. The action is
 * dispatched from onSubmit (no automatic form reset), so a refused change keeps the owner's
 * choice; after a save the fields remount from the saved config (key), the message stays.
 */
export function PaymentForm(props: { boothId: string; methods: string[]; eventMode: boolean }) {
  const [state, action, pending] = useActionState(savePaymentAction, IDLE);
  return (
    <div className="space-y-3">
      <PaymentFields
        key={`${props.eventMode}|${props.methods.join(',')}`}
        {...props}
        pending={pending}
        onSubmit={(form) => startTransition(() => action(form))}
      />
      <FormMessage state={state} />
    </div>
  );
}

function PaymentFields({
  boothId,
  methods,
  eventMode,
  pending,
  onSubmit,
}: {
  boothId: string;
  methods: string[];
  eventMode: boolean;
  pending: boolean;
  onSubmit: (form: FormData) => void;
}) {
  const [event, setEvent] = useState(eventMode);
  const [chosen, setChosen] = useState<string[]>(methods);
  return (
    <form
      className="space-y-3"
      data-testid="payment-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
      }}
    >
      <input type="hidden" name="boothId" value={boothId} />
      <fieldset className="space-y-2" disabled={event}>
        <legend className="mb-1 text-sm font-medium">Cara bayar pembeli</legend>
        {PAYMENT_OPTIONS.map((o) => (
          <label
            key={o.value}
            className="flex items-start gap-2 text-sm aria-disabled:opacity-50"
            aria-disabled={event}
          >
            <input
              type="checkbox"
              className="mt-1"
              name={`method-${o.value}`}
              checked={chosen.includes(o.value)}
              onChange={(e) =>
                setChosen((list) =>
                  e.target.checked ? [...list, o.value] : list.filter((m) => m !== o.value),
                )
              }
              data-testid={`payment-method-${o.value}`}
            />
            <span>
              {o.label}
              <span className="block text-xs text-muted-foreground">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex items-start gap-2 border-t pt-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          name="eventMode"
          checked={event}
          onChange={(e) => setEvent(e.target.checked)}
          data-testid="payment-event-mode"
        />
        <span>
          Mode event: tanpa pembayaran
          <span className="block text-xs text-muted-foreground">
            Untuk acara yang sudah dibayar penyelenggara (pernikahan, acara kantor). Halaman
            Pembayaran dilewati dan setiap sesi gratis.
          </span>
        </span>
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? 'Menyimpan…' : 'Simpan & terapkan ke booth'}
      </Button>
    </form>
  );
}

/**
 * Archive / restore / delete at the bottom of the booth page. Delete is offered only when the
 * booth never had a session (sales records are never erased); otherwise archive.
 */
export function BoothLifecycle({
  boothId,
  boothName,
  archived,
  sessionCount,
}: {
  boothId: string;
  boothName: string;
  archived: boolean;
  sessionCount: number;
}) {
  const [archiveState, archive, archiving] = useActionState(archiveBoothAction, IDLE);
  const [restoreState, restore, restoring] = useActionState(restoreBoothAction, IDLE);
  const [deleteState, remove, deleting] = useActionState(deleteBoothAction, IDLE);
  return (
    <div className="space-y-4 text-sm" data-testid="booth-lifecycle">
      {archived ? (
        <form action={restore} className="space-y-2">
          <input type="hidden" name="boothId" value={boothId} />
          <p className="text-muted-foreground">
            Booth ini diarsipkan: tidak berjalan dan tidak dihitung dalam batas paket. Data
            penjualan, voucher, dan desain tetap tersimpan.
          </p>
          <Button type="submit" disabled={restoring} data-testid="booth-restore">
            {restoring ? 'Memulihkan…' : 'Pulihkan booth'}
          </Button>
          <FormMessage state={restoreState} />
        </form>
      ) : (
        <form action={archive} className="space-y-2">
          <input type="hidden" name="boothId" value={boothId} />
          <p className="text-muted-foreground">
            Arsipkan booth yang tidak dipakai lagi: perangkatnya dicabut dan booth tidak dihitung
            dalam batas paket. Data penjualan tetap ada dan booth bisa dipulihkan kapan saja.
          </p>
          <ConfirmSubmit
            label="Arsipkan booth"
            confirmLabel="Ya, arsipkan"
            message={`Arsipkan "${boothName}"? Kiosk yang terpasang langsung berhenti dan harus dipasang ulang bila booth dipulihkan.`}
            testId="booth-archive"
            pending={archiving}
          />
          <FormMessage state={archiveState} />
        </form>
      )}
      <form action={remove} className="space-y-2 border-t pt-4">
        <input type="hidden" name="boothId" value={boothId} />
        {sessionCount > 0 ? (
          <p className="text-muted-foreground">
            Hapus permanen tidak tersedia: booth ini punya {sessionCount} transaksi yang harus tetap
            tercatat. Gunakan arsip.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground">
              Booth ini belum pernah dipakai, jadi bisa dihapus permanen beserta desain dan
              vouchernya.
            </p>
            <ConfirmSubmit
              label="Hapus permanen"
              confirmLabel="Ya, hapus permanen"
              message={`Hapus "${boothName}" beserta desain, riwayat versi, dan vouchernya? Tindakan ini tidak bisa dibatalkan.`}
              testId="booth-delete"
              pending={deleting}
            />
          </>
        )}
        <FormMessage state={deleteState} />
      </form>
    </div>
  );
}
