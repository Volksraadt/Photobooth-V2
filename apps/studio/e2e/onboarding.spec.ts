import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'e2e-password-123';

async function signUp(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Kata sandi').fill(PASSWORD);
  await page.getByRole('button', { name: 'Daftar' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

async function createOrgAndBooth(page: Page, org: string, booth: string): Promise<string> {
  await page.getByLabel('Nama usaha / organisasi').fill(org);
  await page.getByRole('button', { name: 'Buat organisasi' }).click();
  await expect(page).toHaveURL(/\/booths$/);
  await expect(page.getByTestId('org-name')).toHaveText(org);

  await page.getByLabel('Nama booth').fill(booth);
  await page.getByRole('button', { name: 'Buat booth' }).click();
  await expect(page).toHaveURL(/\/booths\/[a-z0-9]+$/);
  await expect(page.getByTestId('booth-name')).toHaveText(booth);
  await expect(page.getByTestId('draft-valid')).toBeVisible();
  // Page previews use the shared renderer (same as the Kiosk), in editor mode.
  const capture = page.getByTestId('preview-capture');
  await expect(capture.locator('[data-pb-element-type="camera-view"]')).toContainText('Kamera');
  await expect(capture.locator('[data-pb-slot]')).toHaveCount(4);
  await expect(page.getByTestId('preview-cover')).toContainText(booth);
  return page.url();
}

test('new user signs up, creates an org and a booth with a valid default draft', async ({
  page,
}) => {
  const id = Date.now();
  await signUp(page, `e2e-${id}@example.test`);
  await createOrgAndBooth(page, `Org E2E ${id}`, `Booth E2E ${id}`);

  await page.getByRole('link', { name: 'Semua booth' }).click();
  await expect(page.getByTestId('booth-list')).toContainText(`Booth E2E ${id}`);
});

test("a user cannot open another org's booth", async ({ browser }) => {
  const id = Date.now();
  const a = await browser.newPage();
  await signUp(a, `e2e-a-${id}@example.test`);
  const boothUrl = await createOrgAndBooth(a, `Org A ${id}`, `Booth A ${id}`);

  const b = await browser.newPage();
  await signUp(b, `e2e-b-${id}@example.test`);
  await createOrgAndBooth(b, `Org B ${id}`, `Booth B ${id}`);
  await b.goto('/booths');
  await expect(b.getByTestId('booth-list')).not.toContainText(`Booth A ${id}`);

  const res = await b.goto(boothUrl);
  expect(res?.status()).toBe(404);
  await expect(b.getByText('Halaman tidak ditemukan')).toBeVisible();
});
