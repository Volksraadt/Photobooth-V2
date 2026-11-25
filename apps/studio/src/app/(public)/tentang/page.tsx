import { Button } from '@pb/ui';
import Link from 'next/link';
import { operatorName, supportEmail } from '@/lib/public-info';

export const metadata = {
  title: 'Photobooth Studio — tentang layanan',
  description:
    'Desain dan kelola photobooth Anda: pembayaran QRIS, voucher, cetak, dan unduhan lewat Google Drive.',
};

/** Public home page (also the "Application home page" of the Google OAuth consent screen). */
export default function AboutPage() {
  const email = supportEmail();
  return (
    <article className="space-y-6">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold">Photobooth Studio</h1>
        <p className="text-muted-foreground">
          Layanan untuk pemilik usaha photobooth: rancang tampilan booth sendiri, terima pembayaran
          pembeli, cetak foto, dan kirim hasilnya ke pembeli lewat QR.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/login">Masuk ke Studio</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/privasi">Kebijakan Privasi</Link>
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Apa yang bisa dilakukan</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Editor desain booth: halaman, frame foto, filter, harga, dan alur.</li>
          <li>
            Pembayaran pembeli lewat QRIS (Midtrans, langsung ke akun milik pemilik booth), voucher,
            atau tunai.
          </li>
          <li>Kamera, hitung mundur, cetak, serta GIF dan video otomatis.</li>
          <li>
            Hasil foto disimpan ke Google Drive milik pemilik booth; pembeli mengunduhnya lewat QR.
          </li>
          <li>Rekap penjualan, transaksi, perangkat, dan langganan.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Google Drive</h2>
        <p className="text-sm">
          Studio meminta izin Google Drive <code>drive.file</code>: aplikasi hanya dapat membuat dan
          mengakses folder serta file yang dibuatnya sendiri di Drive pemilik booth (folder sesi
          foto), bukan file lain di Drive tersebut. Rinciannya ada di{' '}
          <Link href="/privasi" className="underline">
            Kebijakan Privasi
          </Link>
          .
        </p>
      </section>

      <section className="space-y-1 text-sm text-muted-foreground">
        <p>Dikelola oleh {operatorName()}.</p>
        {email && (
          <p>
            Kontak:{' '}
            <a href={`mailto:${email}`} className="underline">
              {email}
            </a>
          </p>
        )}
      </section>
    </article>
  );
}
