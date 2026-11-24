# Pertanyaan terbuka

| # | Pertanyaan | Default sementara | Kapan harus diputuskan |
|---|---|---|---|
| 1 | Nama produk dan domain | codename `photobooth-platform` | Sebelum F5 (short link) |
| 2 | Harga tiap paket langganan | Kosong; perlu riset kompetitor | Sebelum F6 |
| 3 | Masa trial untuk owner baru | 14 hari plan Pro | F6 |
| 4 | Lama masa tenggang telat bayar | 7 hari | F6 |
| 5 | Retensi file di object storage platform setelah masuk Drive | 30 hari lalu hapus | F5 |
| 6 | Apakah link Drive pembeli punya masa berlaku | Tidak | F5 |
| 7 | Model printer yang diuji resmi | Satu printer dye-sub yang tersedia untuk tim. F3: diuji lewat printer virtual + spooler Windows; belum dengan printer dye-sub fisik (lihat #23) | F3 (uji lapangan) |
| 8 | Apakah owner boleh menaruh biaya MDR ke pembeli | Tidak, harga sudah termasuk (F4: fee dicatat sebagai pengurang `net_amount`, tidak ditambahkan ke tagihan) | F6 |
| 9 | Konfirmasi regulasi model "dana langsung ke owner" dengan Midtrans/konsultan | Belum | Sebelum launch |
| 10 | Apakah QR yang tidak dibayar dikenai biaya di Xendit (Processing Fee per percobaan) | Belum dicek | Sebelum F7 Xendit |
| 11 | Persetujuan pembeli atas penyimpanan foto (privasi, UU PDP) | Teks persetujuan singkat di Cover/Tutorial yang dapat diatur owner. F1: config default sudah memuatnya di Cover (elemen teks biasa); isi teks perlu ditinjau hukum | Sebelum launch |
| 12 | Proyek Supabase dev (butuh akun owner; tidak bisa dibuat dari repo) | `PB_AUTH_MODE=dev` + Postgres lokal; kode mode Supabase + `supabase/config.toml` sudah siap, belum diuji ke proyek nyata | Sebelum F2 selesai |
| 13 | Batas frame plan Starter ("Terbatas" di PRD) | `maxFrames: 5`; Business `maxBooths: 10` ("10+") | F6 |
| 14 | ~~Format hash PIN admin Kiosk (`admin.pinHash`)~~ | **Diputuskan F1**: PBKDF2-SHA256, lihat `docs/schema.md` A.6 | — |
| 15 | Fee MDR QRIS per provider (`fee_settings`) | F4: di-seed Midtrans QRIS 0,7 % (migrasi 0003). Konfirmasi tarif kontrak Midtrans owner (bisa berbeda per merchant; MDR QRIS usaha mikro bisa lebih rendah) | Sebelum launch |
| 16 | Cetak tambahan dipilih di Review (setelah pembayaran): bagaimana dibayar? | F4 tetap: hanya ditambahkan ke total di layar, tidak ditagih (pembayaran kedua di Review belum ada). Pilihan: QRIS kedua di Review, atau matikan `extraPrintPrice` | F6 |
| 24 | Uji Midtrans **sandbox** sungguhan (QRIS + webhook lewat tunnel) dan `qr_string` di respons charge | Kode + test dengan mock/fetch tiruan; langkah di `docs/testing/F4-manual.md` §3. Butuh akun sandbox owner | Sebelum F4 dipakai di event |
| 25 | Teks desain owner yang menyebut QRIS (mis. "Scan QRIS…") tetap tampil saat offline; hanya elemen `qris`/`payment-timer` yang disembunyikan | Default: biarkan. Opsi: kondisi tampil per elemen (`showWhen: online/offline`) — perubahan schema | F6/F7 |
| 26 | Voucher nominal di bawah harga: gabung dengan QRIS/tunai untuk sisanya? | Ditolak ("Nilai voucher kurang") | Setelah MVP |
| 27 | PIN tunai per staff (`cash_approvals.approved_by_pin_of`) | PIN admin booth; kolom diisi `null` | F7 (peran staff) |
| 28 | Lebih dari satu instance API: sinyal pembayaran ke device | In-process (`DeviceSignals`); polling 2–3 dtk menutup selisih. Pindah ke `pg_notify` bila diskalakan | Sebelum scale-out API |
| 17 | Sesi berbayar yang tidak bisa dilanjutkan (mis. kamera rusak permanen): refund/kompensasi | Halaman Error menunggu; keluar dari Error mencoba melanjutkan sesi; operator menangani manual | F3/F4 |
| 18 | Kebijakan Supabase Storage untuk bucket `assets` (upload oleh anggota org, baca publik) | Kode upload mode supabase siap, belum diuji (lihat #12); dev memakai disk lokal | Sebelum F2 dipakai di Supabase |
| 19 | Retensi aset yang tidak lagi dipakai booth mana pun | Tidak dihapus otomatis; pustaka aset menampilkan semua | F6 |
| 20 | Token device di keychain OS (arsitektur §5) | F3: file `device-token` 0600 di folder data agent | Sebelum launch |
| 21 | TLS untuk server kamera LAN (foto lewat Wi-Fi booth tanpa enkripsi) | HTTP + token kamera; opsi: sertifikat self-signed + fingerprint di QR pairing | Sebelum launch |
| 22 | Sertifikat code signing Windows + Apple Developer ID / notarization untuk installer Kiosk dan Camera App | Installer belum ditandatangani (SmartScreen/Gatekeeper memperingatkan) | Sebelum dibagikan ke owner |
| 23 | Verifikasi di perangkat nyata: latensi preview di Wi-Fi booth, foto native iPad (plugin camera-preview), cetak di printer dye-sub (lihat #7) | e2e loopback lolos (median 28 ms); mode admin menampilkan estimasi latensi + ukuran foto tes untuk uji lapangan | Sebelum F3 dipakai di event |
