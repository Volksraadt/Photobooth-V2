import { migrateBoothConfig, type BoothConfig } from '@pb/schema';
import { useCallback, useEffect, useState } from 'react';
import { Kiosk } from '../kiosk';
import type { CaptureChoice, KioskSettings } from '../settings';
import type { AgentClient, AgentConfigState } from './agent-client';

type Ready = { config: BoothConfig; version: number; assets: Record<string, string> };

const POLL_MS = 5000;

/**
 * Paired-device mode: the local agent owns pairing, the device token, config sync and the asset
 * cache (F3). The kiosk shows the agent's active config; new versions arrive as a WebSocket
 * `config` push (+ polling) and are applied by the flow at Cover.
 */
export function AgentApp({
  agent,
  settings,
  camera,
  onCameraChange,
}: {
  agent: AgentClient;
  settings: KioskSettings;
  camera: CaptureChoice;
  onCameraChange: (c: 'webcam' | 'tablet') => Promise<void>;
}) {
  const [state, setState] = useState<AgentConfigState>({ status: 'connecting' });
  // Last activated config: kept on screen if a later refresh fails.
  const [ready, setReady] = useState<Ready | null>(null);

  useEffect(() => {
    let alive = true;
    let version: number | null = null;
    let rejected: number | null = null;
    const load = async () => {
      try {
        const s = await agent.configState();
        if (!alive) return;
        if (s.status === 'ready') {
          if (s.version === version || s.version === rejected) return;
          const parsed = migrateBoothConfig(s.config);
          if (!parsed.success) {
            // Audit S6: never silent. Report once per version; keep the last good config on
            // screen if there is one, otherwise explain instead of "Menghubungkan…" forever.
            rejected = s.version;
            const issues = parsed.issues.map((i) => `${i.path || '(root)'}: ${i.message}`);
            console.error('[kiosk] invalid config from agent', parsed.issues);
            agent.send({ type: 'config-invalid', version: s.version, issues });
            setState({
              status: 'error',
              message: `Desain versi ${s.version} tidak bisa dipakai booth ini (${issues.length} masalah). Periksa desain di Studio atau perbarui aplikasi booth.`,
            });
            return;
          }
          version = s.version;
          setReady({ config: parsed.config, version: s.version, assets: s.assets });
        }
        setState(s);
      } catch (err) {
        if (alive)
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    };
    void load();
    const off = agent.subscribe((msg) => {
      if (msg.type === 'config') void load();
    });
    const offOpen = agent.onOpenChange((open) => open && void load());
    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      off();
      offOpen();
      clearInterval(t);
    };
  }, [agent]);

  const resolveAssetUrl = useCallback((id: string) => ready?.assets[id], [ready]);

  if (ready) {
    return (
      <Kiosk
        key={camera}
        config={ready.config}
        settings={settings}
        agent={agent}
        cameraChoice={camera}
        onCameraChange={onCameraChange}
        resolveAssetUrl={resolveAssetUrl}
      />
    );
  }
  return <DeviceScreen state={state} />;
}

function DeviceScreen({ state }: { state: AgentConfigState }) {
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
