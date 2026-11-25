'use client';

import { Button } from '@pb/ui';
import { useState } from 'react';

/**
 * Two-step submit for destructive form actions: the first click only asks, the second submits.
 * Inline instead of window.confirm so it works without blocking dialogs and reads in Indonesian.
 * Must be rendered inside the <form> it submits.
 */
export function ConfirmSubmit({
  label,
  confirmLabel,
  message,
  testId,
  pending,
  size = 'sm',
}: {
  label: string;
  confirmLabel: string;
  message: string;
  testId?: string;
  pending?: boolean;
  size?: 'sm' | 'default';
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button
        type="button"
        size={size}
        variant="outline"
        className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        data-testid={testId}
        onClick={() => setAsking(true)}
      >
        {label}
      </Button>
    );
  }
  return (
    <div
      className="flex max-w-sm flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm"
      role="alert"
    >
      <p className="basis-full text-destructive">{message}</p>
      <Button
        type="submit"
        size="sm"
        variant="destructive"
        disabled={pending}
        data-testid={testId ? `${testId}-confirm` : undefined}
      >
        {pending ? 'Memproses…' : confirmLabel}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)}>
        Batal
      </Button>
    </div>
  );
}
