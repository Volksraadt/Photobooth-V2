import { expect, type Page } from '@playwright/test';

export type ElementBox = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export async function openKiosk(page: Page, query = 'capture=mock&dev=1') {
  await page.goto(`/?${query}`);
  await expect(page.locator('[data-pb-page="cover"]')).toBeVisible();
}

export function onPage(page: Page, type: string) {
  return page.locator(`.pb-root[data-pb-page="${type}"]`);
}

export async function tap(page: Page, kind: string) {
  await page.locator(`.pb-root [data-pb-action="${kind}"]`).first().click();
}

export async function flowValue(page: Page): Promise<unknown> {
  return page.evaluate(() => window.__pbKiosk!.snapshot().value);
}

/** cover → tutorial → frame → payment (mock paid) → capture */
export async function goToCapture(page: Page) {
  await tap(page, 'start');
  await expect(onPage(page, 'tutorial')).toBeVisible();
  await tap(page, 'next');
  await expect(onPage(page, 'framePick')).toBeVisible();
  await tap(page, 'next');
  await expect(onPage(page, 'payment')).toBeVisible();
  await expect(page.locator('[data-pb-qris]')).not.toHaveAttribute('data-pb-qris', '');
  await page.getByTestId('simulate-paid').click();
  await expect(onPage(page, 'capture')).toBeVisible();
}

/** Screen boxes of all rendered elements, mapped back to artboard px. */
export async function artboardBoxes(page: Page): Promise<{ scale: number; boxes: ElementBox[] }> {
  return page.evaluate(() => {
    const artboard = document.querySelector<HTMLElement>('[data-pb-artboard]')!;
    const scale = Number(artboard.dataset.pbScale);
    const origin = artboard.getBoundingClientRect();
    const boxes = [
      ...document.querySelectorAll<HTMLElement>(
        '.pb-root > [data-pb-artboard] [data-pb-element-id]',
      ),
    ]
      .filter((el) => !el.closest('[data-pb-frame-composite]'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.dataset.pbElementId!,
          type: el.dataset.pbElementType!,
          x: (r.left - origin.left) / scale,
          y: (r.top - origin.top) / scale,
          width: r.width / scale,
          height: r.height / scale,
        };
      });
    return { scale, boxes };
  });
}

/** With page.clock installed: advance fake time in steps until the locator is visible. */
export async function advanceUntilVisible(
  page: Page,
  selector: string,
  stepMs = 500,
  maxSteps = 200,
) {
  for (let i = 0; i < maxSteps; i++) {
    if (await page.locator(selector).first().isVisible()) return;
    await page.clock.runFor(stepMs);
  }
  await expect(page.locator(selector).first()).toBeVisible();
}
