import type { CameraFacing } from '@pb/capture/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  APP_VERSION,
  CameraLink,
  pairWithAgent,
  parsePairingPayload,
  type LinkStatus,
  type Pairing,
} from './link';
import { CameraMedia, type StillResult } from './media';
import { keepAwake, lockOrientation, platform, prefs, type OrientationLock } from './native';
import { QrScanner } from './qr-scanner';

const PAIRING_KEY = 'pb.camera.pairing';
const SETTINGS_KEY = 'pb.camera.settings';

type Settings = { facing: CameraFacing; orientation: OrientationLock; name: string };
const DEFAULT_SETTINGS: Settings = {
  facing: 'back',
  orientation: 'landscape',
  name: 'Tablet booth',
};

declare global {
  interface Window {
    /** Dev/test hooks. */
    __pbCamera?: {
      pairWith(qr: string): Promise<void>;
      status(): LinkStatus | null;
      simulateOutage(ms: number): void;
      simulateOutageAfterNextShot(ms: number): void;
      lastShot(): { width: number; height: number; method: string; confirmed: boolean } | null;
      pending(): number;
    };
  }
}

export function App() {
  const [pairing, setPairing] = useState<Pairing | null | undefined>(undefined);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [pairError, setPairError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    void (async () => {
      const raw = await prefs.get(PAIRING_KEY);
      const s = await prefs.get(SETTINGS_KEY);
      if (s) setSettings({ ...DEFAULT_SETTINGS, ...(JSON.parse(s) as Partial<Settings>) });
      setPairing(raw ? (JSON.parse(raw) as Pairing) : null);
    })();
  }, []);

  const saveSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void prefs.set(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const pairWith = useCallback(
    async (text: string) => {
      const payload = parsePairingPayload(text.trim());
      if (!payload) {
        setPairError('QR bukan kode pairing kamera booth.');
        return;
      }
      setPairError(null);
      try {
        const p = await pairWithAgent(payload, { name: settings.name, platform: platform() });
        await prefs.set(PAIRING_KEY, JSON.stringify(p));
        setPairing(p);
      } catch (err) {
        setPairError(err instanceof Error ? err.message : String(err));
      }
    },
    [settings.name],
  );

  const unpair = useCallback(async () => {
    await prefs.set(PAIRING_KEY, null);
    setPairing(null);
  }, []);

  useEffect(() => {
    window.__pbCamera = {
      ...(window.__pbCamera ?? {
        status: () => null,
        simulateOutage: () => undefined,
        simulateOutageAfterNextShot: () => undefined,
        lastShot: () => null,
        pending: () => 0,
      }),
      pairWith,
    };
  }, [pairWith]);

  useEffect(() => {
    void keepAwake();
    void lockOrientation(settings.orientation);
  }, [settings.orientation]);

  if (pairing === undefined) return <div className="screen" />;
  if (!pairing) {
    return (
      <div className="screen pairing" data-testid="pairing-screen">
        <h1>Pasangkan dengan booth</h1>
        <p>
          Di laptop booth: mode admin → Kamera → Tablet → “Pasang tablet baru”, lalu pindai QR-nya.
        </p>
        <label className="field">
          Nama tablet
          <input
            value={settings.name}
            onChange={(e) => saveSettings({ name: e.target.value })}
            maxLength={60}
          />
        </label>
        {manual ? (
          <ManualEntry onSubmit={(t) => void pairWith(t)} />
        ) : (
          <QrScanner onResult={(t) => void pairWith(t)} />
        )}
        <button type="button" className="link" onClick={() => setManual((m) => !m)}>
          {manual ? 'Pindai QR' : 'Masukkan kode manual'}
        </button>
        {pairError && (
          <p className="error" data-testid="pair-error">
            {pairError}
          </p>
        )}
      </div>
    );
  }
  return (
    <CameraScreen
      pairing={pairing}
      settings={settings}
      onSettings={saveSettings}
      onUnpair={unpair}
    />
  );
}

function ManualEntry({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form
      className="manual"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(text);
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='{"t":"pb-camera",…}'
        rows={4}
      />
      <button type="submit">Pasangkan</button>
    </form>
  );
}

function CameraScreen({
  pairing,
  settings,
  onSettings,
  onUnpair,
}: {
  pairing: Pairing;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onUnpair: () => void;
}) {
  const media = useMemo(() => new CameraMedia(), []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [lastShot, setLastShot] = useState<{ result: StillResult; confirmed: boolean } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [peer, setPeer] = useState<string>('—');
  const linkRef = useRef<CameraLink | null>(null);

  useEffect(() => {
    let alive = true;
    // Latest values for the test hook (read outside React).
    let hookStatus: LinkStatus | null = null;
    let hookShot: { result: StillResult; confirmed: boolean } | null = null;
    const link = new CameraLink(pairing, media, { name: settings.name, platform: platform() });
    linkRef.current = link;
    const off = link.on((e) => {
      if (!alive) return;
      if (e.type === 'status') {
        hookStatus = e.status;
        setStatus(e.status);
      }
      if (e.type === 'shot') {
        hookShot = { result: e.result, confirmed: e.confirmed };
        setLastShot(hookShot);
        if (!e.confirmed) setFlash((n) => n + 1);
      }
      if (e.type === 'error') setError(e.message);
      if (e.type === 'peer') setPeer(e.state);
    });
    const offTrack = media.onTrack(() => {
      if (videoRef.current) videoRef.current.srcObject = media.mediaStream;
    });
    media
      .start(settings.facing)
      .then(() => {
        if (alive) return link.start();
      })
      .catch((err: unknown) => setError(`Kamera tidak bisa dibuka: ${String(err)}`));
    window.__pbCamera = {
      pairWith: window.__pbCamera?.pairWith ?? (async () => undefined),
      status: () => hookStatus,
      simulateOutage: (ms) => link.simulateOutage(ms),
      simulateOutageAfterNextShot: (ms) => link.simulateOutageAfterNextShot(ms),
      lastShot: () =>
        hookShot ? { ...hookShot.result, blob: undefined, confirmed: hookShot.confirmed } : null,
      pending: () => link.queue.ids().length,
    } as Window['__pbCamera'];
    return () => {
      alive = false;
      off();
      offTrack();
      link.stop();
      media.stop();
    };
    // The link is rebuilt only for a new pairing; facing switches restart the track only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing, media]);

  const switchFacing = async () => {
    const facing: CameraFacing = media.currentFacing === 'back' ? 'front' : 'back';
    onSettings({ facing });
    try {
      await media.start(facing);
      linkRef.current?.announce();
    } catch (err) {
      setError(String(err));
    }
  };

  const connected = status?.state === 'connected';
  return (
    <div
      className="screen camera"
      data-testid="camera-screen"
      data-link={status?.state ?? 'none'}
      onPointerDown={() => void keepAwake()}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={`preview${media.currentFacing === 'front' ? ' mirror' : ''}`}
      />
      {flash > 0 && <div key={flash} className="flash" />}
      <div className={`badge ${connected ? 'ok' : 'bad'}`} data-testid="link-status">
        {status?.state === 'connected'
          ? `Tersambung ke booth (${status.host})`
          : status?.state === 'unpaired'
            ? status.message
            : `Terputus — menyambungkan ulang${status && status.attempt > 0 ? ` (percobaan ${status.attempt})` : ''}…`}
      </div>
      <div className="hud">
        {lastShot && (
          <span data-testid="last-shot">
            Foto terakhir {lastShot.result.width}×{lastShot.result.height} ({lastShot.result.method}
            ){lastShot.confirmed ? ' · tersimpan di booth' : ' · menunggu konfirmasi'}
          </span>
        )}
        <span>Preview: {peer}</span>
        {error && <span className="error">{error}</span>}
      </div>
      <div className="controls">
        <button type="button" onClick={() => void switchFacing()}>
          Kamera {media.currentFacing === 'back' ? 'belakang' : 'depan'} ⇄
        </button>
        <button type="button" onClick={() => setShowSettings((s) => !s)}>
          Pengaturan
        </button>
      </div>
      {showSettings && (
        <div className="sheet">
          <h2>Pengaturan</h2>
          <label className="field">
            Orientasi layar
            <select
              value={settings.orientation}
              onChange={(e) => onSettings({ orientation: e.target.value as OrientationLock })}
            >
              <option value="landscape">Kunci landscape</option>
              <option value="portrait">Kunci portrait</option>
              <option value="any">Bebas</option>
            </select>
          </label>
          <p className="muted">
            Layar dijaga tetap menyala. Agent: {pairing.hosts.join(', ')}:{pairing.port} · versi{' '}
            {APP_VERSION}
          </p>
          <button type="button" className="danger" onClick={onUnpair}>
            Lepas pasangan
          </button>
          <button type="button" onClick={() => setShowSettings(false)}>
            Tutup
          </button>
        </div>
      )}
    </div>
  );
}
