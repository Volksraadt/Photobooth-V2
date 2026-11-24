# F5 — Pipeline output + Google Drive + short link

Tujuan: setiap sesi menghasilkan semua file dan tersedia di Drive owner melalui QR.

## Task
- [x] Studio: hubungkan Google Drive (OAuth, scope `drive.file`), simpan refresh token terenkripsi, pilih/buat folder root.
- [x] Agent → API: unggah original, composite, metadata sesi ke object storage; retry saat offline; tandai `upload_jobs`.
- [x] `apps/worker`: job `process-session`
  - [x] `mirrored/` — flip horizontal dari original.
  - [x] `filtered/` — filter pilihan pembeli via `packages/compositor`.
  - [x] `composite/` — gunakan dari booth; buat ulang jika tidak ada.
  - [x] `gif/` — semua foto terpilih, `frameDelayMs` dari config.
  - [x] `video/` — 1080×1920, 3 foto 16:9 sesuai `photoPick`, latar dan musik opsional, ffmpeg.
- [x] Job `upload-drive`: struktur folder `/<root>/<YYYY-MM-DD>/<SESSION-CODE>/<subfolder>/`, permission "anyone with link: reader", simpan `drive_folder_url`.
- [x] Short link `/s/:code`: halaman "sedang diproses" (dengan auto-refresh) atau redirect ke Drive; halaman 404 yang rapi.
- [x] Elemen `download-qr` dan QR di frame memakai short link.
- [x] Agent menghapus file lokal setelah upload storage terkonfirmasi (retensi lokal opsional N hari).
- [x] Watermark platform untuk plan yang mewajibkan.
- [x] Studio: status upload per sesi + retry manual.

## Acceptance criteria
- Satu sesi selesai → dalam < 2 menit (online) folder Drive berisi 6 subfolder dengan file yang benar.
- QR di cetakan dan di layar Result membuka halaman proses lalu folder Drive yang sama.
- Sesi offline: QR di cetakan sudah valid; setelah booth online, link mengarah ke folder Drive.
- Mencabut akses Drive di akun Google owner → job gagal dengan pesan jelas di Studio, file tetap aman di storage.

## Status verifikasi (2026-11-25)
- Semua task dikerjakan. Acceptance criteria 1–4 **lolos secara otomatis terhadap Google tiruan** (`FakeGoogle`, server HTTP lokal yang meniru endpoint OAuth + Drive yang dipakai):
  - Kriteria 1: e2e sistem penuh `apps/studio/e2e/session-to-drive.spec.ts` (Studio + API + worker + agent + Kiosk di Postgres sungguhan): konfirmasi → folder dengan 6 subfolder + file yang benar dalam ±3,4 dtk (batas 2 menit). Isi tiap subfolder dicek di `apps/worker/src/pipeline.test.ts`.
  - Kriteria 2: `/s/:code` menampilkan halaman proses lalu 302 ke folder yang sama (e2e + pipeline test); QR di cetakan dan Result memakai `<API>/s/<kode>` yang sama.
  - Kriteria 3: kode tak dikenal → 404 rapi; setelah agent mengunggah → 302 ke Drive (`pipeline.test.ts`, termasuk kode agent sungguhan `UploadQueue` ↔ API ↔ worker); antrian agent offline/backoff/retensi di `apps/agent/src/uploads.test.ts`.
  - Kriteria 4: akses dicabut → job `failed` dengan `drive_revoked` + pesan Indonesia, file tetap di storage, hubungkan ulang melanjutkan (`pipeline.test.ts`, `drive.spec.ts`).
- **Belum diuji**: Google sungguhan (butuh proyek Google Cloud + akun owner), BullMQ dengan Redis sungguhan, Supabase Storage, perangkat/printer sungguhan. Langkah ada di `docs/testing/F5-manual.md`; lihat open-questions #30, #33, #34.
