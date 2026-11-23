# CLAUDE.md — photobooth-platform

SaaS photobooth fully customizable. Owner desain booth di Studio (editor Figma-like), Kiosk jalankan config. Baca `PRD.md` dulu, lalu `docs/architecture.md`, `docs/schema.md`, fase aktif di `docs/phases/`.

## Aturan kerja
- Kerjakan per fase, urut. Satu fase selesai = semua acceptance criteria lolos.
- Sebelum mulai task: baca file fase terkait. Setelah selesai: centang checkbox di file fase.
- Keputusan baru / penyimpangan dari docs → catat di `docs/decisions.md` (tanggal, keputusan, alasan).
- Hal belum jelas → tambah ke `docs/open-questions.md`, pilih default paling aman, lanjut.
- Jangan ubah `packages/schema` tanpa update `docs/schema.md` + migrasi versi config.

## Stack
- Monorepo pnpm + Turborepo. TypeScript strict semua tempat.
- `apps/studio`: Next.js (App Router), Tailwind, shadcn/ui.
- `apps/api`: Hono di Node. Webhook, kiosk API, short link `/s/:code`.
- `apps/worker`: BullMQ + Redis, `sharp`, `ffmpeg`.
- `apps/kiosk`: Vite + React, dibungkus Tauri (desktop). Jalan juga di browser untuk dev.
- `apps/agent`: Node service lokal (print, SQLite, upload queue, LAN server kamera).
- `apps/camera`: React + Capacitor (iOS/Android).
- DB: Postgres via Drizzle ORM. Auth + storage + realtime: Supabase.
- Validasi: zod. State flow: XState. Editor: `react-moveable` + `selecto`.

## Packages
- `packages/schema` — zod types config (Theme, Page, Element, Frame, PrintProfile, Filter). Sumber kebenaran tunggal.
- `packages/renderer` — React DOM renderer halaman dari schema. Dipakai Studio + Kiosk. Wajib WYSIWYG.
- `packages/compositor` — Node (`sharp`): frame + foto + filter → gambar 300dpi. Dipakai agent + worker.
- `packages/flow` — XState machine flow pembeli.
- `packages/payments` — interface `PaymentProvider` + `midtrans` (MVP), `xendit` (F7).
- `packages/capture` — interface `CaptureSource` + `webcam`, `tablet` (MVP), `dslr` (F7).
- `packages/db` — Drizzle schema + migrasi.
- `packages/ui` — komponen UI Studio bersama.

## Invarian (jangan dilanggar)
- Secret payment / Drive token tidak pernah sampai ke Kiosk, agent, atau camera app. Hanya di `apps/api` + `apps/worker`, terenkripsi di DB.
- Semua query DB scoped `org_id`. Tidak ada endpoint lintas org kecuali admin platform.
- Kiosk tidak punya desain hardcoded. Semua dari config JSON.
- Posisi elemen dalam koordinat artboard (px artboard), bukan px layar.
- Filter = parameter numerik. Satu definisi, dua implementasi (CSS di renderer, `sharp` di compositor). Ada test kesamaan visual.
- Sesi + file disimpan lokal dulu (agent SQLite + disk), hapus hanya setelah upload terkonfirmasi.
- QR download selalu ke short link `/s/:code`, tidak pernah langsung ke Drive.
- Waktu simpan UTC.
- Uang pembeli ke akun gateway owner. Uang langganan ke akun gateway platform. Jangan campur.

## Konvensi
- Nama file kebab-case. Komponen React PascalCase.
- ID: `cuid2`. Kode sesi: 8 karakter huruf besar + angka, tanpa karakter ambigu (0/O, 1/I).
- Error kiosk → selalu ada fallback ke halaman Error, tidak boleh layar putih.
- Teks UI Studio: Bahasa Indonesia. Kode, komentar, commit: Bahasa Inggris.

## Perintah
- `pnpm dev` — semua app mode dev
- `pnpm test` — vitest semua package
- `pnpm typecheck`, `pnpm lint`
- `pnpm db:migrate`, `pnpm db:seed`

## Testing
- Unit: vitest. E2E Studio + Kiosk: Playwright.
- Payment: pakai sandbox Midtrans + mock provider untuk test.
- Kamera: `CaptureSource` mock (gambar statis) untuk test flow.
