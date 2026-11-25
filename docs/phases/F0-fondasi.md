# F0 — Fondasi

Tujuan: repo siap dikerjakan, schema dan database berdiri, owner bisa daftar dan membuat booth kosong.

## Task
- [x] Inisialisasi monorepo pnpm + Turborepo dengan struktur `apps/*` dan `packages/*` sesuai `CLAUDE.md`.
- [x] Konfigurasi bersama: TypeScript strict, ESLint, Prettier, vitest, Playwright.
- [x] `packages/schema`: semua tipe di `docs/schema.md` bagian A sebagai zod schema + type export; fungsi `validateBoothConfig()` termasuk aturan validasi per halaman.
- [x] `packages/schema`: fungsi `createDefaultBoothConfig()` menghasilkan config lengkap yang valid (desain sederhana default, 1 frame 4 slot, 3 filter).
- [x] `packages/db`: Drizzle schema untuk tabel B.1–B.5, migrasi awal, seed (3 plan, 1 org demo, 1 booth demo).
- [x] Supabase: proyek dev, auth email + Google, RLS per `org_id`.
  - [x] RLS per `org_id` (migrasi `0001_rls.sql`, diuji di `packages/db/src/rls.test.ts`).
  - [x] Kode auth email + Google mode Supabase di Studio + verifikasi token Supabase di API; `supabase/config.toml`.
  - [x] Proyek Supabase dev (Singapura) + login email: 2026-11-25 daftar → konfirmasi e-mail → dashboard Studio; org + owner dibuat otomatis; API menerima token (ES256 via JWKS). Migrasi + seed lewat session pooler (port 5432); 25/25 tabel RLS; Data API dimatikan.
  - [x] Login Google terhadap proyek Supabase: 2026-11-25 lolos (OAuth client Google yang sama dengan Drive + redirect `https://<ref>.supabase.co/auth/v1/callback`); e-mail yang sama tertaut ke user yang sama (identitas email + google).
- [x] `apps/studio`: kerangka Next.js, login, buat organisasi, daftar booth, buat booth (pakai `createDefaultBoothConfig`).
- [x] `apps/api`: kerangka Hono, health check, middleware auth device dan auth user.
- [x] Util enkripsi AES-256-GCM untuk secret (`packages/db` atau `packages/crypto`).
- [x] CI: typecheck, lint, test di setiap push.
- [x] Catat keputusan teknis baru di `docs/decisions.md` (file sudah berisi keputusan awal).

## Acceptance criteria
- `pnpm dev` menjalankan Studio dan API tanpa error.
- `validateBoothConfig(createDefaultBoothConfig())` lolos; config dengan `capture` tanpa `camera-view` gagal dengan pesan jelas.
- User baru bisa daftar, membuat organisasi, dan membuat booth; booth tersimpan dengan draft config default.
- User org A tidak bisa membaca booth org B (dibuktikan dengan test).

### Status (2026-11-24)
- [x] `pnpm dev`: local Postgres + Studio (:3000) + API (:8787) jalan tanpa error; `GET /health` → `{"status":"ok","db":"ok"}`.
- [x] `packages/schema/src/validate.test.ts`: config default lolos; capture tanpa `camera-view` → `Halaman Capture harus punya tepat satu elemen camera-view (ditemukan 0).`
- [x] Daftar → buat org → buat booth diuji manual di browser dan di Playwright (`apps/studio/e2e/onboarding.spec.ts`); draft default tersimpan dan valid.
- [x] Isolasi org: `packages/db/src/rls.test.ts` (RLS: baca, tulis, update, delete, keanggotaan) dan e2e (URL booth org lain → 404).
