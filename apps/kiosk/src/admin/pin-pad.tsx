import { verifyAdminPin } from '@pb/schema';
import { useEffect, useState } from 'react';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;
const PIN_MAX = 8;
// New PINs are 6–8 digits (NEW_ADMIN_PIN_RE); legacy 4–5 digit PINs still verify. Showing only
// 4 empty dots made operators think the PIN was 4 digits.
const PIN_DOTS_MIN = 6;

// Module-level so closing and reopening the pad does not reset the lockout.
const guard = { failures: 0, lockedUntil: 0 };

const clock = () => Date.now();

function resetFailures(): void {
  guard.failures = 0;
}

/** Returns remaining attempts; 0 = now locked out. */
function recordFailure(): number {
  guard.failures += 1;
  if (guard.failures < MAX_ATTEMPTS) return MAX_ATTEMPTS - guard.failures;
  guard.failures = 0;
  guard.lockedUntil = Date.now() + LOCKOUT_MS;
  return 0;
}

export function PinPad({
  pinHash,
  onSuccess,
  onCancel,
  title = 'PIN admin',
  hint = 'Masukkan PIN 6–8 digit.',
}: {
  pinHash: string;
  /** Receives the verified PIN (cash approval re-checks it in the agent). */
  onSuccess: (pin: string) => void;
  onCancel: () => void;
  title?: string;
  hint?: string;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(clock);
  const locked = guard.lockedUntil > now;

  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(t);
  }, [locked]);

  // Auto-close an abandoned pad so it never stays over the buyer screen.
  useEffect(() => {
    const t = setTimeout(onCancel, 30_000);
    return () => clearTimeout(t);
  }, [pin, onCancel]);

  if (!pinHash) {
    return (
      <div className="sys" data-testid="pin-pad">
        <div className="sys-card" style={{ width: 'min(92vw, 480px)' }}>
          <h1>Mode admin terkunci</h1>
          <p>PIN admin belum diatur untuk booth ini. Atur PIN di Studio, lalu publikasikan.</p>
          <button type="button" className="sys-btn" onClick={onCancel}>
            Tutup
          </button>
        </div>
      </div>
    );
  }

  const submit = async (value: string) => {
    if (busy || locked || value.length < 4) return;
    setBusy(true);
    const ok = await verifyAdminPin(value, pinHash);
    setBusy(false);
    if (ok) {
      resetFailures();
      onSuccess(value);
      return;
    }
    const remaining = recordFailure();
    setPin('');
    setNow(clock());
    setMessage(remaining > 0 ? `PIN salah. Sisa percobaan: ${remaining}.` : null);
  };

  const press = (key: string) => {
    if (busy || locked) return;
    setMessage(null);
    if (key === 'del') setPin((p) => p.slice(0, -1));
    else if (key === 'ok') void submit(pin);
    else setPin((p) => (p.length < PIN_MAX ? p + key : p));
  };

  return (
    <div className="sys" data-testid="pin-pad">
      <div className="sys-card" style={{ width: 'min(92vw, 420px)', textAlign: 'center' }}>
        <h1>{title}</h1>
        {locked ? (
          <p className="sys-error">
            Terlalu banyak percobaan. Coba lagi dalam {Math.ceil((guard.lockedUntil - now) / 1000)}{' '}
            detik.
          </p>
        ) : (
          <p className={message ? 'sys-error' : 'sys-muted'}>{message ?? hint}</p>
        )}
        <div className="sys-dots" aria-label={`${pin.length} digit`}>
          {Array.from({ length: Math.max(PIN_DOTS_MIN, pin.length) }, (_, i) => (
            <span key={i} className={i < pin.length ? 'on' : ''} />
          ))}
        </div>
        <div className="sys-keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => (
            <button
              key={k}
              type="button"
              className={`sys-btn${k === 'ok' ? ' primary' : ''}`}
              data-key={k}
              disabled={busy || locked}
              onClick={() => press(k)}
            >
              {k === 'del' ? '⌫' : k === 'ok' ? 'OK' : k}
            </button>
          ))}
        </div>
        <button type="button" className="sys-btn" style={{ marginTop: 16 }} onClick={onCancel}>
          Batal
        </button>
      </div>
    </div>
  );
}
