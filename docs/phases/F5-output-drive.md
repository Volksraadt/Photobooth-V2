# F5 — Pipeline output + Google Drive + short link

Tujuan: setiap sesi menghasilkan semua file dan tersedia di Drive owner melalui QR.

## Task
- [ ] Studio: hubungkan Google Drive (OAuth, scope `drive.file`), simpan refresh token terenkripsi, pilih/buat folder root.
- [ ] Agent → API: unggah original, composite, metadata sesi ke object storage; retry saat offline; tandai `upload_jobs`.
- [ ] `apps/worker`: job `process-session`
  - [ ] `mirrored/` — flip horizontal dari original.
  - [ ] `filtered/` — filter pilihan pembeli via `packages/compositor`.
  - [ ] `composite/` — gunakan dari booth; buat ulang jika tidak ada.
  - [ ] `gif/` — semua foto terpilih, `frameDelayMs` dari config.
  - [ ] `video/` — 1080×1920, 3 foto 16:9 sesuai `photoPick`, latar dan musik opsional, ffmpeg.
- [ ] Job `upload-drive`: struktur folder `/<root>/<YYYY-MM-DD>/<SESSION-CODE>/<subfolder>/`, permission "anyone with link: reader", simpan `drive_folder_url`.
- [ ] Short link `/s/:code`: halaman "sedang diproses" (dengan auto-refresh) atau redirect ke Drive; halaman 404 yang rapi.
- [ ] Elemen `download-qr` dan QR di frame memakai short link.
- [ ] Agent menghapus file lokal setelah upload storage terkonfirmasi (retensi lokal opsional N hari).
- [ ] Watermark platform untuk plan yang mewajibkan.
- [ ] Studio: status upload per sesi + retry manual.

## Acceptance criteria
- Satu sesi selesai → dalam < 2 menit (online) folder Drive berisi 6 subfolder dengan file yang benar.
- QR di cetakan dan di layar Result membuka halaman proses lalu folder Drive yang sama.
- Sesi offline: QR di cetakan sudah valid; setelah booth online, link mengarah ke folder Drive.
- Mencabut akses Drive di akun Google owner → job gagal dengan pesan jelas di Studio, file tetap aman di storage.
