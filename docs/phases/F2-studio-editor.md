# F2 — Studio editor + publish + pairing

Tujuan: owner mendesain semua halaman dan frame dengan editor bergaya Figma, lalu mempublikasikannya ke booth yang terpasang.

## Task — Editor halaman
- [ ] Layout editor: daftar halaman (kiri atas), layer panel (kiri bawah), canvas (tengah), panel properti (kanan), toolbar (atas).
- [ ] Canvas memakai `packages/renderer` mode `editor`; lapisan interaksi `react-moveable` + `selecto`.
- [ ] Operasi: select, multi-select (drag box, shift-klik), drag, resize (dengan shift = kunci rasio), rotate, hapus, duplikat, copy/paste (termasuk antar halaman).
- [ ] Snap ke tepi artboard, tengah, elemen lain, grid; garis guide saat snap.
- [ ] Align & distribute untuk multi-select.
- [ ] Group / ungroup, lock, hide, urutan layer (drag di layer panel, bring forward/backward).
- [ ] Undo/redo (minimal 100 langkah) dengan pola command atau patch (mis. Immer patches).
- [ ] Zoom (scroll + ctrl, tombol fit), pan (spasi + drag).
- [ ] Panel properti per tipe elemen sesuai `docs/schema.md`; input angka presisi X/Y/W/H/rotasi.
- [ ] Panel "Tambah elemen": statis, tombol, elemen khusus (hanya yang relevan untuk halaman aktif).
- [ ] Editor slide untuk halaman Tutorial.
- [ ] Indikator validasi: daftar masalah per halaman (mis. "Halaman Capture butuh 1 Camera View").
- [ ] Autosave draft ke `booth_drafts`.

## Task — Editor frame
- [ ] Canvas ukuran strip (600×1800) dengan overlay PNG.
- [ ] Tambah/atur slot foto (drag, resize, rotate, radius, urutan).
- [ ] Elemen dinamis frame: teks dengan `{{date}}`, logo, `download-qr`.
- [ ] Preview dengan foto contoh.
- [ ] Harga per frame, aktif/nonaktif, urutan tampil.

## Task — Lainnya
- [ ] Manajemen aset: upload gambar/video/font ke storage, hitung sha256, daftar aset per org.
- [ ] Pengaturan flow, harga, filter (editor parameter + preview), output.
- [ ] Galeri template: buat booth dari template.
- [ ] Preview flow di Studio (memakai `packages/flow` + webcam laptop, payment mock).
- [ ] Publish: validasi → simpan `booth_configs` versi baru → set aktif → kirim sinyal realtime ke device.
- [ ] Riwayat versi + rollback ke versi sebelumnya.
- [ ] Pairing device: Kiosk menampilkan kode 6 digit → owner memasukkan di Studio → API membuat device token.
- [ ] Kiosk: ambil config aktif dari API, unduh aset, aktifkan versi baru hanya jika semua aset berhasil.
- [ ] Batas plan: jumlah booth, device, frame (tampilkan pesan upgrade).

## Acceptance criteria
- Owner membuat booth dari template, memindahkan dan mengubah ukuran `camera-view` dan keempat `photo-slot`, mengganti background, lalu Publish; Kiosk yang terpasang memperbarui tampilan dalam < 10 detik tanpa restart.
- Apa yang terlihat di canvas editor identik dengan Kiosk (uji screenshot Playwright, selisih piksel di bawah ambang).
- Undo/redo bekerja untuk semua operasi di atas.
- Publish ditolak dengan daftar masalah bila validasi gagal.
- Rollback ke versi lama berhasil dan device mengikutinya.
