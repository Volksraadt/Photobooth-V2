import { migrateBoothConfig, type BoothConfig, type ValidationIssue } from '@pb/schema';
import { useCallback, useEffect, useState } from 'react';
import { Kiosk } from './kiosk';
import { RemoteApp } from './remote-app';
import type { KioskSettings } from './settings';
import { SystemScreen } from './system-screen';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; config: BoothConfig }
  | { status: 'error'; message: string; issues?: ValidationIssue[] };

/** Loads and validates the booth config. Dev: local JSON file; F2: agent/API cache. */
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

export function App({ settings }: { settings: KioskSettings }) {
  return settings.source === 'api' ? (
    <RemoteApp settings={settings} />
  ) : (
    <FileApp settings={settings} />
  );
}

/** Dev/F1 mode: config from a local JSON file. */
function FileApp({ settings }: { settings: KioskSettings }) {
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

  if (state.status === 'loading') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#000' }} data-testid="loading" />
    );
  }
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
  return <Kiosk config={state.config} settings={settings} />;
}
