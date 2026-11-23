# PRD — Photobooth Platform

> Nama produk masih sementara (codename: **photobooth-platform**). Ganti setelah branding final.
> Versi: 0.1 · Tanggal: 24 November 2026 · Status: Draft siap dikerjakan

Dokumen terkait:
- `docs/architecture.md` — arsitektur sistem dan keputusan teknis
- `docs/schema.md` — schema config (theme, halaman, elemen, frame) dan database
- `docs/phases/` — breakdown task per fase, dengan acceptance criteria
- `docs/open-questions.md` — hal yang belum diputuskan

---

## 1. Ringkasan

Photobooth Platform adalah SaaS untuk pemilik usaha photobooth. Owner mendesain seluruh pengalaman photobooth mereka di sebuah editor web bergaya Figma (Studio), lalu menjalankannya di perangkat booth (laptop sebagai "otak", tablet atau kamera DSLR sebagai sumber foto). Pembeli di booth memilih frame, membayar dengan QRIS, berfoto 4 kali dengan opsi retake, memilih filter, lalu mendapat cetakan strip dan QR untuk mengunduh semua hasil dari Google Drive milik owner.

Pembeda utama: **setiap halaman, setiap elemen, posisi dan ukurannya dapat diatur bebas**, termasuk layar kamera, kotak foto, QRIS, dan QR unduhan. Booth tetap berjalan saat internet terputus.

## 2. Tujuan

1. Owner bisa membuat dan mengubah desain booth tanpa bantuan developer.
2. Satu owner bisa mengelola banyak booth dengan desain berbeda, sesuai paket langganan.
3. Pembeli menyelesaikan satu sesi dari cover sampai cetak dalam waktu singkat dan tanpa kebingungan.
4. Booth tetap bisa melayani pembeli saat offline (voucher/cash), dan semua data tersinkron saat kembali online.
5. Owner memiliki rekap penjualan dan status perangkat yang akurat.

## 3. Bukan tujuan (untuk MVP)

- Tablet sebagai otak (MVP: laptop sebagai otak, tablet sebagai kamera).
- Kamera DSLR/mirrorless (dirancang dari awal, diimplementasikan setelah MVP).
- Raspberry Pi sebagai otak (dirancang kompatibel, diuji setelah MVP).
- Xendit (interface disiapkan, implementasi setelah Midtrans).
- Ukuran cetak selain strip 2×6.
- Live clip / boomerang.
- Aplikasi mobile untuk owner.

## 4. Pengguna

| Persona | Kebutuhan |
|---|---|
| **Owner** | Mendesain booth, mengatur harga dan frame, menghubungkan Midtrans dan Google Drive, melihat rekap penjualan |
| **Operator/Staff** di lokasi | Menyalakan booth, menyetujui pembayaran cash, menangani printer, mengecek status |
| **Pembeli** | Berfoto dengan cepat dan menyenangkan, membayar mudah, mendapat cetakan dan file digital |
| **Admin platform** (kita) | Mengelola paket langganan, membantu owner, memantau kesehatan sistem |

## 5. Komponen sistem

| Komponen | Berjalan di | Fungsi |
|---|---|---|
| **Studio** | Web (cloud) | Editor desain, manajemen booth/device, frame, harga, voucher, integrasi, rekap, langganan |
| **API + Worker** | Cloud | Auth, sinkron config, pembuatan QRIS, webhook, pemrosesan output, upload Drive, short link |
| **Kiosk** | Laptop (MVP) | Menjalankan flow booth berdasarkan config; layar yang dilihat pembeli |
| **Local Agent** | Laptop yang sama dengan Kiosk | Print, penyimpanan lokal, antrian upload, server LAN untuk aplikasi kamera, nanti DSLR |
| **Camera App** | Tablet/iPad (MVP) | Mengirim preview kamera ke Kiosk dan mengambil foto resolusi penuh |

Detail teknis ada di `docs/architecture.md`.

## 6. Flow pembeli

```
Cover → Tutorial → Pilih Frame → Payment → Capture (4×) → Review → Processing → Result → Cover
```

| # | Halaman | Perilaku | Elemen khusus wajib |
|---|---|---|---|
| 1 | **Cover** | Tampilan menarik; sentuh untuk mulai | `button` (aksi start) |
| 2 | **Tutorial** | 1 atau lebih slide gambar statis; bisa dimatikan | — |
| 3 | **Pilih Frame** | Pembeli memilih satu frame dari daftar yang diaktifkan owner; harga bisa per frame | `frame-picker` |
| 4 | **Payment** | QRIS dinamis dibuat saat halaman dibuka; timer kedaluwarsa; alternatif voucher dan cash | `qris`, `price-label` |
| 5 | **Capture** | 1 layar kamera besar + slot foto 1–4. Countdown, ambil foto, foto masuk ke slot. Setiap slot bisa di-retake | `camera-view`, `photo-slot` × jumlah slot frame, `countdown` |
| 6 | **Review** | Hasil di dalam frame; pembeli memilih filter; opsi beli cetak tambahan; konfirmasi | `frame-preview`, `filter-picker` |
| 7 | **Processing** | Komposisi dan cetak; upload di belakang layar | `progress` |
| 8 | **Result** | QR untuk unduh file; pesan terima kasih; kembali ke Cover otomatis | `download-qr` |

Aturan umum flow:
- Halaman Tutorial dan Review bisa diaktifkan/dimatikan oleh owner. Jika Review mati, filter default owner yang dipakai.
- Setiap halaman memiliki **idle timeout** yang membawa kembali ke Cover. Setelah pembayaran lunas, timeout tidak menghapus sesi; sesi tetap dilanjutkan.
- Jika pembeli kembali dari Payment ke Pilih Frame, QRIS lama dibatalkan.
- Halaman **Error** (kamera putus, printer error, pembayaran gagal) dapat didesain juga.
- **Mode admin** tersembunyi di Kiosk (gesture + PIN): tes kamera, tes print, sinkron config, lihat antrian upload, sesi gratis, approve cash.
- **Mode event** (gratis): Payment dilewati sepenuhnya.

## 7. Kustomisasi (inti produk)

### 7.1 Editor bergaya Figma
- Canvas dengan **artboard** berukuran tetap per orientasi (mis. 1920×1080 landscape, 1080×1920 portrait). Kiosk menskalakan artboard agar pas di layar (letterbox).
- Operasi: drag, resize, rotate, multi-select, group, align, distribute, snap ke grid/guide/elemen lain, layer panel (urutan, lock, hide), undo/redo, copy/paste antar halaman, zoom/pan.
- **Panel properti** di kanan untuk nilai presisi: X, Y, W, H, rotasi, opacity, warna, font, border radius, shadow, dsb.
- **Template siap pakai** sebagai titik awal untuk owner yang bukan desainer.
- **Preview** flow di Studio (simulasi, kamera webcam laptop) dan tombol **Publish** yang mengirim config ke booth.

### 7.2 Tipe elemen
- Statis: `image`, `text`, `shape`, `video` (loop background)
- Interaktif: `button` dengan aksi (next, back, start, retake, confirm, pilih filter, tambah cetak)
- Khusus (terikat data flow): `camera-view`, `photo-slot`, `countdown`, `frame-picker`, `frame-preview`, `filter-picker`, `qris`, `price-label`, `payment-timer`, `voucher-input`, `download-qr`, `progress`, `print-copies`

Setiap elemen khusus memiliki properti visual yang bisa diubah (bingkai, radius, warna placeholder, font angka, dsb.). Daftar lengkap di `docs/schema.md`.

### 7.3 Frame
- Frame = gambar overlay (PNG transparan) + daftar **slot** foto (posisi, ukuran, rotasi, aspect ratio, urutan).
- Jumlah slot ditentukan frame (default 4).
- Ukuran frame mengikuti `PrintProfile`. MVP: strip 2×6 inci @300dpi (600×1800 px), dicetak 2 strip per kertas 4×6 lalu dipotong.
- Elemen dinamis opsional di frame: tanggal, teks event, logo, QR unduhan.
- Harga bisa per frame atau harga dasar booth.

### 7.4 Filter
- Owner memilih filter mana yang tersedia per booth dan filter default.
- Filter didefinisikan sebagai parameter (brightness, contrast, saturation, warmth, grayscale, sepia, dll.) sehingga preview di Kiosk sama dengan hasil akhir.

## 8. Output per sesi

Semua file diunggah ke **Google Drive milik owner**:
```
/<Nama Booth>/<YYYY-MM-DD>/<SESSION-CODE>/
  original/    foto asli dari kamera (tanpa mirror)
  mirrored/    foto yang di-mirror (seperti yang dilihat pembeli di layar)
  filtered/    foto dengan filter pilihan pembeli
  composite/   strip final dalam frame (file yang dicetak)
  gif/         animasi GIF dari foto-foto sesi
  video/       video 9:16 berisi 3 foto 16:9 (dipilih acak secara default)
```
- Pilihan 3 foto untuk video: `random` (default), `first`, atau dipilih pembeli; diatur owner.
- QR di halaman Result dan di cetakan mengarah ke **link pendek platform** (`/s/<SESSION-CODE>`), bukan langsung ke Drive. Sebelum upload selesai, link menampilkan halaman "sedang diproses"; setelah selesai, link mengarahkan ke folder Drive. Dengan begitu QR tetap valid walaupun booth sedang offline.
- Integrasi Drive memakai scope `drive.file` (hanya file yang dibuat aplikasi), untuk menghindari security assessment scope restricted.

## 9. Pembayaran

- **Uang pembeli langsung masuk ke akun payment gateway milik owner.** Platform tidak memegang dana pembeli.
- MVP: **Midtrans** (QRIS via Core API). Xendit menyusul lewat interface yang sama.
- Owner memasukkan kredensial di Studio; kredensial dienkripsi dan tidak pernah dikirim ke perangkat booth.
- QRIS dibuat oleh server saat halaman Payment dibuka; kedaluwarsa pendek (default 5 menit, dapat diatur).
- Status lunas diterima lewat webhook dan diteruskan ke Kiosk secara realtime; polling sebagai cadangan.
- Wajib: idempotency per sesi, penanganan bayar setelah kedaluwarsa (ditandai untuk refund manual), pencegahan sesi ganda.
- Fee provider per transaksi disimpan agar rekap menunjukkan pendapatan bersih. Besaran fee disimpan sebagai pengaturan, bukan hardcode, karena MDR QRIS dapat berubah oleh regulator.
- Studio menyediakan panduan onboarding Midtrans dan tombol "Tes koneksi".

### 9.1 Mode offline
- **Voucher**: dibuat owner di Studio (sekali pakai, terikat ke booth tertentu, opsional masa berlaku dan nominal). Daftar voucher disinkron ke perangkat sehingga bisa divalidasi tanpa internet. Pemakaian direkonsiliasi saat online.
- **Cash**: operator menyetujui dengan PIN; tercatat di rekap dan audit log.
- Saat offline, opsi QRIS otomatis disembunyikan.

## 10. Cetak

- Dikelola Local Agent melalui driver printer sistem operasi (CUPS di macOS/Linux, spooler di Windows).
- MVP: strip 2×6, 2 strip per lembar 4×6.
- Jumlah cetak dasar diatur owner; pembeli bisa membeli cetak tambahan di Review (opsional).
- Agent mencatat jumlah lembar tercetak untuk estimasi sisa kertas/ribbon.

## 11. Multi-tenant & langganan

- Hierarki: `Owner (organisasi)` → `Subscription` → `Booth` → `Device`.
- Device dipasangkan ke booth dengan kode 6 digit yang tampil di Kiosk.
- Langganan dibayar bulanan oleh owner ke **akun payment gateway milik platform** (terpisah dari pembayaran pembeli).
- Paket memakai **feature flag dan limit** yang bisa diubah tanpa deploy. Draft paket (harga belum ditentukan):

| | Starter | Pro | Business |
|---|---|---|---|
| Booth | 1 | 3 | 10+ |
| Device per booth | 1 | 2 | Tanpa batas |
| Frame & template | Terbatas | Tanpa batas | Tanpa batas |
| Sumber kamera | Tablet/webcam | + DSLR | + DSLR |
| Live clip & video | — | ✓ | ✓ |
| Watermark platform | Ada | Tidak | Tidak |
| Custom domain QR | — | — | ✓ |
| Rekap | 30 hari, dasar | Lengkap + export | Lengkap + multi-staff + audit |

- Telat bayar: masa tenggang beberapa hari dengan peringatan di Studio, lalu turun ke kondisi terbatas. Booth tidak langsung mati di tengah event.

## 12. Rekap & log

### 12.1 Rekap penjualan
- Dashboard: pendapatan kotor/bersih, jumlah sesi, rata-rata per sesi; filter tanggal, booth, device.
- Breakdown metode (QRIS/voucher/cash), frame terlaris, filter populer, cetak tambahan.
- Grafik per jam dan per hari; perbandingan antar booth.
- Daftar transaksi dengan detail sesi (thumbnail, link Drive, status cetak & upload).
- Export CSV/Excel.
- Rekonsiliasi dengan data provider (setelah MVP).
- Penanda "data belum tersinkron dari device X" bila ada sesi offline yang belum masuk.

### 12.2 Log operasional
- Status device realtime: online/offline, heartbeat terakhir, versi app, status kamera dan printer.
- Antrian upload (pending/gagal) dengan tombol retry.
- Event log per device: kamera putus, printer error, payment timeout, sinkron gagal, crash.
- Estimasi sisa kertas.
- Notifikasi (email, lalu WhatsApp) untuk device offline, printer error, upload gagal berulang (setelah MVP).

### 12.3 Audit log
- Perubahan desain, harga, frame, voucher, kredensial; approve cash; login staff. Tidak bisa diubah atau dihapus.

### 12.4 Peran staff (setelah MVP, paket Business)
- Owner (semua akses), Manager (rekap + konfigurasi), Operator (status device + approve cash).

## 13. Kebutuhan non-fungsional

| Area | Target |
|---|---|
| Latensi preview kamera tablet → Kiosk | < 200 ms di LAN yang sama |
| Waktu dari tekan foto terakhir ke strip tercetak | < 30 detik (tergantung printer) |
| Halaman Kiosk | 60 fps animasi; transisi < 300 ms |
| Offline | Kiosk dapat menjalankan sesi penuh (voucher/cash + cetak) tanpa internet |
| Ketahanan data | Tidak ada sesi yang hilang; semua file tersimpan lokal sampai upload terkonfirmasi |
| Keamanan | Kredensial terenkripsi; isolasi data antar owner; device memakai token yang bisa dicabut |
| Waktu zona | Simpan UTC, tampilkan sesuai zona booth (WIB/WITA/WIT) |
| Bahasa UI | Studio: Indonesia (Inggris menyusul). Teks Kiosk sepenuhnya dari desain owner |

## 14. Metrik keberhasilan

- Owner baru dapat mempublikasikan desain pertama dari template dalam waktu kurang dari 30 menit.
- ≥ 99% sesi yang dibayar berakhir dengan cetakan dan file terunggah.
- Tingkat QRIS kedaluwarsa tanpa bayar dipantau per booth (indikator UX payment).
- Retensi owner bulanan.

## 15. Fase pengerjaan

| Fase | Isi | Status |
|---|---|---|
| F0 | Fondasi monorepo, schema, database, auth | MVP |
| F1 | Renderer + Kiosk flow dengan webcam dan config manual | MVP |
| F2 | Studio editor Figma-like + publish + pairing device | MVP |
| F3 | Camera App tablet + Local Agent + cetak 2×6 | MVP |
| F4 | Midtrans QRIS + voucher + cash + offline | MVP |
| F5 | Pipeline output + Google Drive + short link | MVP |
| F6 | Rekap penjualan, status device, langganan & plan gating | MVP |
| F7 | Pasca-MVP: Xendit, DSLR, live clip, 4×6, staff, notifikasi, Raspberry Pi | Setelah MVP |

Detail task dan acceptance criteria ada di `docs/phases/`.

## 16. Risiko utama

| Risiko | Mitigasi |
|---|---|
| Browser mewajibkan HTTPS untuk akses kamera; tablet tidak bisa membuka kamera dari alamat LAN biasa | Camera App dibungkus Capacitor (aplikasi native), lihat `docs/architecture.md` |
| Safari iPad tidak mendukung pengambilan foto resolusi penuh via web API | Plugin kamera native di Capacitor |
| Editor Figma-like memakan waktu paling banyak | Pakai library teruji (`react-moveable`, `selecto`), bangun schema dan renderer dulu |
| Preview filter berbeda dengan hasil akhir | Filter berbasis parameter yang diterjemahkan sama di CSS dan di compositor |
| Biaya transaksi provider untuk QR yang tidak dibayar | QR dibuat hanya saat halaman Payment, kedaluwarsa pendek, dibatalkan saat kembali |
| Regulasi pembayaran | Dana pembeli langsung ke akun owner; konfirmasi ke provider/konsultan hukum sebelum launch |
| Kuota Google Drive API | Antrian dengan retry dan backoff; upload dari worker, bukan dari booth |
