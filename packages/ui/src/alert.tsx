import type { ComponentProps } from 'react';
import { cn } from './cn';

export function Alert({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'div'> & { variant?: 'default' | 'destructive' | 'success' }) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        variant === 'destructive' && 'border-destructive/40 bg-destructive/10 text-destructive',
        variant === 'success' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700',
        variant === 'default' && 'bg-muted text-foreground',
        className,
      )}
      {...props}
    />
  );
}
