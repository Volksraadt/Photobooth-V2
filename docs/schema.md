# Schema

Dua bagian: (A) **config booth** dalam JSON yang dibaca Kiosk, dan (B) **database**. Definisi resmi ada di `packages/schema` (zod) dan `packages/db` (Drizzle); dokumen ini adalah spesifikasinya.

---

## A. Config booth (JSON)

Satu booth punya satu `BoothConfig` aktif. Setiap Publish membuat versi baru yang immutable.

```ts
type BoothConfig = {
  schemaVersion: 1;
  configVersion: number;          // naik setiap publish
  boothId: string;
  locale: 'id' | 'en';
  timezone: string;               // 'Asia/Jakarta'
  artboard: Artboard;
  flow: FlowConfig;
  pricing: Pricing;
  pages: Record<PageType, Page>;  // satu halaman per tipe
  frames: Frame[];
  filters: Filter[];
  printProfile: PrintProfile;
  output: OutputConfig;
  assets: AssetRef[];             // semua file yang perlu di-cache device
  admin: { pinHash: string };
};

type Artboard = {
  width: number;                  // mis. 1920
  height: number;                 // mis. 1080
  orientation: 'landscape' | 'portrait';
  scaleMode: 'fit';               // letterbox; mode lain menyusul
  letterboxColor: string;
};
```

### A.1 Flow, harga, output

```ts
type FlowConfig = {
  tutorialEnabled: boolean;
  reviewEnabled: boolean;
  eventMode: boolean;             // true = tanpa payment
  paymentMethods: ('qris' | 'voucher' | 'cash')[];
  shotCountdownSec: number;       // default 3
  autoAdvanceBetweenShots: boolean;
  maxRetakesPerShot: number | null; // null = tanpa batas
  idleTimeoutSec: Partial<Record<PageType, number>>;
  resultAutoReturnSec: number;
  qrisExpirySec: number;          // default 300
};

type Pricing = {
  currency: 'IDR';
  basePrice: number;              // dipakai bila frame tidak punya harga sendiri
  includedPrints: number;         // default 1 lembar (= 2 strip)
  extraPrintPrice: number | null; // null = tidak dijual
  maxExtraPrints: number;
};

type OutputConfig = {
  gif: { enabled: boolean; frameDelayMs: number; width: number };
  video: {
    enabled: boolean;
    photoPick: 'random' | 'first' | 'buyer';
    photoCount: 3;
    secondsPerPhoto: number;
    resolution: { width: 1080; height: 1920 };
    backgroundAssetId?: string;   // latar di belakang foto 16:9
    musicAssetId?: string;
  };
  driveRootFolderName: string;    // default: nama booth
  watermark: boolean;             // dikontrol plan
};
```

### A.2 Halaman dan elemen

```ts
type PageType =
  | 'cover' | 'tutorial' | 'framePick' | 'payment'
  | 'capture' | 'review' | 'processing' | 'result' | 'error';

type Page = {
  type: PageType;
  background: Background;
  elements: Element[];            // urutan array = z-order (bawah → atas)
  slides?: Slide[];               // khusus 'tutorial'
  transitionIn?: Transition;
};

type Background =
  | { kind: 'color'; color: string }
  | { kind: 'gradient'; css: string }
  | { kind: 'image'; assetId: string; fit: 'cover' | 'contain' }
  | { kind: 'video'; assetId: string; loop: true; muted: true };

type Slide = { id: string; elements: Element[]; background?: Background; durationSec?: number };

type BaseElement = {
  id: string;
  name: string;                   // label di layer panel
  x: number; y: number;           // koordinat artboard, titik kiri atas
  width: number; height: number;
  rotation: number;               // derajat
  opacity: number;                // 0..1
  visible: boolean;
  locked: boolean;
  groupId?: string;
  style?: BoxStyle;
  animation?: ElementAnimation;   // entrance, pulse, dll.
};

type BoxStyle = {
  fill?: string;
  borderColor?: string; borderWidth?: number; borderRadius?: number;
  shadow?: { x: number; y: number; blur: number; color: string };
};
```

#### Elemen statis & interaktif
| `type` | Properti tambahan |
|---|---|
| `image` | `assetId`, `fit` |
| `text` | `content`, `fontFamily`, `fontSize`, `fontWeight`, `color`, `align`, `lineHeight`, `letterSpacing`; mendukung token `{{price}}`, `{{boothName}}`, `{{date}}` |
| `shape` | `shape: 'rect' \| 'ellipse' \| 'line'` |
| `video` | `assetId`, `loop`, `muted` |
| `button` | `action: ButtonAction`, `label?`, `assetId?` (tombol gambar), state `pressed` |

```ts
type ButtonAction =
  | { kind: 'start' } | { kind: 'next' } | { kind: 'back' }
  | { kind: 'retake'; shotIndex?: number } | { kind: 'retakeAll' }
  | { kind: 'confirm' } | { kind: 'selectFilter'; filterId: string }
  | { kind: 'addPrint' } | { kind: 'removePrint' }
  | { kind: 'selectPayment'; method: 'qris' | 'voucher' | 'cash' }
  | { kind: 'finish' };
```

#### Elemen khusus
| `type` | Halaman | Properti tambahan |
|---|---|---|
| `camera-view` | capture | `mirror: boolean`, `fit: 'cover' \| 'contain'`, `cropAspect?` (tampilkan area crop slot aktif), `overlayFrame: boolean` |
| `photo-slot` | capture, review | `slotIndex`, `emptyStyle` (warna, angka, font), `filledStyle`, `activeStyle`, `showRetakeButton` |
| `countdown` | capture | `fontFamily`, `fontSize`, `color`, `variant: 'number' \| 'ring'` |
| `frame-picker` | framePick | `layout: 'grid' \| 'carousel'`, `columns`, `gap`, `itemStyle`, `selectedStyle`, `showPrice` |
| `frame-preview` | framePick, review | menampilkan frame terpilih + foto (di review) |
| `filter-picker` | review | `layout`, `itemSize`, `showLabel`, `selectedStyle` |
| `qris` | payment | `padding`, `background`, `showLogo` |
| `price-label` | framePick, payment, review | gaya teks (`TextStyle`); `format: 'idr' \| 'number'` |
| `payment-timer` | payment | `variant: 'text' \| 'bar'`, `textStyle?`, `barColor?`, `trackColor?` |
| `voucher-input` | payment | `variant: 'keypad' \| 'field'`, `textStyle`, `keyStyle?` |
| `download-qr` | result | `padding`, `foreground`, `background` |
| `progress` | processing | `variant: 'bar' \| 'spinner' \| 'steps'`, `color`, `trackColor?` |
| `print-copies` | review | stepper jumlah cetak: `textStyle`, `buttonStyle?` |

> Catatan F0: properti pilihan tampilan bernama `variant` (bukan `style`) karena `style` sudah dipakai `BaseElement` untuk `BoxStyle`. Detail lengkap ada di bagian A.6.

**Validasi wajib di editor & saat publish:**
- `capture`: tepat satu `camera-view`; jumlah `photo-slot` = jumlah slot terbanyak di frame aktif; satu `countdown`.
- `payment`: satu `qris` jika `qris` aktif; `voucher-input` jika voucher aktif.
- `framePick`: satu `frame-picker`.
- `review`: `filter-picker` jika ada > 1 filter.
- `result`: satu `download-qr`.
- Setiap halaman selain `processing` dan `result` harus punya jalan keluar (tombol atau auto-advance).

### A.3 Frame dan cetak

```ts
type Frame = {
  id: string;
  name: string;
  thumbnailAssetId: string;
  overlayAssetId: string;         // PNG transparan, ukuran = printProfile.stripPx
  underlayAssetId?: string;       // latar di bawah foto (opsional)
  price?: number;                 // override basePrice
  slots: PhotoSlot[];
  dynamicElements: Element[];     // text {{date}}, image logo, download-qr
  enabled: boolean;
  sortOrder: number;
};

type PhotoSlot = {
  index: number;                  // 1..n, urutan pengambilan
  x: number; y: number; width: number; height: number; // px strip
  rotation: number;
  borderRadius: number;
};

type PrintProfile = {
  id: 'strip-2x6';                // MVP
  paper: { widthIn: 4; heightIn: 6 };
  dpi: 300;
  stripPx: { width: 600; height: 1800 };
  layout: 'two-strips-side-by-side';
  cutMarks: boolean;
  bleedPx: number;
};
```
- Aspect ratio foto mengikuti slot. Kamera mengambil foto penuh; compositor melakukan crop tengah (dengan offset opsional) sesuai slot.
- `camera-view` dapat menampilkan panduan crop sesuai slot yang sedang diambil.

### A.4 Filter

```ts
type Filter = {
  id: string;
  name: string;
  thumbnailAssetId?: string;
  params: {
    brightness: number;   // 1 = normal
    contrast: number;     // 1 = normal
    saturation: number;   // 1 = normal, 0 = hitam putih
    hueRotate: number;    // derajat
    warmth: number;       // -1..1 (tint oranye/biru)
    sepia: number;        // 0..1
    grain: number;        // 0..1
    vignette: number;     // 0..1
  };
  enabled: boolean;
  isDefault: boolean;
};
```
Diterjemahkan ke CSS `filter` + overlay di renderer, dan ke operasi `sharp` di compositor. Test snapshot memastikan selisih visual di bawah ambang.

**Definisi numerik (ditetapkan di F1, `packages/schema/src/filter-math.ts`):**
- Warna: satu transformasi afin pada nilai sRGB 0..1, `out = M·rgb + offset`, di-clamp ke 0..1 sekali di akhir. `M`/`offset` = komposisi berurutan: brightness `diag(b)` → contrast `c·(v−0,5)+0,5` → saturation (matriks `saturate` Filter Effects) → hueRotate (matriks `hue-rotate`) → sepia (matriks `sepia`, jumlah = `sepia`) → warmth `diag(1+0,15w, 1+0,03w, 1−0,15w)`. Fungsi: `filterColorMatrix(params)`.
- Vignette: overlay hitam, alpha = `vignette × clamp((d − 0,45) / 0,55, 0, 1)`, `d` = jarak eliptis dari pusat (1 di sudut; CSS `ellipse farthest-corner`).
- Grain: noise monokrom (rata-rata 0,5), blend `overlay`, opacity `grain × 0,5`. Tidak identik per piksel; dibandingkan secara statistik.
- Renderer: SVG `feColorMatrix` (`color-interpolation-filters: sRGB`) + dua overlay. Compositor (F3): matriks yang sama diterapkan per piksel di JS (`applyFilter`, hasil identik dengan `applyFilterColorMatrix`) setelah `sharp` mendekode/crop; vignette dan grain dengan rumus di atas. Tidak memakai `sharp.recomb` + `linear` karena sharp meng-clamp ke 8 bit di antara keduanya, sedangkan definisi hanya meng-clamp sekali.

### A.5 Aset
```ts
type AssetRef = { id: string; kind: 'image' | 'video' | 'font' | 'audio'; url: string; sha256: string; bytes: number };
```
Agent mengunduh semua aset sebelum mengaktifkan versi config baru. Jika ada aset gagal, versi lama tetap dipakai.

Ketetapan F2:
- Font yang diunggah dipakai lewat `fontFamily` berisi `pb-font-<assetId>` (mis. `"pb-font-abc123", sans-serif`); renderer memasang `@font-face` untuk setiap aset `font`.
- `referencedAssetIds(config)` = semua `assetId`/`*AssetId` + referensi `pb-font-…`. Saat publish, `pruneUnusedAssets()` membuang `AssetRef` yang tidak direferensikan.
- Di F2 (tanpa agent) Kiosk mengunduh aset dari `url`, memverifikasi `sha256`, menyimpannya di Cache Storage, dan merender dari salinan lokal. Aset `data:` (bawaan) dipakai langsung.

### A.6 Ketetapan detail (ditetapkan di F0)

Definisi resmi ada di `packages/schema/src`. Hal yang tidak dirinci di atas ditetapkan sebagai berikut:

```ts
type TextStyle = { fontFamily: string; fontSize: number; fontWeight: number /* 100..900 */;
  color: string; align: 'left' | 'center' | 'right'; lineHeight: number; letterSpacing: number };
type Transition = { kind: 'none' | 'fade' | 'slide-left' | 'slide-up' | 'zoom'; durationMs: number };
type ElementAnimation = {
  entrance?: { kind: 'none' | 'fade' | 'slide-up' | 'slide-left' | 'zoom'; delayMs: number; durationMs: number };
  loop?: 'none' | 'pulse' | 'bounce' | 'float';
};
```

- `text` dan `price-label` membawa properti `TextStyle` secara datar (bukan nested).
- `image.fit`: `'cover' | 'contain' | 'fill'`. `button`: `textStyle?`, `pressedStyle?: BoxStyle`.
- `camera-view.cropAspect?: boolean`.
- `photo-slot.emptyStyle` = `BoxStyle` + `showNumber`, `numberColor`, `numberFontFamily`, `numberFontSize`; `filledStyle`/`activeStyle` = `BoxStyle`.
- `frame-picker`: tambah `showName: boolean`, `labelStyle?: TextStyle`. `filter-picker`: `layout: 'row' | 'grid'`, `labelStyle?`. `frame-preview`: `fit: 'contain' | 'cover'`.
- `configVersion: 0` = draft yang belum pernah dipublikasikan.
- `admin.pinHash: ''` = PIN belum diatur; Kiosk wajib menolak mode admin. Format (F1): `pbkdf2-sha256$<iterasi>$<salt base64url>$<hash base64url 32 byte>`, PIN 4–8 digit, dibuat dengan `hashAdminPin()` dan dicek dengan `verifyAdminPin()` (Web Crypto). zod menerima `''` atau format ini saja.
- `Frame.dynamicElements` hanya boleh `text`, `image`, `shape`, `download-qr` (koordinat px strip).
- `Slide.elements` hanya elemen statis (`image`, `text`, `shape`, `video`).
- Kode sesi: 8 karakter dari `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (`generateSessionCode()`).
- Aset bawaan `builtin-strip-overlay-4`: SVG 600×1800 sebagai data URL, dipakai frame default.
- `migrateBoothConfig()` menaikkan config lama ke `schemaVersion` terbaru sebelum validasi.

**Rincian aturan validasi** (`validateBoothConfig`, pesan berbahasa Indonesia, setiap isu punya `code`, `path`, `message`):
- Elemen khusus hanya boleh di halaman yang tercantum di tabel elemen khusus.
- Aturan elemen wajib dan jalan keluar hanya berlaku untuk halaman aktif: Tutorial (jika `tutorialEnabled`), Review (jika `reviewEnabled`), Payment (jika bukan `eventMode`).
- Jalan keluar per halaman: Cover = tombol `start`/`next`; Tutorial = tombol `next`/`start`/`confirm` atau semua slide punya `durationSec`; Pilih Frame = `next`/`confirm`; Payment = `back`/`confirm`/`selectPayment` atau ada `qris`/`voucher-input`; Capture = `next`/`confirm` atau `autoAdvanceBetweenShots`; Review = `confirm`/`next`/`finish`; Error = `start`/`finish`/`back`/`next` atau `idleTimeoutSec.error` diisi.
- `photo-slot` di Capture memakai `slotIndex` 1..n masing-masing sekali.
- Integritas: ID unik (aset, frame, filter, elemen per halaman), referensi aset ada dan jenisnya cocok, tepat satu filter default yang aktif, minimal satu frame dan satu filter aktif, slot frame bernomor 1..n dan berada dalam area strip, tombol `selectFilter` merujuk filter yang ada, tombol `selectPayment` merujuk metode yang aktif, `paymentMethods` tidak kosong kecuali mode event, `timezone` valid.

---

## B. Database (Postgres)

Semua tabel bisnis punya `org_id`, `created_at`, `updated_at`. ID memakai `cuid2`.

### B.1 Organisasi & langganan
| Tabel | Kolom utama |
|---|---|
| `orgs` | id, name, slug, timezone |
| `org_members` | org_id, user_id, role (`owner` \| `manager` \| `operator`) |
| `plans` | id, code (`starter`/`pro`/`business`), name, price_monthly, limits (jsonb: maxBooths, maxDevicesPerBooth, maxFrames), features (jsonb: dslr, liveClip, video, watermarkRemoval, customDomain, export, auditLog, staff) |
| `subscriptions` | org_id, plan_id, status (`trialing` \| `active` \| `past_due` \| `canceled`), current_period_start, current_period_end, grace_until |
| `billing_invoices` | org_id, subscription_id, amount, status, provider_ref, paid_at |

### B.2 Booth, device, config
| Tabel | Kolom utama |
|---|---|
| `booths` | org_id, name, timezone, active_config_id, status |
| `booth_configs` | booth_id, version, config (jsonb `BoothConfig`), published_by, published_at |
| `booth_drafts` | booth_id, config (jsonb), updated_by — draft editor sebelum publish |
| `devices` | org_id, booth_id, name, token_hash, platform, app_version, last_heartbeat_at, last_config_version, camera_status, printer_status, revoked_at |
| `pairing_codes` | code, device_fingerprint, expires_at, claimed_booth_id |
| `assets` | org_id, kind, storage_path, sha256, bytes, width, height |
| `templates` | id, name, preview, config (jsonb parsial), is_public |

### B.3 Sesi & pembayaran
| Tabel | Kolom utama |
|---|---|
| `sessions` | org_id, booth_id, device_id, code (8 karakter, unik), frame_id, filter_id, status (`started` \| `paid` \| `capturing` \| `completed` \| `abandoned` \| `failed`), payment_method, gross_amount, fee_amount, net_amount, extra_prints, started_at, completed_at, synced_at, offline (bool), drive_folder_url |
| `session_shots` | session_id, slot_index, take_number, storage_path, width, height, selected (bool) |
| `session_outputs` | session_id, kind (`original` \| `mirrored` \| `filtered` \| `composite` \| `gif` \| `video` \| `clip`), storage_path, drive_file_id, status |
| `payments` | org_id, session_id, provider, order_id (unik), amount, status (`pending` \| `paid` \| `expired` \| `canceled` \| `failed` \| `paid_late`), qr_string, expires_at, paid_at, provider_ref, fee_amount, raw (jsonb) |
| `vouchers` | org_id, booth_id, code_hash, code_last4, value_type (`full` \| `amount`), value, expires_at, used_at, used_session_id, used_device_id |
| `cash_approvals` | session_id, approved_by_pin_of (member id), amount |

### B.4 Integrasi
| Tabel | Kolom utama |
|---|---|
| `payment_credentials` | org_id, provider, env (`sandbox` \| `production`), encrypted_secret, merchant_id, status, last_tested_at |
| `drive_connections` | org_id, google_email, encrypted_refresh_token, root_folder_id, status |
| `fee_settings` | provider, method, percent, fixed, effective_from — nilai fee yang dipakai untuk menghitung `net_amount` |

### B.5 Log
| Tabel | Kolom utama |
|---|---|
| `device_events` | org_id, device_id, level, kind (`camera_disconnected`, `printer_error`, `payment_timeout`, `sync_failed`, `crash`, …), message, data (jsonb), occurred_at |
| `print_jobs` | org_id, device_id, session_id, sheets, status, occurred_at |
| `upload_jobs` | org_id, session_id, target (`storage` \| `drive`), status, attempts, last_error |
| `audit_logs` | org_id, actor_id, action, entity, entity_id, before (jsonb), after (jsonb), at — append-only |

### B.6 Rekap
Rekap dihitung dari `sessions` + `payments` + `print_jobs`. Untuk performa, buat materialized view harian per booth (`daily_booth_stats`) yang di-refresh berkala. Semua agregasi memakai zona waktu booth.

### B.7 Ketetapan F0 (implementasi di `packages/db`)
- `org_id` juga ada di `booth_configs`, `booth_drafts`, `session_shots`, `session_outputs`, `cash_approvals` agar RLS seragam. FK komposit `(parent_id, org_id)` memastikan baris anak tidak bisa menunjuk induk milik org lain.
- `org_members.user_id` / `published_by` / `updated_by` / `actor_id` = `uuid` dari `auth.users`.
- `plans.price_monthly` boleh `null` (harga belum ditentukan). `payment_method` punya nilai tambahan `free` (mode event).
- `payments`: indeks unik parsial `(session_id) WHERE status = 'paid'`: satu sesi hanya boleh punya satu pembayaran lunas.
- `vouchers`: unik `(booth_id, code_hash)`. `devices.token_hash` = sha256 token device (token asli hanya ditampilkan sekali).
- `audit_logs` hanya punya `at` (tanpa `updated_at`). Trigger menolak UPDATE/DELETE/TRUNCATE. `booth_configs` juga ditolak UPDATE (immutable).
- **RLS** (migrasi `0001_rls.sql`): anggota membaca data org-nya; owner/manager menulis tabel konfigurasi (booths, drafts, configs, assets, vouchers, devices); data operasional (sesi, pembayaran, log) hanya baca dari Studio, ditulis API/worker. `payment_credentials`, `drive_connections`, `pairing_codes` tertutup total untuk Studio. Org dibuat lewat `app.create_org()` (SECURITY DEFINER): org + owner + langganan trial.
- Studio mengakses DB lewat `withUserContext(db, userId, fn)`: transaksi dengan role `authenticated` dan `request.jwt.claims.sub = userId`, sehingga RLS berlaku. API/worker memakai koneksi owner dan wajib filter `org_id` eksplisit.

### B.8 Ketetapan F2 (migrasi `0002_f2_editor.sql`)
- `assets`: tambah `name` (nama file asli, default `''`) dan `mime_type`. `storage_path` berisi URL publik aset (media lokal atau Supabase Storage). Path penyimpanan: `<orgId>/<sha256>.<ext>`.
- `pairing_codes`: tambah `token_hash` = sha256 token yang dibuat Kiosk; saat diklaim menjadi `devices.token_hash`. Token asli tidak pernah disimpan di server. Kode 6 digit, berlaku 10 menit, sekali pakai.
- `templates`: tambah `key` (unik, untuk template bawaan) dan `description`. `config` berisi `BoothConfig` lengkap dengan `boothId: 'template'` dan judul `{{boothName}}`.
- Publish: versi = `max(version)+1` per booth, `config.configVersion` = versi, audit `booth.publish` / `booth.rollback`, lalu `pg_notify('pb_booth_config', boothId)`. Rollback = publish ulang config versi lama sebagai versi baru.
- Batas paket ditegakkan di server: `maxBooths` (buat booth), `maxFrames` (publish), `maxDevicesPerBooth` (klaim pairing, hanya device yang belum dicabut).

### B.9 Ketetapan F4 (migrasi `0003_f4_payments.sql`)
- `payment_credentials`: tambah `client_key` (bukan secret), `is_active` (indeks unik parsial `(org_id, provider) WHERE is_active`: satu env aktif), `last_test_message`. `encrypted_secret` = SecretBox dari JSON `{ "serverKey": … }`, AAD `org:<orgId>:payment:midtrans:<env>`. Tetap tanpa policy RLS (hanya API).
- `payments`: tambah `env` (env kredensial saat charge; webhook diverifikasi dengan key env ini), `device_id`, `last_checked_at` (batas query status ke provider saat polling, 3 dtk). `id` = `order_id` = cuid2 dari agent per percobaan. Indeks `(org_id, status)` untuk daftar `paid_late`.
- `vouchers`: tambah `batch_id`, `note`, `used_offline`. `code_hash` = hex PBKDF2-SHA256(kode 12 digit, salt `pb-voucher:v1:<boothId>`, 20.000 iterasi, 32 byte) — `hashVoucherCode()` di `@pb/crypto`. `code_last4` = 4 digit terakhir.
- `cash_approvals`: tambah `device_id`, `approved_at`; `id` = id outbox agent (idempotent). `approved_by_pin_of` `null` = PIN admin booth.
- `fee_settings`: seed `midtrans/qris 0.7000 %, fixed 0, effective_from 2024-01-01`.
- `sessions`: dibuat API saat kontak pertama (charge QRIS, redeem voucher, tunai, atau sinkron sesi) dengan `id` + `code` dari kiosk; `payment_method`, `gross/fee/net_amount` diisi oleh pembayaran (QRIS: nominal tagihan, fee dari `fee_settings`; voucher/tunai: harga frame, fee 0; free: 0). `offline` = dibayar saat device offline. `synced_at` = catatan sesi lengkap diterima.
- `device_events.kind` baru dari API: `voucher_conflict` (voucher dipakai dua sesi), `sync_conflict` (item outbox ditolak permanen). Dari agent: `voucher_offline`, `cash_approved`, `cash_pin_rejected`, `payment_failed`.
- Status `payments`: `pending → paid | expired | canceled | failed`; `paid_late` = settlement yang terlambat/ganda (kandidat refund manual). `paid` dan `paid_late` final.

---

## C. Penyimpanan lokal (Agent, SQLite)

| Tabel | Isi |
|---|---|
| `config_cache` | versi config aktif + path aset lokal |
| `local_sessions` | salinan sesi + status sinkron |
| `local_files` | path file, jenis, status upload |
| `local_vouchers` | code_hash, booth_id, used_at, synced |
| `outbox` | event yang menunggu dikirim (heartbeat tertunda, device_events, pemakaian voucher) |

### C.1 Ketetapan F3 (`apps/agent/src/store.ts`, `node:sqlite`)
File `agent.sqlite` di folder data agent (Windows `%APPDATA%\photobooth-agent`, macOS `~/Library/Application Support/photobooth-agent`, Linux `$XDG_DATA_HOME/photobooth-agent`; installer: folder data aplikasi Tauri `…/agent`; dev dari repo: `.data/agent`). Migrasi lewat `pragma user_version`. Waktu = ISO 8601 UTC.

| Tabel | Kolom |
|---|---|
| `meta` | key, value — pengaturan lokal: `agent.id`, `camera.source` (`webcam`\|`tablet`), `printer.name` |
| `config_cache` | version (PK), config_id, etag, config (JSON), asset_paths (JSON assetId → path), activated_at |
| `local_sessions` | id, code (unik), booth_id, config_version, frame_id, filter_id, payment_method, amount, extra_prints, status (`capturing`\|`completed`\|`failed`), download_url, data (JSON), started_at, completed_at, sync_status, created_at, updated_at |
| `local_files` | id, session_id, kind (`original`\|`composite`\|`print`), slot_index, take_number, path, mime_type, width, height, bytes, sha256, source (`tablet`\|`webcam`\|`mock`\|`agent`), selected, captured_at, upload_status, created_at |
| `local_vouchers` | code_hash, booth_id, used_at, synced (dipakai F4) |
| `outbox` | id (cuid2, juga id baris di API), kind (`device_event`\|`print_job`), payload (JSON), created_at, attempts, next_attempt_at, last_error |
| `camera_pairings` | id, name, platform, token_hash (sha256 token kamera), created_at, last_seen_at, revoked_at |
| `print_jobs` | id, session_id, sheets, printer, status (`queued`\|`printing`\|`done`\|`failed`), file_path, os_job_id, error, created_at, updated_at |

- File sesi: `sessions/<YYYY-MM-DD UTC>/<KODE>/original|composite|print/`, ditulis dengan fsync. Tidak ada penghapusan di F3 (upload = F5). Aset config: `assets/<sha256>` (content-addressed, diverifikasi). Token device: file `device-token` (mode 0600).
- Outbox: dikirim per 100 ke `POST /device/events`; API menyimpan dengan id yang sama (`on conflict do nothing`) dan membalas id yang tersimpan → pengiriman ulang tidak menggandakan baris. Gagal → backoff 10 dtk × 2ⁿ (maks. 10 menit).
- `print_jobs` di API: `session_id` diisi hanya bila sesi dengan kode tersebut sudah ada di org (sesi baru diunggah di F5); `sheets` tetap tercatat untuk estimasi kertas.
- Heartbeat F3 menambah `printerStatus` (`ok`\|`warning`\|`error`\|`disconnected`\|`unknown`) → `devices.printer_status`. Tanpa migrasi DB (kolom sudah ada sejak F0).

### C.2 Ketetapan F4 (SQLite `user_version` 2)
| Tabel | Kolom |
|---|---|
| `local_vouchers` (dibuat ulang) | code_hash, booth_id (PK bersama), value_type (`full`\|`amount`), value, expires_at, remote_used_at (terpakai menurut API), used_at, used_session_id (terpakai di device ini), synced |
| `cash_approvals` (baru) | id (= id outbox), session_id, amount, approved_at, offline |
| `local_sessions` (+kolom) | offline (dibayar saat offline), payment_id |

- Daftar voucher di-replace dari `GET /device/vouchers` saat start, tiap 60 dtk, saat config siap, dan saat kembali online; pemakaian lokal yang belum tersinkron (`synced = 0`) tidak pernah dihapus.
- `outbox.kind` baru: `voucher_use` (payload: codeHash, session {id, code, startedAt}, amount, usedAt, offline), `cash_approval` (session, amount, approvedAt, offline), `session` (catatan sesi setelah processing), `payment_cancel` (paymentId; dikirim ke `POST /device/payments/:id/cancel`). `voucher_use`, `cash_approval`, `session` ikut batch `POST /device/events` (field `voucherUses`, `cashApprovals`, `sessions`).
- Kode voucher tidak pernah disimpan di agent; hanya hash (lihat B.9).

### A.7 Ketetapan F4 (renderer, tanpa perubahan schema)
- `voucher-input` varian `keypad`: baris tampilan kode/status + keypad 3×4. Varian `field`: kolom setinggi `min(height, fontSize × 2,4)`; bila sisa tinggi kotak ≥ 1,2 × tinggi kolom, keypad ringkas 6×2 digambar di sisa kotak (editor dan kiosk sama). Keduanya menerima keyboard/scanner di mode live. Kode ditampilkan `1234-5678-9012`.
- `qris` dan `payment-timer` tidak digambar di mode live bila `runtime.qrisHidden` (device offline atau QRIS tidak aktif).
