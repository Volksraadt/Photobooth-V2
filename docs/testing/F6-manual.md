# F6 — Langkah uji manual (rekap, perangkat, langganan)

Test otomatis yang sudah ada: `pnpm test` (rekap + zona waktu + view di `packages/db/src/report-repo.test.ts`,
siklus langganan di `billing-repo.test.ts`, checkout + webhook platform di `apps/api/src/billing.test.ts`,
ekspor di `apps/studio/src/lib/xlsx.test.ts`) dan e2e sistem penuh `apps/studio/e2e/f6.spec.ts`
(Postgres sungguhan, provider langganan tiruan). Dokumen ini untuk **akun Midtrans platform sungguhan**
dan pemeriksaan visual. Catat hasil (lolos/gagal, catatan) di kolom paling kanan tiap tabel.

## 0. Persiapan

1. `.env` (lihat `.env.example`): `SECRET_MASTER_KEY`, `PB_PUBLIC_API_URL`, dan variabel F6 di bawah.
2. Admin platform: `PB_PLATFORM_ADMINS=email-anda@contoh.com` (e-mail akun Studio yang akan menjadi admin).
3. `pnpm dev` (worker ikut berjalan: menyegarkan view `daily_booth_stats` tiap menit dan menjalankan siklus
   langganan tiap jam). Log worker menampilkan `[worker] storage: …`; log API menampilkan
   `[api] subscription billing: <mode>`.

### Tanpa akun Midtrans platform (provider tiruan)

`PB_BILLING_PROVIDER=mock pnpm dev`. Bayar tagihan dengan
`curl -X POST http://localhost:8787/dev/billing/invoices/<ID_TAGIHAN>/simulate-paid`
(ID tagihan ada di tabel `billing_invoices`). Ditolak di production.

### Dengan akun Midtrans platform (sandbox)

Akun ini **milik platform**, bukan milik owner booth. Dana langganan masuk ke sini; dana pembeli booth tetap ke
akun Midtrans masing-masing owner (Studio → Integrasi).

1. Daftar/masuk <https://dashboard.sandbox.midtrans.com> dengan akun perusahaan platform. Pastikan QRIS aktif
   (Settings → Payment → QRIS/GoPay).
2. Settings → Access Keys → salin **Server Key** sandbox.
3. `.env` server API **dan** worker: `PB_BILLING_MIDTRANS_SERVER_KEY=SB-Mid-server-…`,
   `PB_BILLING_MIDTRANS_ENV=sandbox`. Jangan isi `PB_BILLING_PROVIDER` (atau kosongkan).
4. Buka tunnel ke API (`cloudflared tunnel --url http://localhost:8787`) dan set `PB_PUBLIC_API_URL` ke URL
   tunnel. API mengirim URL notifikasi per transaksi `<PB_PUBLIC_API_URL>/webhooks/billing`. Isi juga di
   Settings → Payment → Notification URL sebagai cadangan.
5. Log API: `[api] subscription billing: midtrans (sandbox)`.
6. Harga paket belum ditetapkan (open-questions #2): login sebagai admin → menu **Admin** → isi harga Pro dan
   Business (mis. 150000 dan 400000 untuk uji).

## 1. Rekap penjualan (Studio → Rekap)

Siapkan data: jalankan beberapa sesi di booth (QRIS sandbox, voucher, tunai, dan satu sesi offline), atau pakai
`pnpm db:seed` bila sudah ada data. Catat penjualan dari dashboard Midtrans / catatan Anda untuk pembanding.

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 1.1 | Buka **Rekap** | Rentang default 7 hari terakhir; kartu: Pendapatan kotor, bersih, jumlah sesi, rata-rata/sesi, cetak tambahan, lembar tercetak | |
| 1.2 | Bandingkan kartu dengan catatan Anda untuk hari yang sama | Jumlah sesi dan pendapatan kotor sama; bersih = kotor − fee (QRIS 0,7 %) | |
| 1.3 | Buat sesi tepat sekitar **23.30 WIB** (atau ubah jam laptop/gunakan data uji) | Sesi muncul di **tanggal WIB** itu pada grafik "Per hari" dan "Per jam" (jam 23), bukan tanggal berikutnya (UTC) | |
| 1.4 | Booth kedua dengan zona waktu WITA | Tanggal/jam tiap booth mengikuti zona booth masing-masing; kartu "Perbandingan booth" memisahkan keduanya | |
| 1.5 | Filter Booth lalu Perangkat | Angka berubah sesuai filter; filter perangkat tetap benar | |
| 1.6 | Tabel metode pembayaran | QRIS, Voucher, Tunai, Gratis (event) dengan jumlah sesi dan kotor | |
| 1.7 | Frame terlaris / Filter populer | Urutan sesuai jumlah sesi, nama sesuai config aktif | |
| 1.8 | Matikan internet laptop booth, selesaikan 1 sesi tunai, sambungkan lagi | Selama belum tersinkron: peringatan "Data belum tersinkron dari <perangkat>"; setelah online: peringatan hilang, sesi masuk rekap (ditandai offline) | |
| 1.9 | Bayar QRIS setelah kedaluwarsa (F4 §5) | Muncul di "Perlu ditindaklanjuti (refund manual)" | |
| 1.10 | Tekan **Unduh CSV** / **Unduh Excel** | File terunduh; buka di Excel: kolom waktu memakai zona booth, angka bisa dijumlahkan | |
| 1.11 | Org di paket Starter (Admin → ubah paket) | Rekap dibatasi 30 hari (pesan), tombol ekspor diganti ajakan upgrade | |
| 1.12 | Klik kode sesi di **Transaksi** | Halaman detail: pratinjau strip, pembayaran, jumlah file per jenis, status unggah ke Drive, riwayat cetak | |

## 2. Perangkat, log, kertas

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 2.1 | Buka **Perangkat** dengan Kiosk + agent berjalan | Kartu perangkat: **online**, heartbeat terakhir "x dtk lalu", versi aplikasi, config terpasang vs aktif, status kamera/printer | |
| 2.2 | Matikan agent/Kiosk. Tunggu 3 menit, muat ulang | Status **tidak responsif** | |
| 2.3 | Tunggu hingga lebih dari 5 menit sejak heartbeat terakhir | Status **offline** | |
| 2.4 | Nyalakan lagi | Kembali **online** dalam ±30 dtk | |
| 2.5 | Publish versi baru, lihat saat Kiosk belum menerima | "Config terpasang / aktif" menunjukkan "belum menerima versi terbaru" sampai tersinkron | |
| 2.6 | Isi **Kapasitas roll** 700, Simpan | "Perkiraan sisa: 700 lembar" (dikurangi lembar tercetak sejak roll dipasang) | |
| 2.7 | Cetak beberapa sesi lalu muat ulang | Sisa berkurang sesuai lembar tercetak; di bawah 50 lembar tampil merah "segera ganti roll" | |
| 2.8 | Ganti roll: centang **Roll baru dipasang**, Simpan | Counter "sejak roll dipasang" kembali 0 | |
| 2.9 | **Log kejadian** perangkat, filter Tingkat = Error / Jenis tertentu | Daftar terfilter (kamera putus, printer error, sync gagal…) dengan waktu zona booth | |
| 2.10 | Buat kegagalan upload (cabut akses Drive, F5 §5) lalu lihat **Antrian upload** | Sesi gagal tampil dengan pesan jelas + tombol **Coba lagi**; setelah berhasil menghilang dari antrian | |
| 2.11 | **Cabut token** pada perangkat | Status "dicabut"; agent di laptop itu kembali ke layar pairing (F2) | |

## 3. Log audit

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 3.1 | Publish, buat voucher, simpan kredensial Midtrans, setujui tunai, cabut perangkat, ganti roll | Menu **Log audit** mencatat tiap kejadian (waktu, pelaku, objek) | |
| 3.2 | Masuk sebagai operator | Menu Log audit tidak ada; membuka `/audit` mengalihkan ke daftar booth | |
| 3.3 | Starter | Hanya 30 hari terakhir + pesan; Business: riwayat penuh | |

## 4. Langganan dan paket

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 4.1 | Org baru: **Langganan** | Paket Pro, "Masa percobaan", berakhir 14 hari lagi | |
| 4.2 | Admin → ubah paket org ke **Starter** (aktif) | Org tidak bisa membuat booth kedua (form diganti pesan batas paket) | |
| 4.3 | Org Starter: **Pilih Pro** | Muncul QR QRIS + nominal; "Menunggu pembayaran…" | |
| 4.4 | Bayar QR dengan simulator QRIS Midtrans sandbox (<https://simulator.sandbox.midtrans.com/qris/index>) | Dalam beberapa detik halaman menampilkan "Pembayaran diterima. Paket Pro aktif"; nama paket berubah; riwayat tagihan "lunas" | |
| 4.5 | Buat booth kedua | Berhasil (Pro: 3 booth) | |
| 4.6 | Kartu tagihan di akun Midtrans **platform** | Transaksi QRIS masuk di akun **platform**, bukan akun Midtrans owner | |
| 4.7 | Studio → Integrasi (kredensial Midtrans owner) tetap tidak berubah | Pembayaran pembeli di booth tetap ke akun owner | |
| 4.8 | Biarkan QR kedaluwarsa (1 jam) | "Kode QR sudah kedaluwarsa" + tombol **Buat kode QR baru** | |
| 4.9 | Kirim ulang notifikasi pembayaran yang sama dari dashboard Midtrans | Tidak ada perubahan (periode tidak bertambah dua kali) | |
| 4.10 | Operator membuka **Langganan** | Boleh melihat; tombol pilih paket tidak ada | |

### Telat bayar (masa tenggang) dan turun paket

Majukan waktu lewat DB: `update subscriptions set current_period_end = now() - interval '1 day' where org_id = '<org>'`.

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 4.11 | Muat ulang halaman Studio apa pun | **Banner merah**: "Langganan … berakhir pada … Booth Anda tetap berjalan penuh sampai <tanggal> …" | |
| 4.12 | Selama masa tenggang: jalankan sesi di booth | Booth berjalan normal (QRIS, cetak, unggah, video, tanpa watermark) | |
| 4.13 | Admin → **Jalankan siklus langganan** (atau tunggu worker, tiap jam) | Status org "lewat jatuh tempo"; `graceUntil` = akhir periode + 7 hari; log audit `subscription.past_due` | |
| 4.14 | Bayar tagihan selama masa tenggang | Banner hilang, periode berlanjut dari tanggal berakhir sebelumnya | |
| 4.15 | Majukan lagi: `current_period_end = now() - interval '9 days'` lalu jalankan siklus | Paket turun ke **Starter**; banner info; **booth yang sudah ada tetap jalan**; booth baru ditolak; sesi baru mendapat watermark dan tanpa video | |
| 4.16 | 3 hari sebelum periode berakhir (paket berbayar) | Banner "Langganan berakhir dalam N hari" + tagihan perpanjangan dibuat | |

## 5. Panel admin platform

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 5.1 | Masuk dengan akun yang ada di `PB_PLATFORM_ADMINS` | Menu **Admin** muncul; daftar semua org: paket, status, berakhir, jumlah booth | |
| 5.2 | Akun biasa membuka `/admin` | "Halaman tidak ditemukan"; panggilan API `/admin/*` dengan token owner → 403 | |
| 5.3 | Ubah paket sebuah org (paket, status, lama hari, catatan) | Berlaku segera; muncul di log audit org itu (`subscription.admin_set`, pelaku admin) | |
| 5.4 | Ubah harga paket | Harga baru tampil di halaman Langganan; kosong = tidak bisa dibeli | |

## 6. Catatan setelah uji

- Hapus data uji: org uji dan transaksi sandbox.
- Temuan baru → `docs/open-questions.md` dan `docs/decisions.md`.
