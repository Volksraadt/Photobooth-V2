# photobooth-platform

Platform SaaS untuk pemilik photobooth: desain booth sepenuhnya di editor web, jalankan di laptop dengan tablet/DSLR sebagai kamera, terima pembayaran QRIS, cetak strip, dan kirim hasil ke Google Drive.

## Mulai dari sini
1. `PRD.md` — apa yang dibangun dan kenapa
2. `docs/architecture.md` — bagaimana sistem tersusun
3. `docs/schema.md` — format config dan database
4. `docs/phases/` — urutan pengerjaan (F0 → F7)
5. `docs/decisions.md`, `docs/open-questions.md`

## Menjalankan lokal

Butuh Node ≥ 22 dan pnpm 12. Tidak perlu Docker.

```sh
pnpm install
cp .env.example .env   # isi SECRET_MASTER_KEY dan DEV_AUTH_SECRET (lihat komentar di file)
pnpm dev               # Postgres lokal (:54329) + Studio (:3000) + API (:8787)
```

`pnpm dev` menjalankan Postgres bawaan (`embedded-postgres`, data di `packages/db/.data/`), menerapkan migrasi, dan mengisi seed. Login demo: `demo@photobooth.local` / `demo12345`. Kiosk ikut jalan di `http://localhost:5173`.

### Studio editor + perangkat (F2)
- Buat booth dari template di `/booths`, lalu **Buka editor** (`/booths/<id>/editor`): halaman, slide Tutorial, frame, filter, pengaturan; undo/redo, autosave, Pratinjau, Publish.
- Pasang Kiosk ke booth: buka `http://localhost:5173/?source=agent` (tambahkan `&capture=mock&dev=1` tanpa webcam). Pairing + sinkron config dilakukan Local Agent (F3; `pnpm dev` menjalankannya). Kiosk menampilkan kode 6 digit → di Studio, halaman booth → **Perangkat** → masukkan kode. Publish berikutnya tampil di Kiosk dalam beberapa detik. Pindah booth: mode admin → **Lepas dari booth**.
- Riwayat versi dan rollback ada di halaman booth. Aset upload (dev) tersimpan di `.data/assets/`.
- `pnpm --filter @pb/studio test:e2e` butuh stack lengkap (`pnpm dev`, termasuk Kiosk di :5173).

### Kiosk (F1)
```sh
pnpm --filter @pb/kiosk dev          # http://localhost:5173 (webcam laptop)
# http://localhost:5173/?capture=mock  → kamera tiruan, tanpa webcam
# ?kiosk=1 → layar penuh + kursor disembunyikan (default di build produksi)
```
- Config dibaca dari `apps/kiosk/booth-config.local.json` (dibuat otomatis dari config default; edit lalu simpan, Kiosk me-reload). `pnpm --filter @pb/kiosk config:init` mengembalikan ke default.
- Mode dev: panel kecil kiri bawah berisi **Simulasikan lunas** (payment mock) dan **Putus kamera**.
- Mode admin: ketuk 5× pojok kiri atas, PIN dev `1234`. Berisi tes kamera, sesi gratis, dan unduh foto sesi yang tersimpan (IndexedDB).
- `pnpm --filter @pb/kiosk test:e2e` menjalankan Playwright (webcam tiruan Chromium + kamera mock).

### Local Agent, tablet kamera, cetak (F3)
```sh
pnpm --filter @pb/agent dev     # API Kiosk http://127.0.0.1:47810, server kamera LAN :47811
pnpm dev:camera                 # Camera App di browser: http://localhost:5175 (laptop/HP sebagai "tablet")
```
- Agent menyimpan sesi + file di `.data/agent/` (dev) atau folder data aplikasi (installer), mencetak, mengirim heartbeat/event ke API, dan menjadi server LAN untuk Camera App. Dari repo, cetak default ke **printer virtual** (file di `.data/agent/prints/`); `PB_PRINT_MODE=system` untuk printer sungguhan.
- Kiosk memakai agent otomatis bila berjalan (`?agent=0` = mode browser saja seperti F1).
- Tablet: mode admin → Kamera → **Tablet** → **Pasang tablet baru** → pindai QR dengan Camera App (tablet dan laptop di Wi-Fi yang sama). Admin juga menampilkan estimasi latensi preview.
- Printer: mode admin → Printer → pilih printer → **Tes cetak**. Lembar 4×6 berisi 2 strip 2×6; aktifkan potong 2 inci di driver printer.
- Camera App native: `pnpm --filter @pb/camera cap:android` / `cap:ios` (butuh Android Studio / Xcode di macOS).
- Installer Kiosk (Tauri + agent sidecar): `pnpm --filter @pb/kiosk tauri:build` di OS target (butuh Rust). CI: workflow **Kiosk installers** (Windows + macOS).

| Perintah | Fungsi |
|---|---|
| `pnpm test` | unit + DB test (PGlite, tanpa server) |
| `pnpm --filter @pb/studio test:e2e` | Playwright Studio (menjalankan `pnpm dev` jika belum jalan) |
| `pnpm --filter @pb/kiosk test:e2e` | Playwright Kiosk (server Vite sendiri di :5174 dengan config default baru, tanpa agent) |
| `pnpm --filter @pb/kiosk test:e2e:f3` | Playwright F3: agent + Kiosk + Camera App (kamera palsu Chromium), latensi, Wi-Fi putus, cetak, cetak vs editor |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | pemeriksaan statis (juga di CI) |
| `pnpm db:generate` | buat migrasi Drizzle dari `packages/db/src/schema` |
| `pnpm db:migrate` / `pnpm db:seed` | terapkan migrasi / seed ke `DATABASE_URL` |

### Memakai Supabase
1. Buat proyek Supabase (region Singapura), aktifkan provider Email dan Google (redirect: `<studio>/auth/callback`). Pengaturan referensi: `supabase/config.toml`.
2. Di `.env`: `PB_AUTH_MODE=supabase`, `PB_LOCAL_DB=0`, `DATABASE_URL` = connection string langsung, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, dan `SUPABASE_JWT_SECRET` (jika proyek masih memakai kunci JWT HS256).
3. `pnpm db:migrate && pnpm db:seed`. Skema, RLS, dan fungsi berasal dari `packages/db/drizzle`.

## Memakai dengan Claude Code
Buka folder ini dengan Claude Code. `CLAUDE.md` berisi aturan kerja. Contoh perintah pertama:

```
Baca PRD.md, CLAUDE.md, dan docs/. Kerjakan docs/phases/F0-fondasi.md task demi task. Centang setiap task yang selesai dan hentikan setelah semua acceptance criteria F0 lolos.
```
