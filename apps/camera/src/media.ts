import { PREVIEW_ENCODING, type CameraFacing } from '@pb/capture/protocol';
import { isNative, nativeStill } from './native';

export type StillResult = {
  blob: Blob;
  width: number;
  height: number;
  /** How the still was made (shown on screen; only `stream-frame` is a preview-sized fallback). */
  method: 'image-capture' | 'native' | 'stream-frame';
};

type ImageCaptureLike = {
  takePhoto(settings?: { imageWidth?: number; imageHeight?: number }): Promise<Blob>;
  getPhotoCapabilities(): Promise<{
    imageWidth?: { max?: number };
    imageHeight?: { max?: number };
  }>;
};
declare const ImageCapture: { new (track: MediaStreamTrack): ImageCaptureLike } | undefined;

async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  const size = { width: bmp.width, height: bmp.height };
  bmp.close();
  return size;
}

/**
 * Camera of the tablet: a live track for the WebRTC preview and full-resolution stills.
 * Stills: ImageCapture.takePhoto at the sensor's max size (Android / Chrome), else the native
 * camera plugin (iOS), else — only in a plain browser without either — a frame from the track.
 */
export class CameraMedia {
  private stream: MediaStream | null = null;
  private facing: CameraFacing = 'back';
  private readonly listeners = new Set<(track: MediaStreamTrack | null) => void>();
  photoSize: { width: number; height: number } | null = null;

  get track(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  get currentFacing(): CameraFacing {
    return this.facing;
  }

  /** Fires whenever the live track is replaced (facing switch, native capture). */
  onTrack(listener: (track: MediaStreamTrack | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of [...this.listeners]) l(this.track);
  }

  async start(facing: CameraFacing = this.facing): Promise<void> {
    this.stop(false);
    this.facing = facing;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: facing === 'front' ? 'user' : 'environment',
        width: { ideal: PREVIEW_ENCODING.maxWidth },
        height: { ideal: PREVIEW_ENCODING.maxHeight },
        frameRate: { ideal: PREVIEW_ENCODING.maxFramerate },
      },
    });
    const track = this.track;
    if (track && 'contentHint' in track) track.contentHint = 'motion';
    await this.probePhotoSize();
    this.emit();
  }

  stop(emit = true) {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (emit) this.emit();
  }

  private async probePhotoSize() {
    const track = this.track;
    if (!track || typeof ImageCapture === 'undefined') return;
    try {
      const caps = await new ImageCapture(track).getPhotoCapabilities();
      if (caps.imageWidth?.max && caps.imageHeight?.max) {
        this.photoSize = { width: caps.imageWidth.max, height: caps.imageHeight.max };
      }
    } catch {
      this.photoSize = null;
    }
  }

  async still(): Promise<StillResult> {
    const track = this.track;
    if (track && typeof ImageCapture !== 'undefined') {
      try {
        const ic = new ImageCapture(track);
        const caps = await ic.getPhotoCapabilities().catch(() => null);
        const blob = await ic.takePhoto(
          caps?.imageWidth?.max && caps.imageHeight?.max
            ? { imageWidth: caps.imageWidth.max, imageHeight: caps.imageHeight.max }
            : undefined,
        );
        return { blob, ...(await imageSize(blob)), method: 'image-capture' };
      } catch (err) {
        console.warn('[camera] ImageCapture failed, falling back', err);
      }
    }
    if (isNative()) {
      // The native session needs the camera: release the preview track, shoot, restart preview.
      this.stop();
      try {
        const blob = await nativeStill(this.facing);
        return { blob, ...(await imageSize(blob)), method: 'native' };
      } finally {
        await this.start(this.facing);
      }
    }
    return this.streamFrame();
  }

  private async streamFrame(): Promise<StillResult> {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    await video.play();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    video.pause();
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        0.92,
      ),
    );
    return { blob, width: canvas.width, height: canvas.height, method: 'stream-frame' };
  }
}
