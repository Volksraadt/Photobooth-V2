# F7 — Pasca-MVP (backlog)

Urutan prioritas sementara. Setiap item dipecah menjadi file fase sendiri saat akan dikerjakan.

1. **DSLR/mirrorless** — `CaptureSource` `dslr` di Agent: `gphoto2` (Linux/macOS), Canon EDSDK (Windows). Live view sebagai preview, capture resolusi penuh, daftar kamera yang diuji.
2. **Xendit** — implementasi `PaymentProvider` `xendit` memakai API Payments terbaru (bukan legacy `/qr_codes`). Konfirmasi dulu apakah QR yang tidak dibayar dikenai Processing Fee.
3. **Ukuran cetak 4×6 penuh** dan profil lain.
4. **Live clip / boomerang** — rekam 2–3 detik saat countdown di sumber kamera, encode di worker, subfolder `clips/`. Fitur plan Pro ke atas.
5. **Peran staff** (owner/manager/operator) dan undangan anggota.
6. **Notifikasi** email lalu WhatsApp: device offline, printer error, upload gagal, kertas hampir habis.
7. **Rekonsiliasi** otomatis dengan data provider.
8. **Raspberry Pi** sebagai otak (Tauri Linux ARM64), uji performa.
9. **Tablet sebagai otak** (Kiosk di tablet, tanpa Agent penuh; cetak via printer jaringan).
10. **Custom domain** untuk short link (plan Business).
11. Pilih foto untuk video oleh pembeli (`photoPick: 'buyer'`), musik pilihan.
12. Studio dalam Bahasa Inggris.
13. Analitik lanjutan: funnel per halaman (berapa yang berhenti di Payment, dll.).
