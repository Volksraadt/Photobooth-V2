# F1 — Renderer + Kiosk flow

Tujuan: Kiosk menjalankan flow pembeli lengkap dari config JSON, memakai webcam laptop, tanpa payment sungguhan dan tanpa cetak.

## Task
- [ ] `packages/renderer`: komponen `<PageRenderer page config runtime />` yang menggambar halaman di artboard dan menskalakannya (fit + letterbox).
- [ ] Renderer: semua elemen statis (`image`, `text` dengan token, `shape`, `video`, `button`).
- [ ] Renderer: elemen khusus menerima data dari `runtime` (stream kamera, foto slot, countdown, daftar frame, filter, QR string, harga, timer, progress).
- [ ] Renderer: mode `editor` (tanpa interaksi tombol, placeholder untuk elemen khusus) dan mode `live`.
- [ ] Renderer: filter preview via CSS dari `Filter.params`.
- [ ] `packages/flow`: XState machine sesuai `docs/architecture.md` §3.3, termasuk idle timeout, retake per slot, retake semua, mode event, halaman error.
- [ ] `packages/capture`: interface `CaptureSource` + implementasi `webcam` dan `mock`.
- [ ] `apps/kiosk`: aplikasi Vite + React yang memuat config dari file lokal (dev) dan menjalankan flow.
- [ ] Kiosk: payment mock (tombol "simulasikan lunas" di mode dev).
- [ ] Kiosk: mode admin (gesture 5 ketukan di pojok + PIN).
- [ ] Kiosk: fullscreen, sembunyikan kursor, cegah sleep (di browser via Wake Lock API).
- [ ] Hasil sesi di F1: simpan foto ke IndexedDB/download lokal agar bisa diperiksa.

## Acceptance criteria
- Config default dari F0 berjalan penuh di Kiosk: cover → tutorial → frame → payment (mock) → 4 foto dengan countdown → retake slot 2 → review dengan ganti filter → processing → result → kembali ke cover.
- Mengubah posisi `camera-view` di file JSON langsung mengubah posisinya di Kiosk setelah reload.
- Tampilan identik di resolusi 1920×1080 dan 1366×768 (hanya skala berbeda).
- Mencabut webcam di tengah capture membawa ke halaman Error, bukan layar putih.
- Tidak menyentuh tombol selama `idleTimeoutSec` membawa kembali ke Cover (sebelum bayar).
