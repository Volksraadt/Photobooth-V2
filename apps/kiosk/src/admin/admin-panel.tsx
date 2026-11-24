import type { CaptureSource, CaptureStatus } from '@pb/capture';
import type { BoothConfig } from '@pb/schema';
import { useEffect, useRef, useState } from 'react';
import { downloadBlob, getSessionPhotos, listSessions, type StoredSession } from '../session-store';

const STATUS_LABEL: Record<CaptureStatus, string> = {
  idle: 'belum terhubung',
  connecting: 'menghubungkan…',
  connected: 'terhubung',
  reconnecting: 'menghubungkan ulang…',
  error: 'error',
};

/** Operator panel (system UI). F1: camera test, free session, stored sessions. */
export function AdminPanel({
  config,
  camera,
  stream,
  cameraStatus,
  onFreeSession,
  onClose,
}: {
  config: BoothConfig;
  camera: CaptureSource;
  stream: MediaStream | null;
  cameraStatus: CaptureStatus;
  onFreeSession: () => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [testShot, setTestShot] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<StoredSession[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch((err: unknown) => setSessionsError(String(err)));
  }, []);

  useEffect(() => () => void (testShot && URL.revokeObjectURL(testShot)), [testShot]);

  const takeTestShot = async () => {
    setTestError(null);
    try {
      await camera.connect();
      const image = await camera.capture({ shotIndex: 0 });
      setTestShot(URL.createObjectURL(image.blob));
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    }
  };

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
          Booth {config.boothId} · config v{config.configVersion} · kamera{' '}
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

        <h2>Tes kamera</h2>
        <video ref={videoRef} className="sys-preview" autoPlay muted playsInline />
        <div className="sys-row" style={{ marginTop: 10 }}>
          <button type="button" className="sys-btn" onClick={takeTestShot}>
            Ambil foto tes
          </button>
          {testError && <span className="sys-error">{testError}</span>}
        </div>
        {testShot && (
          <img src={testShot} alt="Foto tes" className="sys-preview" style={{ marginTop: 10 }} />
        )}

        <h2>Sesi tersimpan di perangkat</h2>
        {sessionsError && <p className="sys-error">{sessionsError}</p>}
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
                    <button
                      type="button"
                      className="sys-btn"
                      onClick={() => void downloadSession(s)}
                    >
                      Unduh
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2>Menyusul</h2>
        <p className="sys-muted">
          Tes print, sinkron config, antrian upload, dan approve cash tersedia setelah Local Agent
          (F3) dan pembayaran (F4).
        </p>
      </div>
    </div>
  );
}
