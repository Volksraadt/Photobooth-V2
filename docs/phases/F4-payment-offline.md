# F4 — Midtrans QRIS + voucher + cash + offline

Tujuan: pembeli membayar dengan QRIS ke akun Midtrans owner; booth tetap melayani saat offline.

## Task — Payment
- [x] `packages/payments`: interface `PaymentProvider` + implementasi `midtrans` (Core API, `payment_type: qris`) + `mock`.
- [x] Studio: halaman Integrasi Midtrans (server key, client key, merchant ID, sandbox/production), panduan onboarding, tombol Tes koneksi. Secret dienkripsi.
- [x] API `POST /device/payments`: buat payment record dengan `order_id` idempoten, panggil provider owner, kembalikan QR string + `expires_at`.
- [x] API `/webhooks/midtrans/:orgId`: verifikasi signature, update status, simpan fee, push realtime ke device.
- [x] API `GET /device/payments/:id` untuk polling cadangan.
- [x] Cancel payment saat pembeli kembali atau timeout.
- [x] Tangani bayar setelah kedaluwarsa (`paid_late`): tampil di Studio sebagai kandidat refund.
- [x] Kiosk: elemen `qris`, `payment-timer`, transisi otomatis ke capture saat lunas.

## Task — Voucher & cash
- [x] Studio: buat voucher (satuan atau batch), terikat booth, nilai penuh atau nominal, masa berlaku; export daftar kode untuk dicetak.
- [x] Sinkron daftar voucher (hash) ke Agent.
- [x] Kiosk: elemen `voucher-input`; validasi lokal; tandai terpakai di SQLite; kirim ke API saat online.
- [x] API: tolak pemakaian ganda, catat konflik sebagai `device_events`.
- [x] Cash: operator approve dengan PIN di Kiosk; tercatat di `cash_approvals` dan audit log.

## Task — Offline
- [x] Agent mendeteksi online/offline (heartbeat + cek koneksi).
- [x] Kiosk menyembunyikan QRIS saat offline dan menampilkan voucher/cash sesuai `FlowConfig`.
- [x] Sesi offline: kode sesi dibuat lokal, tersimpan lengkap, sinkron saat online.
- [x] Mode event (gratis) melewati Payment.

## Acceptance criteria
- Pembayaran sandbox Midtrans lunas → Kiosk berpindah ke Capture dalam < 3 detik.
- Webhook dengan signature salah ditolak.
- Mengirim webhook yang sama dua kali tidak membuat dua sesi lunas.
- Cabut internet laptop: QRIS hilang, voucher valid diterima, voucher yang sama ditolak pada percobaan kedua, sesi tercetak; setelah internet kembali, sesi dan pemakaian voucher muncul di Studio.
- Server key Midtrans tidak pernah muncul di respons API ke device maupun di log.

## Status verifikasi (F4)
| Kriteria | Otomatis | Manual (`docs/testing/F4-manual.md`) |
|---|---|---|
| Lunas → Capture < 3 dtk | e2e Studio `payments.spec.ts` (mock provider, jalur webhook → stream → agent → kiosk: ±100 ms); `apps/agent/src/money.test.ts` | §3 dengan Midtrans **sandbox** sungguhan + tunnel webhook — belum dijalankan di repo ini (butuh akun sandbox owner) |
| Signature salah ditolak | `apps/api/src/payments.test.ts`, `packages/payments/src/midtrans.test.ts` | §4 |
| Webhook ganda tidak menggandakan | `apps/api/src/payments.test.ts` | §4 |
| Offline: QRIS hilang, voucher 1× , cetak, sinkron | `apps/agent/src/money.test.ts` (API dimatikan/dinyalakan), flow + renderer test | §5 (cabut internet sungguhan) |
| Server key tidak bocor | `apps/api/src/payments.test.ts` (setiap respons + log), e2e Studio, scan log dev + data agent | §6 |
