'use client';

import type { ElementOf } from '@pb/schema';
import { useState } from 'react';
import { useActionEnabled, useRenderer } from '../context';
import { Placeholder } from '../placeholder';
import { boxStyleToCss, pickTextStyle, textStyleToCss } from '../styles';
import { paymentHint, resolveTextTokens } from '../tokens';

const fill = { position: 'absolute', inset: 0 } as const;

export function ImageElementView({ el }: { el: ElementOf<'image'> }) {
  const { resolveAsset } = useRenderer();
  const src = resolveAsset(el.assetId);
  return (
    <div style={{ ...fill, overflow: 'hidden', ...boxStyleToCss(el.style) }}>
      {src ? (
        <img
          src={src}
          alt={el.name}
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: el.fit, display: 'block' }}
        />
      ) : (
        <Placeholder label="Gambar tidak ditemukan" width={el.width} height={el.height} />
      )}
    </div>
  );
}

export function TextElementView({ el }: { el: ElementOf<'text'> }) {
  const { runtime, config, mode } = useRenderer();
  const text = resolveTextTokens(el.content, {
    price: runtime.price ?? config.pricing.basePrice,
    boothName: runtime.boothName ?? config.output.driveRootFolderName,
    date: runtime.now ?? new Date(),
    timezone: config.timezone,
    locale: config.locale,
    paymentHint: paymentHint(
      config.flow.paymentMethods,
      !(mode === 'live' && runtime.qrisHidden),
      config.locale,
    ),
  });
  return (
    <div
      style={{
        ...fill,
        ...boxStyleToCss(el.style),
        ...textStyleToCss(pickTextStyle(el)),
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
      }}
    >
      {text}
    </div>
  );
}

export function ShapeElementView({ el }: { el: ElementOf<'shape'> }) {
  if (el.shape === 'line') {
    const stroke = el.style?.borderColor ?? el.style?.fill ?? '#ffffff';
    const width = el.style?.borderWidth ?? 4;
    return (
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${el.width} ${el.height}`}
        preserveAspectRatio="none"
        style={{ ...fill, overflow: 'visible' }}
      >
        <line
          x1={0}
          y1={el.height / 2}
          x2={el.width}
          y2={el.height / 2}
          stroke={stroke}
          strokeWidth={width}
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <div
      style={{
        ...fill,
        ...boxStyleToCss(el.style),
        ...(el.shape === 'ellipse' ? { borderRadius: '50%' } : {}),
      }}
    />
  );
}

export function VideoElementView({ el }: { el: ElementOf<'video'> }) {
  const { resolveAsset, mode } = useRenderer();
  const src = resolveAsset(el.assetId);
  if (!src)
    return <Placeholder label="Video tidak ditemukan" width={el.width} height={el.height} />;
  return (
    <div style={{ ...fill, overflow: 'hidden', ...boxStyleToCss(el.style) }}>
      <video
        src={src}
        autoPlay={mode === 'live'}
        loop={el.loop}
        muted={el.muted}
        playsInline
        preload={mode === 'live' ? 'auto' : 'metadata'}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </div>
  );
}

export function ButtonElementView({ el }: { el: ElementOf<'button'> }) {
  const { mode, onAction, resolveAsset, runtime, config } = useRenderer();
  const enabled = useActionEnabled(el.action);
  const [pressed, setPressed] = useState(false);
  const live = mode === 'live';
  // QRIS cannot be used now (offline / Midtrans not set up): its button is not offered.
  const qrisUnavailable =
    live && runtime.qrisHidden && el.action.kind === 'selectPayment' && el.action.method === 'qris';
  const box = pressed && el.pressedStyle ? el.pressedStyle : el.style;
  const src = el.assetId ? resolveAsset(el.assetId) : undefined;
  const release = () => setPressed(false);
  // A payment method the owner switched off (e.g. from the booth page): hidden on the kiosk,
  // dimmed in the editor so the design can stay as it is.
  const methodOff =
    el.action.kind === 'selectPayment' && !config.flow.paymentMethods.includes(el.action.method);
  if (qrisUnavailable || (live && methodOff)) return null;
  return (
    <button
      type="button"
      data-pb-action={el.action.kind}
      aria-label={el.label || el.name}
      aria-disabled={!enabled || undefined}
      tabIndex={live ? 0 : -1}
      onPointerDown={live && enabled ? () => setPressed(true) : undefined}
      onPointerUp={live ? release : undefined}
      onPointerLeave={live ? release : undefined}
      onPointerCancel={live ? release : undefined}
      onClick={live && enabled ? () => onAction(el.action) : undefined}
      style={{
        ...fill,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        cursor: live && enabled ? 'pointer' : 'default',
        opacity: methodOff ? 0.35 : enabled ? 1 : 0.4,
        transform: pressed && !el.pressedStyle ? 'scale(0.97)' : undefined,
        ...boxStyleToCss(box),
        ...textStyleToCss(el.textStyle),
      }}
    >
      {src && (
        <img
          src={src}
          alt=""
          draggable={false}
          style={{ ...fill, width: '100%', height: '100%', objectFit: 'contain' }}
        />
      )}
      {el.label && (
        <span style={{ position: 'relative', padding: '0 0.4em', whiteSpace: 'nowrap' }}>
          {el.label}
        </span>
      )}
    </button>
  );
}
