import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { F3 } from '../playwright.f3.config';
import { onPage, tap } from './helpers';

const AGENT = `http://127.0.0.1:${F3.agentPort}`;
const CAMERA_URL = `http://localhost:${F3.cameraPort}/`;
const KIOSK_QUERY = '?dev=1&kiosk=0';
const SLOT = (n: number) => `.pb-root [data-pb-slot="${n}"]`;

type AgentSession = {
  id: string;
  code: string;
  status: string;
  started_at: string;
  files: {
    id: string;
    kind: string;
    slotIndex: number | null;
    takeNumber: number | null;
    selected: boolean;
    width: number;
    height: number;
    source: string;
    url: string;
  }[];
};

declare global {
  interface Window {
    __pbCamera?: {
      pairWith(qr: string): Promise<void>;
      status(): { state: string } | null;
      simulateOutage(ms: number): void;
      simulateOutageAfterNextShot(ms: number): void;
      lastShot(): { width: number; height: number; method: string; confirmed: boolean } | null;
      pending(): number;
    };
  }
}

async function agentJson<T>(
  page: Page,
  path: string,
  init?: { method?: string; data?: unknown },
): Promise<T> {
  const res = await page.request.fetch(`${AGENT}${path}`, {
    method: init?.method ?? 'GET',
    data: init?.data,
  });
  expect(res.ok(), `${path}: ${res.status()}`).toBe(true);
  return (await res.json()) as T;
}

/** Kiosk with the tablet source + a paired, connected Camera App page. */
async function setup(page: Page, cameraInit?: () => void) {
  await agentJson(page, '/settings', { method: 'PUT', data: { cameraSource: 'tablet' } });
  await page.goto(`/${KIOSK_QUERY}`);
  await expect(page.locator('[data-pb-page="cover"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__pbKiosk?.camera().id)).toBe('tablet');

  // Operator UI: admin → Kamera → Tablet → "Pasang tablet baru" shows the pairing QR.
  await page.evaluate(() => window.__pbKiosk!.send({ type: 'ADMIN.OPEN' }));
  await expect(page.getByTestId('admin-panel')).toBeVisible();
  await expect(page.getByTestId('camera-source-tablet')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('pair-tablet').click();
  const qr = (await page.getByTestId('tablet-qr').getAttribute('data-qr'))!;
  expect(JSON.parse(qr)).toMatchObject({
    t: 'pb-camera',
    hosts: ['127.0.0.1'],
    port: F3.agentLanPort,
  });

  const camera = await page.context().newPage();
  await camera.setViewportSize({ width: 1180, height: 820 });
  if (cameraInit) await camera.addInitScript(cameraInit);
  await camera.goto(CAMERA_URL);
  await expect(camera.getByTestId('pairing-screen')).toBeVisible();
  // Same function the QR scanner calls with the decoded text.
  await camera.evaluate((text) => window.__pbCamera!.pairWith(text), qr);
  await expect(camera.getByTestId('camera-screen')).toHaveAttribute('data-link', 'connected', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('tablet-panel')).toHaveAttribute('data-status', 'connected');
  await expect.poll(() => page.evaluate(() => window.__pbKiosk!.camera().status)).toBe('connected');
  // WebRTC preview frames arrive in the kiosk.
  await expect
    .poll(() => page.getByTestId('admin-preview').evaluate((v: HTMLVideoElement) => v.videoWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  return camera;
}

test('tablet camera: low-latency preview over WebRTC (timestamp probe)', async ({ page }) => {
  // The tablet's camera is replaced by a canvas that paints Date.now() as 24 black/white bars;
  // the kiosk decodes each presented frame. Same clock on both pages → glass-to-glass latency.
  const camera = await setup(page, () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d')!;
    const draw = () => {
      const t = Date.now() % 2 ** 24;
      for (let i = 0; i < 24; i++) {
        ctx.fillStyle = (t >> (23 - i)) & 1 ? '#ffffff' : '#000000';
        ctx.fillRect((i * 1280) / 24, 0, 1280 / 24 + 1, 720);
      }
      requestAnimationFrame(draw);
    };
    draw();
    const stream = canvas.captureStream(30);
    navigator.mediaDevices.getUserMedia = async () => stream.clone();
  });

  const samples = await page.getByTestId('admin-preview').evaluate(
    (video: HTMLVideoElement) =>
      new Promise<number[]>((resolve) => {
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        const out: number[] = [];
        const onFrame = () => {
          const w = video.videoWidth;
          const h = video.videoHeight;
          c.width = w;
          c.height = h;
          ctx.drawImage(video, 0, 0);
          const row = ctx.getImageData(0, Math.floor(h / 2), w, 1).data;
          let t = 0;
          for (let i = 0; i < 24; i++) {
            const x = Math.floor(((i + 0.5) * w) / 24);
            t = (t << 1) | (row[x * 4]! > 127 ? 1 : 0);
          }
          const latency = ((Date.now() % 2 ** 24) - t + 2 ** 24) % 2 ** 24;
          if (latency < 5000) out.push(latency);
          if (out.length >= 150) resolve(out);
          else video.requestVideoFrameCallback(onFrame);
        };
        video.requestVideoFrameCallback(onFrame);
      }),
  );
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)]!;
  const p95 = samples[Math.floor(samples.length * 0.95)]!;
  const stats = await page.evaluate(() => window.__pbKiosk!.previewStats?.());
  console.log(
    `[f3] preview latency (loopback) median ${median} ms, p95 ${p95} ms; webrtc stats`,
    stats,
  );
  expect(median).toBeLessThan(200);
  expect(p95).toBeLessThan(200);
  await camera.close();
});

test('tablet session: full-res stills, Wi-Fi drop mid-capture, print < 15 s, print matches the editor', async ({
  page,
}) => {
  const camera = await setup(page);
  const previewWidth = await page
    .getByTestId('admin-preview')
    .evaluate((v: HTMLVideoElement) => v.videoWidth);

  // Free session from admin → frame pick → capture (4 shots, auto-advance).
  await page.getByRole('button', { name: 'Mulai sesi gratis' }).click();
  await expect(onPage(page, 'framePick')).toBeVisible();
  await tap(page, 'next');
  await expect(onPage(page, 'capture')).toBeVisible();
  await expect(page.locator(SLOT(1))).toHaveAttribute('data-pb-filled', 'true', {
    timeout: 20_000,
  });

  // Shot 2: the tablet takes the photo, then its Wi-Fi drops for 4 s before the upload.
  await camera.evaluate(() => window.__pbCamera!.simulateOutageAfterNextShot(4000));
  const banner = page.getByTestId('camera-status-banner');
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toHaveAttribute('data-status', 'reconnecting');
  await expect(banner).toContainText('Kamera terputus');
  await expect(camera.getByTestId('link-status')).toContainText('Terputus');
  await expect.poll(() => camera.evaluate(() => window.__pbCamera!.pending())).toBe(1);
  // Back online: banner goes away, the waiting photo is uploaded into slot 2.
  await expect(banner).toBeHidden({ timeout: 20_000 });
  await expect(page.locator(SLOT(2))).toHaveAttribute('data-pb-filled', 'true', {
    timeout: 20_000,
  });
  await expect.poll(() => camera.evaluate(() => window.__pbCamera!.pending())).toBe(0);
  for (const n of [3, 4]) {
    await expect(page.locator(SLOT(n))).toHaveAttribute('data-pb-filled', 'true', {
      timeout: 20_000,
    });
  }
  await expect
    .poll(() => page.evaluate(() => window.__pbKiosk!.snapshot().value))
    .toEqual({ capture: 'waiting' });
  await expect
    .poll(() => camera.evaluate(() => window.__pbCamera!.lastShot()?.confirmed))
    .toBe(true);
  const t4 = Date.now();
  const last = (await camera.evaluate(() => window.__pbCamera!.lastShot()))!;
  console.log(
    `[f3] tablet still ${last.width}×${last.height} via ${last.method}; preview ${previewWidth} px wide`,
  );

  // Stored files: full-resolution originals from the tablet (not frames of the preview stream).
  const sessionId = await page.evaluate(() => window.__pbKiosk!.snapshot().context.session!.id);
  const sessions = await agentJson<AgentSession[]>(page, '/sessions');
  const session = sessions.find((s) => s.id === sessionId)!;
  const originals = session.files.filter((f) => f.kind === 'original');
  expect(originals).toHaveLength(4);
  for (const f of originals) {
    expect(f.source).toBe('tablet');
    expect([f.width, f.height]).toEqual([last.width, last.height]);
  }
  expect(last.method).not.toBe('stream-frame');
  expect(last.width).toBeGreaterThanOrEqual(previewWidth);

  // Review → confirm (instant tap) → processing → printed → result.
  await tap(page, 'next');
  await expect(onPage(page, 'review')).toBeVisible();
  const filters = page.locator('[data-pb-filter-picker] [data-pb-item]');
  await filters.nth(2).click();
  await tap(page, 'confirm');
  await expect(onPage(page, 'result')).toBeVisible({ timeout: 15_000 });
  const printers = await agentJson<{
    recentJobs: { session_id: string; status: string; sheets: number; created_at: string }[];
  }>(page, '/printers');
  const job = printers.recentJobs.find((j) => j.session_id === sessionId)!;
  expect(job.status).toBe('done');
  const printStartMs = Date.parse(job.created_at) - t4;
  console.log(
    `[f3] 4th photo confirmed → print job started in ${printStartMs} ms (includes the review tap)`,
  );
  expect(printStartMs).toBeLessThan(15_000);

  // --- Print vs editor: the composite equals the renderer's strip (same frame, photos, filter, date).
  const done = (await agentJson<AgentSession[]>(page, '/sessions')).find(
    (s) => s.id === sessionId,
  )!;
  const composite = done.files.find((f) => f.kind === 'composite')!;
  const selected = done.files.filter((f) => f.kind === 'original' && f.selected);
  const snapshot = await page.evaluate(() => {
    const s = window.__pbKiosk!.snapshot().context;
    const cv = s.config.pages.capture.elements.find((e) => e.type === 'camera-view') as
      { mirror?: boolean } | undefined;
    return {
      frameId: s.session!.frameId!,
      filterId: s.session!.filterId,
      startedAt: s.session!.startedAt,
      code: s.session!.code,
      mirror: !!cv?.mirror,
    };
  });
  const preview = await page.context().newPage();
  await preview.setViewportSize({ width: 600, height: 1800 });
  const data = {
    frameId: snapshot.frameId,
    filterId: snapshot.filterId,
    mirror: snapshot.mirror,
    photos: Object.fromEntries(selected.map((f) => [f.slotIndex!, f.url])),
    now: snapshot.startedAt,
    downloadUrl: `https://pb.test/s/${snapshot.code}`,
  };
  await preview.goto(`/?dev=1&view=strip#${encodeURIComponent(JSON.stringify(data))}`);
  const stripEl = preview.getByTestId('strip-preview');
  await expect(stripEl.locator('img')).toHaveCount(5); // 4 photos + overlay
  await preview.waitForFunction(() =>
    [...document.images].every((i) => i.complete && i.naturalWidth > 0),
  );
  await preview.evaluate(() => document.fonts.ready);
  const screen = await stripEl.screenshot({ animations: 'disabled' });

  const raw = async (bytes: Buffer) =>
    sharp(bytes).resize(600, 1800, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const compositeBytes = Buffer.from(await (await page.request.get(composite.url)).body());
  await sharp(screen).toFile(test.info().outputPath('strip-renderer.png'));
  await sharp(compositeBytes).toFile(test.info().outputPath('strip-compositor.png'));
  const a = await raw(screen);
  const b = await raw(compositeBytes);
  const diff = (x0: number, y0: number, w: number, h: number) => {
    let sum = 0;
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++)
        for (let c = 0; c < 3; c++) {
          const i = (y * 600 + x) * 3 + c;
          sum += Math.abs(a[i]! - b[i]!);
        }
    return sum / (w * h * 3);
  };
  const config = await (await page.request.get(`/booth-config.json`)).json();
  const frame = config.frames.find((f: { id: string }) => f.id === snapshot.frameId);
  const whole = diff(0, 0, 600, 1800);
  const slots = frame.slots.map((s: { x: number; y: number; width: number; height: number }) =>
    diff(
      Math.round(s.x + 4),
      Math.round(s.y + 4),
      Math.round(s.width - 8),
      Math.round(s.height - 8),
    ),
  );
  const dateEl = frame.dynamicElements[1];
  const dateArea = diff(dateEl.x, dateEl.y, dateEl.width, dateEl.height);
  console.log(
    `[f3] renderer vs compositor mean abs diff: whole ${whole.toFixed(2)}, slots ${slots.map((d: number) => d.toFixed(2)).join('/')}, date text ${dateArea.toFixed(2)}`,
  );
  expect(whole).toBeLessThan(4);
  for (const d of slots) expect(d).toBeLessThan(4);
  expect(dateArea).toBeLessThan(8);
  await preview.close();
  await camera.close();
});
