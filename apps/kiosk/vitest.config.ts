import { defineConfig } from 'vitest/config';

// Unit tests only; e2e/*.spec.ts are Playwright.
export default defineConfig({
  test: { include: ['src/**/*.test.{ts,tsx}'] },
});
