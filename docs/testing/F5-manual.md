# F5 — Langkah setup Google Cloud dan uji manual (output + Google Drive)

Uji ini melengkapi test otomatis. Yang sudah otomatis (tanpa akun Google): `pnpm test` (pipeline
lengkap di `apps/worker/src/pipeline.test.ts`, antrian unggah agent di `apps/agent/src/uploads.test.ts`,
klien Drive di `packages/drive`) dan e2e sistem penuh `apps/studio/e2e/session-to-drive.spec.ts` +
`drive.spec.ts` (Studio, API, worker, agent, Kiosk, dengan Google tiruan). Dokumen ini untuk
**Google sungguhan** dan **perangkat sungguhan**. Catat hasil (lolos/gagal, waktu, catatan) di kolom
paling kanan setiap tabel.

## 0. Cara cepat tanpa Google Cloud (Google tiruan)

Berguna untuk melihat seluruh alur lebih dulu, atau melatih langkah §3–§5 tanpa akun Google.

1. Terminal 1: `pnpm --filter @pb/drive fake` (server tiruan di `http://127.0.0.1:9099`).
2. Terminal 2, dari root repo:
   ```bash
   GOOGLE_CLIENT_ID=fake GOOGLE_CLIENT_SECRET=fake \
   PB_GOOGLE_BASE_URL=http://127.0.0.1:9099 PB_PUBLIC_API_URL=http://localhost:8787 pnpm dev
   ```
   (PowerShell: `$env:GOOGLE_CLIENT_ID='fake'; …; pnpm dev`.) `SECRET_MASTER_KEY` harus terisi di `.env`.
   Log API harus menampilkan `[api] drive: configured`, log worker `[worker] … drive: configured`.
3. Studio → Integrasi → **Hubungkan Google Drive**: layar persetujuan langsung disetujui. File yang
   "diunggah" hanya ada di memori server tiruan; untuk membuat kondisi "akses dicabut":
   `curl -X POST http://127.0.0.1:9099/__revoke`.

## 1. Setup proyek Google Cloud (sekali, oleh pemilik platform)

Lakukan dengan akun Google yang akan menjadi pemilik aplikasi (bukan akun owner booth).

1. Buka <https://console.cloud.google.com/> → pilih/buat project, mis. `photobooth-platform-dev`.
2. **APIs & Services → Library** → cari **Google Drive API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding/Audience):
   - User type **External**. Isi nama aplikasi, email dukungan, email kontak developer.
   - **Data access / Scopes**: tambahkan **hanya** `https://www.googleapis.com/auth/drive.file`
     ("See, edit, create, and delete only the specific Google Drive files you use with this app").
     Jangan tambahkan scope lain: `drive`, `drive.readonly`, `drive.metadata` termasuk *restricted*
     dan memicu security assessment.
   - **Audience**: selama pengembangan biarkan **Testing** dan tambahkan email Google yang akan
     dipakai menguji sebagai **Test users**. Catatan: di status Testing refresh token **kedaluwarsa
     setelah 7 hari** (owner harus menghubungkan ulang). Untuk dipakai owner sungguhan, ubah ke
     **In production** (butuh URL kebijakan privasi dan ketentuan layanan; scope `drive.file` tidak
     memerlukan verifikasi restricted). Lihat open-questions #30.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type **Web application**, nama mis. `photobooth-api-dev`.
   - **Authorized redirect URIs**: `http://localhost:8787/oauth/google/callback`
     (untuk server nyata: `https://<domain-api>/oauth/google/callback`; harus sama persis dengan
     `GOOGLE_REDIRECT_URI`, atau `<PB_PUBLIC_API_URL>/oauth/google/callback` bila tidak diisi).
   - Simpan **Client ID** dan **Client secret**.
5. Isi `.env` (jangan di-commit; lihat `.env.example`):
   ```
   GOOGLE_CLIENT_ID=…apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=…
   PB_PUBLIC_API_URL=http://localhost:8787
   PB_STUDIO_URL=http://localhost:3000
   SECRET_MASTER_KEY=<32 byte base64>   # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Kosongkan `PB_GOOGLE_BASE_URL` (itu hanya untuk Google tiruan).
6. `pnpm dev` (menjalankan Postgres lokal, Studio, API, **worker**, agent, Kiosk). Log harus
   menampilkan `[api] drive: configured` dan `[worker] … drive: configured`.

## 2. Hubungkan Google Drive (Studio → Integrasi)

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 2.1 | Masuk Studio sebagai owner, buka **Integrasi** | Kartu **Google Drive** muncul dengan tombol "Hubungkan Google Drive" dan keterangan izin `drive.file` | |
| 2.2 | Klik **Hubungkan Google Drive** | Browser ke layar persetujuan Google. Layar menyebut izin terbatas pada file yang digunakan dengan aplikasi ini ("only the specific Google Drive files you use with this app"; redaksi bisa berbeda), bukan seluruh Drive | |
| 2.3 | Setujui dengan akun uji | Kembali ke Studio `/integrations?drive=connected`, banner "Google Drive terhubung"; kartu menampilkan email akun, status **terhubung**, folder root **Photobooth** | |
| 2.4 | Buka drive.google.com akun itu | Ada folder **Photobooth** (dibuat aplikasi) | |
| 2.5 | Di Studio buat folder baru "Booth Uji" lewat **Atau buat folder baru** | "Folder root disimpan"; kartu menampilkan "Booth Uji" (tautan membuka folder di Drive) | |
| 2.6 | **Tes koneksi** | "Terhubung ke Google Drive (email)" | |
| 2.7 | Lihat sumber halaman / tab Network browser | Tidak ada refresh token atau client secret di halaman maupun respons | |
| 2.8 | Di DB (`select encrypted_refresh_token from drive_connections`) | Berawalan `v1.` (terenkripsi), bukan token mentah | |
| 2.9 | Masuk sebagai anggota **operator** | Kartu Drive tidak tampil / Integrasi menolak: hanya owner/manager | |
| 2.10 | Tolak persetujuan di layar Google (klik Batal) | Kembali ke Studio dengan pesan "Izin Google Drive tidak diberikan" | |

## 3. Sesi lengkap (online) → folder Drive (kriteria 1 dan 2)

Siapkan: booth dipublish, Kiosk terpasang (lihat `docs/testing/F4-manual.md` §0), mode event atau
voucher agar tidak perlu bayar. Jam tangan/stopwatch siap. Kamera: tablet (F3) atau webcam.

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 3.1 | Jalankan satu sesi penuh: Cover → … → 4 foto → Review (pilih filter selain default) → Selesai. Mulai stopwatch saat menekan Selesai | Halaman Result menampilkan QR; cetakan keluar | |
| 3.2 | Pindai QR **di layar Result** dengan ponsel | Terbuka `<API>/s/<KODE>`: "Foto Anda sedang diproses" (auto-refresh) atau langsung folder Drive | |
| 3.3 | Tunggu halaman terbuka sendiri | Berpindah ke folder Google Drive sesi. **Waktu dari 3.1 < 2 menit** (catat: ____ dtk) | |
| 3.4 | Di folder: struktur | `Booth/…/<YYYY-MM-DD>/<KODE>/` berisi tepat 6 subfolder: `original`, `mirrored`, `filtered`, `composite`, `gif`, `video` | |
| 3.5 | `original/` | 4 file `<KODE>-fotoN.jpg`, tanpa mirror, resolusi penuh kamera | |
| 3.6 | `mirrored/` | 4 file `…-mirror.jpg`; kiri-kanan terbalik dibanding original | |
| 3.7 | `filtered/` | 4 file `…-filter.jpg` dengan filter yang dipilih di Review (sama dengan tampilan Review) | |
| 3.8 | `composite/` | 1 file `<KODE>-strip.jpg` 600×1800, sama dengan strip yang dicetak (termasuk QR) | |
| 3.9 | `gif/` | `<KODE>.gif` beranimasi, 4 frame, jeda sesuai `frameDelayMs` | |
| 3.10 | `video/` | `<KODE>.mp4` 1080×1920 (9:16), 3 foto 16:9 masing-masing `secondsPerPhoto` dtk, bisa diputar di ponsel | |
| 3.11 | Pindai QR **di cetakan** | Membuka folder Drive yang **sama persis** dengan 3.2 | |
| 3.12 | Buka link folder di jendela penyamaran / akun Google lain | Bisa dilihat tanpa login ("siapa pun dengan link: pembaca"), tidak bisa diubah | |
| 3.13 | Studio → booth → **Transaksi** | Kolom File sesi itu: "Terkirim ke Drive" (tautan ke folder) | |
| 3.14 | Folder data agent (`.data/agent/sessions/…` di dev; `%APPDATA%\photobooth-agent\sessions` di Windows) | Folder sesi itu sudah **tidak ada** (dihapus setelah upload terkonfirmasi) | |

## 4. Sesi offline (kriteria 3)

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 4.1 | Putuskan internet laptop booth (cabut Wi-Fi). Kiosk menampilkan opsi voucher/tunai (QRIS tersembunyi) | Sesuai F4 | |
| 4.2 | Jalankan sesi penuh dengan voucher/tunai | Sesi selesai dan **tercetak**; QR di cetakan ada | |
| 4.3 | Pindai QR di cetakan dengan ponsel (internet ponsel hidup) | Halaman rapi "Link tidak ditemukan … jika booth sedang tanpa internet, foto muncul begitu booth tersambung" (bukan error server) | |
| 4.4 | Mode admin Kiosk / `GET http://127.0.0.1:47810/status` | `uploads.pending` ≥ 1; file sesi masih ada di disk agent | |
| 4.5 | Sambungkan lagi internet | Dalam ±1 menit: halaman Studio → Transaksi menampilkan sesi (ditandai offline) lalu "Terkirim ke Drive" | |
| 4.6 | Muat ulang halaman dari 4.3 / pindai lagi QR cetakan | Sekarang mengarah ke folder Drive sesi itu, isi 6 subfolder | |
| 4.7 | Ulangi 4.2 sebanyak 3 sesi sebelum menyambung | Ketiganya terunggah berurutan tanpa ada yang hilang atau ganda (Drive: 3 folder kode berbeda) | |
| 4.8 | Putuskan internet **di tengah unggah** (saat file besar naik) | Tidak ada file lokal yang hilang; setelah tersambung unggahan dilanjutkan, tanpa file ganda di Drive | |

## 5. Akses Drive dicabut dan error lain (kriteria 4)

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 5.1 | Buka <https://myaccount.google.com/permissions> dengan akun owner → pilih aplikasi → **Hapus akses** | Akses dicabut | |
| 5.2 | Jalankan satu sesi penuh | Sesi, cetak, dan Result berjalan normal untuk pembeli | |
| 5.3 | Studio → Transaksi (tunggu ±30 dtk) | Kolom File sesi itu **Gagal** dengan teks "Akses Google Drive dicabut. Hubungkan ulang di menu Integrasi." dan tombol **Coba lagi** | |
| 5.4 | Studio → Integrasi | Status Drive "akses dicabut" + tombol **Hubungkan ulang Google Drive** | |
| 5.5 | Server: file sesi masih ada | `.data/storage/<org>/sessions/<sesi>/…` berisi original/mirrored/filtered/composite/gif/video | |
| 5.6 | Pindai QR sesi itu | Halaman "sedang diproses" (bukan error); pembeli tidak melihat pesan teknis | |
| 5.7 | **Hubungkan ulang Google Drive** (setujui) | Kembali dengan "terhubung"; job yang gagal berjalan sendiri; Transaksi → "Terkirim ke Drive"; QR membuka folder | |
| 5.8 | Kosongkan kuota Drive (atau pakai akun yang penuh) lalu jalankan sesi | Gagal dengan "Penyimpanan Google Drive penuh…"; setelah ruang ada, **Coba lagi** berhasil | |
| 5.9 | Hapus folder root di drive.google.com (pindah ke sampah) lalu sesi baru | Gagal "Folder di Google Drive tidak ditemukan…"; Integrasi → buat folder baru → job otomatis lanjut | |
| 5.10 | Putuskan Drive di Studio (**Putuskan**) lalu sesi baru | Gagal "Google Drive belum terhubung…"; setelah dihubungkan, otomatis lanjut | |

## 6. Redis / BullMQ (opsional, untuk deploy dengan Redis)

BullMQ belum diuji dengan Redis sungguhan di mesin dev (open-questions #33).

1. Jalankan Redis (`redis-server`, atau Docker `docker run -p 6379:6379 redis:7`), set `REDIS_URL=redis://localhost:6379` untuk **API dan worker**.
2. Log memuat `queue: bullmq`. Jalankan satu sesi: waktu dari `complete` sampai worker mulai < 1 dtk (bukan menunggu polling 30 dtk; lihat log `[worker] … outputs ready`).
3. Matikan Redis saat sesi berjalan: sesi tetap selesai lewat polling (≤ 30 dtk), tidak ada job tertinggal.

## 7. Watermark (plan)

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 7.1 | Org plan **Pro/Business** (default trial Pro): sesi baru | Tidak ada watermark di semua subfolder | |
| 7.2 | Ubah plan org ke **Starter**: `update subscriptions set plan_id = (select id from plans where code = 'starter') where org_id = '<org>'` lalu sesi baru | Badge kecil `photobooth-platform` di kanan bawah `mirrored/`, `filtered/`, `composite/`, frame GIF dan video; `original/` tetap bersih; cetakan di booth tidak berubah | |

## 8. Catatan setelah uji

- Hapus data uji: folder uji di Drive, `.data/storage`, dan akses aplikasi di myaccount.google.com/permissions.
- Bila ada temuan, tulis di `docs/open-questions.md` dan `docs/decisions.md`.
