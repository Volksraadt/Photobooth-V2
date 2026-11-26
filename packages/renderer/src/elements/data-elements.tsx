'use client';

import type { ElementOf } from '@pb/schema';
import { useEffect, useState, type CSSProperties } from 'react';
import { useActionEnabled, useRenderer } from '../context';
import { Pending } from '../placeholder';
import { QrCode } from '../qr-code';
import { boxStyleToCss, pickTextStyle, textStyleToCss } from '../styles';
import { formatMmSs, formatPrice } from '../tokens';
import type { RendererAction, VoucherRuntimeStatus } from '../types';

const fill = { position: 'absolute', inset: 0 } as const;
const SAMPLE_QRIS = 'QRIS-PREVIEW-0000000000';
const SAMPLE_DOWNLOAD = 'https://photobooth.example/s/ABCD2345';

function useNow(active: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs]);
  return now;
}

export function QrisElementView({ el }: { el: ElementOf<'qris'> }) {
  const { mode, runtime } = useRenderer();
  const value = mode === 'editor' ? SAMPLE_QRIS : (runtime.qrisString ?? null);
  if (mode === 'live' && runtime.qrisHidden) return null;
  const logoHeight = el.showLogo ? Math.max(24, Math.min(el.width, el.height) * 0.1) : 0;
  return (
    <div
      data-pb-qris={value ?? ''}
      style={{
        ...fill,
        background: el.background,
        padding: el.padding,
        display: 'flex',
        flexDirection: 'column',
        gap: el.showLogo ? el.padding / 2 : 0,
        overflow: 'hidden',
        ...boxStyleToCss(el.style),
      }}
    >
      {el.showLogo && (
        <div
          style={{
            height: logoHeight,
            flex: 'none',
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontWeight: 900,
            fontSize: logoHeight * 0.9,
            lineHeight: 1,
            letterSpacing: logoHeight * 0.05,
            color: '#000000',
            textAlign: 'center',
          }}
        >
          QRIS
        </div>
      )}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {value ? <QrCode value={value} label="QRIS" /> : <Pending style={{ borderRadius: 8 }} />}
      </div>
    </div>
  );
}

export function PriceLabelElementView({ el }: { el: ElementOf<'price-label'> }) {
  const { runtime, config } = useRenderer();
  const value = runtime.price ?? config.pricing.basePrice;
  return (
    <div
      data-pb-price={value}
      style={{
        ...fill,
        ...boxStyleToCss(el.style),
        ...textStyleToCss(pickTextStyle(el)),
        whiteSpace: 'nowrap',
      }}
    >
      {formatPrice(value, el.format)}
    </div>
  );
}

export function PaymentTimerElementView({ el }: { el: ElementOf<'payment-timer'> }) {
  const { mode, runtime, config } = useRenderer();
  const total = runtime.paymentTotalSec ?? config.flow.qrisExpirySec;
  const expiresAt = mode === 'live' ? (runtime.paymentExpiresAt ?? null) : null;
  const now = useNow(expiresAt !== null);
  if (mode === 'live' && (expiresAt === null || runtime.qrisHidden)) return null;
  // Clamped: the first frame may be measured slightly before the QRIS was issued.
  const remaining =
    expiresAt === null ? total : Math.min(total, Math.max(0, (expiresAt - now) / 1000));

  if (el.variant === 'text') {
    return (
      <div
        data-pb-timer
        style={{ ...fill, ...boxStyleToCss(el.style), ...textStyleToCss(el.textStyle) }}
      >
        {formatMmSs(remaining)}
      </div>
    );
  }
  const ratio = total > 0 ? Math.min(1, remaining / total) : 0;
  return (
    <div
      data-pb-timer
      style={{
        ...fill,
        background: el.trackColor ?? 'rgba(255,255,255,0.2)',
        borderRadius: el.height / 2,
        overflow: 'hidden',
        ...boxStyleToCss(el.style),
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${ratio * 100}%`,
          background: el.barColor ?? '#ffffff',
          borderRadius: 'inherit',
          transition: 'width 250ms linear',
        }}
      />
    </div>
  );
}

const VOUCHER_PLACEHOLDER = { id: 'Kode voucher', en: 'Voucher code' } as const;
/** Short system feedback inside the element (like the placeholder); the owner styles the element. */
const VOUCHER_MESSAGES: Record<
  Exclude<VoucherRuntimeStatus, 'idle'>,
  { id: string; en: string }
> = {
  checking: { id: 'Memeriksa…', en: 'Checking…' },
  invalid: { id: 'Voucher tidak valid', en: 'Invalid voucher' },
  used: { id: 'Voucher sudah dipakai', en: 'Voucher already used' },
  expired: { id: 'Voucher kedaluwarsa', en: 'Voucher expired' },
  insufficient: { id: 'Nilai voucher kurang', en: 'Voucher value too low' },
  needs_online: { id: 'Voucher butuh internet', en: 'Voucher needs internet' },
  locked: { id: 'Terlalu banyak percobaan, tunggu sebentar', en: 'Too many tries, please wait' },
  error: { id: 'Coba lagi', en: 'Try again' },
};
const ERROR_COLOR = '#ef4444';
type VoucherKey = { label: string; action: RendererAction };
const KEYS: VoucherKey[] = [
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => ({
    label: k,
    action: { kind: 'voucherKey', key: k } as const,
  })),
  { label: '⌫', action: { kind: 'voucherBackspace' } },
  { label: '0', action: { kind: 'voucherKey', key: '0' } },
  { label: '✓', action: { kind: 'voucherSubmit' } },
];

/** 12345678 → 1234-5678 (as printed on the voucher). */
const groupCode = (code: string) => code.replace(/(\d{4})(?=\d)/g, '$1-');

/** One voucher key: digits, ⌫, ✓ (pointer-down so a fast tap never misses). */
function VoucherKeyButton({
  k,
  live,
  onAction,
  style,
}: {
  k: VoucherKey;
  live: boolean;
  onAction: (a: RendererAction) => void;
  style: CSSProperties;
}) {
  return (
    <div
      role={live ? 'button' : undefined}
      data-pb-voucher-key={k.label}
      onPointerDown={
        live
          ? (e) => {
              e.preventDefault();
              onAction(k.action);
            }
          : undefined
      }
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#ffffff',
        borderRadius: 12,
        cursor: live ? 'pointer' : undefined,
        userSelect: 'none',
        touchAction: 'manipulation',
        ...style,
      }}
    >
      {k.label}
    </div>
  );
}

/**
 * Voucher keypad (schema v2): phone-style 3×4 keys filling the element box, placed and styled on
 * its own. Digits shrink to fit short keys. Hidden on the kiosk when vouchers are switched off,
 * dimmed in the editor.
 */
export function VoucherKeypadElementView({ el }: { el: ElementOf<'voucher-keypad'> }) {
  const { config, mode, onAction } = useRenderer();
  const live = mode === 'live';
  const voucherOff = !config.flow.paymentMethods.includes('voucher');
  if (live && voucherOff) return null;
  const rowHeight = (el.height - el.gap * 3) / 4;
  const fontSize = Math.max(1, Math.min(el.textStyle.fontSize, rowHeight * 0.6));
  const keyStyle = { ...boxStyleToCss(el.keyStyle), ...textStyleToCss(el.textStyle), fontSize };
  return (
    <div
      data-pb-voucher-keypad="3x4"
      style={{
        ...fill,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(4, 1fr)',
        gap: el.gap,
        ...boxStyleToCss(el.style),
        ...(voucherOff ? { opacity: 0.35 } : {}),
      }}
    >
      {KEYS.map((k) => (
        <VoucherKeyButton key={k.label} k={k} live={live} onAction={onAction} style={keyStyle} />
      ))}
    </div>
  );
}

/**
 * Voucher entry (F4). Keypad: on-screen digits; both variants also accept a physical keyboard or
 * barcode scanner (digits, Backspace, Enter) while shown in live mode.
 */
export function VoucherInputElementView({ el }: { el: ElementOf<'voucher-input'> }) {
  const { runtime, config, mode, onAction } = useRenderer();
  const live = mode === 'live';
  const text = textStyleToCss(el.textStyle);
  // Voucher switched off by the owner: hidden on the kiosk, dimmed in the editor.
  const voucherOff = !config.flow.paymentMethods.includes('voucher');

  useEffect(() => {
    if (!live || voucherOff) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) onAction({ kind: 'voucherKey', key: e.key });
      else if (e.key === 'Backspace') onAction({ kind: 'voucherBackspace' });
      else if (e.key === 'Enter') onAction({ kind: 'voucherSubmit' });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live, voucherOff, onAction]);
  if (live && voucherOff) return null;
  const dim = voucherOff ? { opacity: 0.35 } : {};

  const code = runtime.voucherCode ?? '';
  const status = runtime.voucherStatus ?? 'idle';
  const isError = status !== 'idle' && status !== 'checking';
  const display = code ? (
    <span data-pb-voucher-code={code}>{groupCode(code)}</span>
  ) : status !== 'idle' ? (
    <span
      data-pb-voucher-status={status}
      style={isError ? { color: ERROR_COLOR } : { opacity: 0.6 }}
    >
      {VOUCHER_MESSAGES[status][config.locale]}
    </span>
  ) : (
    <span style={{ opacity: 0.45 }}>{VOUCHER_PLACEHOLDER[config.locale]}</span>
  );
  const fieldStyle = {
    display: 'flex',
    alignItems: 'center',
    padding: '0 0.6em',
    background: '#ffffff',
    borderRadius: 16,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    ...boxStyleToCss(el.keyStyle),
    ...text,
    ...(isError ? { boxShadow: `inset 0 0 0 3px ${ERROR_COLOR}` } : {}),
  } as const;

  const keyView = (k: VoucherKey) => (
    <VoucherKeyButton
      key={k.label}
      k={k}
      live={live}
      onAction={onAction}
      style={{ ...boxStyleToCss(el.keyStyle), ...text }}
    />
  );

  if (el.variant === 'field') {
    // Code field only (schema v2): the keypad is its own `voucher-keypad` element.
    return (
      <div
        data-pb-voucher
        data-status={status}
        style={{ ...fill, ...boxStyleToCss(el.style), ...dim }}
      >
        <div
          style={{
            ...fieldStyle,
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: Math.min(el.height, el.textStyle.fontSize * 2.4),
          }}
        >
          {display}
        </div>
      </div>
    );
  }
  return (
    <div
      data-pb-voucher
      data-status={status}
      style={{
        ...fill,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(5, 1fr)',
        gap: 8,
        ...boxStyleToCss(el.style),
        ...dim,
      }}
    >
      <div style={{ ...fieldStyle, gridColumn: '1 / -1', justifyContent: 'center' }}>{display}</div>
      {KEYS.map((k) => keyView(k))}
    </div>
  );
}

export function DownloadQrElementView({ el }: { el: ElementOf<'download-qr'> }) {
  const { mode, runtime } = useRenderer();
  const value = mode === 'editor' ? SAMPLE_DOWNLOAD : (runtime.downloadUrl ?? null);
  return (
    <div
      data-pb-download-qr={value ?? ''}
      style={{
        ...fill,
        background: el.background,
        padding: el.padding,
        overflow: 'hidden',
        ...boxStyleToCss(el.style),
      }}
    >
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {value ? (
          <QrCode
            value={value}
            foreground={el.foreground}
            background={el.background}
            label="QR unduh"
          />
        ) : (
          <Pending style={{ borderRadius: 8 }} />
        )}
      </div>
    </div>
  );
}

export function ProgressElementView({ el }: { el: ElementOf<'progress'> }) {
  const { mode, runtime } = useRenderer();
  const progress = mode === 'editor' ? 0.6 : (runtime.progress ?? null);
  const track = el.trackColor ?? 'rgba(255,255,255,0.2)';

  if (el.variant === 'spinner') {
    const size = Math.min(el.width, el.height);
    const stroke = Math.max(4, size * 0.1);
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    return (
      <div data-pb-progress={progress ?? ''} style={{ ...fill, ...boxStyleToCss(el.style) }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          style={{
            ...fill,
            width: '100%',
            height: '100%',
            animation: mode === 'live' ? 'pb-spin 1s linear infinite' : undefined,
          }}
          aria-hidden
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={track}
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={el.color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * 0.3} ${c}`}
          />
        </svg>
      </div>
    );
  }

  if (el.variant === 'steps') {
    const steps = 4;
    const done = progress === null ? 0 : Math.ceil(progress * steps);
    return (
      <div
        data-pb-progress={progress ?? ''}
        style={{ ...fill, display: 'flex', gap: el.height * 0.6, ...boxStyleToCss(el.style) }}
      >
        {Array.from({ length: steps }, (_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              borderRadius: el.height / 2,
              background: i < done ? el.color : track,
              transition: 'background 300ms ease-out',
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      data-pb-progress={progress ?? ''}
      style={{
        ...fill,
        background: track,
        borderRadius: el.height / 2,
        overflow: 'hidden',
        ...boxStyleToCss(el.style),
      }}
    >
      <div
        style={{
          height: '100%',
          width: progress === null ? '40%' : `${progress * 100}%`,
          background: el.color,
          borderRadius: 'inherit',
          transition: 'width 300ms ease-out',
          animation:
            progress === null && mode === 'live'
              ? 'pb-indeterminate 1.2s ease-in-out infinite'
              : undefined,
        }}
      />
    </div>
  );
}

export function PrintCopiesElementView({ el }: { el: ElementOf<'print-copies'> }) {
  const { mode, runtime, config, onAction } = useRenderer();
  const value = runtime.printSheets ?? config.pricing.includedPrints;
  const add: RendererAction = { kind: 'addPrint' };
  const remove: RendererAction = { kind: 'removePrint' };
  const canAdd = useActionEnabled(add) && config.pricing.extraPrintPrice !== null;
  const canRemove = useActionEnabled(remove);
  const size = el.height;
  const live = mode === 'live';
  // Live, when the count cannot change (e.g. Review, after payment): just the number of sheets.
  const readOnly = live && !canAdd && !canRemove;
  const stepper = (action: RendererAction, enabled: boolean, label: string, glyph: string) => (
    <button
      type="button"
      data-pb-action={action.kind}
      aria-label={label}
      aria-disabled={!enabled || undefined}
      tabIndex={live ? 0 : -1}
      onClick={live && enabled ? () => onAction(action) : undefined}
      style={{
        width: size,
        height: size,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: enabled ? 1 : 0.4,
        cursor: live && enabled ? 'pointer' : 'default',
        ...boxStyleToCss(el.buttonStyle),
        ...textStyleToCss(el.textStyle),
      }}
    >
      {glyph}
    </button>
  );
  return (
    <div
      data-pb-print-copies={value}
      style={{
        ...fill,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        ...boxStyleToCss(el.style),
      }}
    >
      {!readOnly && stepper(remove, canRemove, 'Kurangi cetak', '−')}
      <div style={{ ...textStyleToCss(el.textStyle), flex: 1 }}>{value}</div>
      {!readOnly && stepper(add, canAdd, 'Tambah cetak', '+')}
    </div>
  );
}
