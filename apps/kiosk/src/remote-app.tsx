import { useCallback, useEffect, useRef, useState } from 'react';
import { Kiosk } from './kiosk';
import { RemoteConfigClient, type RemoteState } from './remote/remote-config';
import type { KioskSettings } from './settings';

/** Paired-device mode (F2): config + assets from apps/api, live updates without restart. */
export function RemoteApp({ settings }: { settings: KioskSettings }) {
  // One client per mount (StrictMode mounts twice; a stopped client is never reused).
  const clientRef = useRef<RemoteConfigClient | null>(null);
  const [state, setState] = useState<RemoteState>({ status: 'connecting' });
  // Last activated config: kept on screen if a later refresh fails (offline etc.).
  const [ready, setReady] = useState<Extract<RemoteState, { status: 'ready' }> | null>(null);

  useEffect(() => {
    const c = new RemoteConfigClient(settings.apiBase);
    const off = c.subscribe((s) => {
      setState(s);
      if (s.status === 'ready') setReady(s);
    });
    clientRef.current = c;
    void c.start();
    return () => {
      off();
      c.stop();
    };
  }, [settings.apiBase]);

  const heartbeat = useCallback(
    (info: { configVersion: number | null; cameraStatus: string }) =>
      clientRef.current?.heartbeat(info),
    [],
  );
  const resolveAssetUrl = useCallback(
    (id: string) => (state.status === 'ready' ? state : ready)?.assetUrls.get(id),
    [state, ready],
  );

  const active = state.status === 'ready' ? state : state.status === 'error' ? ready : null;

  if (active) {
    return (
      <Kiosk
        config={active.config}
        settings={settings}
        resolveAssetUrl={resolveAssetUrl}
        onHeartbeat={heartbeat}
      />
    );
  }
  return <DeviceScreen state={state} />;
}

function DeviceScreen({ state }: { state: RemoteState }) {
  const code = state.status === 'pairing' ? state.code : null;
  return (
    <div
      className="sys"
      style={{ background: '#020617' }}
      data-testid="device-screen"
      data-status={state.status}
    >
      <div className="sys-card" style={{ textAlign: 'center', width: 'min(92vw, 640px)' }}>
        {code ? (
          <>
            <h1>Pasang perangkat ini</h1>
            <p>Di Studio, buka booth → Perangkat, lalu masukkan kode berikut:</p>
            <div
              data-testid="pairing-code"
              data-code={code}
              style={{
                fontSize: 88,
                fontWeight: 800,
                letterSpacing: 16,
                margin: '16px 0',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {code.slice(0, 3)} {code.slice(3)}
            </div>
            <p className="sys-muted">Kode berlaku 10 menit dan diperbarui otomatis.</p>
          </>
        ) : state.status === 'waiting' ? (
          <>
            <h1>Perangkat terpasang</h1>
            <p>Belum ada desain yang dipublikasikan untuk booth ini. Publikasikan dari Studio.</p>
          </>
        ) : state.status === 'error' ? (
          <>
            <h1>Booth belum siap</h1>
            <p className="sys-error">{state.message}</p>
            <p className="sys-muted">Mencoba lagi otomatis…</p>
          </>
        ) : (
          <h1>Menghubungkan…</h1>
        )}
      </div>
    </div>
  );
}
