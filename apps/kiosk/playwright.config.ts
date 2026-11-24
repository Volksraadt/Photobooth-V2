import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;

// Runs the kiosk dev server with a freshly generated default config (e2e/.tmp, not your local file).
export default defineConfig({
  testDir: './e2e',
  testIgnore: /f3-.*.spec.ts$/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1920, height: 1080 },
    launchOptions: {
      // Fake webcam for the real `webcam` source.
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
    permissions: ['camera'],
    // Looping animations (pulsing buttons) never become "stable" for clicks.
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
  webServer: {
    command: 'pnpm exec tsx scripts/ensure-dev-config.ts --reset && pnpm exec vite',
    url: `http://localhost:${PORT}/booth-config.json`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Browser-only mode (no local agent): F1 behavior. The F3 suite (playwright.f3.config.ts) runs the agent.
    env: {
      PB_KIOSK_PORT: String(PORT),
      PB_KIOSK_CONFIG: 'e2e/.tmp/booth-config.json',
      VITE_AGENT_URL: '0',
    },
  },
});
