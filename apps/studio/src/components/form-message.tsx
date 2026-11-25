import { Alert } from '@pb/ui';
import type { FormState } from '@/lib/form';

export function FormMessage({ state }: { state: FormState }) {
  if (state.status === 'idle') return null;
  if (state.status === 'warning')
    return (
      <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-800">{state.message}</Alert>
    );
  return (
    <Alert variant={state.status === 'error' ? 'destructive' : 'success'}>{state.message}</Alert>
  );
}
