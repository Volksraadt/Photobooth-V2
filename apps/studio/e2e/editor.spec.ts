import { expect, test, type Page } from '@playwright/test';
import type { Element } from '@pb/schema';
import {
  artboardBox,
  editorDoc,
  KIOSK_URL,
  kioskVersion,
  newBooth,
  openEditor,
  pairKiosk,
  publish,
} from './helpers';

test.use({ viewport: { width: 1700, height: 1000 } });
test.describe.configure({ mode: 'serial' });

// 1×1 PNG (sky blue) used as an uploaded cover background.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgaPj/HwAEhgJ/0OB2VQAAAABJRU5ErkJggg==',
  'base64',
);

/** Artboard px → screen px on the editor canvas. */
async function toScreen(page: Page, x: number, y: number) {
  const stage = (await page.getByTestId('editor-stage').boundingBox())!;
  const zoom = await page.evaluate(() => window.__pbEditor!.getState().ui.zoom);
  return { x: stage.x + x * zoom, y: stage.y + y * zoom, zoom };
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 6 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

const captureEls = async (page: Page) => (await editorDoc(page)).pages.capture.elements;
const geo = (e: Element) => ({ x: e.x, y: e.y, width: e.width, height: e.height });

test('template → edit camera, 4 slots and background → publish → paired kiosk updates < 10 s; rollback is followed', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const boothUrl = await newBooth(page, 'neon');
  const kiosk = await pairKiosk(context, page, boothUrl);
  await kiosk.evaluate(() => ((window as unknown as { __noReload: number }).__noReload = 1));

  await openEditor(page, boothUrl);

  // --- Cover background: uploaded image (exercises upload + kiosk asset download/verify) ---
  await page.getByTestId('bg-kind').selectOption('image');
  await page.getByTestId('page-props').getByRole('button', { name: 'Gambar', exact: true }).click();
  await page
    .getByTestId('upload-image')
    .setInputFiles({ name: 'latar.png', mimeType: 'image/png', buffer: PNG });
  await expect
    .poll(async () => (await editorDoc(page)).pages.cover.background)
    .toMatchObject({ kind: 'image' });

  // --- Capture page ---
  await page.getByTestId('page-capture').click();
  const before = await captureEls(page);
  const camera = before.find((e) => e.type === 'camera-view')!;
  const slots = before.filter((e) => e.type === 'photo-slot');

  // Drag the camera (grab near its top-left, away from the countdown).
  const grab = await toScreen(page, camera.x + 80, camera.y + 60);
  await drag(page, grab, -120, 60);
  let cam = (await captureEls(page)).find((e) => e.id === camera.id)!;
  expect(cam.x).not.toBe(camera.x);
  expect(cam.y).not.toBe(camera.y);

  // Resize it from the bottom-right handle.
  const se = (await page.locator('.moveable-control[data-direction="se"]').first().boundingBox())!;
  await drag(page, { x: se.x + se.width / 2, y: se.y + se.height / 2 }, -150, -90);
  cam = (await captureEls(page)).find((e) => e.id === camera.id)!;
  expect(cam.width).toBeLessThan(camera.width);
  expect(cam.height).toBeLessThan(camera.height);

  // Select the 4 slots (layer panel, shift-click) and move them together.
  await page.getByTestId(`layer-${slots[0]!.id}`).click();
  for (const s of slots.slice(1))
    await page.getByTestId(`layer-${s.id}`).click({ modifiers: ['Shift'] });
  await expect
    .poll(() => page.evaluate(() => window.__pbEditor!.getState().ui.selection.length))
    .toBe(4);
  const slotGrab = await toScreen(
    page,
    slots[1]!.x + slots[1]!.width / 2,
    slots[1]!.y + slots[1]!.height / 2,
  );
  await drag(page, slotGrab, 60, 30);
  const movedSlots = (await captureEls(page)).filter((e) => e.type === 'photo-slot');
  for (const [i, s] of movedSlots.entries()) expect(s.x).not.toBe(slots[i]!.x);

  // Capture background color.
  await page.keyboard.press('Escape');
  await page.getByTestId('bg-kind').selectOption('color');
  await page.getByTestId('bg-color').fill('#123456');
  await page.getByTestId('bg-color').press('Enter');
  await expect
    .poll(async () => (await editorDoc(page)).pages.capture.background)
    .toEqual({ kind: 'color', color: '#123456' });

  const v1Doc = await editorDoc(page);
  const t0 = Date.now();
  expect(await publish(page)).toBe(1);

  // --- Kiosk follows without restart, in < 10 s ---
  await expect.poll(() => kioskVersion(kiosk), { timeout: 10_000, intervals: [200] }).toBe(1);
  expect(Date.now() - t0).toBeLessThan(10_000);
  expect(
    await kiosk.evaluate(() => (window as unknown as { __noReload?: number }).__noReload),
  ).toBe(1);
  await expect(
    kiosk.locator('.pb-root[data-pb-page="cover"] img[data-pb-background]'),
  ).toHaveAttribute('src', /^blob:/);

  // Same layout on the kiosk's capture page (second tab of the same paired device).
  const kioskB = await context.newPage();
  await kioskB.setViewportSize({ width: 1366, height: 768 });
  await kioskB.goto(KIOSK_URL);
  await expect.poll(() => kioskVersion(kioskB), { timeout: 20_000 }).toBe(1);
  await kioskB.evaluate(() => {
    const k = window.__pbKiosk!;
    k.send({ type: 'ADMIN.OPEN' });
    k.send({ type: 'ADMIN.FREE_SESSION' });
    k.send({ type: 'NEXT' });
  });
  await expect(kioskB.locator('.pb-root[data-pb-page="capture"]')).toBeVisible();
  for (const el of v1Doc.pages.capture.elements.filter(
    (e) => e.type === 'camera-view' || e.type === 'photo-slot',
  )) {
    const box = await artboardBox(kioskB, '.pb-root > [data-pb-artboard]', el.id);
    for (const k of ['x', 'y', 'width', 'height'] as const)
      expect(Math.abs(box[k] - geo(el)[k]), `${el.name}.${k}`).toBeLessThan(1);
  }
  await expect(kioskB.locator('.pb-root[data-pb-page="capture"] [data-pb-background]')).toHaveCSS(
    'background-color',
    'rgb(18, 52, 86)',
  );
  await kioskB.close();

  // --- v2: move the camera again via the properties panel ---
  await page.getByTestId(`layer-${camera.id}`).click();
  await page.getByTestId('prop-x').fill('300');
  await page.getByTestId('prop-x').press('Enter');
  expect(await publish(page)).toBe(2);
  await expect.poll(() => kioskVersion(kiosk), { timeout: 10_000 }).toBe(2);

  // --- Rollback to v1 → published as v3; the device follows ---
  await page.goto(boothUrl);
  await page.getByTestId('rollback-1').click();
  await expect(page.getByText('Versi 1 diaktifkan kembali sebagai versi 3')).toBeVisible();
  await expect.poll(() => kioskVersion(kiosk), { timeout: 10_000 }).toBe(3);
  const live = await kiosk.evaluate(
    () => window.__pbKiosk!.snapshot().context.config.pages.capture.elements,
  );
  const liveCam = live.find((e: Element) => e.id === camera.id)!;
  expect(geo(liveCam)).toEqual(geo(v1Doc.pages.capture.elements.find((e) => e.id === camera.id)!));
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByTestId('device-config-version').first().textContent();
      },
      { timeout: 45_000, intervals: [2000] },
    )
    .toContain('v3');
});

test('undo/redo covers every editor operation', async ({ page }) => {
  test.setTimeout(120_000);
  const boothUrl = await newBooth(page, 'klasik');
  await openEditor(page, boothUrl);
  await page.getByTestId('page-capture').click();
  const original = await editorDoc(page);
  const els = original.pages.capture.elements;
  const camera = els.find((e) => e.type === 'camera-view')!;
  const slots = els.filter((e) => e.type === 'photo-slot');
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

  // drag
  await drag(page, await toScreen(page, camera.x + 60, camera.y + 60), 80, 40);
  // resize
  const se = (await page.locator('.moveable-control[data-direction="se"]').first().boundingBox())!;
  await drag(page, { x: se.x + 3, y: se.y + 3 }, -60, -30);
  // rotate (handle)
  const rot = (await page.locator('.moveable-rotation-control').first().boundingBox())!;
  await drag(page, { x: rot.x + rot.width / 2, y: rot.y + rot.height / 2 }, 120, 40);
  // property field
  await page.getByTestId('prop-rotation').fill('15');
  await page.getByTestId('prop-rotation').press('Enter');
  // keyboard nudge, duplicate, copy/paste to another page, delete
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(`${mod}+d`);
  await page.keyboard.press('Delete');
  await page.getByTestId(`layer-${camera.id}`).click();
  await page.keyboard.press(`${mod}+c`);
  await page.getByTestId('page-cover').click();
  await page.keyboard.press(`${mod}+v`); // camera-view is not allowed on Cover: skipped
  await page.getByTestId('page-capture').click();
  // multi-select slots: align, distribute, group, ungroup
  await page.getByTestId(`layer-${slots[0]!.id}`).click();
  for (const s of slots.slice(1))
    await page.getByTestId(`layer-${s.id}`).click({ modifiers: ['Shift'] });
  await page.getByTestId('align-left').click();
  await page.getByTestId('distribute-v').click();
  await page.keyboard.press(`${mod}+g`);
  await page.keyboard.press(`${mod}+Shift+g`);
  // layer order, lock, hide
  await page.keyboard.press(`${mod}+]`);
  await page.getByTestId(`layer-lock-${slots[0]!.id}`).click();
  await page.getByTestId(`layer-visible-${slots[1]!.id}`).click();
  // add element + background
  await page.getByTestId('add-element').click();
  await page.getByTestId('add-text').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('bg-kind').selectOption('color');
  // frame editor: add a slot
  await page.getByTestId('tab-frames').click();
  await page.getByTestId('slot-add').click();
  // filter + settings
  await page.getByTestId('tab-filters').click();
  await page.getByTestId('filter-add').click();
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('setting-base-price').fill('50000');
  await page.getByTestId('setting-base-price').press('Enter');

  const changed = await editorDoc(page);
  expect(changed).not.toEqual(original);
  const steps = await page.evaluate(() => {
    let n = 0;
    while (window.__pbEditor!.undo()) n++;
    return n;
  });
  expect(steps).toBeGreaterThanOrEqual(15);
  expect(await editorDoc(page)).toEqual(original);
  await page.evaluate(() => {
    while (window.__pbEditor!.redo());
  });
  expect(await editorDoc(page)).toEqual(changed);

  // Toolbar buttons and Ctrl+Z work too.
  await page.getByTestId('tab-design').click();
  await page.getByTestId('undo').click();
  await page.keyboard.press(`${mod}+z`);
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect(page.getByTestId('redo')).toBeEnabled();
});

test('publish is rejected with the list of problems', async ({ page }) => {
  const boothUrl = await newBooth(page, 'klasik');
  await openEditor(page, boothUrl);
  await page.getByTestId('page-capture').click();
  const camera = (await captureEls(page)).find((e) => e.type === 'camera-view')!;
  await page.getByTestId(`layer-${camera.id}`).click();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('issues-button')).toContainText('masalah');
  await page.getByTestId('publish-button').click();
  const result = page.getByTestId('publish-result');
  await expect(result).toContainText('Perbaiki masalah');
  await expect(result.getByTestId('issue-list')).toContainText('camera-view');
  await expect(page.getByTestId('publish-ok')).toHaveCount(0);
  await page.goto(boothUrl);
  await expect(page.getByTestId('version-list')).toHaveCount(0);
});

test('editor canvas is pixel-identical to the kiosk', async ({ page, context }) => {
  test.setTimeout(180_000);
  const boothUrl = await newBooth(page, 'terang');
  const kiosk = await pairKiosk(context, page, boothUrl);
  await openEditor(page, boothUrl);
  await publish(page);
  await expect.poll(() => kioskVersion(kiosk), { timeout: 10_000 }).toBe(1);
  await kiosk.setViewportSize({ width: 960, height: 540 });
  await kiosk.emulateMedia({ reducedMotion: 'reduce' });
  await kiosk.getByTestId('dev-tools').evaluate((el) => (el.style.display = 'none'));

  for (const pageType of ['cover', 'framePick'] as const) {
    await page.getByTestId(`page-${pageType}`).click();
    await page.evaluate(() =>
      window.__pbEditor!.setUi({ zoom: 0.5, pan: { x: 20, y: 20 }, selection: [] }),
    );
    await page.waitForTimeout(300);
    const editorShot = await page.getByTestId('editor-stage').screenshot();

    if (pageType === 'framePick') {
      await kiosk.evaluate(() => window.__pbKiosk!.send({ type: 'START' }));
      await kiosk.evaluate(() => window.__pbKiosk!.send({ type: 'NEXT' }));
    }
    await expect(kiosk.locator(`.pb-root[data-pb-page="${pageType}"]`)).toBeVisible();
    await kiosk.waitForTimeout(500);
    const kioskShot = await kiosk.screenshot();

    const diff = await kiosk.evaluate(
      async ({ a, b }) => {
        const load = (b64: string) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = `data:image/png;base64,${b64}`;
          });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        const w = 960;
        const h = 540;
        const px = (img: HTMLImageElement) => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(img, 0, 0, w, h);
          return ctx.getImageData(0, 0, w, h).data;
        };
        const pa = px(ia);
        const pb = px(ib);
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
        return {
          mean: sum / (w * h),
          bad: bad / (w * h),
          sizes: [ia.width, ia.height, ib.width, ib.height],
        };
      },
      { a: editorShot.toString('base64'), b: kioskShot.toString('base64') },
    );
    console.log(
      `[parity] ${pageType}: mean=${diff.mean.toFixed(3)} differing=${(diff.bad * 100).toFixed(3)}%`,
    );
    expect(diff.sizes, pageType).toEqual([960, 540, 960, 540]);
    expect(diff.mean, `${pageType} mean diff`).toBeLessThan(2);
    expect(diff.bad, `${pageType} differing pixels`).toBeLessThan(0.005);
  }
});
