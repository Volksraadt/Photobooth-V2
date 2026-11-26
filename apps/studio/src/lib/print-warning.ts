import type { BoothConfig } from '@pb/schema';

/**
 * Extra prints are bought on Pilih Frame (and paid at Payment). A booth that sells them but has
 * no "Jumlah cetak" element there cannot sell any: say so before publishing (it never blocks).
 */
export function extraPrintsWarning(config: BoothConfig): string | null {
  if (config.pricing.extraPrintPrice === null || config.pricing.maxExtraPrints === 0) return null;
  if (config.flow.eventMode) return null;
  const onFramePick = config.pages.framePick.elements.some((e) => e.type === 'print-copies');
  if (onFramePick) return null;
  return 'Cetak tambahan kini dibeli di halaman Pilih Frame (dibayar bersama frame). Tambahkan elemen "Jumlah cetak" di halaman Pilih Frame agar pembeli bisa menambah cetakan; tanpa itu cetak tambahan tidak dijual.';
}
