'use client';

import type { ElementOf } from '@pb/schema';
import { useEffect, useState } from 'react';
import { useActionEnabled, useRenderer } from '../context';
import { Pending } from '../placeholder';
import { QrCode } from '../qr-code';
import { boxStyleToCss, pickTextStyle, textStyleToCss } from '../styles';
import { formatMmSs, formatPrice } from '../tokens';
import type { RendererAction } from '../types';

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
  if (mode === 'live' && expiresAt === null) return null;
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
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'];

/** Visual only in F1; voucher entry and validation arrive in F4. */
export function VoucherInputElementView({ el }: { el: ElementOf<'voucher-input'> }) {
  const { runtime, config } = useRenderer();
  const text = textStyleToCss(el.textStyle);
  if (el.variant === 'field') {
    return (
      <div
        data-pb-voucher
        style={{
          ...fill,
          display: 'flex',
          alignItems: 'center',
          padding: '0 0.6em',
          background: '#ffffff',
          borderRadius: 16,
          ...boxStyleToCss(el.keyStyle),
          ...boxStyleToCss(el.style),
          ...text,
          height: Math.min(el.height, el.textStyle.fontSize * 2.4),
          bottom: 'auto',
        }}
      >
        {runtime.voucherCode ? (
          <span>{runtime.voucherCode}</span>
        ) : (
          <span style={{ opacity: 0.45 }}>{VOUCHER_PLACEHOLDER[config.locale]}</span>
        )}
      </div>
    );
  }
  return (
    <div
      data-pb-voucher
      style={{
        ...fill,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(4, 1fr)',
        gap: 8,
        ...boxStyleToCss(el.style),
      }}
    >
      {KEYS.map((k) => (
        <div
          key={k}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#ffffff',
            borderRadius: 12,
            ...boxStyleToCss(el.keyStyle),
            ...text,
          }}
        >
          {k}
        </div>
      ))}
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
      {stepper(remove, canRemove, 'Kurangi cetak', '−')}
      <div style={{ ...textStyleToCss(el.textStyle), flex: 1 }}>{value}</div>
      {stepper(add, canAdd, 'Tambah cetak', '+')}
    </div>
  );
}
