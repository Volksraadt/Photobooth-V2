# F4 — Midtrans QRIS + voucher + cash + offline

Tujuan: pembeli membayar dengan QRIS ke akun Midtrans owner; booth tetap melayani saat offline.

## Task — Payment
- [ ] `packages/payments`: interface `PaymentProvider` + implementasi `midtrans` (Core API, `payment_type: qris`) + `mock`.
- [ ] Studio: halaman Integrasi Midtrans (server key, client key, merchant ID, sandbox/production), panduan onboarding, tombol Tes koneksi. Secret dienkripsi.
- [ ] API `POST /device/payments`: buat payment record dengan `order_id` idempoten, panggil provider owner, kembalikan QR string + `expires_at`.
- [ ] API `/webhooks/midtrans/:orgId`: verifikasi signature, update status, simpan fee, push realtime ke device.
- [ ] API `GET /device/payments/:id` untuk polling cadangan.
- [ ] Cancel payment saat pembeli kembali atau timeout.
- [ ] Tangani bayar setelah kedaluwarsa (`paid_late`): tampil di Studio sebagai kandidat refund.
- [ ] Kiosk: elemen `qris`, `payment-timer`, transisi otomatis ke capture saat lunas.

## Task — Voucher & cash
- [ ] Studio: buat voucher (satuan atau batch), terikat booth, nilai penuh atau nominal, masa berlaku; export daftar kode untuk dicetak.
- [ ] Sinkron daftar voucher (hash) ke Agent.
- [ ] Kiosk: elemen `voucher-input`; validasi lokal; tandai terpakai di SQLite; kirim ke API saat online.
- [ ] API: tolak pemakaian ganda, catat konflik sebagai `device_events`.
- [ ] Cash: operator approve dengan PIN di Kiosk; tercatat di `cash_approvals` dan audit log.

## Task — Offline
- [ ] Agent mendeteksi online/offline (heartbeat + cek koneksi).
- [ ] Kiosk menyembunyikan QRIS saat offline dan menampilkan voucher/cash sesuai `FlowConfig`.
- [ ] Sesi offline: kode sesi dibuat lokal, tersimpan lengkap, sinkron saat online.
- [ ] Mode event (gratis) melewati Payment.

## Acceptance criteria
- Pembayaran sandbox Midtrans lunas → Kiosk berpindah ke Capture dalam < 3 detik.
- Webhook dengan signature salah ditolak.
- Mengirim webhook yang sama dua kali tidak membuat dua sesi lunas.
- Cabut internet laptop: QRIS hilang, voucher valid diterima, voucher yang sama ditolak pada percobaan kedua, sesi tercetak; setelah internet kembali, sesi dan pemakaian voucher muncul di Studio.
- Server key Midtrans tidak pernah muncul di respons API ke device maupun di log.
