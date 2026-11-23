# F3 — Camera App tablet + Local Agent + cetak 2×6

Tujuan: tablet menjadi kamera booth, laptop memproses dan mencetak strip.

## Task — Local Agent
- [ ] `apps/agent`: Node service, dijalankan sebagai sidecar Tauri; API lokal di `127.0.0.1` + WebSocket untuk Kiosk.
- [ ] SQLite lokal sesuai `docs/schema.md` bagian C.
- [ ] Penyimpanan file sesi di folder data aplikasi.
- [ ] Sinkron config + aset (dipindah dari Kiosk F2 ke Agent).
- [ ] Server LAN: signaling WebRTC + endpoint `POST /camera/shots` dengan token pairing.
- [ ] `packages/compositor`: frame + foto (crop sesuai slot) + filter + elemen dinamis → PNG/JPEG 600×1800 @300dpi; susun 2 strip pada kertas 4×6.
- [ ] Print: deteksi printer, pilih printer di mode admin, kirim job via CUPS (`lp`) di macOS/Linux dan spooler di Windows; catat `print_jobs`.
- [ ] Tes cetak dari mode admin.
- [ ] Heartbeat + `device_events` ke API (melalui outbox bila offline).

## Task — Camera App
- [ ] `apps/camera`: React + Capacitor, target iOS (iPad) dan Android.
- [ ] Pairing dengan memindai QR di Kiosk (IP Agent, port, token).
- [ ] Preview WebRTC ke Kiosk; atur resolusi/bitrate untuk latensi rendah.
- [ ] Ambil foto resolusi penuh dengan plugin kamera native saat perintah `capture`; kirim ke Agent; tunggu konfirmasi.
- [ ] Pilihan kamera depan/belakang, kunci orientasi, layar tetap menyala.
- [ ] Reconnect otomatis bila Wi-Fi putus sebentar; status tampil di Kiosk.

## Task — Integrasi
- [ ] `packages/capture`: implementasi `tablet` yang memakai Agent.
- [ ] Kiosk: pilih sumber kamera di mode admin (webcam / tablet).
- [ ] Processing page memanggil Agent: compositing → cetak → simpan.
- [ ] Bungkus Kiosk dengan Tauri; installer Windows dan macOS.

## Acceptance criteria
- Latensi preview tablet → Kiosk < 200 ms di Wi-Fi lokal yang sama.
- Foto yang tersimpan beresolusi penuh dari kamera tablet (bukan frame dari stream preview).
- Dari foto ke-4 dikonfirmasi sampai strip mulai dicetak < 15 detik di laptop kelas menengah.
- Hasil cetak 2×6 sesuai frame di editor (posisi slot, overlay, teks tanggal).
- Mematikan Wi-Fi tablet saat capture menampilkan status "kamera terputus" lalu tersambung kembali tanpa kehilangan foto yang sudah diambil.
