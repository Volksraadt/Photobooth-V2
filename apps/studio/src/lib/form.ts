export type FormState =
  { status: 'idle' } | { status: 'error'; message: string } | { status: 'info'; message: string };

export const IDLE: FormState = { status: 'idle' };

export function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}
