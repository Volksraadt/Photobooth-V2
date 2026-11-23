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

### A.5 Aset
```ts
type AssetRef = { id: string; kind: 'image' | 'video' | 'font' | 'audio'; url: string; sha256: string; bytes: number };
```
Agent mengunduh semua aset sebelum mengaktifkan versi config baru. Jika ada aset gagal, versi lama tetap dipakai.

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
- `admin.pinHash: ''` = PIN belum diatur; Kiosk wajib menolak mode admin. Format hash ditetapkan di F1.
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

---

## C. Penyimpanan lokal (Agent, SQLite)

| Tabel | Isi |
|---|---|
| `config_cache` | versi config aktif + path aset lokal |
| `local_sessions` | salinan sesi + status sinkron |
| `local_files` | path file, jenis, status upload |
| `local_vouchers` | code_hash, booth_id, used_at, synced |
| `outbox` | event yang menunggu dikirim (heartbeat tertunda, device_events, pemakaian voucher) |
