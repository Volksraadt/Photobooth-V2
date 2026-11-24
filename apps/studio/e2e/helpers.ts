import { expect, type BrowserContext, type Page } from '@playwright/test';
import type { BoothConfig } from '@pb/schema';

export const KIOSK_URL = 'http://localhost:5173/?source=api&capture=mock&dev=1&kiosk=0';
const PASSWORD = 'e2e-password-123';

/** New user + org + booth from a template; returns the booth page URL. */
export async function newBooth(page: Page, template: 'klasik' | 'neon' | 'terang' = 'neon') {
  const id = Math.random().toString(36).slice(2, 8);
  await page.goto('/login');
  await page.getByLabel('Email').fill(`f2-${id}@e2e.test`);
  await page.getByLabel('Kata sandi').fill(PASSWORD);
  await page.getByRole('button', { name: 'Daftar' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel('Nama usaha / organisasi').fill(`Org F2 ${id}`);
  await page.getByRole('button', { name: 'Buat organisasi' }).click();
  await expect(page).toHaveURL(/\/booths$/);
  await page.getByTestId(`template-${template}`).click();
  await page.getByLabel('Nama booth').fill(`Booth ${id}`);
  await page.getByRole('button', { name: 'Buat booth' }).click();
  await expect(page).toHaveURL(/\/booths\/[a-z0-9]+$/);
  return page.url();
}

export async function openEditor(page: Page, boothUrl: string) {
  await page.goto(`${boothUrl}/editor`);
  await expect(page.getByTestId('editor-stage')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!window.__pbEditor)).toBe(true);
}

export function editorDoc(page: Page): Promise<BoothConfig> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__pbEditor!.getState().doc)));
}

/** Kiosk tab (own context page): shows a pairing code; Studio claims it. */
export async function pairKiosk(context: BrowserContext, studio: Page, boothUrl: string) {
  const kiosk = await context.newPage();
  await kiosk.goto(KIOSK_URL);
  const codeEl = kiosk.getByTestId('pairing-code');
  await expect(codeEl).toBeVisible({ timeout: 20_000 });
  const code = (await codeEl.getAttribute('data-code'))!;
  await studio.goto(boothUrl);
  await studio.getByLabel('Kode pairing').fill(code);
  await studio.getByLabel('Nama perangkat').fill('Laptop e2e');
  await studio.getByRole('button', { name: 'Pasang' }).click();
  await expect(studio.getByText('Perangkat "Laptop e2e" terpasang')).toBeVisible();
  // Paired, nothing published yet.
  await expect(kiosk.getByTestId('device-screen')).toHaveAttribute('data-status', 'waiting', {
    timeout: 15_000,
  });
  return kiosk;
}

export async function publish(page: Page): Promise<number> {
  await page.getByTestId('publish-button').click();
  const ok = page.getByTestId('publish-ok');
  await expect(ok).toBeVisible({ timeout: 20_000 });
  const version = Number(/Versi (\d+)/.exec((await ok.textContent()) ?? '')?.[1]);
  await page.getByRole('button', { name: 'Tutup' }).click();
  return version;
}

export function kioskVersion(kiosk: Page): Promise<number | null> {
  return kiosk.evaluate(() => window.__pbKiosk?.snapshot().context.config.configVersion ?? null);
}

/** Bounding box of an element in artboard px (kiosk or editor stage). */
export async function artboardBox(page: Page, rootSelector: string, elementId: string) {
  return page.evaluate(
    ({ rootSelector, elementId }) => {
      const root = document.querySelector<HTMLElement>(rootSelector)!;
      const rect = root.getBoundingClientRect();
      const scale = rect.width / root.offsetWidth;
      const el = [
        ...root.querySelectorAll<HTMLElement>(`[data-pb-element-id="${elementId}"]`),
      ].find((n) => !n.closest('[data-pb-frame-composite]'))!;
      const r = el.getBoundingClientRect();
      return {
        x: (r.left - rect.left) / scale,
        y: (r.top - rect.top) / scale,
        width: r.width / scale,
        height: r.height / scale,
      };
    },
    { rootSelector, elementId },
  );
}

declare global {
  interface Window {
    __pbEditor?: {
      getState(): {
        doc: BoothConfig;
        ui: { selection: string[]; zoom: number };
        canUndo: boolean;
        canRedo: boolean;
      };
      setUi(patch: Record<string, unknown>): void;
      undo(): boolean;
      redo(): boolean;
    };
    __pbKiosk?: {
      send(e: { type: string }): void;
      snapshot(): { value: unknown; context: { config: BoothConfig } };
    };
  }
}
