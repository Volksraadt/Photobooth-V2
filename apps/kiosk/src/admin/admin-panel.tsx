import type { CaptureSource, CaptureStatus, PreviewStats, TabletCameraState } from '@pb/capture';
import { QrCode } from '@pb/renderer';
import type { BoothConfig } from '@pb/schema';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentClient,
  AgentSession,
  AgentStatus,
  PrinterInfo,
  PrintJob,
} from '../agent/agent-client';
import type { CaptureChoice } from '../settings';
import { downloadBlob, getSessionPhotos, listSessions, type StoredSession } from '../session-store';

const STATUS_LABEL: Record<CaptureStatus, string> = {
  idle: 'belum terhubung',
  connecting: 'menghubungkan…',
  connected: 'terhubung',
  reconnecting: 'terputus, menyambungkan ulang…',
  error: 'error',
};

/** Local session status as shown to the booth operator. */
const SESSION_STATUS_LABEL: Record<string, string> = {
  capturing: 'berjalan',
  completed: 'selesai',
  failed: 'gagal',
  abandoned: 'dibatalkan (belum bayar)',
};

const PRINTER_LABEL: Record<string, string> = {
  ok: 'siap',
  warning: 'peringatan',
  error: 'error',
  disconnected: 'tidak terhubung',
  unknown: 'tidak diketahui',
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Operator panel (system UI, Bahasa Indonesia). */
export function AdminPanel({
  config,
  camera,
  cameraChoice,
  onCameraChange,
  stream,
  cameraStatus,
  agent,
  onFreeSession,
  onClose,
}: {
  config: BoothConfig;
  camera: CaptureSource;
  cameraChoice: CaptureChoice;
  onCameraChange: (c: 'webcam' | 'tablet') => Promise<void>;
  stream: MediaStream | null;
  cameraStatus: CaptureStatus;
  agent: AgentClient | null;
  onFreeSession: () => void;
  onClose: () => void;
}) {
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };

  return (
    <div className="sys" data-testid="admin-panel">
      <div className="sys-card">
        <div className="sys-row" style={{ justifyContent: 'space-between' }}>
          <h1>Mode admin</h1>
          <button type="button" className="sys-btn primary" onClick={onClose}>
            Keluar
          </button>
        </div>
        <p className="sys-muted">
          Booth {config.boothId} · config v{config.configVersion} · kamera ({camera.id}){' '}
          {STATUS_LABEL[cameraStatus]}
        </p>

        <h2>Sesi</h2>
        <div className="sys-row">
          <button type="button" className="sys-btn" onClick={onFreeSession}>
            Mulai sesi gratis
          </button>
          <button type="button" className="sys-btn" onClick={() => window.location.reload()}>
            Muat ulang config
          </button>
          <button type="button" className="sys-btn" onClick={toggleFullscreen}>
            Layar penuh
          </button>
        </div>

        {agent ? <AgentSection agent={agent} /> : <NoAgentNote />}

        <CameraSection
          config={config}
          camera={camera}
          cameraChoice={cameraChoice}
          onCameraChange={onCameraChange}
          stream={stream}
          agent={agent}
        />

        {agent && <PrinterSection agent={agent} config={config} />}

        {agent ? <AgentSessions agent={agent} /> : <BrowserSessions />}
      </div>
    </div>
  );
}

function NoAgentNote() {
  return (
    <>
      <h2>Agent lokal</h2>
      <p className="sys-muted" data-testid="no-agent">
        Agent tidak terhubung: foto disimpan di browser dan cetak hanya disimulasikan. Jalankan
        aplikasi booth (Tauri) atau <code>pnpm --filter @pb/agent dev</code>.
      </p>
    </>
  );
}

function AgentSection({ agent }: { agent: AgentClient }) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const load = useCallback(() => {
    agent
      .status()
      .then((s) => {
        setStatus(s);
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, [agent]);
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      await agent.refreshConfig();
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <h2>Agent lokal</h2>
      {error && <p className="sys-error">{error}</p>}
      {status && (
        <p className="sys-muted" data-testid="agent-status">
          Agent {status.version} · {status.paired ? 'terpasang' : 'belum dipasang'} ·{' '}
          {status.online === null ? 'mengecek koneksi' : status.online ? 'online' : 'offline'} ·
          config {status.config.version ? `v${status.config.version}` : status.config.status} ·
          antrian kirim {status.outboxPending} · lembar tercetak {status.printedSheets}
        </p>
      )}
      {status && (
        <p className="sys-muted" data-testid="agent-payments">
          Voucher tersinkron: {status.vouchers ?? 0} · belum terkirim: sesi{' '}
          {status.outboxByKind?.session ?? 0}, voucher {status.outboxByKind?.voucher_use ?? 0},
          tunai {status.outboxByKind?.cash_approval ?? 0}
          {status.online === false && ' · offline: QRIS disembunyikan, voucher & tunai tetap bisa'}
        </p>
      )}
      <div className="sys-row">
        <button type="button" className="sys-btn" onClick={() => void sync()} disabled={syncing}>
          {syncing ? 'Menyinkron…' : 'Sinkron config'}
        </button>
        <button
          type="button"
          className="sys-btn"
          onClick={() =>
            void agent.syncVouchers().then(load, (e: unknown) => setError(errorText(e)))
          }
        >
          Sinkron voucher
        </button>
        {confirmReset ? (
          <>
            <span className="sys-error">
              Lepas perangkat ini dari booth? Sesi tersimpan tetap ada.
            </span>
            <button
              type="button"
              className="sys-btn"
              onClick={() => void agent.resetDevice().then(() => window.location.reload())}
            >
              Ya, lepas
            </button>
            <button type="button" className="sys-btn" onClick={() => setConfirmReset(false)}>
              Batal
            </button>
          </>
        ) : (
          <button type="button" className="sys-btn" onClick={() => setConfirmReset(true)}>
            Lepas dari booth
          </button>
        )}
      </div>
    </>
  );
}

function CameraSection({
  config,
  camera,
  cameraChoice,
  onCameraChange,
  stream,
  agent,
}: {
  config: BoothConfig;
  camera: CaptureSource;
  cameraChoice: CaptureChoice;
  onCameraChange: (c: 'webcam' | 'tablet') => Promise<void>;
  stream: MediaStream | null;
  agent: AgentClient | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [testShot, setTestShot] = useState<{ url: string; size: string } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(
    () => () => {
      if (testShot?.url.startsWith('blob:')) URL.revokeObjectURL(testShot.url);
    },
    [testShot],
  );

  const takeTestShot = async () => {
    setTestError(null);
    setBusy(true);
    try {
      await camera.connect();
      const image = await camera.capture({
        shotIndex: 1,
        // The tablet stores stills in the agent; tests go to a separate "camera-test" session.
        session: {
          id: 'camera-test',
          code: 'TESTSHT2',
          boothId: config.boothId,
          configVersion: config.configVersion,
          startedAt: new Date().toISOString(),
          takeNumber: 1 + (Date.now() % 99),
        },
      });
      const url = image.stored?.url ?? (image.blob ? URL.createObjectURL(image.blob) : null);
      if (url) setTestShot({ url, size: `${image.width}×${image.height}` });
    } catch (err) {
      setTestError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>Kamera</h2>
      {agent && (
        <div className="sys-row" role="radiogroup" aria-label="Sumber kamera">
          {(['webcam', 'tablet'] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={cameraChoice === c}
              data-testid={`camera-source-${c}`}
              className={`sys-btn${cameraChoice === c ? ' primary' : ''}`}
              onClick={() => void onCameraChange(c)}
            >
              {c === 'webcam' ? 'Webcam laptop' : 'Tablet (Camera App)'}
            </button>
          ))}
        </div>
      )}
      {camera.id === 'tablet' && agent && <TabletPanel agent={agent} camera={camera} />}
      <video
        ref={videoRef}
        className="sys-preview"
        autoPlay
        muted
        playsInline
        data-testid="admin-preview"
      />
      <div className="sys-row" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="sys-btn"
          onClick={() => void takeTestShot()}
          disabled={busy}
        >
          {busy ? 'Mengambil…' : 'Ambil foto tes'}
        </button>
        {testShot && (
          <span className="sys-muted" data-testid="test-shot-size">
            Foto tes {testShot.size}
          </span>
        )}
        {testError && <span className="sys-error">{testError}</span>}
      </div>
      {testShot && (
        <img src={testShot.url} alt="Foto tes" className="sys-preview" style={{ marginTop: 10 }} />
      )}
    </>
  );
}

function TabletPanel({ agent, camera }: { agent: AgentClient; camera: CaptureSource }) {
  const [state, setState] = useState<TabletCameraState | null>(null);
  const [pairings, setPairings] = useState<
    { id: string; name: string; platform: string; last_seen_at: string | null }[]
  >([]);
  const [qr, setQr] = useState<{
    value: string;
    hosts: string[];
    port: number;
    expiresAt: string;
  } | null>(null);
  const [stats, setStats] = useState<PreviewStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    agent
      .camera()
      .then((c) => {
        setState(c.state);
        setPairings(c.pairings);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, [agent]);

  useEffect(() => {
    load();
    const off = agent.subscribe((m) => m.type === 'camera' && load());
    return off;
  }, [agent, load]);

  useEffect(() => {
    const source = camera as CaptureSource & { previewStats?: () => Promise<PreviewStats | null> };
    if (!source.previewStats) return;
    const t = setInterval(() => void source.previewStats!().then(setStats), 1000);
    return () => clearInterval(t);
  }, [camera]);

  const pair = async () => {
    setError(null);
    try {
      const res = await agent.createCameraPairing();
      setQr({
        value: res.qr,
        hosts: res.payload.hosts,
        port: res.payload.port,
        expiresAt: res.expiresAt,
      });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const label =
    state?.status === 'connected'
      ? `tersambung: ${state.info.name} (${state.info.platform}, kamera ${state.info.facing === 'front' ? 'depan' : 'belakang'}${
          state.info.photoWidth ? `, foto ${state.info.photoWidth}×${state.info.photoHeight}` : ''
        })`
      : state?.status === 'disconnected'
        ? `terputus sejak ${new Date(state.since).toLocaleTimeString('id-ID')}`
        : 'belum ada tablet tersambung';

  return (
    <div data-testid="tablet-panel" data-status={state?.status ?? 'unknown'}>
      <p className="sys-muted">Tablet {label}</p>
      {stats && (
        <p className="sys-muted" data-testid="preview-stats">
          Preview {stats.width ?? '?'}×{stats.height ?? '?'} · {stats.fps ?? '?'} fps ·{' '}
          {stats.codec ?? ''} · estimasi latensi {stats.estimatedLatencyMs ?? '?'} ms (jitter buffer{' '}
          {stats.jitterBufferMs?.toFixed(0) ?? '?'} ms, RTT {stats.rttMs?.toFixed(0) ?? '?'} ms)
        </p>
      )}
      <div className="sys-row">
        <button
          type="button"
          className="sys-btn"
          onClick={() => void pair()}
          data-testid="pair-tablet"
        >
          Pasang tablet baru
        </button>
        {error && <span className="sys-error">{error}</span>}
      </div>
      {qr && (
        <div className="sys-row" style={{ alignItems: 'flex-start', marginTop: 10 }}>
          <div
            style={{ width: 260, height: 260, background: '#fff', padding: 8 }}
            data-testid="tablet-qr"
            data-qr={qr.value}
          >
            <QrCode value={qr.value} label="QR pairing kamera" />
          </div>
          <div className="sys-muted" style={{ maxWidth: 360 }}>
            <p>
              Buka Camera App di tablet, lalu pindai QR ini. Tablet dan laptop harus di Wi-Fi yang
              sama.
            </p>
            <p>
              Alamat: {qr.hosts.join(', ') || '(tidak ada jaringan)'} · port {qr.port}
              <br />
              Berlaku sampai {new Date(qr.expiresAt).toLocaleTimeString('id-ID')}
            </p>
          </div>
        </div>
      )}
      {pairings.length > 0 && (
        <table className="sys-table">
          <thead>
            <tr>
              <th>Tablet terpasang</th>
              <th>Terakhir terlihat (UTC)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pairings.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.name} ({p.platform})
                </td>
                <td>{p.last_seen_at?.replace('T', ' ').slice(0, 19) ?? '—'}</td>
                <td>
                  <button
                    type="button"
                    className="sys-btn"
                    onClick={() => void agent.forgetCamera(p.id).then(load)}
                  >
                    Lupakan
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PrinterSection({ agent, config }: { agent: AgentClient; config: BoothConfig }) {
  const [data, setData] = useState<{
    printers: PrinterInfo[];
    selected: string | null;
    status: { status: string; message: string | null };
    printedSheets: number;
    recentJobs: PrintJob[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    agent
      .printers()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, [agent]);
  useEffect(load, [load]);

  const select = async (name: string) => {
    try {
      await agent.selectPrinter(name);
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const testPrint = async () => {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const { job } = await agent.testPrint(config);
      setResult(`Tes cetak dikirim ke "${job.printer}" (${job.status}).`);
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>Printer</h2>
      {data && (
        <>
          <p className="sys-muted" data-testid="printer-status">
            Dipakai: {data.selected ?? '(belum dipilih)'} ·{' '}
            {PRINTER_LABEL[data.status.status] ?? data.status.status}
            {data.status.message ? ` (${data.status.message})` : ''} · lembar tercetak{' '}
            {data.printedSheets}
          </p>
          <div className="sys-row" role="radiogroup" aria-label="Printer">
            {data.printers.map((p) => (
              <button
                key={p.name}
                type="button"
                role="radio"
                aria-checked={data.selected === p.name}
                className={`sys-btn${data.selected === p.name ? ' primary' : ''}`}
                onClick={() => void select(p.name)}
                title={p.message ?? undefined}
              >
                {p.name}
                {p.isDefault ? ' (default)' : ''} · {PRINTER_LABEL[p.status] ?? p.status}
              </button>
            ))}
          </div>
          <p className="sys-muted">
            Strip 2×6: kertas 4×6 berisi 2 strip. Untuk potong otomatis, aktifkan opsi potong 2 inci
            di pengaturan driver printer.
          </p>
        </>
      )}
      <div className="sys-row">
        <button
          type="button"
          className="sys-btn"
          onClick={() => void testPrint()}
          disabled={busy}
          data-testid="test-print"
        >
          {busy ? 'Mencetak…' : 'Tes cetak'}
        </button>
        <button type="button" className="sys-btn" onClick={load}>
          Deteksi ulang printer
        </button>
        {result && (
          <span className="sys-muted" data-testid="test-print-result">
            {result}
          </span>
        )}
        {error && <span className="sys-error">{error}</span>}
      </div>
    </>
  );
}

function AgentSessions({ agent }: { agent: AgentClient }) {
  const [sessions, setSessions] = useState<AgentSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    agent
      .sessions()
      .then(setSessions)
      .catch((e: unknown) => setError(errorText(e)));
  }, [agent]);
  return (
    <>
      <h2>Sesi tersimpan di perangkat</h2>
      {error && <p className="sys-error">{error}</p>}
      {sessions?.length === 0 && <p className="sys-muted">Belum ada sesi.</p>}
      {sessions && sessions.length > 0 && (
        <table className="sys-table" data-testid="stored-sessions">
          <thead>
            <tr>
              <th>Kode</th>
              <th>Mulai (UTC)</th>
              <th>Status</th>
              <th>Foto</th>
              <th>Strip</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const strip = s.files.find((f) => f.kind === 'composite');
              return (
                <tr key={s.id}>
                  <td>{s.code}</td>
                  <td>{s.started_at.replace('T', ' ').slice(0, 19)}</td>
                  <td>{SESSION_STATUS_LABEL[s.status] ?? s.status}</td>
                  <td>{s.files.filter((f) => f.kind === 'original').length}</td>
                  <td>
                    {strip ? (
                      <a href={strip.url} target="_blank" rel="noreferrer">
                        Lihat
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

/** Without an agent: F1 IndexedDB sessions. */
function BrowserSessions() {
  const [sessions, setSessions] = useState<StoredSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch((err: unknown) => setError(String(err)));
  }, []);

  const downloadSession = async (session: StoredSession) => {
    const blobs = await getSessionPhotos(session.id);
    for (const shot of session.shots) {
      const blob = blobs.get(shot.photoId);
      if (!blob) continue;
      const ext = shot.mimeType === 'image/png' ? 'png' : 'jpg';
      const suffix = shot.selected ? '' : '-unused';
      downloadBlob(
        blob,
        `${session.code}-slot${shot.slotIndex}-take${shot.takeNumber}${suffix}.${ext}`,
      );
    }
    downloadBlob(
      new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' }),
      `${session.code}.json`,
    );
  };

  return (
    <>
      <h2>Sesi tersimpan di perangkat</h2>
      {error && <p className="sys-error">{error}</p>}
      {sessions?.length === 0 && <p className="sys-muted">Belum ada sesi.</p>}
      {sessions && sessions.length > 0 && (
        <table className="sys-table" data-testid="stored-sessions">
          <thead>
            <tr>
              <th>Kode</th>
              <th>Waktu (UTC)</th>
              <th>Foto</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.code}</td>
                <td>{s.savedAt.replace('T', ' ').slice(0, 19)}</td>
                <td>{s.shots.length}</td>
                <td>
                  <button type="button" className="sys-btn" onClick={() => void downloadSession(s)}>
                    Unduh
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
