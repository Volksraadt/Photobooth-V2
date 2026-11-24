'use client';

import { Button } from '@pb/ui';
import { useActionState } from 'react';
import { IDLE } from '@/lib/form';
import { retryUploadAction } from './actions';

export function RetryUploadButton({ sessionId, code }: { sessionId: string; code: string }) {
  const [state, action, pending] = useActionState(retryUploadAction, IDLE);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending}
        data-testid={`retry-upload-${code}`}
      >
        {pending ? 'Menjadwalkan…' : 'Coba lagi'}
      </Button>
      {state.status === 'error' && (
        <span className="text-xs text-destructive">{state.message}</span>
      )}
    </form>
  );
}
