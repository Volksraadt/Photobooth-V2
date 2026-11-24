import { Capacitor } from '@capacitor/core';
import type { CameraFacing } from '@pb/capture/protocol';

/**
 * Native plugins (Capacitor). Every call degrades gracefully in a plain browser (dev: a laptop
 * tab can act as the tablet for testing).
 */

export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => Capacitor.getPlatform(); // 'ios' | 'android' | 'web'

/** Keeps the screen on while the app is in use. */
export async function keepAwake(): Promise<void> {
  if (isNative()) {
    const { KeepAwake } = await import('@capacitor-community/keep-awake');
    await KeepAwake.keepAwake().catch(() => undefined);
    return;
  }
  try {
    await (
      navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<unknown> } }
    ).wakeLock?.request('screen');
  } catch {
    // Not allowed without a gesture; retried on the next tap.
  }
}

export type OrientationLock = 'landscape' | 'portrait' | 'any';

export async function lockOrientation(lock: OrientationLock): Promise<void> {
  try {
    if (isNative()) {
      const { ScreenOrientation } = await import('@capacitor/screen-orientation');
      if (lock === 'any') await ScreenOrientation.unlock();
      else await ScreenOrientation.lock({ orientation: lock });
      return;
    }
    const so = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
      unlock?: () => void;
    };
    if (lock === 'any') so.unlock?.();
    else await so.lock?.(lock);
  } catch {
    // Browsers only allow locking in fullscreen; ignore.
  }
}

/**
 * Full-resolution still with the native camera (iOS has no web API for this). The camera can
 * only be opened by one session: the caller stops its getUserMedia track before and restarts it
 * after. Returns a JPEG.
 */
export async function nativeStill(facing: CameraFacing): Promise<Blob> {
  const { CameraPreview } = await import('@capacitor-community/camera-preview');
  await CameraPreview.start({
    position: facing === 'front' ? 'front' : 'rear',
    toBack: true,
    disableAudio: true,
    enableHighResolution: true,
    disableExifHeaderStripping: false,
  });
  try {
    const { value } = await CameraPreview.capture({ quality: 92 });
    const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: 'image/jpeg' });
  } finally {
    await CameraPreview.stop().catch(() => undefined);
  }
}

/** Key/value storage that survives app restarts (Preferences on device, localStorage on web). */
export const prefs = {
  async get(key: string): Promise<string | null> {
    if (isNative()) {
      const { Preferences } = await import('@capacitor/preferences');
      return (await Preferences.get({ key })).value;
    }
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string | null): Promise<void> {
    if (isNative()) {
      const { Preferences } = await import('@capacitor/preferences');
      if (value === null) await Preferences.remove({ key });
      else await Preferences.set({ key, value });
      return;
    }
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // storage blocked
    }
  },
};
