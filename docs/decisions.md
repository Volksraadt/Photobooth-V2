# Catatan keputusan

Format: tanggal · keputusan · alasan.

- 2026-11-24 · SaaS multi-tenant; satu owner banyak booth sesuai paket · target pasar pemilik usaha photobooth.
- 2026-11-24 · Laptop sebagai otak, tablet sebagai kamera untuk MVP; DSLR setelah MVP · menguji cepat, DSLR target jangka panjang.
- 2026-11-24 · Editor bergaya Figma (drag bebas) sejak MVP · kustomisasi penuh adalah pembeda produk.
- 2026-11-24 · Renderer berbasis DOM, dipakai bersama Studio dan Kiosk · WYSIWYG; video kamera, QR, teks native di DOM.
- 2026-11-24 · Dana pembeli langsung ke akun gateway owner · platform tidak memegang dana pembeli (risiko regulasi).
- 2026-11-24 · Midtrans dulu, Xendit menyusul via interface yang sama · fee QRIS sederhana, notifikasi per request; harga Xendit baru perlu dicek.
- 2026-11-24 · Langganan bulanan via akun gateway platform · terpisah dari dana pembeli.
- 2026-11-24 · Cetak strip 2×6 dulu (2 strip per 4×6) · format paling umum.
- 2026-11-24 · Offline wajib jalan: voucher (daftar tersinkron, terikat booth) + cash dengan PIN · booth sering di lokasi dengan internet tidak stabil.
- 2026-11-24 · QR selalu ke short link platform, bukan langsung ke Drive · valid walau offline, bisa ganti tujuan.
- 2026-11-24 · Google Drive scope `drive.file` · hindari security assessment scope restricted.
- 2026-11-24 · Video 9:16 memakai 3 foto dipilih acak (default) · keputusan owner/user.
- 2026-11-24 · Filter dipilih pembeli di halaman Review · keputusan user.
- 2026-11-24 · Camera App memakai Capacitor · kamera di browser butuh HTTPS; Safari iPad tidak mendukung foto resolusi penuh via web API.

### F0 (fondasi)
- 2026-11-24 · TypeScript 6.0 (bukan 7) · typescript-eslint baru mendukung `<6.1`. TS 6 tidak lagi otomatis memuat `@types`, jadi `types: ["node"]` diset di `tsconfig.base.json`.
- 2026-11-24 · Versi: Next.js 16 (App Router, `proxy.ts` menggantikan middleware), React 19, Tailwind 4, zod 4, Drizzle 0.45, Hono 4, vitest 4, pnpm 12 · versi stabil terbaru. pnpm 12 memblokir build script dependency; yang diizinkan didaftar di `allowBuilds` (`pnpm-workspace.yaml`).
- 2026-11-24 · Workspace package diekspor sebagai source TS (`exports: ./src/index.ts`), tanpa build step · monorepo sederhana; Next `transpilePackages`, API/skrip lewat `tsx`.
- 2026-11-24 · Elemen `countdown`, `payment-timer`, `voucher-input`, `progress` memakai `variant` untuk pilihan tampilan (di spesifikasi awal: `style`) · `style` sudah dipakai `BaseElement` untuk `BoxStyle`; dua makna di satu nama tidak bisa diketik. `docs/schema.md` diperbarui.
- 2026-11-24 · Detail tipe yang belum dirinci di spesifikasi (TextStyle, Transition, ElementAnimation, sub-style elemen, aturan jalan keluar per halaman) ditetapkan di `docs/schema.md` A.6 · dibutuhkan untuk zod schema; dipilih paling sederhana yang cukup untuk F1/F2.
- 2026-11-24 · Schema tanpa `.default()` zod; config selalu eksplisit · tipe input = output, config tersimpan tidak bergantung pada default kode versi tertentu.
- 2026-11-24 · Frame default memakai aset bawaan SVG (data URL, sha256 diverifikasi test) · `createDefaultBoothConfig()` harus valid tanpa upload; compositor `sharp` bisa membaca SVG.
- 2026-11-24 · Util enkripsi di `packages/crypto` (bukan `packages/db`) · dipakai API/worker tanpa menarik Drizzle. Format `v1.<keyId>.<iv>.<tag>.<ct>`, AAD wajib (mis. `org:<id>:payment:midtrans:sandbox`) agar ciphertext tidak bisa dipindah ke org lain; keyId untuk rotasi kunci.
- 2026-11-24 · `org_id` ditambahkan ke `booth_configs`, `booth_drafts`, `session_shots`, `session_outputs`, `cash_approvals` + FK komposit `(parent_id, org_id)` · RLS seragam dan mencegah baris anak menunjuk induk org lain.
- 2026-11-24 · Studio mengakses DB lewat Drizzle server-side dalam `withUserContext()` (role `authenticated` + JWT claims) · RLS tetap jadi lapisan penegak tanpa memakai PostgREST; API/worker memakai koneksi owner dengan filter `org_id` eksplisit.
- 2026-11-24 · Pembuatan org lewat fungsi `app.create_org()` (SECURITY DEFINER), sekaligus membuat owner dan langganan trial 14 hari plan Pro · bootstrap anggota pertama tidak bisa dilakukan aman lewat policy biasa. Trial sesuai default open-question #3.
- 2026-11-24 · `payment_credentials`, `drive_connections`, `pairing_codes` tanpa policy RLS untuk Studio · invarian: secret hanya di API/worker.
- 2026-11-24 · `audit_logs` append-only dan `booth_configs` immutable ditegakkan trigger DB · berlaku juga untuk koneksi owner/service.
- 2026-11-24 · Dev lokal tanpa Docker: `embedded-postgres` (Postgres 18 asli) dijalankan `pnpm dev`; test DB memakai PGlite in-process · mesin dev tidak punya Docker; CI tidak butuh service Postgres.
- 2026-11-24 · Auth shim (`auth.users`, `auth.uid()`, role `authenticated`/`anon`) untuk database non-Supabase; hanya dipasang jika `auth.uid()` belum ada · migrasi RLS yang sama jalan di Supabase dan lokal.
- 2026-11-24 · `PB_AUTH_MODE=dev`: login email + kata sandi lokal (scrypt, cookie JWT HS256), ditolak di production; `PB_AUTH_MODE=supabase`: Supabase Auth email + Google · proyek Supabase dev belum ada (lihat open-questions #12); kedua mode memakai `auth.uid()` yang sama untuk RLS.
- 2026-11-24 · API memverifikasi token user: dev (HS256 + issuer dev), Supabase legacy (HS256 `SUPABASE_JWT_SECRET`) atau Supabase JWKS · mendukung kunci JWT lama dan baru Supabase.
- 2026-11-24 · Token device disimpan sebagai sha256 (`devices.token_hash`), dicek bersama `revoked_at` · token high-entropy, hash cepat cukup; token bocor dari DB tidak bisa dipakai.
- 2026-11-24 · Enum `payment_method` mendapat nilai `free` · sesi mode event tetap tercatat di rekap.
- 2026-11-24 · Prettier tidak memformat `*.md` · dokumen spesifikasi ditulis tangan; jangan diubah otomatis.
