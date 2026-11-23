# F6 — Rekap penjualan, status device, langganan

Tujuan: owner memantau bisnis dan perangkat; platform menagih langganan dan menerapkan batas paket.

## Task — Rekap penjualan
- [ ] Dashboard: pendapatan kotor/bersih, jumlah sesi, rata-rata per sesi; filter tanggal, booth, device.
- [ ] Breakdown metode pembayaran, frame terlaris, filter populer, cetak tambahan.
- [ ] Grafik per jam dan per hari; perbandingan antar booth.
- [ ] Daftar transaksi + detail sesi (thumbnail, link Drive, status cetak & upload).
- [ ] Export CSV/Excel (sesuai plan).
- [ ] Materialized view `daily_booth_stats`, agregasi sesuai zona waktu booth.
- [ ] Penanda data belum tersinkron dari device.
- [ ] Daftar `paid_late` untuk ditindaklanjuti.

## Task — Status device & log
- [ ] Halaman Device: online/offline, heartbeat terakhir, versi app & config, status kamera/printer, cabut token.
- [ ] Antrian upload dengan retry.
- [ ] Event log per device dengan filter level/jenis.
- [ ] Counter cetak dan estimasi sisa kertas (owner mengisi kapasitas roll).
- [ ] Audit log dasar (publish, harga, kredensial, voucher, cash).

## Task — Langganan
- [ ] Halaman paket & upgrade di Studio.
- [ ] Integrasi pembayaran langganan memakai **akun Midtrans platform** (terpisah dari akun owner): tagihan bulanan + webhook `/webhooks/billing`.
- [ ] Status langganan, masa tenggang, downgrade otomatis.
- [ ] Middleware entitlement di API dan Studio memakai `plans.limits` + `plans.features`; config device membawa flag yang relevan.
- [ ] Panel admin platform sederhana: daftar org, plan, status, ubah plan manual.

## Acceptance criteria
- Angka di dashboard sama dengan hasil query manual pada data seed (test).
- Sesi pukul 23.30 WIB tercatat di tanggal yang benar walaupun disimpan UTC.
- Org Starter tidak bisa membuat booth kedua; setelah upgrade ke Pro bisa.
- Langganan telat bayar → banner peringatan, booth tetap jalan selama masa tenggang.
- Device offline > 5 menit tampil "offline" di Studio.
