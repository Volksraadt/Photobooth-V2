# Deploy sementara ke Vercel (tanpa domain sendiri)

Status: **ter-deploy 2026-11-25** (Hobby). Domain bawaan Vercel:

- API: https://photobooth-api-one.vercel.app (proyek `photobooth-api`, Root `apps/api`, preset Other)
- Studio: https://photobooth-studio-coral.vercel.app (proyek `photobooth-studio`, Root `apps/studio`)

Sudah diatur: env kedua proyek (Secret; `NEXT_PUBLIC_*` harus tipe Config), Supabase Site URL + redirect `/auth/callback` Vercel (localhost tetap diizinkan), redirect URI Google OAuth ke API Vercel, Notification URL Midtrans sandbox ke `/webhooks/midtrans/br4gkl87qobjwo2bag043wxn` (org Volksraadt Studio) dan `/webhooks/billing`. Laptop booth: `pnpm booth` (agent + Kiosk + worker ke API Vercel, tanpa API/Studio lokal; Kiosk di http://localhost:5173). Diuji 2026-11-26: voucher online lewat Vercel, sesi C6223PLM diproses worker laptop, short link Vercel → Drive dalam ±1 menit.

## Bagian dan tempatnya

| Bagian | Tempat | Catatan |
|---|---|---|
| Studio (`apps/studio`) | Vercel, proyek **studio** | Next.js, region `sin1` (Singapura, dekat Supabase). |
| API (`apps/api`) | Vercel, proyek **api** | Satu fungsi Node hasil `pnpm build:vercel` (Build Output API v3), region `sin1`, `maxDuration` 300 dtk. |
| Worker (`apps/worker`) | Laptop booth (sementara) | Butuh ffmpeg dan proses yang terus menyala: tidak bisa di Vercel. Juga menjalankan siklus tagihan langganan dan refresh statistik harian, jadi keduanya hanya jalan saat laptop menyala. |
| Kiosk + agent | Laptop booth | Diarahkan ke URL API Vercel. |
| Database, auth, storage | Supabase (proyek yang sama) | Sudah dipakai dev. |

### Kompromi serverless (API di Vercel)
- Tidak ada `LISTEN` Postgres: publish desain sampai ke Kiosk lewat polling `/device/config` (agent tiap 5 dtk), bukan push instan.
- Sinyal "lunas" QRIS antar-instance bisa tidak sampai lewat SSE; Kiosk tetap tahu lewat pengecekan status berkala (≤ 10 dtk).
- Stream SSE perangkat berakhir tiap 300 dtk; agent menyambung ulang otomatis.
- Batas percobaan (pairing, voucher salah) dihitung per instance: lebih longgar daripada satu server. Cukup untuk pilot (open-questions #45, #53).

### Paket Vercel
Paket **Hobby hanya untuk pemakaian non-komersial**. Uji coba sendiri boleh; begitu booth menerima pembayaran dari pembeli sungguhan, pakai **Pro** (per anggota tim, per bulan) atau pindahkan API/Studio ke host lain.

## Langkah (sekali)

1. **Masuk Vercel dengan akun GitHub** (vercel.com → Continue with GitHub) dan izinkan Vercel membaca repo `Volksraadt/photobooth-platform`.
2. **Proyek API**: Add New → Project → import repo → *Root Directory* `apps/api`. Framework *Other*; Build Command dan region diambil dari `apps/api/vercel.json`. Deploy sekali (boleh gagal karena env belum diisi) untuk mendapat URL `https://<api>.vercel.app`.
3. **Proyek Studio**: import repo yang sama lagi → *Root Directory* `apps/studio` (Next.js terdeteksi). Catat URL `https://<studio>.vercel.app`.
4. **Variabel lingkungan**: di laptop jalankan
   `node scripts/vercel-env.mjs https://<api>.vercel.app https://<studio>.vercel.app`
   lalu tempel isi `.data/vercel/api.env` ke proyek api dan `.data/vercel/studio.env` ke proyek studio (Settings → Environment Variables → *Import .env*, environment Production). Redeploy keduanya.
   - Rahasia (master key, service role, Google secret, Midtrans platform) **hanya** di proyek api.
   - `DATABASE_URL` memakai **session pooler** Supabase (port 5432, sama seperti dev) dan `PB_DB_POOL_MAX=3`. Jangan transaction pooler 6543: postgres.js + Supavisor mode transaksi menggantung saat query berjalan bersamaan.
5. **Supabase → Authentication → URL Configuration**: *Site URL* `https://<studio>.vercel.app`; tambah *Redirect URL* `https://<studio>.vercel.app/auth/callback`.
6. **Google Cloud → OAuth client `photobooth-api-dev`**: tambah *Authorized redirect URI* `https://<api>.vercel.app/oauth/google/callback`.
7. **Midtrans (sandbox)**: Notification URL owner `https://<api>.vercel.app/webhooks/midtrans/<orgId>` (salin dari Studio → Integrasi), billing platform `https://<api>.vercel.app/webhooks/billing`. Tidak perlu tunnel lagi.
8. **Laptop booth** (`.env` di laptop):
   - agent: `PB_API_URL=https://<api>.vercel.app`, `PB_SHORT_LINK_BASE=https://<api>.vercel.app`
   - kiosk: `VITE_SHORT_LINK_BASE=https://<api>.vercel.app`
   - worker: `PB_PUBLIC_API_URL=https://<api>.vercel.app` lalu `pnpm --filter @pb/worker start` (memakai `DATABASE_URL` session pooler seperti dev).
   - Atau cukup `pnpm booth` (scripts/booth.mjs): menyetel semua variabel di atas ke `PB_BOOTH_API_URL` (default API Vercel) dan menjalankan agent + Kiosk + worker saja.

## Cek setelah deploy
- `https://<api>.vercel.app/s/XXXXXXXX` → 404 (halaman "tidak ditemukan"), `…/studio/me` → 401.
- Login Studio (email/Google), buka Booth, Integrasi (Midtrans + Drive), Rekap.
- Pasang Kiosk dengan kode 6 digit, publish desain (sampai di Kiosk ≤ ±10 dtk), satu sesi voucher sampai Drive.

## Uji lokal bundel API
`pnpm --filter @pb/api build:vercel` menulis `apps/api/.vercel/output`. Fungsi bisa dijalankan dengan `http.createServer((await import('./index.mjs')).default)` untuk uji cepat.
