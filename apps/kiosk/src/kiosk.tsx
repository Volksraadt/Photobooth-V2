import { createMockSource, createWebcamSource, type CaptureSource } from '@pb/capture';
import { uiActionToEvent, type FlowEvent, type FlowSnapshot } from '@pb/flow';
import { PageRenderer, type RendererAction } from '@pb/renderer';
import type { BoothConfig } from '@pb/schema';
import { useActorRef, useSelector } from '@xstate/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminPanel } from './admin/admin-panel';
import { PinPad } from './admin/pin-pad';
import { useCornerTaps } from './admin/use-corner-taps';
import { DevTools, simulateCameraUnplug } from './dev-tools';
import { KioskErrorBoundary } from './error-boundary';
import { createKioskMachine } from './flow-host';
import { useKioskEnvironment } from './kiosk-environment';
import { PhotoStore } from './photo-store';
import { buildRuntime } from './runtime';
import type { KioskSettings } from './settings';
import { SystemScreen } from './system-screen';
import { useCamera } from './use-camera';

declare global {
  interface Window {
    /** Test/dev hooks (dev builds only). */
    __pbKiosk?: {
      send: (event: FlowEvent) => void;
      snapshot: () => FlowSnapshot;
      unplugCamera: () => void;
    };
  }
}

export function Kiosk({
  config,
  settings,
  resolveAssetUrl,
  onHeartbeat,
}: {
  config: BoothConfig;
  settings: KioskSettings;
  /** Locally cached asset URLs (API mode). Defaults to the URLs in the config. */
  resolveAssetUrl?: (assetId: string) => string | undefined;
  onHeartbeat?: (info: { configVersion: number | null; cameraStatus: string }) => void;
}) {
  const camera = useMemo<CaptureSource>(
    () =>
      settings.capture === 'mock' ? createMockSource({ latencyMs: 50 }) : createWebcamSource(),
    [settings.capture],
  );
  const photos = useMemo(() => new PhotoStore(), []);
  const machine = useMemo(
    () => createKioskMachine({ camera, photos, shortLinkBase: settings.shortLinkBase }),
    [camera, photos, settings.shortLinkBase],
  );
  const actor = useActorRef(machine, { input: { config } });
  const snapshot = useSelector(actor, (s) => s);
  const { stream, status } = useCamera(camera);
  const [pinOpen, setPinOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useKioskEnvironment(settings.kiosk);

  // New published config: the flow applies it at Cover (immediately when idle, never mid-session).
  useEffect(() => {
    if (actor.getSnapshot().context.config !== config)
      actor.send({ type: 'CONFIG.UPDATE', config });
  }, [actor, config]);

  // Heartbeat: every 30 s and whenever the applied config version changes.
  const appliedVersion = snapshot.context.config.configVersion;
  useEffect(() => {
    if (!onHeartbeat) return;
    const beat = () =>
      onHeartbeat({
        configVersion: appliedVersion,
        cameraStatus: status === 'connected' ? 'ok' : status === 'error' ? 'error' : 'unknown',
      });
    beat();
    const t = setInterval(beat, 30_000);
    return () => clearInterval(t);
  }, [onHeartbeat, appliedVersion, status]);

  // Camera unplugged/failed → the flow decides (Error page during capture, ignored elsewhere).
  useEffect(
    () =>
      camera.onStatusChange((next, error) => {
        if (next === 'error') actor.send({ type: 'CAMERA.ERROR', message: error?.message });
      }),
    [camera, actor],
  );

  useEffect(() => {
    if (!settings.dev) return;
    window.__pbKiosk = {
      send: (e) => actor.send(e),
      snapshot: () => actor.getSnapshot(),
      unplugCamera: () => simulateCameraUnplug(camera, stream),
    };
    return () => {
      delete window.__pbKiosk;
    };
  }, [settings.dev, actor, camera, stream]);

  useCornerTaps(() => setPinOpen(true));

  const onAction = useCallback(
    (action: RendererAction) => actor.send(uiActionToEvent(action)),
    [actor],
  );
  const runtime = useMemo(
    () => buildRuntime(snapshot, { stream, status }),
    [snapshot, stream, status],
  );
  const closePin = useCallback(() => setPinOpen(false), []);
  const onPinSuccess = useCallback(() => {
    setPinOpen(false);
    actor.send({ type: 'ADMIN.OPEN' });
    if (!actor.getSnapshot().matches('admin')) {
      setNotice('Mode admin tidak bisa dibuka selama sesi berbayar berjalan.');
      setTimeout(() => setNotice(null), 4000);
    }
  }, [actor]);

  const pageType = snapshot.context.page ?? 'cover';
  // The flow owns the active config (it may swap it at Cover in F2).
  const page = snapshot.context.config.pages[pageType];

  return (
    <div
      style={{ position: 'fixed', inset: 0 }}
      onPointerDownCapture={() => actor.send({ type: 'ACTIVITY' })}
    >
      <KioskErrorBoundary
        resetKey={pageType}
        onError={(error) => {
          if (pageType !== 'error') actor.send({ type: 'FAIL', message: error.message });
        }}
        fallback={() =>
          pageType === 'error' ? (
            <SystemScreen
              title="Terjadi kesalahan"
              message="Halaman tidak dapat ditampilkan. Silakan hubungi petugas booth."
              retryInSec={30}
              onRetry={() => window.location.reload()}
            />
          ) : (
            <div style={{ position: 'fixed', inset: 0, background: '#000' }} />
          )
        }
      >
        <PageRenderer
          page={page}
          config={snapshot.context.config}
          runtime={runtime}
          mode="live"
          onAction={onAction}
          resolveAssetUrl={resolveAssetUrl}
        />
      </KioskErrorBoundary>

      {snapshot.matches('admin') && (
        <AdminPanel
          config={snapshot.context.config}
          camera={camera}
          stream={stream}
          cameraStatus={status}
          onFreeSession={() => actor.send({ type: 'ADMIN.FREE_SESSION' })}
          onClose={() => actor.send({ type: 'ADMIN.CLOSE' })}
        />
      )}
      {pinOpen && (
        <PinPad
          pinHash={snapshot.context.config.admin.pinHash}
          onSuccess={onPinSuccess}
          onCancel={closePin}
        />
      )}
      {notice && (
        <div
          className="sys"
          style={{ background: 'rgba(2,6,23,0.6)' }}
          onClick={() => setNotice(null)}
        >
          <div className="sys-card" style={{ width: 'min(92vw, 520px)' }}>
            <p style={{ margin: 0 }}>{notice}</p>
          </div>
        </div>
      )}
      {settings.dev && (
        <DevTools actor={actor} snapshot={snapshot} camera={camera} stream={stream} />
      )}
    </div>
  );
}
