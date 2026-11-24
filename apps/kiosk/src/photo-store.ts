import type { CapturedImage } from '@pb/capture';
import type { ShotPhoto } from '@pb/flow';

export type StoredPhoto = ShotPhoto & {
  sessionId: string;
  slotIndex: number;
  takeNumber: number;
  /** null when the file lives in the local agent (`url` points there). */
  blob: Blob | null;
  mimeType: string;
  capturedAt: string;
};

/**
 * Photos of the running session. The flow machine only holds ids + URLs: with an agent the
 * files are on its disk (agent URLs); without one, blobs stay here as object URLs (F1).
 */
export class PhotoStore {
  private readonly photos = new Map<string, StoredPhoto>();

  /** A still already stored by the local agent (tablet capture or uploaded webcam shot). */
  addStored(
    sessionId: string,
    slotIndex: number,
    takeNumber: number,
    stored: {
      photoId: string;
      url: string;
      width: number;
      height: number;
      mimeType: string;
      capturedAt: string;
    },
  ): ShotPhoto {
    this.photos.set(stored.photoId, {
      id: stored.photoId,
      url: stored.url,
      width: stored.width,
      height: stored.height,
      sessionId,
      slotIndex,
      takeNumber,
      blob: null,
      mimeType: stored.mimeType,
      capturedAt: stored.capturedAt,
    });
    return { id: stored.photoId, url: stored.url, width: stored.width, height: stored.height };
  }

  add(
    sessionId: string,
    slotIndex: number,
    takeNumber: number,
    image: CapturedImage & { blob: Blob },
  ): ShotPhoto {
    const id = `${sessionId}-s${slotIndex}-t${takeNumber}`;
    const url = URL.createObjectURL(image.blob);
    this.photos.set(id, {
      id,
      url,
      width: image.width,
      height: image.height,
      sessionId,
      slotIndex,
      takeNumber,
      blob: image.blob,
      mimeType: image.mimeType,
      capturedAt: image.capturedAt,
    });
    return { id, url, width: image.width, height: image.height };
  }

  forSession(sessionId: string): StoredPhoto[] {
    return [...this.photos.values()].filter((p) => p.sessionId === sessionId);
  }

  /** Drops blobs + object URLs (after the session is persisted or abandoned). */
  release(sessionId: string): void {
    for (const photo of this.forSession(sessionId)) {
      if (photo.blob) URL.revokeObjectURL(photo.url);
      this.photos.delete(photo.id);
    }
  }
}
