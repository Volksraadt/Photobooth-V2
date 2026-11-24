# F2 — Studio editor + publish + pairing

Tujuan: owner mendesain semua halaman dan frame dengan editor bergaya Figma, lalu mempublikasikannya ke booth yang terpasang.

## Task — Editor halaman
- [x] Layout editor: daftar halaman (kiri atas), layer panel (kiri bawah), canvas (tengah), panel properti (kanan), toolbar (atas).
- [x] Canvas memakai `packages/renderer` mode `editor`; lapisan interaksi `react-moveable` + `selecto`.
- [x] Operasi: select, multi-select (drag box, shift-klik), drag, resize (dengan shift = kunci rasio), rotate, hapus, duplikat, copy/paste (termasuk antar halaman).
- [x] Snap ke tepi artboard, tengah, elemen lain, grid; garis guide saat snap.
- [x] Align & distribute untuk multi-select.
- [x] Group / ungroup, lock, hide, urutan layer (drag di layer panel, bring forward/backward).
- [x] Undo/redo (minimal 100 langkah) dengan pola command atau patch (mis. Immer patches).
- [x] Zoom (scroll + ctrl, tombol fit), pan (spasi + drag).
- [x] Panel properti per tipe elemen sesuai `docs/schema.md`; input angka presisi X/Y/W/H/rotasi.
- [x] Panel "Tambah elemen": statis, tombol, elemen khusus (hanya yang relevan untuk halaman aktif).
- [x] Editor slide untuk halaman Tutorial.
- [x] Indikator validasi: daftar masalah per halaman (mis. "Halaman Capture butuh 1 Camera View").
- [x] Autosave draft ke `booth_drafts`.

## Task — Editor frame
- [x] Canvas ukuran strip (600×1800) dengan overlay PNG.
- [x] Tambah/atur slot foto (drag, resize, rotate, radius, urutan).
- [x] Elemen dinamis frame: teks dengan `{{date}}`, logo, `download-qr`.
- [x] Preview dengan foto contoh.
- [x] Harga per frame, aktif/nonaktif, urutan tampil.

## Task — Lainnya
- [x] Manajemen aset: upload gambar/video/font ke storage, hitung sha256, daftar aset per org.
- [x] Pengaturan flow, harga, filter (editor parameter + preview), output.
- [x] Galeri template: buat booth dari template.
- [x] Preview flow di Studio (memakai `packages/flow` + webcam laptop, payment mock).
- [x] Publish: validasi → simpan `booth_configs` versi baru → set aktif → kirim sinyal realtime ke device.
- [x] Riwayat versi + rollback ke versi sebelumnya.
- [x] Pairing device: Kiosk menampilkan kode 6 digit → owner memasukkan di Studio → API membuat device token.
- [x] Kiosk: ambil config aktif dari API, unduh aset, aktifkan versi baru hanya jika semua aset berhasil.
- [x] Batas plan: jumlah booth, device, frame (tampilkan pesan upgrade).

## Acceptance criteria
- Owner membuat booth dari template, memindahkan dan mengubah ukuran `camera-view` dan keempat `photo-slot`, mengganti background, lalu Publish; Kiosk yang terpasang memperbarui tampilan dalam < 10 detik tanpa restart.
- Apa yang terlihat di canvas editor identik dengan Kiosk (uji screenshot Playwright, selisih piksel di bawah ambang).
- Undo/redo bekerja untuk semua operasi di atas.
- Publish ditolak dengan daftar masalah bila validasi gagal.
- Rollback ke versi lama berhasil dan device mengikutinya.

### Status (2026-11-24)
Diuji otomatis di `apps/studio/e2e/editor.spec.ts` (Playwright, Studio + API + Kiosk mode API berjalan bersama) ditambah unit test `apps/studio/src/editor/editor.test.ts` (12), `packages/db/src/booth-repo.test.ts` (8), `apps/api/src/pairing.test.ts` (6).
- [x] *template → edit camera, 4 slots and background → publish → paired kiosk updates < 10 s; rollback is followed*: booth dari template Neon, Kiosk dipasang lewat kode 6 digit, `camera-view` digeser (mouse) dan di-resize (handle), 4 `photo-slot` dipilih dan digeser bersama, latar Cover diganti gambar upload dan latar Foto diganti warna → Publish v1 → Kiosk memakai v1 dalam < 10 dtk tanpa reload (penanda `window` tetap ada), gambar latar dari cache lokal (`blob:`), posisi kamera + 4 slot di Kiosk sama dengan editor (selisih < 1 px artboard).
- [x] *editor canvas is pixel-identical to the kiosk*: canvas editor (zoom 50%) vs Kiosk 960×540 — Cover: rata-rata selisih 0,104/255, 0% piksel berbeda (> 48); Pilih Frame: identik.
- [x] *undo/redo covers every editor operation*: drag, resize, rotate (handle + field), nudge, duplikat, hapus, copy/paste antar halaman, align, distribute, group/ungroup, urutan layer, lock, hide, tambah elemen, latar, slot frame, filter, harga → undo semua = dokumen awal persis; redo semua = dokumen akhir persis. Unit test: setiap operasi bolak-balik, ≥ 150 langkah.
- [x] *publish is rejected with the list of problems*: `camera-view` dihapus → Publish menampilkan daftar masalah ("… camera-view …"), tidak ada versi yang dibuat.
- [x] Rollback: v2 dipublish, lalu "Aktifkan lagi" v1 → v3 berisi config v1; Kiosk mengikuti ke v3 dalam < 10 dtk; daftar perangkat di Studio menampilkan "Config terpasang: v3" (heartbeat).
- Regresi: e2e Kiosk F1 (10) dan onboarding F0 tetap lolos; `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (166 unit test) bersih.
