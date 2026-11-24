import {
  createMockSource,
  createTabletSource,
  createWebcamSource,
  type CaptureSource,
  type CaptureStatus,
} from '@pb/capture';
import { uiActionToEvent, type FlowEvent, type FlowSnapshot } from '@pb/flow';
import { PageRenderer, type RendererAction } from '@pb/renderer';
import type { BoothConfig } from '@pb/schema';
import { useActorRef, useSelector } from '@xstate/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminPanel } from './admin/admin-panel';
import { PinPad } from './admin/pin-pad';
import { useCornerTaps } from './admin/use-corner-taps';
import type { AgentClient } from './agent/agent-client';
import { DevTools, simulateCameraUnplug } from './dev-tools';
import { KioskErrorBoundary } from './error-boundary';
import { createKioskMachine } from './flow-host';
import { useKioskEnvironment } from './kiosk-environment';
import { PhotoStore } from './photo-store';
import { buildRuntime } from './runtime';
import type { CaptureChoice, KioskSettings } from './settings';
import { SystemScreen } from './system-screen';
import { useCamera } from './use-camera';

declare global {
  interface Window {
    /** Test/dev hooks (dev builds only). */
    __pbKiosk?: {
      send: (event: FlowEvent) => void;
      snapshot: () => FlowSnapshot;
      unplugCamera: () => void;
      camera: () => { id: string; status: CaptureStatus };
      previewStats?: () => Promise<unknown>;
    };
  }
}

function createCamera(choice: CaptureChoice, agent: AgentClient | null): CaptureSource {
  if (choice === 'mock') return createMockSource({ latencyMs: 50 });
  // Tablet needs the agent; without one fall back to the webcam (browser-only dev).
  if (choice === 'tablet' && agent) return createTabletSource({ agent });
  return createWebcamSource();
}

export function Kiosk({
  config,
  settings,
  agent,
  cameraChoice,
  onCameraChange,
  resolveAssetUrl,
}: {
  config: BoothConfig;
  settings: KioskSettings;
  agent: AgentClient | null;
  cameraChoice: CaptureChoice;
  onCameraChange: (c: 'webcam' | 'tablet') => Promise<void>;
  /** Locally cached asset URLs (agent). Defaults to the URLs in the config. */
  resolveAssetUrl?: (assetId: string) => string | undefined;
}) {
  const camera = useMemo(() => createCamera(cameraChoice, agent), [cameraChoice, agent]);
  useEffect(() => () => void camera.disconnect(), [camera]);
  const photos = useMemo(() => new PhotoStore(), []);
  const machine = useMemo(
    () => createKioskMachine({ camera, photos, shortLinkBase: settings.shortLinkBase, agent }),
    [camera, photos, settings.shortLinkBase, agent],
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

  // The agent sends the heartbeat; it needs the kiosk-side camera status and applied version.
  const appliedVersion = snapshot.context.config.configVersion;
  useEffect(() => {
    agent?.send({
      type: 'kiosk-status',
      cameraSource: camera.id === 'tablet' ? 'tablet' : camera.id === 'mock' ? 'mock' : 'webcam',
      cameraStatus: status,
      configVersion: appliedVersion,
    });
  }, [agent, camera, status, appliedVersion]);

  // Camera failed → the flow decides (Error page during capture, ignored elsewhere).
  // A tablet that is only `reconnecting` is not an error yet: the capture waits for it.
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
      camera: () => ({ id: camera.id, status: camera.status() }),
      previewStats:
        'previewStats' in camera
          ? () => (camera as { previewStats: () => Promise<unknown> }).previewStats()
          : undefined,
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
  // The flow owns the active config (it may swap it at Cover).
  const page = snapshot.context.config.pages[pageType];
  const inSession = !!snapshot.context.session;
  const tabletDown = camera.id === 'tablet' && (status === 'reconnecting' || status === 'error');

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

      {tabletDown && (inSession || pageType === 'capture') && (
        <div
          className="camera-banner"
          data-testid="camera-status-banner"
          data-status={status}
          role="status"
        >
          {status === 'reconnecting'
            ? 'Kamera terputus — menyambungkan ulang…'
            : 'Kamera terputus. Hubungi petugas booth.'}
        </div>
      )}

      {snapshot.matches('admin') && (
        <AdminPanel
          config={snapshot.context.config}
          camera={camera}
          cameraChoice={cameraChoice}
          onCameraChange={onCameraChange}
          stream={stream}
          cameraStatus={status}
          agent={agent}
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
