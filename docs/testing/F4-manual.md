# F4 — Langkah uji manual (pembayaran + offline)

Uji ini melengkapi test otomatis (`pnpm test`, e2e `apps/studio/e2e/payments.spec.ts`). Jalankan
di laptop booth (Windows/macOS) dengan Kiosk + agent. Catat hasil (lolos/gagal, waktu, catatan)
di kolom paling kanan setiap tabel.

## 0. Persiapan

1. `.env` (salin dari `.env.example`):
   - `SECRET_MASTER_KEY` terisi (32 byte base64):
     `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
   - Untuk uji Midtrans sungguhan: `PB_PAYMENT_PROVIDER=midtrans` dan `PB_PUBLIC_API_URL=<URL tunnel ke :8787>`
     (mis. `cloudflared tunnel --url http://localhost:8787` → `https://xxxx.trycloudflare.com`).
   - Untuk uji tanpa akun Midtrans: `PB_PAYMENT_PROVIDER=mock` (bagian 3 diganti 3b).
2. `pnpm install`, `pnpm dev` (Postgres lokal + migrasi 0003, Studio :3000, API :8787, agent :47810, Kiosk :5173).
   Log API harus menampilkan `[api] payments: midtrans` (atau `mock`) tanpa peringatan SECRET_MASTER_KEY.
3. Di Studio: daftar/masuk → buat organisasi → buat booth dari template → di editor, **Pengaturan
   booth**: atur PIN admin 6–8 digit (mis. `246813`; R2), pastikan metode pembayaran QRIS + Voucher + Tunai aktif → Publish.
4. Buka Kiosk `http://localhost:5173/?source=agent&capture=mock&dev=1` → kode pairing → di Studio
   booth → Perangkat → masukkan kode. Kiosk menampilkan Cover.

## 1. Integrasi Midtrans (Studio → Integrasi)

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 1.1 | Buka menu **Integrasi** | Panduan onboarding 5 langkah, URL webhook `…/webhooks/midtrans/<orgId>` tampil | |
| 1.2 | Isi Merchant ID, Client key, Server key dan **Signature secret key** **Sandbox** (Dashboard Midtrans Sandbox → Settings → Access Keys; server key cukup izin Core API Write + Cancel Write), centang "Pakai lingkungan ini", Simpan | "tersimpan terenkripsi"; badge **aktif** pada Sandbox | |
| 1.3 | Reload halaman | Kolom server key kosong dengan teks "Tersimpan terenkripsi…"; key tidak terlihat di halaman maupun View Source | |
| 1.4 | **Tes koneksi** | "Terhubung ke Midtrans sandbox." Status: terhubung | |
| 1.5 | Ubah server key menjadi salah (mis. tambah huruf), Simpan, Tes koneksi | "Server key ditolak Midtrans sandbox…" Status: gagal. Kembalikan key yang benar | |
| 1.6 | Masuk sebagai operator (anggota role operator) | Halaman menolak: hanya owner/manager | |
| 1.7 | Di Dashboard Midtrans → Settings → Payment → Notification URL, isi URL webhook dari 1.1 | Tersimpan di Midtrans | |

## 2. Voucher (Studio → booth → Voucher)

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 2.1 | Buat 1 voucher Penuh tanpa masa berlaku | Satu kode `1234-5678-9012-3456` tampil + "kode tidak bisa ditampilkan lagi" | |
| 2.2 | Buat batch 10 voucher Nominal Rp50.000 berlaku s.d. besok, catatan "uji" | 10 kode; **Unduh CSV** menghasilkan file 10 baris (buka di Excel, kode utuh); **Cetak** membuka kartu siap cetak | |
| 2.3 | Reload | Daftar menampilkan `····-····-9012`, status **tersedia**; kode lengkap tidak muncul lagi | |
| 2.4 | Buat 1 voucher Nominal Rp1.000 (lebih kecil dari harga frame) — simpan untuk 5.6 | Tersedia | |
| 2.5 | Di Kiosk mode admin (5 ketukan kiri atas + PIN) → **Sinkron voucher** | "Voucher tersinkron: 12" (sesuai jumlah) | |

## 3. QRIS Midtrans Sandbox (online)

Ukur waktu dengan stopwatch atau video ponsel (layar simulator + layar Kiosk dalam satu bingkai).

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 3.1 | Kiosk: Cover → Pilih Frame → Lanjut | Halaman Payment: QRIS tampil < 3 dtk, timer berjalan dari 05:00 | |
| 3.2 | Di Dashboard Midtrans Sandbox → Transactions | Transaksi baru `pending`, payment type QRIS, nominal = harga frame | |
| 3.3 | Buka simulator QRIS sandbox `https://simulator.sandbox.midtrans.com/v2/qris/index` (akun lama: `/qris/index`), tempel URL gambar QR (Dashboard → detail transaksi, atau `payments.raw.charge.actions[0].url` di DB), **Pay** | Kiosk pindah ke **Capture < 3 dtk** setelah simulator menyatakan sukses | |
| 3.4 | Lanjutkan sesi sampai tercetak (printer virtual: file di `.data/agent/prints`) | Strip tercetak; halaman Result | |
| 3.5 | Studio → booth → **Transaksi** | Sesi tampil: QRIS, kotor = harga, fee = 0,7 %, bersih = kotor − fee, status selesai | |
| 3.6 | Tanpa tunnel (hapus `PB_PUBLIC_API_URL`, matikan Notification URL), ulangi 3.1–3.3 | Kiosk tetap pindah ke Capture lewat polling (≤ ±5 dtk). Catat waktunya | |
| 3.7 | Payment → biarkan QR, tekan **Kembali** | Kembali ke Pilih Frame; di Dashboard Midtrans transaksi menjadi `cancel` | |
| 3.8 | Payment → tunggu timer habis | Kembali ke Pilih Frame; transaksi `cancel`/`expire` | |
| 3.9 | **Bayar setelah batal**: Payment → salin URL QR → Kembali → bayar URL tadi di simulator | Kiosk tidak berubah; Studio → **Integrasi → Kandidat refund** (dan booth → Transaksi) menampilkan sesi tersebut (`paid_late`) | |

### 3b. Varian tanpa Midtrans (`PB_PAYMENT_PROVIDER=mock`)
Langkah 3.1, lalu ambil `paymentId` dari tombol dev Kiosk (`?dev=1`) atau `window.__pbKiosk.snapshot().context.session.paymentId`, lalu
`curl -X POST http://localhost:8787/dev/payments/<paymentId>/simulate-paid` → Kiosk pindah ke Capture < 3 dtk.

## 4. Webhook: signature & idempotensi

Ambil body notifikasi asli: Dashboard Midtrans → transaksi 3.3 → riwayat notifikasi (atau buat dengan
skrip di bawah memakai server key sandbox Anda; jangan simpan skrip berisi key di repo).

```bash
ORDER=<order_id dari 3.3>; ORG=<orgId dari URL webhook>; KEY=<server key sandbox>
SIG=$(node -e "console.log(require('crypto').createHash('sha512').update(process.argv[1]+'200'+process.argv[2]+'.00'+process.argv[3]).digest('hex'))" "$ORDER" <harga> "$KEY")
BODY="{\"order_id\":\"$ORDER\",\"status_code\":\"200\",\"gross_amount\":\"<harga>.00\",\"transaction_status\":\"settlement\",\"signature_key\":\"$SIG\"}"
```

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 4.1 | `curl -i -X POST localhost:8787/webhooks/midtrans/$ORG -H 'content-type: application/json' -d "${BODY/$SIG/$(printf 'f%.0s' {1..128})}"` (signature diganti) | **HTTP 401** `invalid_signature`; log API hanya berisi org + order id | |
| 4.2 | Ubah `gross_amount` di body tanpa menghitung ulang signature | **401** | |
| 4.3 | Kirim `BODY` yang benar dua kali | Keduanya **200**; di DB `select status, count(*) from payments where session_id = (select session_id from payments where order_id='$ORDER') group by 1;` → tepat satu `paid`; tidak ada sesi lunas kedua | |
| 4.4 | Kirim body benar dengan `order_id` acak (signature dihitung untuk order tsb.) | **200** `ignored` | |
| 4.5 | Dashboard Midtrans → Settings → **Test notification** | 200 (diabaikan) | |

## 5. Offline (cabut internet laptop)

Gunakan voucher dari bagian 2 yang belum dipakai. Mode admin menampilkan status agent (online/offline,
antrian sesi/voucher/tunai).

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 5.1 | Cabut kabel LAN / matikan Wi-Fi laptop (agent + kiosk tetap berjalan) | Dalam ≤ 35 dtk mode admin menunjukkan **offline**; event `went_offline` tercatat | ✅ 2026-11-25 (Wi-Fi dicabut sungguhan) |
| 5.2 | Mulai sesi → Payment | **QRIS dan timer tidak tampil**; voucher (kolom + keypad) dan tombol Tunai tampil; tidak ada halaman Error | ✅ 2026-11-25 |
| 5.3 | Ketik kode voucher A (keypad layar atau keyboard) → ✓ | Pindah ke Capture | ✅ 2026-11-25 (sesi 5RL6NF7W, 857UM8VM) |
| 5.4 | Selesaikan sesi sampai tercetak | Strip tercetak; QR di strip = `…/s/<KODE>` (kode sesi lokal) | ✅ 2026-11-25 |
| 5.5 | Sesi baru → Payment → masukkan voucher A lagi | Ditolak: "Voucher sudah dipakai"; tetap di Payment | ✅ 2026-11-25 "Voucher sudah dipakai" (voucher …4628 dipakai offline sesi sebelumnya) |
| 5.6 | Masukkan voucher nominal Rp1.000 (2.4) | "Nilai voucher kurang" | ✅ 2026-11-25 |
| 5.7 | Masukkan kode acak 16 digit | "Voucher tidak valid" | ✅ 2026-11-25 |
| 5.8 | Tekan **Tunai** → PIN pad "Pembayaran tunai" → PIN salah | "PIN salah…" | ✅ 2026-11-25 "PIN salah. Sisa percobaan: 4." Catatan: pad mulai dengan 4 titik → terkesan PIN 4 digit (perbaikan UI menyusul) |
| 5.9 | PIN benar | Pindah ke Capture; selesaikan sesi (tercetak) | ✅ 2026-11-25 sesi 2N699SSM tercetak |
| 5.10 | Mode admin | Antrian: sesi 2, voucher 1, tunai 1 (belum terkirim) | ✅ 2026-11-25 (hanya sesi tunai): session 1, cash_approval 1, print_job 1, upload 1 (HTTP 530) |
| 5.11 | Sambungkan internet lagi | ≤ 5 dtk status **online**; antrian menjadi 0; QRIS muncul lagi bila sedang di Payment | ✅ 2026-11-25 lewat proxy lokal yang meniru 530 Cloudflare: online 3 dtk, antrian + upload kosong 8 dtk (sebelum fix 6e803e7 ±5 mnt) |
| 5.12 | Studio → booth → **Transaksi** | Dua sesi offline (Voucher, Tunai) dengan penanda **offline**, status selesai | ✅ 2026-11-25 voucher di UI; tunai 2N699SSM dicek di DB: completed, cash, Rp35.000, offline |
| 5.13 | Studio → booth → **Voucher** | Voucher A: "Terpakai sesi <KODE> · offline" | ✅ 2026-11-25 |
| 5.14 | Audit log: `select action, after from audit_logs where action='cash.approve' order by at desc limit 1;` | Ada; `amount`, `deviceId`, `offline: true` | ✅ 2026-11-25 amount 35000, deviceId, offline true, approvedWith booth_admin_pin |

### 5b. Konflik voucher dua perangkat (opsional, paket dengan ≥ 2 device)
Kedua laptop offline, pakai voucher yang sama di keduanya → keduanya diterima lokal. Sambungkan
keduanya → yang kedua sampai ditolak API: Studio/DB `device_events.kind = 'voucher_conflict'` untuk
sesi tersebut (sesi tetap tercatat; tindak lanjut manual).

## 6. Server key tidak pernah ke device / log

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 6.1 | Setelah bagian 3–5: `grep -r "<server key>" .data/agent` (Windows: `findstr /s /c:"<key>" .data\agent\*`) | Tidak ada hasil (SQLite, file sesi, token) | |
| 6.2 | Cari key di output terminal `pnpm dev` (simpan log: `pnpm dev > dev.log 2>&1`) | Tidak ada | |
| 6.3 | DevTools Kiosk → Network: semua respons `/payments*`, `/config/state`, `/status` | Tidak ada key; respons payment hanya `id, status, amount, qrString, expiresAt, paidAt` | |
| 6.4 | `select encrypted_secret from payment_credentials;` | Diawali `v1.`; bukan key polos | |
| 6.5 | `select after from audit_logs where action like 'integration.midtrans%';` | Hanya `serverKeyChanged: true/false`, tanpa key | |

## 7. Mode event

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| 7.1 | Editor → aktifkan Mode event → Publish | — | |
| 7.2 | Kiosk: Cover → Pilih Frame → Lanjut | Langsung ke Capture tanpa Payment; Transaksi Studio: metode **Gratis**, Rp0 | |
