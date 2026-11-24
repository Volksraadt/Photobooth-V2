import { FakeGoogle } from '@pb/drive/testing';
import { expect, test, type Page } from '@playwright/test';
import { newBooth, openEditor, pairKiosk, publish } from './helpers';

/**
 * F5 acceptance on the full dev stack (Studio, API, worker, agent, kiosk) with a local fake of
 * Google. Start with:
 *   GOOGLE_CLIENT_ID=fake GOOGLE_CLIENT_SECRET=fake PB_GOOGLE_BASE_URL=http://127.0.0.1:9099 \
 *   PB_PUBLIC_API_URL=http://localhost:8787 pnpm dev      (worker = `pnpm dev` includes it)
 * One finished session → six Drive subfolders in < 2 minutes; the QR link goes processing → Drive.
 */
const API = 'http://localhost:8787';
const fake = new FakeGoogle();

test.beforeAll(async () => {
  await fake.start(9099);
});
test.afterAll(async () => {
  await fake.stop();
});

const onPage = (p: Page, type: string) => p.locator(`.pb-root[data-pb-page="${type}"]`);
const tap = (p: Page, kind: string) =>
  p.locator(`.pb-root [data-pb-action="${kind}"]`).first().click();
const KINDS = ['original', 'mirrored', 'filtered', 'composite', 'gif', 'video'];

test('a finished session lands in six Drive subfolders in < 2 min; QR short link follows', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const boothUrl = await newBooth(page, 'klasik');

  // Studio → Integrasi → connect Google Drive.
  await page.goto('/integrations');
  await page.getByTestId('drive-connect').click();
  await expect(page).toHaveURL(/drive=connected/);

  // A voucher pays the session (no Midtrans needed).
  await page.goto(`${boothUrl}/vouchers`);
  await page.getByLabel('Jumlah').fill('1');
  await page.getByRole('button', { name: 'Buat voucher' }).click();
  await expect(page.getByTestId('voucher-created')).toBeVisible({ timeout: 20_000 });
  const code = (await page.getByTestId('voucher-code').first().textContent())!.replace(/\D/g, '');

  const kiosk = await pairKiosk(context, page, boothUrl);
  // Looping animations (pulsing buttons) make elements never "stable" for Playwright clicks.
  await kiosk.emulateMedia({ reducedMotion: 'reduce' });
  await openEditor(page, boothUrl);
  await publish(page);
  await expect(kiosk.getByTestId('device-screen')).toHaveCount(0, { timeout: 20_000 });

  // Buyer: cover → … → payment (voucher) → 4 photos → review → confirm → result.
  await expect(onPage(kiosk, 'cover')).toBeVisible({ timeout: 20_000 });
  await tap(kiosk, 'start');
  await kiosk.evaluate(() => window.__pbKiosk!.send({ type: 'NEXT' })); // tutorial
  for (let i = 0; i < 3; i++) {
    const p = await kiosk.evaluate(
      () =>
        (window.__pbKiosk!.snapshot() as unknown as { context: { page: string | null } }).context
          .page,
    );
    if (p === 'payment') break;
    await kiosk.evaluate(() => window.__pbKiosk!.send({ type: 'NEXT' }));
  }
  await expect(onPage(kiosk, 'payment')).toBeVisible();
  await kiosk.keyboard.type(code);
  await kiosk.keyboard.press('Enter');
  await expect(onPage(kiosk, 'capture')).toBeVisible({ timeout: 15_000 });
  for (const n of [1, 2, 3, 4]) {
    await expect(kiosk.locator(`.pb-root [data-pb-slot="${n}"]`)).toHaveAttribute(
      'data-pb-filled',
      'true',
      { timeout: 20_000 },
    );
  }
  const sessionCode = await kiosk.evaluate(
    () =>
      (window.__pbKiosk!.snapshot() as unknown as { context: { session: { code: string } } })
        .context.session.code,
  );
  await tap(kiosk, 'next');
  await expect(onPage(kiosk, 'review')).toBeVisible();
  await tap(kiosk, 'confirm');
  const t0 = Date.now();
  await expect(onPage(kiosk, 'result')).toBeVisible({ timeout: 30_000 });

  // The QR on the result page encodes the short link (never Drive directly).
  const link = `${API}/s/${sessionCode}`;

  // Short link first says "processing" or already redirects; it must never 404 for this session.
  await expect
    .poll(async () => (await page.request.get(link, { maxRedirects: 0 })).status(), {
      timeout: 30_000,
    })
    .not.toBe(404);

  // Within 2 minutes of the buyer confirming: the short link redirects to the Drive folder.
  await expect
    .poll(async () => (await page.request.get(link, { maxRedirects: 0 })).status(), {
      timeout: 110_000,
      intervals: [1000],
    })
    .toBe(302);
  const elapsedSec = (Date.now() - t0) / 1000;
  console.log(`[f5] confirm → Drive folder ready in ${elapsedSec.toFixed(1)} s`);
  expect(elapsedSec).toBeLessThan(120);

  const location = (await page.request.get(link, { maxRedirects: 0 })).headers()['location']!;
  const folderId = location.split('/').pop()!;
  const folder = fake.files.get(folderId)!;
  expect(folder.name).toBe(sessionCode);
  expect(folder.permissions[0]).toMatchObject({ role: 'reader', type: 'anyone' });
  const subs = fake.children(folderId);
  expect(subs.map((s) => s.name).sort()).toEqual([...KINDS].sort());
  const files = (k: string) => fake.children(subs.find((s) => s.name === k)!.id);
  expect(files('original')).toHaveLength(4);
  expect(files('mirrored')).toHaveLength(4);
  expect(files('filtered')).toHaveLength(4);
  expect(files('composite')).toHaveLength(1);
  expect(files('gif')).toHaveLength(1);
  expect(files('video')).toHaveLength(1);

  // Studio shows the delivery state of the session.
  await page.goto(`${boothUrl}/transactions`);
  await expect(page.getByTestId(`upload-${sessionCode}`)).toContainText('Terkirim ke Drive');
});
