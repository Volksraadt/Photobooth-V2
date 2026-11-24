import { expect, test, type Page } from '@playwright/test';
import type { BoothConfig } from '@pb/schema';
import {
  advanceUntilVisible,
  artboardBoxes,
  flowValue,
  goToCapture,
  onPage,
  openKiosk,
  tap,
} from './helpers';

const SLOT = (n: number) => `.pb-root [data-pb-slot="${n}"]`;

async function storedSessions(page: Page) {
  return page.evaluate(
    () =>
      new Promise<
        { code: string; shots: { slotIndex: number; takeNumber: number; selected: boolean }[] }[]
      >((resolve, reject) => {
        const req = indexedDB.open('pb-kiosk');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const all = req.result.transaction('sessions').objectStore('sessions').getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => reject(all.error);
        };
      }),
  );
}

test('default config runs the full buyer flow', async ({ page }) => {
  await openKiosk(page);

  await goToCapture(page);
  // Countdown 3-2-1, then the photo lands in slot 1.
  await expect(page.locator('[data-pb-countdown="3"]')).toBeVisible();
  await expect(page.locator(SLOT(1))).toHaveAttribute('data-pb-filled', 'true', {
    timeout: 10_000,
  });
  for (const n of [2, 3, 4]) {
    await expect(page.locator(SLOT(n))).toHaveAttribute('data-pb-filled', 'true', {
      timeout: 10_000,
    });
  }
  await expect.poll(() => flowValue(page)).toEqual({ capture: 'waiting' });

  // Retake slot 2.
  await page.locator('[data-pb-retake-slot="2"]').click();
  await expect(page.locator(SLOT(2))).toHaveAttribute('data-pb-active', 'true');
  await expect(page.locator('[data-pb-countdown]')).toBeVisible();
  await expect.poll(() => flowValue(page), { timeout: 10_000 }).toEqual({ capture: 'waiting' });
  const takes = await page.evaluate(() =>
    window.__pbKiosk!.snapshot().context.session!.shots.map((s) => s?.takeNumber),
  );
  expect(takes).toEqual([1, 2, 1, 1]);

  // Review: change filter.
  await tap(page, 'next');
  await expect(onPage(page, 'review')).toBeVisible();
  const items = page.locator('[data-pb-filter-picker] [data-pb-item]');
  await expect(items).toHaveCount(3);
  await items.nth(1).click();
  await expect(items.nth(1)).toHaveAttribute('data-pb-selected', 'true');
  const previewPhotos = page.locator('[data-pb-frame-composite] [data-pb-frame-slot] img');
  await expect(previewPhotos).toHaveCount(4);
  await expect(previewPhotos.first()).toHaveCSS('filter', /url/);

  // Processing → result with QR to the short link.
  await tap(page, 'confirm');
  await expect(onPage(page, 'processing')).toBeVisible();
  await expect(onPage(page, 'result')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-pb-download-qr]')).toHaveAttribute(
    'data-pb-download-qr',
    /\/s\/[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/,
  );

  // Photos are stored locally (all takes, including the replaced one).
  const sessions = await storedSessions(page);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.shots).toHaveLength(5);
  expect(sessions[0]!.shots.filter((s) => s.selected)).toHaveLength(4);

  await tap(page, 'finish');
  await expect(onPage(page, 'cover')).toBeVisible();
});

test('result page returns to cover automatically', async ({ page }) => {
  await page.clock.install();
  await openKiosk(page);
  await page.evaluate(() => {
    const k = window.__pbKiosk!;
    k.send({ type: 'ADMIN.OPEN' });
    k.send({ type: 'ADMIN.FREE_SESSION' });
    k.send({ type: 'NEXT' });
  });
  await expect(onPage(page, 'capture')).toBeVisible();
  await advanceUntilVisible(page, `${SLOT(4)}[data-pb-filled="true"]`);
  await expect.poll(() => flowValue(page)).toEqual({ capture: 'waiting' });
  await tap(page, 'next');
  await tap(page, 'confirm');
  await advanceUntilVisible(page, '.pb-root[data-pb-page="result"]');
  await page.clock.runFor(60_000);
  await expect(onPage(page, 'cover')).toBeVisible();
});

test('camera-view position follows the JSON config after reload', async ({ page }) => {
  let moved = false;
  await page.route('**/booth-config.json', async (route) => {
    const res = await route.fetch();
    const config = (await res.json()) as BoothConfig;
    if (moved) {
      const camera = config.pages.capture.elements.find((e) => e.type === 'camera-view')!;
      camera.x = 400;
      camera.y = 200;
      camera.width = 960;
      camera.height = 540;
    }
    await route.fulfill({ response: res, json: config });
  });

  const cameraBox = async () => {
    await openKiosk(page);
    await page.evaluate(() => {
      const k = window.__pbKiosk!;
      k.send({ type: 'ADMIN.OPEN' });
      k.send({ type: 'ADMIN.FREE_SESSION' });
      k.send({ type: 'NEXT' });
    });
    await expect(onPage(page, 'capture')).toBeVisible();
    const { boxes } = await artboardBoxes(page);
    return boxes.find((b) => b.type === 'camera-view')!;
  };

  const before = await cameraBox();
  expect(before).toMatchObject({ x: 80, y: 80, width: 1280, height: 720 });

  moved = true;
  await page.reload();
  const after = await cameraBox();
  expect(after.x).toBeCloseTo(400, 1);
  expect(after.y).toBeCloseTo(200, 1);
  expect(after.width).toBeCloseTo(960, 1);
  expect(after.height).toBeCloseTo(540, 1);
});

test.describe('same layout at 1920×1080 and 1366×768', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const pageType of ['cover', 'capture'] as const) {
    test(`${pageType}: only the scale differs`, async ({ page }) => {
      const measure = async (width: number, height: number) => {
        await page.setViewportSize({ width, height });
        await openKiosk(page);
        if (pageType === 'capture') {
          await page.evaluate(() => {
            const k = window.__pbKiosk!;
            k.send({ type: 'ADMIN.OPEN' });
            k.send({ type: 'ADMIN.FREE_SESSION' });
            k.send({ type: 'NEXT' });
          });
          await expect(onPage(page, 'capture')).toBeVisible();
        }
        await page.getByTestId('dev-tools').evaluate((el) => (el.style.display = 'none'));
        await page.waitForTimeout(300);
        return {
          ...(await artboardBoxes(page)),
          shot: (await page.screenshot()).toString('base64'),
        };
      };

      const big = await measure(1920, 1080);
      const small = await measure(1366, 768);
      expect(big.scale).toBe(1);
      expect(small.scale).toBeCloseTo(768 / 1080, 6);

      // Every element sits at the same artboard coordinates.
      expect(small.boxes.length).toBe(big.boxes.length);
      for (const b of big.boxes) {
        const s = small.boxes.find((x) => x.id === b.id)!;
        for (const k of ['x', 'y', 'width', 'height'] as const) {
          expect(Math.abs(s[k] - b[k]), `${b.type}.${k}`).toBeLessThan(1);
        }
      }

      if (pageType === 'cover') {
        // Pixel check: the 1920 screenshot scaled down ≈ the 1366 screenshot.
        const diff = await page.evaluate(
          async ({ bigShot, smallShot }) => {
            const load = (b64: string) =>
              new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = `data:image/png;base64,${b64}`;
              });
            const [a, b] = await Promise.all([load(bigShot), load(smallShot)]);
            const w = b.width;
            const h = b.height;
            const pixels = (img: HTMLImageElement) => {
              const c = document.createElement('canvas');
              c.width = w;
              c.height = h;
              const ctx = c.getContext('2d')!;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(img, 0, 0, w, h);
              return ctx.getImageData(0, 0, w, h).data;
            };
            const pa = pixels(a);
            const pb = pixels(b);
            let sum = 0;
            let bad = 0;
            for (let i = 0; i < pa.length; i += 4) {
              const d =
                (Math.abs(pa[i]! - pb[i]!) +
                  Math.abs(pa[i + 1]! - pb[i + 1]!) +
                  Math.abs(pa[i + 2]! - pb[i + 2]!)) /
                3;
              sum += d;
              if (d > 48) bad++;
            }
            const n = pa.length / 4;
            return { mean: sum / n, badRatio: bad / n };
          },
          { bigShot: big.shot, smallShot: small.shot },
        );
        expect(diff.mean).toBeLessThan(3);
        expect(diff.badRatio).toBeLessThan(0.01);
      }
    });
  }
});

for (const source of ['webcam', 'mock'] as const) {
  test(`${source}: camera unplugged mid-capture shows the Error page, then resumes`, async ({
    page,
  }) => {
    await openKiosk(page, `capture=${source}&dev=1`);
    await goToCapture(page);
    await expect(page.locator(SLOT(1))).toHaveAttribute('data-pb-filled', 'true', {
      timeout: 10_000,
    });

    await page.evaluate(() => window.__pbKiosk!.unplugCamera());
    await expect(onPage(page, 'error')).toBeVisible();
    await expect(page.getByTestId('system-screen')).toHaveCount(0);
    await expect(onPage(page, 'error')).toContainText('Ups, ada kendala');

    // Paid session is kept: leaving the Error page resumes capture at slot 2.
    await tap(page, 'start');
    await expect(onPage(page, 'capture')).toBeVisible();
    await expect(page.locator(SLOT(1))).toHaveAttribute('data-pb-filled', 'true');
    await expect(page.locator(SLOT(2))).toHaveAttribute('data-pb-filled', 'true', {
      timeout: 10_000,
    });
  });
}

test('idle before payment returns to cover', async ({ page }) => {
  await page.clock.install();
  await openKiosk(page);
  await tap(page, 'start');
  await tap(page, 'next');
  await expect(onPage(page, 'framePick')).toBeVisible();
  await page.clock.runFor(89_000);
  await expect(onPage(page, 'framePick')).toBeVisible();
  // A touch restarts the timer.
  await page.locator('.pb-root [data-pb-item]').first().click();
  await page.clock.runFor(89_000);
  await expect(onPage(page, 'framePick')).toBeVisible();
  await page.clock.runFor(2_000);
  await expect(onPage(page, 'cover')).toBeVisible();
  expect(await page.evaluate(() => window.__pbKiosk!.snapshot().context.session)).toBeNull();
});

test('admin mode: 5 corner taps + PIN', async ({ page }) => {
  await openKiosk(page);
  for (let i = 0; i < 5; i++) await page.mouse.click(20, 20);
  await expect(page.getByTestId('pin-pad')).toBeVisible();

  for (const k of ['9', '9', '9', '9', 'ok']) await page.locator(`[data-key="${k}"]`).click();
  await expect(page.getByTestId('pin-pad')).toContainText('PIN salah');

  for (const k of ['1', '2', '3', '4', 'ok']) await page.locator(`[data-key="${k}"]`).click();
  await expect(page.getByTestId('admin-panel')).toBeVisible();
  await expect.poll(() => flowValue(page)).toBe('admin');

  await page.getByRole('button', { name: 'Mulai sesi gratis' }).click();
  await expect(onPage(page, 'framePick')).toBeVisible();
  await tap(page, 'next');
  // Free session skips payment.
  await expect(onPage(page, 'capture')).toBeVisible();
});

test('invalid config shows a system screen with the issues, not a white page', async ({ page }) => {
  await page.route('**/booth-config.json', async (route) => {
    const res = await route.fetch();
    const config = (await res.json()) as BoothConfig;
    config.pages.capture.elements = config.pages.capture.elements.filter(
      (e) => e.type !== 'camera-view',
    );
    await route.fulfill({ response: res, json: config });
  });
  await page.goto('/?capture=mock&dev=1');
  await expect(page.getByTestId('system-screen')).toBeVisible();
  await expect(page.getByTestId('config-issues')).toContainText('camera-view');
});
