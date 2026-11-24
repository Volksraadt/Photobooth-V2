'use client';

import type { ElementOf } from '@pb/schema';
import { useEffect, useRef, useState } from 'react';
import { useActionEnabled, useRenderer } from '../context';
import { FilteredImage } from '../filter-view';
import { cropGuideRect, fitRect } from '../fit';
import { Placeholder } from '../placeholder';
import { selectedFilter, selectedFrame } from '../selection';
import { boxStyleToCss } from '../styles';
import type { RendererAction } from '../types';

const fill = { position: 'absolute', inset: 0 } as const;
/** Typical webcam aspect, used for the crop guide before the stream reports its size. */
const ASSUMED_VIDEO = { width: 1920, height: 1080 };

export function CameraViewElementView({ el }: { el: ElementOf<'camera-view'> }) {
  const { mode, runtime, config, resolveAsset } = useRenderer();
  const stream = mode === 'live' ? (runtime.camera?.stream ?? null) : null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  // Flash only for shots taken while mounted, not for the counter value we started with.
  const [initialFlash] = useState(runtime.flashKey);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    if (stream) video.play().catch(() => undefined);
  }, [stream]);

  const onSize = () => {
    const v = videoRef.current;
    if (v && v.videoWidth && v.videoHeight) {
      setVideoSize({ width: v.videoWidth, height: v.videoHeight });
    }
  };

  const box = { width: el.width, height: el.height };
  const frame = selectedFrame(config, runtime, mode);
  const slot = frame?.slots.find((s) => s.index === (runtime.activeSlotIndex ?? 1));
  const slotAspect = slot ? slot.width / slot.height : null;
  const guide =
    el.cropAspect && slotAspect
      ? cropGuideRect(box, videoSize ?? ASSUMED_VIDEO, slotAspect, el.fit)
      : null;
  const overlayTarget =
    el.overlayFrame && slot && slotAspect
      ? (guide ?? fitRect(box, { width: slotAspect, height: 1 }, 'contain'))
      : null;
  const overlaySrc = frame ? resolveAsset(frame.overlayAssetId) : undefined;
  const strip = config.printProfile.stripPx;
  const flash = runtime.flashKey !== undefined && runtime.flashKey !== initialFlash;

  return (
    <div style={{ ...fill, overflow: 'hidden', background: '#000000', ...boxStyleToCss(el.style) }}>
      {stream ? (
        <video
          ref={videoRef}
          data-pb-camera-video
          autoPlay
          muted
          playsInline
          onLoadedMetadata={onSize}
          onResize={onSize}
          style={{
            width: '100%',
            height: '100%',
            objectFit: el.fit,
            display: 'block',
            transform: el.mirror ? 'scaleX(-1)' : undefined,
          }}
        />
      ) : mode === 'editor' ? (
        <Placeholder label="Kamera" width={el.width} height={el.height} />
      ) : null}
      {guide && (
        <div
          data-pb-crop-guide
          style={{
            position: 'absolute',
            left: guide.x,
            top: guide.y,
            width: guide.width,
            height: guide.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
            outline: '3px dashed rgba(255,255,255,0.8)',
            outlineOffset: -3,
            pointerEvents: 'none',
          }}
        />
      )}
      {overlayTarget && slot && overlaySrc && (
        <img
          src={overlaySrc}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            left: overlayTarget.x - slot.x * (overlayTarget.width / slot.width),
            top: overlayTarget.y - slot.y * (overlayTarget.width / slot.width),
            width: strip.width * (overlayTarget.width / slot.width),
            height: strip.height * (overlayTarget.width / slot.width),
            pointerEvents: 'none',
          }}
        />
      )}
      {flash && (
        <div
          key={runtime.flashKey}
          data-pb-flash
          style={{
            ...fill,
            background: '#ffffff',
            animation: 'pb-flash 450ms ease-out both',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

function RetakeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="60%" height="60%" fill="none" aria-hidden>
      <path
        d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PhotoSlotElementView({ el }: { el: ElementOf<'photo-slot'> }) {
  const { mode, runtime, config, onAction } = useRenderer();
  const live = mode === 'live';
  const shot = live ? runtime.shots?.[el.slotIndex] : undefined;
  const active = live && runtime.activeSlotIndex === el.slotIndex;
  const retake: RendererAction = { kind: 'retake', shotIndex: el.slotIndex };
  const canRetake = useActionEnabled(retake);
  const filter = selectedFilter(config, runtime);
  const base = shot ? el.filledStyle : el.emptyStyle;
  const radius = base.borderRadius;
  const buttonSize = Math.max(44, Math.min(96, Math.min(el.width, el.height) * 0.26));

  return (
    <div
      data-pb-slot={el.slotIndex}
      data-pb-filled={shot ? 'true' : 'false'}
      data-pb-active={active ? 'true' : 'false'}
      style={{ ...fill, overflow: 'hidden', ...boxStyleToCss(base) }}
    >
      {shot ? (
        <FilteredImage
          src={shot.url}
          params={filter?.params}
          mirror={runtime.mirrorShots}
          style={{ borderRadius: radius }}
        />
      ) : (
        el.emptyStyle.showNumber && (
          <div
            style={{
              ...fill,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: el.emptyStyle.numberColor,
              fontFamily: el.emptyStyle.numberFontFamily,
              fontSize: el.emptyStyle.numberFontSize,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            {el.slotIndex}
          </div>
        )
      )}
      {active && (
        <div
          data-pb-active-overlay
          style={{
            ...fill,
            pointerEvents: 'none',
            ...boxStyleToCss({ ...el.activeStyle, fill: el.activeStyle.fill }),
          }}
        />
      )}
      {live && shot && el.showRetakeButton && canRetake && (
        <button
          type="button"
          data-pb-action="retake"
          data-pb-retake-slot={el.slotIndex}
          aria-label={`Ulangi foto ${el.slotIndex}`}
          onClick={() => onAction(retake)}
          style={{
            position: 'absolute',
            top: buttonSize * 0.15,
            right: buttonSize * 0.15,
            width: buttonSize,
            height: buttonSize,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.6)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <RetakeIcon />
        </button>
      )}
    </div>
  );
}

export function CountdownElementView({ el }: { el: ElementOf<'countdown'> }) {
  const { mode, runtime, config } = useRenderer();
  const value = mode === 'editor' ? config.flow.shotCountdownSec || 3 : (runtime.countdown ?? null);
  if (value === null || value <= 0) return null;
  const number = (
    <div
      key={value}
      data-pb-countdown={value}
      style={{
        ...fill,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: el.fontFamily,
        fontSize: el.variant === 'ring' ? el.fontSize * 0.6 : el.fontSize,
        fontWeight: 800,
        color: el.color,
        lineHeight: 1,
        textShadow: '0 4px 24px rgba(0,0,0,0.45)',
        animation: mode === 'live' ? 'pb-pop 350ms ease-out both' : undefined,
      }}
    >
      {value}
    </div>
  );
  if (el.variant === 'number')
    return <div style={{ ...fill, ...boxStyleToCss(el.style) }}>{number}</div>;

  const total = runtime.countdownTotal ?? (config.flow.shotCountdownSec || value);
  const size = Math.min(el.width, el.height);
  const stroke = Math.max(6, size * 0.06);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ ...fill, ...boxStyleToCss(el.style) }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        style={{ ...fill, width: '100%', height: '100%' }}
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={el.color}
          strokeOpacity={0.25}
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
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, value / total))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: mode === 'live' ? 'stroke-dashoffset 300ms ease-out' : undefined }}
        />
      </svg>
      {number}
    </div>
  );
}
