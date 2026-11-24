import { migrateBoothConfig, type BoothConfig, type ValidationIssue } from '@pb/schema';
import { useCallback, useEffect, useState } from 'react';
import { AgentApp } from './agent/agent-app';
import { AgentClient, probeAgent } from './agent/agent-client';
import { Kiosk } from './kiosk';
import type { CaptureChoice, KioskSettings } from './settings';
import { SystemScreen } from './system-screen';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; config: BoothConfig }
  | { status: 'error'; message: string; issues?: ValidationIssue[] };

/** Loads and validates the booth config from a local JSON file (dev / F1). */
async function loadConfig(url: string): Promise<LoadState> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (err) {
    return { status: 'error', message: `Config tidak dapat dimuat (${String(err)}).` };
  }
  if (!res.ok)
    return { status: 'error', message: `Config tidak dapat dimuat (HTTP ${res.status}).` };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { status: 'error', message: 'File config bukan JSON yang valid.' };
  }
  const result = migrateBoothConfig(json);
  if (!result.success) {
    return { status: 'error', message: 'Config booth tidak valid.', issues: result.issues };
  }
  return { status: 'ready', config: result.config };
}

type AgentState =
  | { status: 'probing' }
  | { status: 'ready'; agent: AgentClient }
  /** No agent: browser-only mode (dev / F1). */
  | { status: 'none' }
  /** Paired-device mode needs the agent, but it does not answer. */
  | { status: 'missing' };

/** Finds the local agent. In `agent` source mode it is required and probed until it answers. */
function useAgent(settings: KioskSettings): AgentState {
  const [state, setState] = useState<AgentState>(
    settings.agentUrl ? { status: 'probing' } : { status: 'none' },
  );
  useEffect(() => {
    const url = settings.agentUrl;
    if (!url) return;
    let alive = true;
    let client: AgentClient | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = async () => {
      const ok = await probeAgent(url);
      if (!alive) return;
      if (ok) {
        client = new AgentClient(url);
        client.start();
        setState({ status: 'ready', agent: client });
      } else if (settings.source === 'agent') {
        setState({ status: 'missing' });
        timer = setTimeout(() => void attempt(), 3000);
      } else {
        setState({ status: 'none' });
      }
    };
    void attempt();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      client?.stop();
    };
  }, [settings.agentUrl, settings.source]);
  return state;
}

/** Camera source: URL/env override, else the operator's choice stored in the agent. */
function useCameraChoice(settings: KioskSettings, agent: AgentClient | null) {
  // Operator choice stored in the agent (null while loading).
  const [stored, setStored] = useState<'webcam' | 'tablet' | null>(null);
  useEffect(() => {
    if (settings.capture || !agent) return;
    let alive = true;
    agent
      .settings()
      .then((s) => alive && setStored(s.cameraSource))
      .catch(() => alive && setStored('webcam'));
    return () => {
      alive = false;
    };
  }, [settings.capture, agent]);
  const change = useCallback(
    async (next: 'webcam' | 'tablet') => {
      if (agent) await agent.setCameraSource(next);
      setStored(next);
    },
    [agent],
  );
  const choice: CaptureChoice | null = settings.capture ?? (agent ? stored : 'webcam');
  return [choice, change] as const;
}

const black = (
  <div style={{ position: 'fixed', inset: 0, background: '#000' }} data-testid="loading" />
);

export function App({ settings }: { settings: KioskSettings }) {
  const agentState = useAgent(settings);
  const agent = agentState.status === 'ready' ? agentState.agent : null;
  const [camera, setCamera] = useCameraChoice(settings, agent);

  if (agentState.status === 'probing') return black;
  if (agentState.status === 'missing') {
    return (
      <SystemScreen
        title="Agent lokal belum berjalan"
        message="Layanan agent (cetak, penyimpanan, kamera tablet) tidak menjawab di perangkat ini. Mencoba lagi otomatis…"
      />
    );
  }
  if (!camera) return black;
  return settings.source === 'agent' && agent ? (
    <AgentApp agent={agent} settings={settings} camera={camera} onCameraChange={setCamera} />
  ) : (
    <FileApp settings={settings} agent={agent} camera={camera} onCameraChange={setCamera} />
  );
}

/** Dev/F1 mode: config from a local JSON file. The agent (if running) still stores + prints. */
function FileApp({
  settings,
  agent,
  camera,
  onCameraChange,
}: {
  settings: KioskSettings;
  agent: AgentClient | null;
  camera: CaptureChoice;
  onCameraChange: (c: 'webcam' | 'tablet') => Promise<void>;
}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    void loadConfig(settings.configUrl).then((next) => alive && setState(next));
    return () => {
      alive = false;
    };
  }, [settings.configUrl, attempt]);

  if (state.status === 'loading') return black;
  if (state.status === 'error') {
    return (
      <SystemScreen
        title="Booth belum siap"
        message={state.message}
        retryInSec={15}
        onRetry={load}
        details={
          state.issues && (
            <ul className="sys-muted" data-testid="config-issues">
              {state.issues.slice(0, 12).map((i) => (
                <li key={`${i.path}:${i.code}`}>
                  <code>{i.path || '(root)'}</code>: {i.message}
                </li>
              ))}
            </ul>
          )
        }
      />
    );
  }
  return (
    <Kiosk
      key={camera}
      config={state.config}
      settings={settings}
      agent={agent}
      cameraChoice={camera}
      onCameraChange={onCameraChange}
    />
  );
}
