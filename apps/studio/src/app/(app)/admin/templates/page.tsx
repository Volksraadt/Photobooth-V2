import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { isPlatformAdmin } from '@/lib/entitlements';
import { TemplatesManager, type AdminTemplate } from './templates-manager';

/** Platform admin: booth templates owners choose from when creating a booth. */
export default async function AdminTemplatesPage() {
  const user = await requireUser();
  if (!isPlatformAdmin(user)) notFound();
  const res = await apiFetch('/admin/templates');
  if (!res.ok) notFound();
  const { templates } = (await res.json()) as { templates: AdminTemplate[] };
  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-muted-foreground hover:underline">
          ← Admin platform
        </Link>
        <h1 className="text-2xl font-semibold">Template booth</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Template tampil di galeri saat owner membuat booth baru. Untuk menambah template, buka
          booth yang desainnya sudah jadi lalu pilih <b>Simpan sebagai template</b> (hanya terlihat
          oleh admin platform). Template bawaan bisa disembunyikan, tetapi tidak dihapus.
        </p>
      </div>
      <TemplatesManager templates={templates} />
    </div>
  );
}
