import QRCode from 'qrcode';

/** QR quiet zone in modules (renderer and compositor draw the same). */
export const QR_QUIET_ZONE = 2;

/** SVG path of the QR modules (1 unit = 1 module), plus the module count. */
export function qrPath(text: string): { size: number; d: string } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const { size, data } = qr.modules;
  let d = '';
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (data[y * size + x]) {
        const start = x;
        while (x < size && data[y * size + x]) x++;
        d += `M${start} ${y}h${x - start}v1h${start - x}z`;
      } else {
        x++;
      }
    }
  }
  return { size, d };
}
