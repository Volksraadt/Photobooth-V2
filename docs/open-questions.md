# Pertanyaan terbuka

| # | Pertanyaan | Default sementara | Kapan harus diputuskan |
|---|---|---|---|
| 1 | Nama produk dan domain | codename `photobooth-platform` | Sebelum F5 (short link) |
| 2 | Harga tiap paket langganan | Kosong; perlu riset kompetitor | Sebelum F6 |
| 3 | Masa trial untuk owner baru | 14 hari plan Pro | F6 |
| 4 | Lama masa tenggang telat bayar | 7 hari | F6 |
| 5 | Retensi file di object storage platform setelah masuk Drive | 30 hari lalu hapus | F5 |
| 6 | Apakah link Drive pembeli punya masa berlaku | Tidak | F5 |
| 7 | Model printer yang diuji resmi | Satu printer dye-sub yang tersedia untuk tim | F3 |
| 8 | Apakah owner boleh menaruh biaya MDR ke pembeli | Tidak, harga sudah termasuk | F4 |
| 9 | Konfirmasi regulasi model "dana langsung ke owner" dengan Midtrans/konsultan | Belum | Sebelum launch |
| 10 | Apakah QR yang tidak dibayar dikenai biaya di Xendit (Processing Fee per percobaan) | Belum dicek | Sebelum F7 Xendit |
| 11 | Persetujuan pembeli atas penyimpanan foto (privasi, UU PDP) | Teks persetujuan singkat di Cover/Tutorial yang dapat diatur owner. F1: config default sudah memuatnya di Cover (elemen teks biasa); isi teks perlu ditinjau hukum | Sebelum launch |
| 12 | Proyek Supabase dev (butuh akun owner; tidak bisa dibuat dari repo) | `PB_AUTH_MODE=dev` + Postgres lokal; kode mode Supabase + `supabase/config.toml` sudah siap, belum diuji ke proyek nyata | Sebelum F2 selesai |
| 13 | Batas frame plan Starter ("Terbatas" di PRD) | `maxFrames: 5`; Business `maxBooths: 10` ("10+") | F6 |
| 14 | ~~Format hash PIN admin Kiosk (`admin.pinHash`)~~ | **Diputuskan F1**: PBKDF2-SHA256, lihat `docs/schema.md` A.6 | — |
| 15 | Fee MDR QRIS per provider (`fee_settings`) | Tabel ada, belum di-seed; isi saat integrasi Midtrans | F4 |
| 16 | Cetak tambahan dipilih di Review (setelah pembayaran): bagaimana dibayar? | F1: hanya ditambahkan ke total di layar, tidak ditagih | F4 |
| 17 | Sesi berbayar yang tidak bisa dilanjutkan (mis. kamera rusak permanen): refund/kompensasi | Halaman Error menunggu; keluar dari Error mencoba melanjutkan sesi; operator menangani manual | F3/F4 |
| 18 | Kebijakan Supabase Storage untuk bucket `assets` (upload oleh anggota org, baca publik) | Kode upload mode supabase siap, belum diuji (lihat #12); dev memakai disk lokal | Sebelum F2 dipakai di Supabase |
| 19 | Retensi aset yang tidak lagi dipakai booth mana pun | Tidak dihapus otomatis; pustaka aset menampilkan semua | F6 |
