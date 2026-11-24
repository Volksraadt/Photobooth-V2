import { useEffect } from 'react';

/**
 * Booth hardening in the browser. Tauri (later) does fullscreen/sleep natively; these keep the
 * browser build usable as a kiosk too.
 */
export function useKioskEnvironment(enabled: boolean): void {
  // Keep the screen awake (Screen Wake Lock API); re-acquire after the tab becomes visible again.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let disposed = false;
    const acquire = async () => {
      if (disposed || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch (err) {
        console.warn('[kiosk] wake lock unavailable', err);
      }
    };
    const onVisibility = () => void acquire();
    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.classList.add('pb-kiosk-mode');
    // Fullscreen needs a user gesture: enter it on the first touch, and again if it was left.
    const enterFullscreen = () => {
      if (!document.fullscreenElement && root.requestFullscreen) {
        root.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
      }
    };
    const preventMenu = (e: Event) => e.preventDefault();
    window.addEventListener('pointerdown', enterFullscreen, true);
    window.addEventListener('contextmenu', preventMenu);
    return () => {
      root.classList.remove('pb-kiosk-mode');
      window.removeEventListener('pointerdown', enterFullscreen, true);
      window.removeEventListener('contextmenu', preventMenu);
    };
  }, [enabled]);
}
