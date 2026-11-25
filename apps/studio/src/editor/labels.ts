import type { PageType } from '@pb/schema';

export const PAGE_LABEL: Record<PageType, string> = {
  cover: 'Cover',
  tutorial: 'Tutorial',
  framePick: 'Pilih Frame',
  payment: 'Pembayaran',
  capture: 'Foto',
  review: 'Review',
  processing: 'Proses',
  result: 'Hasil',
  error: 'Error',
};

const TOKEN_LABEL: Record<string, string> = {
  price: 'Harga',
  boothName: 'Nama booth',
  date: 'Tanggal',
  paymentHint: 'Info bayar',
};

/** Layer names may contain text tokens; show them as readable labels, e.g. "[Nama booth]". */
export function readableTokens(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, (raw, key: string) =>
    TOKEN_LABEL[key] ? `[${TOKEN_LABEL[key]}]` : raw,
  );
}
