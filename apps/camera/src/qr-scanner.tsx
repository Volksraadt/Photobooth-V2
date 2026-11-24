import jsQR from 'jsqr';
import { useEffect, useRef, useState } from 'react';

/**
 * Scans a QR code from the camera (jsQR on video frames; works the same in the Capacitor
 * WebView and in a browser). Calls `onResult` once per distinct value.
 */
export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let alive = true;
    let last = '';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      const video = videoRef.current;
      if (!alive || !video || !ctx) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const w = Math.min(960, video.videoWidth);
        const h = Math.round((video.videoHeight / video.videoWidth) * w);
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, {
          inversionAttempts: 'dontInvert',
        });
        if (code?.data && code.data !== last) {
          last = code.data;
          onResult(code.data);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false })
      .then((s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const video = videoRef.current!;
        video.srcObject = s;
        void video.play();
        raf = requestAnimationFrame(tick);
      })
      .catch((err: unknown) => setError(`Kamera tidak bisa dibuka: ${String(err)}`));
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div className="scanner">
      <video ref={videoRef} muted playsInline className="scanner-video" />
      <div className="scanner-frame" />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
