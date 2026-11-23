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

`pnpm dev` menjalankan Postgres bawaan (`embedded-postgres`, data di `packages/db/.data/`), menerapkan migrasi, dan mengisi seed. Login demo: `demo@photobooth.local` / `demo12345`.

| Perintah | Fungsi |
|---|---|
| `pnpm test` | unit + DB test (PGlite, tanpa server) |
| `pnpm --filter @pb/studio test:e2e` | Playwright Studio (menjalankan `pnpm dev` jika belum jalan) |
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
