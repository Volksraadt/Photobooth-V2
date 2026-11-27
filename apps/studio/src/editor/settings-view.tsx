'use client';

import { hashAdminPin, NEW_ADMIN_PIN_RE, type PaymentMethod } from '@pb/schema';
import { useState } from 'react';
import { AssetField, ensureAssetRef } from './assets';
import { useApply, useEditor } from './editor-context';
import {
  ColorField,
  NumberField,
  Section,
  SelectField,
  TextField,
  Toggle,
  WideFields,
  inputCls,
} from './fields';

const rupiah = (v: number) => v.toLocaleString('id-ID');

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'qris', label: 'QRIS' },
  { value: 'voucher', label: 'Voucher' },
  { value: 'cash', label: 'Tunai' },
];

/** Flow, price, output and admin PIN — all part of the draft config (undoable). */
export function SettingsView() {
  const apply = useApply();
  const doc = useEditor((s) => s.doc);
  const { flow, pricing, output } = doc;
  const [pin, setPin] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  return (
    <WideFields>
      <div className="h-full overflow-auto" data-testid="settings-view">
        <div className="mx-auto grid max-w-5xl gap-4 p-4 md:p-6 xl:grid-cols-2">
          <div className="rounded-lg border bg-background">
            <Section title="Alur">
              <Toggle
                label="Halaman tutorial"
                value={flow.tutorialEnabled}
                onCommit={(v) => apply('Tutorial', (d) => void (d.flow.tutorialEnabled = v))}
              />
              <Toggle
                label="Halaman review (pilih filter)"
                value={flow.reviewEnabled}
                onCommit={(v) => apply('Review', (d) => void (d.flow.reviewEnabled = v))}
              />
              <Toggle
                label="Mode event (tanpa pembayaran)"
                testId="setting-event-mode"
                value={flow.eventMode}
                onCommit={(v) => apply('Mode event', (d) => void (d.flow.eventMode = v))}
              />
              <NumberField
                label="Hitung mundur (dtk)"
                value={flow.shotCountdownSec}
                min={0}
                max={30}
                onCommit={(v) =>
                  apply('Hitung mundur', (d) => void (d.flow.shotCountdownSec = Math.round(v)))
                }
              />
              <Toggle
                label="Lanjut otomatis antar foto"
                value={flow.autoAdvanceBetweenShots}
                onCommit={(v) =>
                  apply('Lanjut otomatis', (d) => void (d.flow.autoAdvanceBetweenShots = v))
                }
              />
              <Toggle
                label="Ulang foto tanpa batas"
                value={flow.maxRetakesPerShot === null}
                onCommit={(v) =>
                  apply('Maks ulang', (d) => void (d.flow.maxRetakesPerShot = v ? null : 2))
                }
              />
              <NumberField
                label="Maks. ulang/foto"
                value={flow.maxRetakesPerShot ?? undefined}
                disabled={flow.maxRetakesPerShot === null}
                placeholder="Tanpa batas"
                min={0}
                onCommit={(v) =>
                  apply('Maks ulang', (d) => void (d.flow.maxRetakesPerShot = Math.round(v)))
                }
              />
              <NumberField
                label="Kembali dari Hasil (dtk)"
                value={flow.resultAutoReturnSec}
                min={1}
                onCommit={(v) =>
                  apply('Auto kembali', (d) => void (d.flow.resultAutoReturnSec = Math.round(v)))
                }
              />
            </Section>
            <Section title="Pembayaran">
              {METHODS.map((m) => (
                <Toggle
                  key={m.value}
                  label={m.label}
                  value={flow.paymentMethods.includes(m.value)}
                  onCommit={(on) =>
                    apply('Metode bayar', (d) => {
                      const list = d.flow.paymentMethods.filter((x) => x !== m.value);
                      d.flow.paymentMethods = on ? [...list, m.value] : list;
                    })
                  }
                />
              ))}
              <NumberField
                label="Kedaluwarsa QRIS (dtk)"
                value={flow.qrisExpirySec}
                min={60}
                max={3600}
                onCommit={(v) =>
                  apply('Kedaluwarsa QRIS', (d) => void (d.flow.qrisExpirySec = Math.round(v)))
                }
              />
            </Section>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border bg-background">
              <Section title="Harga">
                <NumberField
                  label="Harga dasar (Rp)"
                  testId="setting-base-price"
                  format={rupiah}
                  value={pricing.basePrice}
                  min={0}
                  step={1000}
                  onCommit={(v) =>
                    apply('Harga dasar', (d) => void (d.pricing.basePrice = Math.round(v)))
                  }
                />
                <NumberField
                  label="Lembar termasuk"
                  value={pricing.includedPrints}
                  min={0}
                  max={10}
                  onCommit={(v) =>
                    apply('Lembar cetak', (d) => void (d.pricing.includedPrints = Math.round(v)))
                  }
                />
                <Toggle
                  label="Jual cetak tambahan"
                  value={pricing.extraPrintPrice !== null}
                  onCommit={(on) =>
                    apply(
                      'Cetak tambahan',
                      (d) => void (d.pricing.extraPrintPrice = on ? 15000 : null),
                    )
                  }
                />
                {pricing.extraPrintPrice !== null && (
                  <>
                    <NumberField
                      label="Harga/lembar (Rp)"
                      format={rupiah}
                      value={pricing.extraPrintPrice}
                      min={0}
                      step={1000}
                      onCommit={(v) =>
                        apply(
                          'Harga cetak',
                          (d) => void (d.pricing.extraPrintPrice = Math.round(v)),
                        )
                      }
                    />
                    <NumberField
                      label="Maks. tambahan"
                      value={pricing.maxExtraPrints}
                      min={0}
                      max={20}
                      onCommit={(v) =>
                        apply('Maks cetak', (d) => void (d.pricing.maxExtraPrints = Math.round(v)))
                      }
                    />
                  </>
                )}
              </Section>
            </div>

            <div className="rounded-lg border bg-background">
              <Section title="Output">
                <TextField
                  label="Folder Drive"
                  value={output.driveRootFolderName}
                  onCommit={(v) =>
                    v && apply('Folder Drive', (d) => void (d.output.driveRootFolderName = v))
                  }
                />
                <Toggle
                  label="GIF"
                  value={output.gif.enabled}
                  onCommit={(v) => apply('GIF', (d) => void (d.output.gif.enabled = v))}
                />
                {output.gif.enabled && (
                  <NumberField
                    label="Jeda GIF (ms)"
                    value={output.gif.frameDelayMs}
                    min={50}
                    max={5000}
                    onCommit={(v) =>
                      apply('Jeda GIF', (d) => void (d.output.gif.frameDelayMs = Math.round(v)))
                    }
                  />
                )}
                <Toggle
                  label="Video 9:16"
                  value={output.video.enabled}
                  onCommit={(v) => apply('Video', (d) => void (d.output.video.enabled = v))}
                />
                {output.video.enabled && (
                  <>
                    <SelectField
                      label="Pilih foto"
                      value={output.video.photoPick}
                      options={[
                        { value: 'random', label: 'Acak' },
                        { value: 'first', label: '3 pertama' },
                        { value: 'buyer', label: 'Dipilih pembeli' },
                      ]}
                      onCommit={(v) =>
                        apply('Pilih foto video', (d) => void (d.output.video.photoPick = v))
                      }
                    />
                    <NumberField
                      label="Detik/foto"
                      value={output.video.secondsPerPhoto}
                      min={0.5}
                      max={10}
                      step={0.5}
                      onCommit={(v) =>
                        apply('Detik video', (d) => void (d.output.video.secondsPerPhoto = v))
                      }
                    />
                    <AssetField
                      label="Latar video"
                      kind="image"
                      allowEmpty
                      value={output.video.backgroundAssetId}
                      onPick={(a) =>
                        apply('Latar video', (d) => {
                          if (a) {
                            d.output.video.backgroundAssetId = a.id;
                            ensureAssetRef(d, a);
                          } else delete d.output.video.backgroundAssetId;
                        })
                      }
                    />
                  </>
                )}
              </Section>
            </div>

            <div className="rounded-lg border bg-background">
              <Section title="Artboard">
                <ColorField
                  label="Letterbox"
                  value={doc.artboard.letterboxColor}
                  onCommit={(v) =>
                    v && apply('Letterbox', (d) => void (d.artboard.letterboxColor = v))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {doc.artboard.width}×{doc.artboard.height} (
                  {doc.artboard.orientation === 'landscape' ? 'landscape' : 'portrait'})
                </p>
              </Section>
            </div>

            <div className="rounded-lg border bg-background">
              <Section title="PIN admin Kiosk">
                <p className="text-xs text-muted-foreground">
                  {doc.admin.pinHash
                    ? 'PIN sudah diatur.'
                    : 'PIN belum diatur: mode admin di Kiosk terkunci.'}{' '}
                  PIN disimpan sebagai hash.
                </p>
                <div className="flex gap-2">
                  <input
                    className={inputCls}
                    type="password"
                    inputMode="numeric"
                    placeholder="6–8 digit"
                    data-testid="setting-pin"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  />
                  <button
                    type="button"
                    className="h-8 shrink-0 rounded bg-primary px-3 text-xs text-primary-foreground disabled:opacity-50"
                    disabled={!NEW_ADMIN_PIN_RE.test(pin)}
                    onClick={async () => {
                      const hash = await hashAdminPin(pin);
                      apply('PIN admin', (d) => void (d.admin.pinHash = hash));
                      setPin('');
                      setPinMsg('PIN tersimpan di draft. Publikasikan agar berlaku di booth.');
                    }}
                  >
                    Simpan PIN
                  </button>
                </div>
                {pinMsg && <p className="text-xs text-success">{pinMsg}</p>}
              </Section>
            </div>
          </div>
        </div>
      </div>
    </WideFields>
  );
}
