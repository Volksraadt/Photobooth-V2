import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { isPlatformAdmin } from '@/lib/entitlements';
import { requireOrg } from '@/lib/org';
import { assetStorage } from '@/lib/storage';

const TYPES: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Platform admin: store a frame overlay file for the frame library. Only the file goes here; the
 * library row is created through the API (POST /admin/library-frames) with the detected slots.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Belum masuk.' }, { status: 401 });
  if (!isPlatformAdmin(user))
    return NextResponse.json({ error: 'Hanya admin platform.' }, { status: 403 });
  // Stored under the admin's own org path so the same storage policies apply as for uploads.
  const { org } = await requireOrg();
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File))
    return NextResponse.json({ error: 'File tidak ada.' }, { status: 400 });
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mimeType = TYPES[ext];
  if (!mimeType)
    return NextResponse.json(
      { error: 'Frame harus PNG, WebP, atau SVG (dengan area foto transparan).' },
      { status: 400 },
    );
  if (file.size > MAX_BYTES)
    return NextResponse.json({ error: 'File terlalu besar (maks 15 MB).' }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const stored = await assetStorage().put(`${org.id}/library/${sha256}.${ext}`, bytes, mimeType);
  return NextResponse.json(
    { url: stored.url, sha256, bytes: bytes.byteLength, mimeType },
    { status: 201 },
  );
}
