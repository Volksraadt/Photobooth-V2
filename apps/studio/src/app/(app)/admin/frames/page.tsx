import type { PhotoSlot } from '@pb/schema';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { isPlatformAdmin } from '@/lib/entitlements';
import { LibraryFramesManager, type AdminLibraryFrame } from './library-frames-manager';

/** Platform admin: the frame library every owner can add to a booth (Editor → Frame → Pustaka). */
export default async function AdminFramesPage() {
  const user = await requireUser();
  if (!isPlatformAdmin(user)) notFound();
  const res = await apiFetch('/admin/library-frames');
  if (!res.ok) notFound();
  const { frames } = (await res.json()) as {
    frames: (Omit<AdminLibraryFrame, 'slots'> & { slots: PhotoSlot[] })[];
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-muted-foreground hover:underline">
          ← Admin platform
        </Link>
        <h1 className="text-2xl font-semibold">Pustaka frame bawaan</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Frame di sini bisa dipilih semua owner di editor (tab Frame → Pustaka). Unggah PNG strip
          600×1800 px (rasio 1:3) dengan lubang foto transparan; slot foto dideteksi otomatis dari
          area transparan. Menghapus atau menyembunyikan frame tidak mengubah booth yang sudah
          memakainya.
        </p>
      </div>
      <LibraryFramesManager frames={frames} />
    </div>
  );
}
