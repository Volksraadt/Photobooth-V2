export type FormState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'info'; message: string }
  /** Done, but something needs the owner's attention (e.g. QRIS without Midtrans). */
  | { status: 'warning'; message: string };

export const IDLE: FormState = { status: 'idle' };

export function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}
