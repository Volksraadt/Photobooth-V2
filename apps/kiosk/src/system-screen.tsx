import { useEffect, useState, type ReactNode } from 'react';

/**
 * Last-resort screen when no owner design can be shown (config missing/invalid, or the Error page
 * itself failed). Never a white screen; retries automatically.
 */
export function SystemScreen({
  title,
  message,
  details,
  retryInSec,
  onRetry,
}: {
  title: string;
  message: string;
  details?: ReactNode;
  retryInSec?: number;
  onRetry?: () => void;
}) {
  const [left, setLeft] = useState(retryInSec ?? 0);
  useEffect(() => {
    if (!retryInSec || !onRetry) return;
    const t = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          clearInterval(t);
          onRetry();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [retryInSec, onRetry]);

  return (
    <div className="sys" data-testid="system-screen" role="alert">
      <div className="sys-card">
        <span className="sys-icon" aria-hidden>
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3 2 20h20z" />
            <path d="M12 10v4M12 17h.01" />
          </svg>
        </span>
        <h1>{title}</h1>
        <p>{message}</p>
        {details}
        {onRetry && (
          <div className="sys-row" style={{ marginTop: 16 }}>
            <button type="button" className="sys-btn primary" onClick={onRetry}>
              Coba lagi
            </button>
            {retryInSec ? <span className="sys-muted">Otomatis dalam {left} detik</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}
