import { expect, test, type Page } from '@playwright/test';
import { newBooth, pairKiosk, publish, openEditor } from './helpers';

/**
 * F4 on the full dev stack. Requires the API to run with PB_PAYMENT_PROVIDER=mock (no Midtrans
 * account needed): `PB_PAYMENT_PROVIDER=mock pnpm dev`. Real Midtrans sandbox: docs/testing/F4-manual.md.
 */
const API = 'http://localhost:8787';

type Snap = {
  value: unknown;
  context: {
    page: string | null;
    session: { paymentId: string | null; paid: boolean; paymentMethod: string | null } | null;
  };
};
const empty: Snap = { value: null, context: { page: null, session: null } };
const snap = (kiosk: Page) =>
  kiosk.evaluate(
    (e) => (window.__pbKiosk ? (window.__pbKiosk.snapshot() as unknown as Snap) : e),
    empty,
  );
const send = (kiosk: Page, type: string) =>
  kiosk.evaluate((t) => window.__pbKiosk!.send({ type: t }), type);

async function toPayment(kiosk: Page) {
  await expect
    .poll(async () => (await snap(kiosk)).context.page, { timeout: 20_000 })
    .toBe('cover');
  await send(kiosk, 'START');
  await send(kiosk, 'NEXT'); // tutorial → frame pick (if enabled)
  if ((await snap(kiosk)).context.page !== 'framePick') await send(kiosk, 'NEXT');
  await send(kiosk, 'NEXT'); // single frame preselected → payment
  await expect.poll(async () => (await snap(kiosk)).context.page).toBe('payment');
}

test('Midtrans integration page, voucher batch, QRIS paid → capture < 3 s, voucher accepted once', async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  const boothUrl = await newBooth(page, 'klasik');

  // --- Integrasi: save sandbox credentials (encrypted by the API) + connection test ---
  await page.goto('/integrations');
  await expect(page.getByTestId('midtrans-guide')).toBeVisible();
  await expect(page.getByText('provider tiruan')).toBeVisible(); // mock mode banner
  const form = page.getByTestId('midtrans-form-sandbox');
  await form.getByLabel('Merchant ID').fill('G000000000');
  await form.getByLabel('Client key').fill('SB-Mid-client-e2e');
  await form.getByLabel('Server key').fill('SB-Mid-server-e2e-SECRET');
  await form.getByRole('button', { name: 'Simpan' }).click();
  await expect(page.getByText('tersimpan terenkripsi')).toBeVisible();
  await page.getByTestId('midtrans-test-sandbox').click();
  await expect(page.getByTestId('midtrans-status-sandbox')).toContainText('terhubung');
  // The key is never rendered back.
  expect(await page.content()).not.toContain('SB-Mid-server-e2e-SECRET');

  // --- Voucher batch ---
  await page.goto(`${boothUrl}/vouchers`);
  await page.getByLabel('Jumlah').fill('2');
  await page.getByRole('button', { name: 'Buat voucher' }).click();
  await expect(page.getByTestId('voucher-created')).toBeVisible({ timeout: 20_000 });
  const codes = await page.getByTestId('voucher-code').allTextContents();
  expect(codes).toHaveLength(2);
  expect(codes[0]).toMatch(/^\d{4}-\d{4}-\d{4}$/);

  // --- Publish + pair ---
  const kiosk = await pairKiosk(context, page, boothUrl);
  await openEditor(page, boothUrl);
  expect(await publish(page)).toBe(1);
  await expect(kiosk.getByTestId('device-screen')).toHaveCount(0, { timeout: 20_000 });

  // --- QRIS: webhook → API stream → agent → kiosk ---
  await toPayment(kiosk);
  await expect(kiosk.locator('[data-pb-qris] svg path').first()).toBeVisible({ timeout: 15_000 });
  const paymentId = (await snap(kiosk)).context.session!.paymentId!;
  expect(paymentId).toBeTruthy();
  const t0 = Date.now();
  const res = await page.request.post(`${API}/dev/payments/${paymentId}/simulate-paid`);
  expect(res.ok()).toBe(true);
  await expect
    .poll(async () => (await snap(kiosk)).context.page, { timeout: 3000, intervals: [50] })
    .toBe('capture');
  const elapsed = Date.now() - t0;
  console.log(`[e2e] paid → capture in ${elapsed} ms`);
  expect(elapsed).toBeLessThan(3000);

  // --- Voucher: typed on the payment page (keyboard / scanner path) ---
  await kiosk.reload();
  await toPayment(kiosk);
  await kiosk.keyboard.type(codes[0]!.replace(/-/g, ''));
  await kiosk.keyboard.press('Enter');
  await expect
    .poll(async () => (await snap(kiosk)).context.page, { timeout: 10_000 })
    .toBe('capture');
  expect((await snap(kiosk)).context.session?.paymentMethod).toBe('voucher');

  // Same voucher again → refused, buyer stays on Payment.
  await kiosk.reload();
  await toPayment(kiosk);
  await kiosk.keyboard.type(codes[0]!.replace(/-/g, ''));
  await kiosk.keyboard.press('Enter');
  await expect(kiosk.locator('[data-pb-voucher-status="used"]')).toBeVisible({ timeout: 10_000 });
  expect((await snap(kiosk)).context.page).toBe('payment');

  // Studio shows the voucher as used.
  await page.goto(`${boothUrl}/vouchers`);
  await expect(page.getByTestId(`voucher-${codes[0]!.slice(-4)}`)).toContainText('Terpakai');
});
