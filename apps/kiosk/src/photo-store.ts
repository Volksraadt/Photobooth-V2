import type { CapturedImage } from '@pb/capture';
import type { ShotPhoto } from '@pb/flow';

export type StoredPhoto = ShotPhoto & {
  sessionId: string;
  slotIndex: number;
  takeNumber: number;
  blob: Blob;
  mimeType: string;
  capturedAt: string;
};

/** In-memory blobs of the running session; the flow machine only holds ids + object URLs. */
export class PhotoStore {
  private readonly photos = new Map<string, StoredPhoto>();

  add(sessionId: string, slotIndex: number, takeNumber: number, image: CapturedImage): ShotPhoto {
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
      URL.revokeObjectURL(photo.url);
      this.photos.delete(photo.id);
    }
  }
}
