'use client';

import { cn } from '@pb/ui';
import { useState, type ReactNode } from 'react';

export const inputCls =
  'h-8 w-full rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring';

export function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="border-b px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {actions}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[84px_1fr] items-center gap-2 text-xs">
      <span className="truncate text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </label>
  );
}

export function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

/** Number input that commits on blur/Enter (one undo step), shows the live document value otherwise. */
export function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  min,
  max,
  testId,
  compact,
}: {
  label: string;
  value: number | undefined;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  testId?: string;
  compact?: boolean;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [editing, setEditing] = useState(false);
  const shown = editing ? text : value === undefined ? '' : String(round(value));
  const commit = () => {
    setEditing(false);
    const n = Number(text.replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(n)) return;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (clamped !== value) onCommit(clamped);
  };
  const input = (
    <input
      className={inputCls}
      inputMode="decimal"
      data-testid={testId}
      value={shown}
      onFocus={() => {
        setText(value === undefined ? '' : String(round(value)));
        setEditing(true);
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setEditing(false);
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
          const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, (value ?? 0) + delta));
          setText(String(round(next)));
          onCommit(next);
        }
      }}
    />
  );
  if (compact) {
    return (
      <label className="flex items-center gap-1 text-xs">
        <span className="w-4 shrink-0 text-muted-foreground">{label}</span>
        {input}
      </label>
    );
  }
  return <Row label={label}>{input}</Row>;
}

const round = (v: number) => Math.round(v * 100) / 100;

export function TextField({
  label,
  value,
  onCommit,
  multiline,
  testId,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  testId?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const setText = (v: string) => setDraft(v);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <Row label={label}>
      {multiline ? (
        <textarea
          className={cn(inputCls, 'h-20 py-1')}
          data-testid={testId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          className={inputCls}
          data-testid={testId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      )}
    </Row>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

export function ColorField({
  label,
  value,
  onCommit,
  allowEmpty,
  testId,
}: {
  label: string;
  value: string | undefined;
  onCommit: (v: string | undefined) => void;
  allowEmpty?: boolean;
  testId?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value ?? '';
  const setText = (v: string) => setDraft(v);
  const commit = (v: string) => {
    setDraft(null);
    const next = v.trim() === '' ? undefined : v.trim();
    if (!next && !allowEmpty) return;
    if (next !== value) onCommit(next);
  };
  return (
    <Row label={label}>
      <div className="flex items-center gap-1">
        <input
          type="color"
          className="h-8 w-8 shrink-0 cursor-pointer rounded border border-input bg-background p-0.5"
          value={value && HEX.test(value) ? value : '#000000'}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
        />
        <input
          className={inputCls}
          data-testid={testId}
          value={text}
          placeholder={allowEmpty ? 'kosong' : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
    </Row>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onCommit,
  testId,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onCommit: (v: T) => void;
  testId?: string;
}) {
  return (
    <Row label={label}>
      <select
        className={inputCls}
        data-testid={testId}
        value={value}
        onChange={(e) => onCommit(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

export function Toggle({
  label,
  value,
  onCommit,
  testId,
}: {
  label: string;
  value: boolean;
  onCommit: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="checkbox"
        data-testid={testId}
        checked={value}
        onChange={(e) => onCommit(e.target.checked)}
      />
    </label>
  );
}

export function SliderField({
  label,
  value,
  min,
  max,
  step,
  onCommit,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
  testId?: string;
}) {
  const [live, setLive] = useState<number | null>(null);
  const shown = live ?? value;
  const commit = () => {
    if (live !== null && live !== value) onCommit(live);
    setLive(null);
  };
  return (
    <Row label={label}>
      <div className="flex items-center gap-2">
        <input
          type="range"
          className="w-full"
          data-testid={testId}
          min={min}
          max={max}
          step={step}
          value={shown}
          onChange={(e) => setLive(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <span className="w-10 text-right tabular-nums text-muted-foreground">
          {shown.toFixed(2)}
        </span>
      </div>
    </Row>
  );
}

export function IconButton({
  title,
  onClick,
  children,
  disabled,
  active,
  testId,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  active?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-xs hover:bg-accent disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      {children}
    </button>
  );
}
