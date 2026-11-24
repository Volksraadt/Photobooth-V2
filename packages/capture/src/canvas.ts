import { CaptureError } from './types';

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new CaptureError('capture-failed', 'Gagal menyimpan foto.')),
      mimeType,
      quality,
    );
  });
}
