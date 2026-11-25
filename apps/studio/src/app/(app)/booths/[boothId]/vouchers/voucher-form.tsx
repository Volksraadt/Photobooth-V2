'use client';

import { Alert, Button, Input, Label, Select } from '@pb/ui';
import { useActionState, useState } from 'react';
import { createVouchersAction, type VoucherFormState } from './actions';

const IDLE: VoucherFormState = { status: 'idle' };

function downloadCsv(name: string, state: Extract<VoucherFormState, { status: 'created' }>) {
  const rows = [
    ['kode', 'nilai', 'masa_berlaku', 'batch'],
    ...state.codes.map((c) => [c.formatted, state.valueLabel, state.expiresLabel, state.batchId]),
  ];
  const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(
    new Blob([String.fromCharCode(0xfeff) + csv], { type: 'text/csv;charset=utf-8' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `voucher-${name}-${state.batchId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Printable cards in a new window. */
function printCards(boothName: string, state: Extract<VoucherFormState, { status: 'created' }>) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Voucher</title>
<style>body{font-family:system-ui,sans-serif;margin:16px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.card{border:1px dashed #888;padding:12px;break-inside:avoid}.code{font:700 20px ui-monospace,monospace;letter-spacing:1px;margin:6px 0}
small{color:#555}</style></head><body><div class="grid">${state.codes
    .map(
      (c) =>
        `<div class="card"><small>${esc(boothName)}</small><div class="code">${c.formatted}</div><small>${esc(state.valueLabel)} · ${esc(state.expiresLabel)}</small></div>`,
    )
    .join('')}</div><script>window.print()</script></body></html>`);
  w.document.close();
}

export function VoucherForm({ boothId, boothName }: { boothId: string; boothName: string }) {
  const [state, action, pending] = useActionState(createVouchersAction, IDLE);
  const [valueType, setValueType] = useState<'full' | 'amount'>('full');
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3" data-testid="voucher-form">
        <input type="hidden" name="boothId" value={boothId} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="v-count">Jumlah</Label>
            <Input
              id="v-count"
              name="count"
              type="number"
              min={1}
              max={500}
              defaultValue={1}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="v-type">Nilai</Label>
            <Select
              id="v-type"
              name="valueType"
              value={valueType}
              onChange={(e) => setValueType(e.target.value === 'amount' ? 'amount' : 'full')}
            >
              <option value="full">Penuh (gratis 1 sesi)</option>
              <option value="amount">Nominal</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="v-value">Nominal (Rp)</Label>
            <Input
              id="v-value"
              name="value"
              type="number"
              min={1000}
              step={500}
              disabled={valueType === 'full'}
              placeholder={valueType === 'full' ? '—' : '35000'}
              required={valueType === 'amount'}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="v-exp">Berlaku sampai (opsional)</Label>
            <Input id="v-exp" name="expiresOn" type="date" />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="v-note">Catatan (opsional)</Label>
          <Input id="v-note" name="note" maxLength={120} placeholder="mis. Promo pembukaan" />
        </div>
        <p className="text-xs text-muted-foreground">
          Voucher nominal hanya diterima bila nilainya ≥ harga frame yang dipilih. Setiap voucher
          sekali pakai dan hanya berlaku di booth ini.
        </p>
        <Button type="submit" disabled={pending}>
          {pending ? 'Membuat…' : 'Buat voucher'}
        </Button>
      </form>
      {state.status === 'error' && <Alert variant="destructive">{state.message}</Alert>}
      {state.status === 'created' && (
        <div className="space-y-3 rounded border p-4" data-testid="voucher-created">
          <Alert variant="success">{state.message}</Alert>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => downloadCsv(boothName.replace(/\W+/g, '-'), state)}
            >
              Unduh CSV
            </Button>
            <Button type="button" variant="outline" onClick={() => printCards(boothName, state)}>
              Cetak
            </Button>
          </div>
          <ul className="grid max-h-64 grid-cols-2 gap-1 overflow-auto font-mono text-sm sm:grid-cols-4">
            {state.codes.map((c) => (
              <li key={c.code} data-testid="voucher-code">
                {c.formatted}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
