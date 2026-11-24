# F1 — Renderer + Kiosk flow

Tujuan: Kiosk menjalankan flow pembeli lengkap dari config JSON, memakai webcam laptop, tanpa payment sungguhan dan tanpa cetak.

## Task
- [x] `packages/renderer`: komponen `<PageRenderer page config runtime />` yang menggambar halaman di artboard dan menskalakannya (fit + letterbox).
- [x] Renderer: semua elemen statis (`image`, `text` dengan token, `shape`, `video`, `button`).
- [x] Renderer: elemen khusus menerima data dari `runtime` (stream kamera, foto slot, countdown, daftar frame, filter, QR string, harga, timer, progress).
- [x] Renderer: mode `editor` (tanpa interaksi tombol, placeholder untuk elemen khusus) dan mode `live`.
- [x] Renderer: filter preview via CSS dari `Filter.params`.
- [x] `packages/flow`: XState machine sesuai `docs/architecture.md` §3.3, termasuk idle timeout, retake per slot, retake semua, mode event, halaman error.
- [x] `packages/capture`: interface `CaptureSource` + implementasi `webcam` dan `mock`.
- [x] `apps/kiosk`: aplikasi Vite + React yang memuat config dari file lokal (dev) dan menjalankan flow.
- [x] Kiosk: payment mock (tombol "simulasikan lunas" di mode dev).
- [x] Kiosk: mode admin (gesture 5 ketukan di pojok + PIN).
- [x] Kiosk: fullscreen, sembunyikan kursor, cegah sleep (di browser via Wake Lock API).
- [x] Hasil sesi di F1: simpan foto ke IndexedDB/download lokal agar bisa diperiksa.

## Acceptance criteria
- Config default dari F0 berjalan penuh di Kiosk: cover → tutorial → frame → payment (mock) → 4 foto dengan countdown → retake slot 2 → review dengan ganti filter → processing → result → kembali ke cover.
- Mengubah posisi `camera-view` di file JSON langsung mengubah posisinya di Kiosk setelah reload.
- Tampilan identik di resolusi 1920×1080 dan 1366×768 (hanya skala berbeda).
- Mencabut webcam di tengah capture membawa ke halaman Error, bukan layar putih.
- Tidak menyentuh tombol selama `idleTimeoutSec` membawa kembali ke Cover (sebelum bayar).

### Status (2026-11-24)
Semua diuji otomatis: `pnpm --filter @pb/kiosk test:e2e` (Playwright, 10 test) + unit test `flow` (17), `renderer` (33), `capture` (4), `schema` (41), `kiosk` (1).
- [x] Flow penuh dengan config default: `e2e/kiosk.spec.ts` › *default config runs the full buyer flow* (countdown 3-2-1, 4 foto, retake slot 2 → take ke-2, ganti filter → preview berfilter, processing → result dengan QR `/s/<KODE>`, sesi + 5 foto tersimpan di IndexedDB, Selesai → Cover). Kembali otomatis dari Result: *result page returns to cover automatically*.
- [x] Posisi `camera-view` dari JSON: *camera-view position follows the JSON config after reload* (80,80 → 400,200 setelah reload). Manual: edit `apps/kiosk/booth-config.local.json`; Vite juga me-reload Kiosk otomatis saat file berubah.
- [x] 1920×1080 vs 1366×768: *same layout …* — semua elemen di koordinat artboard yang sama (selisih < 1 px artboard), skala 1 vs 0,7111; screenshot 1920 yang diperkecil vs 1366: selisih rata-rata < 3/255.
- [x] Webcam dicabut: *webcam/mock: camera unplugged mid-capture …* — halaman Error desain owner (bukan layar sistem/putih); sesi berbayar dilanjutkan dari slot berikutnya setelah keluar dari Error.
- [x] Idle sebelum bayar: *idle before payment returns to cover* (90 dtk di Pilih Frame, sentuhan me-reset timer, sesi dibuang). Unit test: idle di Payment membatalkan QRIS; idle setelah bayar tidak membuang sesi.
- Renderer dipakai ulang Studio: halaman booth menampilkan pratinjau 9 halaman via `PageRenderer` mode `editor` (diuji di `apps/studio/e2e/onboarding.spec.ts`), termasuk SSR.
