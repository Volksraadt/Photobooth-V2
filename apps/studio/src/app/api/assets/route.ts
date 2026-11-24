import { createHash } from 'node:crypto';
import { insertAsset } from '@pb/db';
import { NextResponse } from 'next/server';
import { toAssetItem } from '@/lib/assets';
import { getCurrentUser } from '@/lib/auth';
import { asUser, requireOrg } from '@/lib/org';
import { assetStorage } from '@/lib/storage';

const MAX_BYTES: Record<string, number> = {
  image: 15 * 1024 * 1024,
  video: 80 * 1024 * 1024,
  font: 5 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
};

const EXT_KIND: Record<string, ['image' | 'video' | 'font' | 'audio', string]> = {
  png: ['image', 'image/png'],
  jpg: ['image', 'image/jpeg'],
  jpeg: ['image', 'image/jpeg'],
  webp: ['image', 'image/webp'],
  gif: ['image', 'image/gif'],
  svg: ['image', 'image/svg+xml'],
  mp4: ['video', 'video/mp4'],
  webm: ['video', 'video/webm'],
  ttf: ['font', 'font/ttf'],
  otf: ['font', 'font/otf'],
  woff: ['font', 'font/woff'],
  woff2: ['font', 'font/woff2'],
  mp3: ['audio', 'audio/mpeg'],
  m4a: ['audio', 'audio/mp4'],
  ogg: ['audio', 'audio/ogg'],
  wav: ['audio', 'audio/wav'],
};

/** Upload one asset file for the active org: sha256 + size computed here, row via RLS. */
export async function POST(req: Request) {
  if (!(await getCurrentUser()))
    return NextResponse.json({ error: 'Belum masuk.' }, { status: 401 });
  const { user, org } = await requireOrg();
  if (org.role === 'operator') {
    return NextResponse.json({ error: 'Operator tidak dapat mengunggah aset.' }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File))
    return NextResponse.json({ error: 'File tidak ada.' }, { status: 400 });

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const kindInfo = EXT_KIND[ext];
  if (!kindInfo) {
    return NextResponse.json({ error: `Jenis file .${ext} tidak didukung.` }, { status: 400 });
  }
  const [kind, mimeType] = kindInfo;
  if (file.size > MAX_BYTES[kind]!) {
    return NextResponse.json(
      { error: `File terlalu besar (maks ${Math.round(MAX_BYTES[kind]! / 1024 / 1024)} MB).` },
      { status: 413 },
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const stored = await assetStorage().put(`${org.id}/${sha256}.${ext}`, bytes, mimeType);
  const num = (name: string) => {
    const v = Number(form?.get(name));
    return Number.isInteger(v) && v > 0 && v < 100_000 ? v : null;
  };
  const row = await asUser(user, (tx) =>
    insertAsset(tx, {
      orgId: org.id,
      kind,
      name: file.name.slice(0, 200),
      mimeType,
      storagePath: stored.url,
      sha256,
      bytes: bytes.byteLength,
      width: num('width'),
      height: num('height'),
    }),
  );
  return NextResponse.json({ asset: toAssetItem(row) }, { status: 201 });
}
