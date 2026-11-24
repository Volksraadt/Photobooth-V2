# F3 — Camera App tablet + Local Agent + cetak 2×6

Tujuan: tablet menjadi kamera booth, laptop memproses dan mencetak strip.

## Task — Local Agent
- [x] `apps/agent`: Node service, dijalankan sebagai sidecar Tauri; API lokal di `127.0.0.1` + WebSocket untuk Kiosk.
- [x] SQLite lokal sesuai `docs/schema.md` bagian C.
- [x] Penyimpanan file sesi di folder data aplikasi.
- [x] Sinkron config + aset (dipindah dari Kiosk F2 ke Agent).
- [x] Server LAN: signaling WebRTC + endpoint `POST /camera/shots` dengan token pairing.
- [x] `packages/compositor`: frame + foto (crop sesuai slot) + filter + elemen dinamis → PNG/JPEG 600×1800 @300dpi; susun 2 strip pada kertas 4×6.
- [x] Print: deteksi printer, pilih printer di mode admin, kirim job via CUPS (`lp`) di macOS/Linux dan spooler di Windows; catat `print_jobs`.
- [x] Tes cetak dari mode admin.
- [x] Heartbeat + `device_events` ke API (melalui outbox bila offline).

## Task — Camera App
- [x] `apps/camera`: React + Capacitor, target iOS (iPad) dan Android.
- [x] Pairing dengan memindai QR di Kiosk (IP Agent, port, token).
- [x] Preview WebRTC ke Kiosk; atur resolusi/bitrate untuk latensi rendah.
- [x] Ambil foto resolusi penuh dengan plugin kamera native saat perintah `capture`; kirim ke Agent; tunggu konfirmasi.
- [x] Pilihan kamera depan/belakang, kunci orientasi, layar tetap menyala.
- [x] Reconnect otomatis bila Wi-Fi putus sebentar; status tampil di Kiosk.

## Task — Integrasi
- [x] `packages/capture`: implementasi `tablet` yang memakai Agent.
- [x] Kiosk: pilih sumber kamera di mode admin (webcam / tablet).
- [x] Processing page memanggil Agent: compositing → cetak → simpan.
- [x] Bungkus Kiosk dengan Tauri; installer Windows dan macOS.

## Acceptance criteria
- Latensi preview tablet → Kiosk < 200 ms di Wi-Fi lokal yang sama.
- Foto yang tersimpan beresolusi penuh dari kamera tablet (bukan frame dari stream preview).
- Dari foto ke-4 dikonfirmasi sampai strip mulai dicetak < 15 detik di laptop kelas menengah.
- Hasil cetak 2×6 sesuai frame di editor (posisi slot, overlay, teks tanggal).
- Mematikan Wi-Fi tablet saat capture menampilkan status "kamera terputus" lalu tersambung kembali tanpa kehilangan foto yang sudah diambil.

## Hasil verifikasi (2026-11-24)
Diuji otomatis di laptop dev Windows 11 (`pnpm --filter @pb/kiosk test:e2e:f3`, `pnpm test`). Tablet disimulasikan oleh Camera App yang berjalan di halaman Chromium kedua dengan kamera palsu; jaringan = loopback.

| Kriteria | Bukti | Hasil |
|---|---|---|
| Latensi preview < 200 ms | e2e `f3-tablet` "low-latency preview": kanvas berisi `Date.now()` di tablet → WebRTC → didekode per frame di Kiosk (150 sampel) | median 28 ms, p95 60 ms (loopback) |
| Foto resolusi penuh, bukan frame preview | e2e: 4 foto tersimpan di agent bersumber `tablet`, diambil lewat `ImageCapture.takePhoto` (bukan `stream-frame`), ukuran = ukuran foto kamera; diterima lewat `POST /camera/shots` | lolos (kamera palsu 1280×720) |
| Foto ke-4 → cetak dimulai < 15 dtk | e2e: dari konfirmasi foto ke-4 (termasuk ketukan Review) sampai job cetak dibuat; test agent: 4 foto 12 MP → strip + lembar + cetak; test compositor: 4×12 MP → strip + lembar | ±0,5 dtk; compositor 0,4 dtk |
| Cetak sesuai editor | e2e: strip renderer (`FrameComposite` 1:1, kode yang sama dengan editor Studio) vs hasil compositor, beda absolut rata-rata per piksel (0–255) | keseluruhan 0,48; area slot 0,00; teks tanggal 4,85 (antialiasing) |
| Wi-Fi putus saat capture | e2e: tablet memotret lalu jaringan putus 4 dtk sebelum upload → banner Kiosk "Kamera terputus — menyambungkan ulang…" → tersambung, foto terunggah dari antrian, 4 foto lengkap; test agent: putus saat upload dan putus sebelum perintah capture | lolos |

Juga diverifikasi: spooler Windows nyata ("Microsoft Print to PDF", output ke file) → halaman 4×6 dengan gambar 1200×1800; sidecar ter-bundel (runtime Node + `sharp` + canvas) berjalan dan mencetak tes; installer Windows (NSIS + MSI) dibangun dengan `tauri build`. Installer macOS dibangun lewat workflow CI **Kiosk installers** (tidak bisa di mesin Windows).

Belum diverifikasi di perangkat fisik (open-questions #23): latensi di Wi-Fi booth sungguhan, foto native iPad (plugin camera-preview, butuh Xcode/macOS), cetak di printer dye-sub (#7), build APK/IPA (butuh Android Studio/Xcode). Mode admin menampilkan estimasi latensi preview, ukuran foto tes, dan tes cetak untuk uji lapangan.
