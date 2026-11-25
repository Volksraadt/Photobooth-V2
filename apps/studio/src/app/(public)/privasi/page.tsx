import Link from 'next/link';
import type { ReactNode } from 'react';
import { operatorName, storageRetentionDays, supportEmail } from '@/lib/public-info';

export const metadata = {
  title: 'Kebijakan Privasi — Photobooth Studio',
  description:
    'Data apa yang diproses Photobooth Studio, termasuk data Google Drive, dan untuk apa.',
};

const EFFECTIVE = '26 November 2026';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

/**
 * Privacy policy (public; linked from the Google OAuth consent screen). Keep it in line with what
 * the system actually does: data flows in docs/architecture.md, Drive scope in packages/drive.
 */
export default function PrivacyPage() {
  const email = supportEmail();
  const operator = operatorName();
  const contact = email ? (
    <a href={`mailto:${email}`} className="underline">
      {email}
    </a>
  ) : (
    'kontak pengelola yang tercantum di halaman Tentang'
  );
  return (
    <article className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Kebijakan Privasi</h1>
        <p className="text-sm text-muted-foreground">
          Berlaku sejak {EFFECTIVE}. Pengelola: {operator}.
        </p>
      </header>

      <Section title="1. Ringkasan">
        <p>
          Photobooth Studio (&ldquo;Studio&rdquo;) membantu pemilik usaha photobooth menjalankan
          booth: desain, pembayaran, cetak, dan pengiriman hasil foto ke pembeli. Kami hanya
          memproses data yang dibutuhkan untuk menjalankan layanan itu, tidak menjual data, dan
          tidak memakainya untuk iklan.
        </p>
      </Section>

      <Section title="2. Data yang kami proses">
        <p>
          <b>Pemilik dan tim booth (pengguna Studio):</b> alamat e-mail akun (juga dari login Google
          bila dipakai), nama organisasi dan booth, desain dan pengaturan booth, voucher, perangkat
          booth yang dipasang (nama perangkat dan nama komputer), riwayat aktivitas (log audit),
          serta kredensial Midtrans milik pemilik yang disimpan terenkripsi.
        </p>
        <p>
          <b>Pembeli di booth:</b> foto, GIF, dan video yang diambil di booth, serta catatan sesi
          (kode sesi, waktu, frame dan filter, metode dan nominal pembayaran, jumlah cetak). Studio
          tidak meminta nama, nomor telepon, atau e-mail pembeli. Sebelum mulai, pembeli diberi tahu
          bahwa fotonya disimpan dan diunggah agar dapat diunduh.
        </p>
        <p>
          <b>Pembayaran:</b> pembayaran QRIS diproses oleh Midtrans langsung ke akun Midtrans milik
          pemilik booth. Studio menyimpan status, nominal, dan nomor referensi transaksi, bukan data
          kartu, rekening, atau dompet digital pembeli.
        </p>
      </Section>

      <Section title="3. Data Google (Google Drive)">
        <p>
          Bila pemilik booth menghubungkan Google Drive, Studio meminta izin{' '}
          <code>https://www.googleapis.com/auth/drive.file</code> dan membaca alamat e-mail akun
          Google tersebut untuk menampilkan akun mana yang terhubung. Dengan izin{' '}
          <code>drive.file</code>, Studio <b>hanya</b> dapat melihat dan mengubah folder serta file
          yang dibuatnya sendiri; Studio tidak dapat membaca file lain di Drive pemilik.
        </p>
        <p>Data Google dipakai hanya untuk:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            membuat folder booth, tanggal, dan sesi di Drive pemilik, lalu mengunggah file sesi;
          </li>
          <li>
            membagikan folder sesi sebagai &ldquo;siapa saja yang memiliki link dapat
            melihat&rdquo;, supaya pembeli bisa mengunduh fotonya lewat QR;
          </li>
          <li>menampilkan status koneksi dan folder root di Studio kepada pemilik.</li>
        </ul>
        <p>
          Penggunaan dan pemindahan informasi yang diterima dari Google API mematuhi{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , termasuk ketentuan <i>Limited Use</i>. Data Google tidak dijual, tidak dipakai untuk
          iklan, tidak dipakai untuk melatih model AI, dan tidak dibaca manusia kecuali dengan
          persetujuan pemilik, untuk keamanan, atau bila diwajibkan hukum.
        </p>
        <p>
          Token akses Google disimpan terenkripsi di server. Pemilik dapat memutus koneksi kapan
          saja di Studio (Integrasi → Putuskan) atau di{' '}
          <a
            href="https://myaccount.google.com/permissions"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            pengaturan akun Google
          </a>
          ; file yang sudah ada di Drive tetap milik pemilik dan tidak dihapus oleh Studio.
        </p>
      </Section>

      <Section title="4. Di mana data disimpan dan berapa lama">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Laptop booth:</b> file sesi disimpan dulu di perangkat booth dan dihapus setelah
            unggahan terkonfirmasi.
          </li>
          <li>
            <b>Penyimpanan platform</b> (Supabase, Singapura): salinan file sesi untuk diproses
            (strip, GIF, video), dihapus otomatis setelah sekitar {storageRetentionDays()} hari.
          </li>
          <li>
            <b>Google Drive pemilik booth:</b> hasil akhir untuk pembeli, dikelola sepenuhnya oleh
            pemilik booth.
          </li>
          <li>
            <b>Basis data</b> (Supabase, Singapura): data akun, booth, dan catatan transaksi,
            disimpan selama akun aktif atau selama diperlukan untuk kewajiban pencatatan.
          </li>
        </ul>
        <p>
          Server aplikasi berjalan di Vercel (Singapura). Pembayaran diproses Midtrans. Pihak-pihak
          ini memproses data hanya untuk menjalankan layanan.
        </p>
      </Section>

      <Section title="5. Keamanan">
        <p>
          Koneksi memakai HTTPS. Kredensial pembayaran dan token Google disimpan terenkripsi dan
          tidak pernah dikirim ke perangkat booth. Data tiap organisasi dipisahkan di tingkat basis
          data, dan setiap perubahan penting dicatat di log audit.
        </p>
      </Section>

      <Section title="6. Hak Anda">
        <p>
          Sesuai peraturan pelindungan data pribadi yang berlaku (termasuk UU No. 27 Tahun 2022),
          Anda dapat meminta akses, perbaikan, atau penghapusan data pribadi Anda, serta menarik
          persetujuan. Pembeli yang ingin fotonya dihapus dapat menghubungi pemilik booth tempat
          foto diambil, atau kami melalui {contact}.
        </p>
      </Section>

      <Section title="7. Cookie">
        <p>
          Studio hanya memakai cookie yang diperlukan untuk login dan memilih organisasi aktif.
          Tidak ada cookie iklan atau pelacak pihak ketiga.
        </p>
      </Section>

      <Section title="8. Perubahan dan kontak">
        <p>
          Kebijakan ini dapat diperbarui; tanggal berlaku di atas akan diubah. Pertanyaan tentang
          privasi: {contact}.
        </p>
        <p>
          <Link href="/tentang" className="underline">
            Kembali ke halaman Tentang
          </Link>
        </p>
      </Section>
    </article>
  );
}
