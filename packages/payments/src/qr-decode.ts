/** Decodes a QR image (PNG/JPEG) to its text payload. Node only (sharp + jsQR). */
export async function decodeQrImage(bytes: Uint8Array): Promise<string | null> {
  const [{ default: sharp }, { default: jsQR }] = await Promise.all([
    import('sharp'),
    import('jsqr'),
  ]);
  const { data, info } = await sharp(bytes)
    .flatten({ background: '#ffffff' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const result = jsQR(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    info.width,
    info.height,
  );
  return result?.data || null;
}
