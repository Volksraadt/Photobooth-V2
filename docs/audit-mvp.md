# Audit MVP (F0–F6)

Tanggal: 2026-11-25 · Commit yang diaudit: `b9d58b8` (master, working tree bersih).

> **Status: semua temuan T1–T3, S1–S6, R1–R8 sudah diperbaiki** (belum di-commit). Ringkasan perbaikan dan bukti test ada di bagian [Status perbaikan](#status-perbaikan) di akhir dokumen; detail keputusan di `docs/decisions.md` › "Audit MVP".

Cakupan: acceptance criteria F0–F6, isolasi `org_id`, secret, token device, webhook, serta penanganan offline dan error di Kiosk. Sumber: `PRD.md`, `CLAUDE.md`, `docs/decisions.md`, `docs/open-questions.md`, `docs/phases/F0`–`F6`, dan pembacaan kode `apps/api`, `apps/agent`, `apps/kiosk`, `apps/worker`, `apps/studio` (auth, server action, route), `packages/db` (repo + migrasi RLS), `packages/payments`, `packages/flow`, `packages/crypto`.

Tingkat: **Tinggi** = bisa merugikan uang/data/tenant atau melanggar invarian CLAUDE.md di produksi · **Sedang** = celah nyata dengan syarat tertentu, atau risiko operasional di booth · **Rendah** = pengerasan, kebersihan, atau dampak kecil.

---

## Ringkasan

| # | Tingkat | Temuan | Area |
|---|---|---|---|
| T1 | Tinggi | SSRF di worker: URL aset dari config diambil tanpa pembatasan host dan tanpa cek sha256 | worker, schema |
| T2 | Tinggi | Pembeli sudah bayar QRIS tapi booth offline saat konfirmasi → sesi hilang, tercatat sebagai pendapatan, tidak masuk kandidat refund | flow, agent, api |
| T3 | Tinggi (mode Supabase) | Tabel `public` terbuka lewat Supabase Data API: owner/manager bisa menulis langsung, melewati batas paket, validasi publish, dan audit log | db/RLS, Supabase |
| S1 | Sedang | Webhook Midtrans mempercayai `transaction_status` yang tidak ikut ditandatangani | api, payments |
| S2 | Sedang | Endpoint publik tanpa rate limit; `/pair/start` bisa membanjiri ruang kode 6 digit sehingga salah ketik memasangkan kiosk penyerang | api |
| S3 | Sedang | Kiosk masih bisa layar putih: hanya `PageRenderer` yang dibungkus error boundary | kiosk |
| S4 | Sedang | Hash voucher di laptop bisa dibalik dalam hitungan jam (salt per booth, 12 digit, 20.000 iterasi) | crypto, agent |
| S5 | Sedang | OAuth Google Drive: `state` tidak terikat ke sesi browser (Drive korban bisa terhubung ke org penyerang) | api |
| S6 | Sedang | Config dari agent yang tidak valid diabaikan diam-diam → Kiosk macet di "Menghubungkan…" | kiosk |
| R1 | Rendah | Stream SSE device tetap terbuka setelah token dicabut | api |
| R2 | Rendah | PIN admin/tunai minimal 4 digit, hash ada di config device, kunci 60 dtk hilang saat agent restart | schema, agent |
| R3 | Rendah | Sinkron sesi dengan `paymentMethod: 'free'` menimpa uang sesi yang sudah lunas | db |
| R4 | Rendah | Antrian unggah agent berhenti satu putaran saat satu sesi gagal karena error non-jaringan | agent |
| R5 | Rendah | Worker memakai `downloadUrl` dari manifest device untuk QR composite tanpa dicek | worker |
| R6 | Rendah | Upload file device dibaca penuh ke memori sebelum batas ukuran bila tanpa `Content-Length` | api |
| R7 | Rendah | Token device di file `0600` tidak berarti apa-apa di Windows (sudah tercatat #20) | agent |
| R8 | Rendah | `pnpm format:check` gagal di mesin Windows ini (CRLF dari `core.autocrlf`), CI tidak terdampak | repo |
| R9 | Info | Pengecekan peran di server action Studio memakai org aktif, bukan org milik booth (RLS tetap menegakkan) | studio |

---

## Tinggi

### T1 — SSRF di worker lewat URL aset config
**Di mana:** `apps/worker/src/assets.ts:22-40`, `packages/schema/src/booth-config.ts:73` (`url: z.string().min(1)`), `apps/studio/src/app/(editor)/booths/[boothId]/editor/actions.ts:37` (`publishAction(boothId, config: unknown)`).

**Masalah:** `AssetRef.url` boleh string apa saja. Config dikirim utuh dari browser ke server action publish dan hanya divalidasi bentuknya. Saat memproses sesi (`process-session`), worker memanggil `fetch(ref.url)` untuk overlay frame, logo, latar video, musik, font, tanpa allowlist host, tanpa larangan IP privat/link-local, tanpa batas ukuran, dan **tanpa mencocokkan sha256** dengan `AssetRef.sha256` (agent mencocokkannya; worker tidak).

**Dampak:** siapa pun yang bisa mendaftar (owner baru, trial Pro otomatis) bisa membuat worker di cloud meminta alamat internal (mis. `http://169.254.169.254/…` metadata cloud, Redis/HTTP internal). Kode status bocor lewat pesan error job yang tampil di Studio (`Aset …: HTTP 403`), jadi bisa dipakai memindai port/jaringan internal. Bila respons bisa didekode sebagai gambar, isinya masuk ke file output di Drive owner. Selain itu, tanpa cek sha256, isi aset bisa berbeda dari yang dicetak booth (WYSIWYG tidak terjamin).

**Saran:** (1) worker hanya mengambil URL yang berawalan base storage platform sendiri (Studio `/media/` atau bucket Supabase), menolak IP privat/loopback/link-local setelah resolusi DNS, dan tidak mengikuti redirect; (2) verifikasi sha256 + `bytes` seperti agent; (3) Studio menolak `AssetRef.url` di luar storage platform saat simpan/publish (selain `data:` bawaan).

### T2 — Bayar QRIS saat booth putus internet: sesi hilang dan tidak masuk refund
**Di mana:** `packages/flow/src/machine.ts:523-527` (kedaluwarsa → `framePick` + `releasePayment`), `apps/kiosk/src/payment-bridge.ts`, `apps/agent/src/money.ts:163-172` (cancel lewat outbox), `packages/db/src/payment-repo.ts:507-517` (`markPaymentCanceled` hanya mengubah `pending`), `payment-repo.ts:340` (`already_paid`), `payment-repo.ts:726-741` (`listRefundCandidates` hanya `paid_late`).

**Skenario:** QRIS tampil → internet booth putus → pembeli tetap membayar (HP pembeli online) → webhook sampai di API, payment = `paid`, sesi = `qris` lunas. Agent tidak bisa bertanya ke API, Kiosk menyembunyikan QR (`qrisHidden`) dan setelah `qrisExpirySec` flow kembali ke Pilih Frame serta mengantrikan cancel. Saat online lagi:
- cancel dari outbox tidak mengubah apa pun (status sudah `paid`), sehingga pembayaran **tidak** muncul sebagai kandidat refund;
- sesi tercatat sebagai pendapatan QRIS di rekap, padahal tidak ada foto/cetak;
- bila pembeli mencoba bayar lagi untuk sesi yang sama, API menjawab `409 already_paid`, yang tidak ditangani agent/flow → halaman Error, lalu sesi dibuang.

Hal yang sama terjadi bila webhook terlambat lebih lama dari timer Kiosk tetapi masih dalam batas `expires_at + 60 dtk` di API.

**Dampak:** pembeli kehilangan uang tanpa jejak yang jelas untuk owner; rekap pendapatan salah; melanggar tujuan PRD ("tidak ada sesi yang hilang", "≥ 99% sesi dibayar berakhir dengan cetakan").

**Saran:** (1) jawaban `already_paid` (dan status `paid` saat cancel) diperlakukan sebagai lunas: Kiosk lanjut ke Capture bila sesi masih di layar; (2) payment `paid` yang menerima cancel, atau sesi lunas yang tidak selesai dalam N menit, ditandai "perlu tindak lanjut" dan tampil bersama kandidat refund di Studio; (3) pertimbangkan: saat offline di halaman Payment dengan QR yang sudah tampil, jangan langsung batalkan; tampilkan pesan "menunggu konfirmasi" sampai online atau operator memutuskan.

### T3 — Supabase Data API membuka tulis langsung ke tabel konfigurasi (mode Supabase)
**Di mana:** `packages/db/drizzle/0001_rls.sql:103` (`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES … TO authenticated`) + policy `booths_editor_insert`, `booth_configs_editor_insert`, `booths_editor_update`, `devices_editor_update`; `supabase/config.toml` tidak membatasi skema yang diekspos (default `public` diekspos PostgREST).

**Masalah:** Studio sengaja tidak memakai PostgREST (keputusan F0: Drizzle server-side + RLS). Namun di proyek Supabase, siapa pun yang login memegang JWT + anon key publik (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) dan bisa memanggil `/rest/v1/*` langsung. RLS hanya memeriksa keanggotaan/peran, sedangkan aturan bisnis ada di kode aplikasi (`booth-repo.ts:77-80`, `:142-144`). Akibatnya owner/manager bisa:
- membuat booth melebihi `maxBooths` (AC F6 "Starter tidak bisa membuat booth kedua" bisa dilewati) dan config melebihi `maxFrames`;
- memasukkan `booth_configs` + mengganti `booths.active_config_id` tanpa `validateBoothConfig` dan tanpa audit log publish;
- mengubah `devices.revoked_at` (membatalkan pencabutan) atau `devices.token_hash` (manager bisa "mengambil alih" device);
- membaca `payments.raw` (berisi body notifikasi termasuk `signature_key`).

Tidak ada kebocoran lintas org (RLS menahan), tetapi gating paket dan jejak audit tidak bisa diandalkan.

**Saran:** matikan Data API untuk skema `public` di proyek Supabase (Studio tidak membutuhkannya), atau pindahkan tabel ke skema yang tidak diekspos; sebagai lapisan kedua, tegakkan batas paket di DB (trigger `BEFORE INSERT` pada `booths`/`booth_configs`) dan batasi kolom yang boleh di-UPDATE (`GRANT UPDATE (name, paper_capacity, …)`). Tambahkan test RLS yang mencoba jalur ini.

---

## Sedang

### S1 — Webhook Midtrans mempercayai status yang tidak ditandatangani
**Di mana:** `packages/payments/src/midtrans.ts:214-229`, `signature.ts:4-13`, `apps/api/src/routes/webhook-routes.ts`, `billing-webhook-routes.ts`.

Signature Midtrans hanya mencakup `order_id + status_code + gross_amount + serverKey`. `transaction_status` (yang menentukan `paid`) tidak ikut. Notifikasi `settlement` dan `cancel` sama-sama `status_code: "200"`, jadi body bertanda tangan sah untuk satu status bisa diputar ulang dengan status lain. Butuh body asli (mis. dari log/proxy, atau `payments.raw` yang terbaca anggota org lewat T3). Dampak saat ini kecil karena urutan cancel → `paid_late`, tetapi untuk `/webhooks/billing` hasilnya bisa langganan aktif tanpa bayar.

**Saran:** setelah signature valid, konfirmasi status lewat `provider.getStatus(orderId)` (GET `/v2/<order>/status`) sebelum menerapkan `paid`; ini juga yang direkomendasikan Midtrans. Jangan simpan `signature_key` di `raw`.

### S2 — Tidak ada rate limit; pairing bisa dibajak lewat salah ketik
**Di mana:** `apps/api/src/routes/device-routes.ts:188-206`, `packages/db/src/device-repo.ts:24-49`, `:83-134`.

`/pair/start` tidak berautentikasi dan setiap panggilan menulis baris `pairing_codes` (10 menit). Ruang kode hanya 1.000.000. Penyerang yang membanjiri endpoint ini bisa memegang sebagian besar kode aktif, sehingga owner yang salah ketik satu digit di Studio memasangkan **kiosk penyerang** ke booth-nya. Studio tidak menampilkan apa pun tentang perangkat sebelum klaim. Device token itu lalu bisa membaca config (termasuk hash PIN), daftar hash voucher (S4), membuat QRIS ke akun owner, dan mengirim sesi/tunai palsu. Endpoint publik lain (`/pair/status`, `/webhooks/*`, `/s/:code`) juga tanpa pembatasan.

**Saran:** rate limit per IP (mis. `hono-rate-limiter` atau di reverse proxy), batas jumlah kode aktif, dan konfirmasi di Studio (tampilkan fingerprint/nama perangkat dari `pairing_codes.device_fingerprint` sebelum dipasang) atau kode lebih panjang.

### S3 — Kiosk masih bisa layar putih
**Di mana:** `apps/kiosk/src/kiosk.tsx:188-214` (boundary hanya di sekitar `PageRenderer`), `main.tsx`, `app.tsx`, `agent/agent-app.tsx`.

`AdminPanel` (676 baris), `PinPad`, banner, notice, `AgentApp`/`DeviceScreen`/`FileApp`/`SystemScreen` berada di luar error boundary. Di React 19, error render yang tidak tertangkap melepas seluruh root → layar putih, melanggar invarian "tidak boleh layar putih". Tidak ada handler `window.onerror`/`unhandledrejection` atau reload otomatis tingkat atas. Selain itu, fallback boundary untuk halaman selain Error adalah layar hitam yang menunggu flow pindah; bila event `FAIL` tidak diterima di state itu (mis. saat `admin`), layar hitam bertahan.

**Saran:** boundary tingkat root di `main.tsx` (SystemScreen + reload 30 dtk, sama seperti fallback halaman Error), boundary terpisah untuk panel admin/PIN pad, dan e2e yang memaksa error di komponen admin.

### S4 — Hash voucher offline bisa dibalik
**Di mana:** `packages/crypto/src/voucher.ts`, keputusan F4 (PBKDF2 20.000 iterasi, salt `pb-voucher:v1:<boothId>`, kode 12 digit), `GET /device/vouchers`.

Karena salt sama untuk semua voucher satu booth, satu tebakan langsung diuji terhadap semua hash. Dengan 500 voucher aktif, rata-rata ±2×10⁹ tebakan × 20.000 iterasi untuk menemukan satu kode: kira-kira satu jam di satu GPU modern. Siapa pun yang bisa membaca disk laptop booth (staf) atau memegang token device (S2) bisa memperoleh kode voucher yang masih berlaku.

**Saran:** kode lebih panjang (16 digit atau alfanumerik), iterasi lebih tinggi atau scrypt/argon2, dan hanya menyinkronkan voucher yang belum terpakai dan belum kedaluwarsa. Catat sebagai keputusan baru di `docs/decisions.md`.

### S5 — OAuth Google Drive: `state` tidak terikat ke browser
**Di mana:** `apps/api/src/routes/drive-routes.ts:105-121`, `:266-336`.

`state` terenkripsi mengikat org + user + kedaluwarsa, tetapi tidak terikat ke sesi browser yang memulai. Penyerang bisa membuat URL consent untuk org-nya sendiri lalu mengirimnya ke korban; bila korban menyetujui, Google Drive **korban** terhubung ke org penyerang (foto booth penyerang masuk ke Drive korban, e-mail korban tampil di Studio penyerang). Callback juga tidak memeriksa ulang bahwa user masih owner/manager org tersebut.

**Saran:** saat `/connect`, Studio menyimpan nonce di cookie httpOnly dan menyertakannya di `state`; callback (lewat Studio, atau API dengan cookie domain yang sama) memeriksa kecocokannya. Periksa ulang peran sebelum menyimpan.

### S6 — Config tidak valid dari agent diabaikan diam-diam
**Di mana:** `apps/kiosk/src/agent/agent-app.tsx:280-293`.

Bila `migrateBoothConfig` gagal (mis. config dari Studio versi lebih baru dari Kiosk, atau T3), Kiosk hanya menulis ke console dan tidak mengubah state. Pada start pertama layar tetap "Menghubungkan…" tanpa penjelasan; tidak ada `device_event`, jadi owner tidak tahu di Studio.

**Saran:** tampilkan SystemScreen "Booth belum siap" berisi daftar masalah, dan kirim event `config_invalid` lewat agent. Tambahkan pengecekan versi schema di agent sebelum mengaktifkan.

---

## Rendah

- **R1 — SSE setelah pencabutan.** `deviceAuth` hanya dicek saat koneksi `/device/stream` dibuka (`device-routes.ts:239-289`); device yang dicabut tetap menerima sinyal config/pembayaran (tanpa data) sampai koneksi putus. Saran: periksa ulang `revoked_at` di setiap keep-alive, atau putuskan stream saat `revokeDevice`.
- **R2 — PIN admin/tunai.** PIN 4–8 digit; hash PBKDF2 ada di config yang dikirim ke device sehingga PIN 4 digit bisa dibalik dalam hitungan detik oleh siapa pun yang punya file config/token device. Kunci 5×salah/60 dtk di agent (`money.ts:36-37`) disimpan di memori dan hilang saat agent restart. Saran: minimal 6 digit, kunci tersimpan di SQLite, dan PIN tunai per staf (sudah direncanakan F7, #27).
- **R3 — `free` menimpa uang.** `syncDeviceSession` (`payment-repo.ts:695-707`) menulis `paymentMethod: 'free'` + nominal 0 tanpa memeriksa apakah sesi sudah lunas lewat QRIS/voucher/tunai. Hanya terjadi bila device mengirim data salah, tetapi rekap jadi salah. Saran: `free` hanya berlaku bila `existing.paymentMethod` kosong; selain itu catat `sync_conflict`.
- **R4 — Antrian unggah.** `UploadQueue.onFailure` (`uploads.ts:178-206`) mengembalikan `false` untuk error non-HTTP (mis. file rusak/hash tidak cocok, sesi tanpa foto terpilih), sehingga putaran berhenti dan sesi lain menunggu putaran berikutnya. Sesi rusak dicoba terus tanpa batas dan hanya terlihat sebagai event. Saran: bedakan error jaringan dari error permanen; tandai sesi permanen gagal agar tampil di Studio.
- **R5 — `downloadUrl` dari manifest.** Worker membuat ulang composite dengan QR dari `manifest.downloadUrl` (`packages/storage/src/manifest.ts:31`) tanpa memastikan nilainya `<shortLinkBase>/s/<kode sesi>`. Invarian "QR selalu ke short link" bergantung pada device. Saran: worker membangun URL sendiri dari kode sesi.
- **R6 — Upload tanpa `Content-Length`.** `output-routes.ts:313-327` membaca seluruh body (`arrayBuffer()`) sebelum memeriksa 60 MB bila header tidak ada (chunked). Hanya device terautentikasi. Saran: `bodyLimit` Hono seperti di agent.
- **R7 — Token device di Windows.** File `device-token` mode `0600` tidak membatasi apa pun di NTFS; user lain di laptop bisa membacanya. Sudah tercatat di open-questions #20; layak dinaikkan prioritasnya sebelum launch karena dikombinasikan dengan S4/R2.
- **R8 — Format check lokal.** `pnpm format:check` gagal di 48 file karena checkout Windows memakai CRLF (`core.autocrlf=true`), sementara isi repo LF dan CI Linux lolos. Saran: `.gitattributes` dengan `* text=auto eol=lf`.
- **R9 — Info: peran di server action.** `editor()` di `apps/studio/src/app/(app)/booths/[boothId]/actions.ts:10-14` memeriksa peran di org aktif (cookie), bukan org pemilik `boothId`. RLS (`has_org_role`) tetap menolak, jadi bukan celah, hanya pesan error yang bisa membingungkan.

Hal yang diperiksa dan **tidak** ditemukan bermasalah: semua query device di API di-scope `device.orgId`/`boothId`; webhook mencari payment per `(org_id, order_id)` dan memverifikasi dengan kunci org + env yang membuat charge; server key Midtrans dan refresh token Drive hanya didekripsi di API/worker, dengan AAD per org, tidak pernah dikembalikan atau dicatat; `payment_credentials`, `drive_connections`, `pairing_codes` tertutup RLS; semua 25 tabel mengaktifkan RLS; materialized view rekap tidak bisa dibaca langsung; nominal QRIS diverifikasi terhadap harga frame di versi config; `applyPaymentStatus` mengunci sesi sehingga webhook ganda tidak membuat dua sesi lunas; token device disimpan sebagai sha256 dan dicek bersama `revoked_at`; agent menghapus file lokal hanya setelah `complete` sukses; API lokal agent memeriksa `Host` + `Origin`; server LAN kamera memakai kode sekali pakai 128-bit + token 256-bit; short link tidak membocorkan data sesi; aset Studio disajikan dengan CSP `sandbox`; ekspor CSV menetralkan formula.

---

## Status acceptance criteria F0–F6

Dijalankan ulang di mesin dev Windows ini pada 2026-11-25:

| Pemeriksaan | Hasil |
|---|---|
| `pnpm typecheck` | lolos (17 paket) |
| `pnpm lint` | lolos |
| `pnpm test` (vitest) | lolos, 300 test di 16 paket |
| `pnpm format:check` | gagal lokal karena CRLF (R8); CI Linux tidak terdampak |
| e2e Kiosk F1 (`apps/kiosk` `test:e2e`) | lolos, 10/10 (1,2 mnt) |
| e2e Kiosk F3 (`test:e2e:f3`, agent + Camera App tiruan) | lolos, 2/2 (41 dtk) |
| e2e Studio F0/F2/F4/F5/F6 (`apps/studio` `test:e2e`, stack penuh, Midtrans/billing/Google tiruan) | lolos, 13/13 (2,2 mnt) |

Per fase (semua otomatis terhadap provider tiruan dan Postgres lokal):

| Fase | Status | Catatan |
|---|---|---|
| F0 | AC lolos, satu task terbuka | Task "proyek Supabase dev + uji login" masih belum dicentang (#12). "Org A tidak bisa membaca booth org B" lolos (`rls.test.ts` + e2e), tetapi lihat T3 untuk jalur tulis lewat Data API di mode Supabase. |
| F1 | AC lolos | Invarian "tidak boleh layar putih" hanya terpenuhi untuk halaman flow; lihat S3. |
| F2 | AC lolos | — |
| F3 | AC lolos (loopback) | Perangkat fisik (iPad, Wi-Fi booth, printer dye-sub) belum diuji (#23). |
| F4 | AC lolos (mock provider) | Midtrans sandbox sungguhan belum diuji (#24). "Signature salah ditolak" lolos, tetapi lihat S1. Skenario offline T2 tidak tercakup AC. |
| F5 | AC lolos (FakeGoogle) | Google sungguhan, Redis, Supabase Storage belum diuji (#30, #33, #34). |
| F6 | AC lolos (billing tiruan) | Akun Midtrans platform belum diuji (#37). "Starter tidak bisa booth kedua" bisa dilewati lewat Data API di mode Supabase (T3). |

---

## Urutan perbaikan yang disarankan

1. **T1** (SSRF) dan **T3** (Data API) sebelum deploy ke cloud/Supabase mana pun: keduanya bisa dieksploitasi oleh siapa saja yang mendaftar.
2. **T2** sebelum booth dipakai melayani pembeli dengan QRIS di lokasi berinternet tidak stabil.
3. **S1**, **S2**, **S3**, **S5**, **S6** sebelum launch.
4. **S4** dan **R2/R7** bersama (semuanya soal rahasia yang tersimpan di laptop booth).
5. Sisanya (R1, R3–R6, R8) kapan saja.

---

## Status perbaikan

Dikerjakan 2026-11-25 atas permintaan "perbaiki semua". Setiap perbaikan punya test baru (atau test lama yang disesuaikan).

| # | Perbaikan | Bukti |
|---|---|---|
| T1 | `isAllowedAssetUrl()` + `PB_ASSET_URL_PREFIXES`; Studio menolak simpan/publish aset luar; worker tanpa redirect, batas 100 MB, cek sha256 (`asset_rejected`) | `packages/schema/src/asset-urls.test.ts`, `apps/worker/src/assets.test.ts` |
| T2 | Flow `payment.confirming`/`verifying` (tidak membatalkan QRIS yang mungkin sudah dibayar saat offline), `already_paid` → Capture, kandidat refund "lunas, sesi tidak selesai" | `packages/flow/src/machine.test.ts` (4 test baru), `apps/api/src/payments.test.ts`, `packages/db/src/payment-repo.test.ts` |
| T3 | Data API Supabase mati (`supabase/config.toml`), migrasi `0006` trigger identitas device | `packages/db/src/rls.test.ts`, `apps/api/src/app.test.ts`; sisa risiko: open-questions #44 |
| S1 | Webhook pembeli + billing mengonfirmasi `paid` ke Midtrans; `signature_key` tidak disimpan | `apps/api/src/payments.test.ts`, `apps/api/src/billing.test.ts` |
| S2 | Rate limit per IP, maks. 2.000 kode pairing aktif, nama komputer tampil setelah pairing | `apps/api/src/pairing.test.ts` |
| S3 | `RootErrorBoundary` + `OverlayErrorBoundary` di Kiosk | `apps/kiosk/src/error-boundary.test.tsx` |
| S4 | Voucher 16 digit | `packages/crypto/src/voucher.test.ts`, test agent/API/flow/e2e disesuaikan |
| S5 | OAuth Drive diselesaikan oleh user yang login, harus sama dengan pemula | `apps/worker/src/pipeline.test.ts` (`wrong_user`), e2e `drive.spec.ts` |
| S6 | Layar alasan + event `config_invalid` | typecheck + e2e Kiosk |
| R1 | SSE ditutup setelah device dicabut (≤ 20 dtk) | — (jalur keep-alive) |
| R2 | PIN baru 6–8 digit; kunci salah PIN tersimpan di SQLite | `apps/agent/src/money-pin.test.ts` |
| R3 | `free` tidak menimpa uang | `apps/api/src/payments.test.ts` |
| R4 | `LocalUploadError` tidak menahan antrian | `apps/agent/src/uploads.test.ts` |
| R5 | `safeDownloadUrl()` di worker | `packages/storage/src/storage.test.ts` |
| R6 | `bodyLimit` di upload device | — |
| R7 | ACL `icacls` untuk `device-token` di Windows | `apps/agent/src/token-file.test.ts` (dijalankan di Windows) |
| R8 | `.gitattributes` LF | `pnpm format:check` lolos |
| R9 | Info saja, tidak diubah (RLS sudah menegakkan) | — |

Pemeriksaan setelah perbaikan: `pnpm typecheck` ✓, `pnpm lint` ✓, `pnpm format:check` ✓, `pnpm test` ✓ **326 test** (sebelumnya 300); e2e Kiosk F1 ✓ 10/10, Kiosk F3 ✓ 2/2, Studio stack penuh ✓ 13/13 (termasuk alur OAuth Drive baru, voucher 16 digit, pairing dengan nama komputer). Acceptance criteria F0–F6 tetap lolos.

Perlu tindakan di luar repo:
- Matikan **Data API** di dashboard proyek Supabase (Project Settings → Data API) saat proyek dibuat (#12, #44).
- Production di belakang reverse proxy: set `PB_TRUST_PROXY=1`.
- Set `PB_ASSET_URL_PREFIXES` / `PB_MEDIA_BASE_URL` sesuai domain storage produksi di Studio **dan** worker.
- Jalankan `pnpm db:migrate` (migrasi `0006_audit_hardening`).
