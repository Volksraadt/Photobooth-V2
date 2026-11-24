import type { CaptureSource, CaptureStatus } from '@pb/capture';
import { useEffect, useState } from 'react';

/** Live preview stream + status of a capture source. Connects eagerly so preview is instant. */
export function useCamera(source: CaptureSource): {
  stream: MediaStream | null;
  status: CaptureStatus;
} {
  const [status, setStatus] = useState<CaptureStatus>(source.status());
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    let alive = true;
    const sync = (next: CaptureStatus) => {
      setStatus(next);
      if (next === 'connected') {
        source
          .getPreviewStream()
          .then((s) => alive && setStream(s))
          .catch(() => alive && setStream(null));
      } else if (next === 'error' || next === 'idle') {
        setStream(null);
      }
    };
    const unsubscribe = source.onStatusChange(sync);
    // Tablet: a renegotiated WebRTC peer brings a new stream while staying `connected`.
    const offPreview = source.onPreviewChange?.((s) => alive && setStream(s));
    sync(source.status());
    source.connect().catch((err: unknown) => {
      // Not fatal here: the flow retries on entering Capture and shows the Error page there.
      console.warn('[kiosk] camera not available yet', err);
    });
    return () => {
      alive = false;
      unsubscribe();
      offPreview?.();
    };
  }, [source]);

  return { stream, status };
}
