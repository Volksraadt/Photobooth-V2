# F6 — Rekap penjualan, status device, langganan

Tujuan: owner memantau bisnis dan perangkat; platform menagih langganan dan menerapkan batas paket.

## Task — Rekap penjualan
- [x] Dashboard: pendapatan kotor/bersih, jumlah sesi, rata-rata per sesi; filter tanggal, booth, device.
- [x] Breakdown metode pembayaran, frame terlaris, filter populer, cetak tambahan.
- [x] Grafik per jam dan per hari; perbandingan antar booth.
- [x] Daftar transaksi + detail sesi (thumbnail, link Drive, status cetak & upload).
- [x] Export CSV/Excel (sesuai plan).
- [x] Materialized view `daily_booth_stats`, agregasi sesuai zona waktu booth.
- [x] Penanda data belum tersinkron dari device.
- [x] Daftar `paid_late` untuk ditindaklanjuti.

## Task — Status device & log
- [x] Halaman Device: online/offline, heartbeat terakhir, versi app & config, status kamera/printer, cabut token.
- [x] Antrian upload dengan retry.
- [x] Event log per device dengan filter level/jenis.
- [x] Counter cetak dan estimasi sisa kertas (owner mengisi kapasitas roll).
- [x] Audit log dasar (publish, harga, kredensial, voucher, cash).

## Task — Langganan
- [x] Halaman paket & upgrade di Studio.
- [x] Integrasi pembayaran langganan memakai **akun Midtrans platform** (terpisah dari akun owner): tagihan bulanan + webhook `/webhooks/billing`.
- [x] Status langganan, masa tenggang, downgrade otomatis.
- [x] Middleware entitlement di API dan Studio memakai `plans.limits` + `plans.features`; config device membawa flag yang relevan.
- [x] Panel admin platform sederhana: daftar org, plan, status, ubah plan manual.

## Acceptance criteria
- Angka di dashboard sama dengan hasil query manual pada data seed (test).
- Sesi pukul 23.30 WIB tercatat di tanggal yang benar walaupun disimpan UTC.
- Org Starter tidak bisa membuat booth kedua; setelah upgrade ke Pro bisa.
- Langganan telat bayar → banner peringatan, booth tetap jalan selama masa tenggang.
- Device offline > 5 menit tampil "offline" di Studio.

## Status verifikasi (2026-11-25)
- Semua task dikerjakan. Acceptance criteria lolos **otomatis** (tanpa akun Midtrans platform, dengan provider langganan tiruan):
  - Angka dashboard sama dengan query manual pada data seed: `packages/db/src/report-repo.test.ts` (fixture dihitung ulang dengan SQL mentah dan JS, via view terjadwal, hari ini live, filter perangkat, RLS) dan e2e `apps/studio/e2e/f6.spec.ts` (kartu, grafik, tabel di UI).
  - Sesi 23.30 WIB di tanggal yang benar: `report-repo.test.ts` (16.30 UTC → 20 Nov WIB; 17.30 UTC → 21 Nov WIB; booth WITA terpisah; jam 23 dan 0 di grafik per jam) dan e2e `f6.spec.ts`.
  - Starter tidak bisa booth kedua, setelah upgrade ke Pro bisa: `billing-repo.test.ts`, `apps/api/src/billing.test.ts` (checkout QRIS → webhook → plan aktif), e2e `f6.spec.ts` (UI: form dibuat diganti pesan batas, bayar, booth kedua dibuat).
  - Telat bayar → banner, booth tetap jalan selama masa tenggang: `billing-repo.test.ts` (state grace/downgraded dari jam, siklus idempoten), e2e `f6.spec.ts` (banner merah "tetap berjalan", heartbeat device tetap 200 dengan flag Pro; setelah masa tenggang flag Starter).
  - Device offline > 5 menit tampil offline: e2e `f6.spec.ts` (20 dtk online, 3 mnt tidak responsif, 6 mnt offline) dan `deviceConnectivity()` di `report-repo.ts`.
- **Belum diuji**: akun Midtrans **platform** sungguhan (charge + webhook, open-questions #37), harga paket nyata (#2), perangkat sungguhan untuk heartbeat/kertas. Langkah di `docs/testing/F6-manual.md`.
