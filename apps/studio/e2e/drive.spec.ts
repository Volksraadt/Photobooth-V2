import { FakeGoogle } from '@pb/drive/testing';
import { expect, test } from '@playwright/test';
import { newBooth } from './helpers';

/**
 * F5 on the dev stack with a local fake of Google (no Google Cloud project needed). The API must
 * be started with:
 *   GOOGLE_CLIENT_ID=fake GOOGLE_CLIENT_SECRET=fake PB_GOOGLE_BASE_URL=http://127.0.0.1:9099 pnpm dev
 * (and SECRET_MASTER_KEY set). Real Google: docs/testing/F5-manual.md.
 */
const fake = new FakeGoogle();

test.beforeAll(async () => {
  await fake.start(9099);
});
test.afterAll(async () => {
  await fake.stop();
});

test('connect Google Drive (drive.file), pick a root folder, see a revoked connection explained', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await newBooth(page, 'klasik');
  await page.goto('/integrations');
  const card = page.getByTestId('drive-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('drive.file');

  // Consent (auto-approved by the fake) → API callback → back to Studio.
  await page.getByTestId('drive-connect').click();
  await expect(page).toHaveURL(/\/integrations\?drive=connected/);
  await expect(page.getByTestId('drive-flash')).toContainText('Google Drive terhubung');
  const status = page.getByTestId('drive-status');
  await expect(status).toContainText('owner@example.test');
  await expect(status).toContainText('terhubung');
  await expect(status).toContainText('Photobooth');
  expect(fake.find(['Photobooth'])).toBeDefined();

  // Create another root folder.
  await page.getByLabel('Atau buat folder baru').fill('Booth Pesta');
  await page.getByRole('button', { name: 'Buat folder' }).click();
  await expect(page.getByText('Folder root disimpan')).toBeVisible();
  await expect(page.getByTestId('drive-status')).toContainText('Booth Pesta');
  expect(fake.find(['Booth Pesta'])).toBeDefined();

  await page.getByTestId('drive-test').click();
  await expect(page.getByText('Terhubung ke Google Drive')).toBeVisible();

  // The refresh token never reaches the browser.
  expect(await page.content()).not.toContain('fake-refresh-token');

  // The owner revokes access in their Google account: a clear message, then reconnect.
  fake.revokeAccess();
  await page.getByTestId('drive-test').click();
  await expect(page.getByText('Akses Google Drive dicabut')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('drive-status')).toContainText('akses dicabut');
  await page.getByTestId('drive-connect').click();
  await expect(page).toHaveURL(/drive=connected/);
  await expect(page.getByTestId('drive-status')).toContainText('terhubung');
});
