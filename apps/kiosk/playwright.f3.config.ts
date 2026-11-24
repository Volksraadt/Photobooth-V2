import { defineConfig, devices } from '@playwright/test';

/**
 * F3 suite: local agent + kiosk + tablet Camera App (a second page in the same browser with a
 * fake camera). Everything on loopback; printing goes to the agent's virtual printer.
 */
export const F3 = {
  kioskPort: 5176,
  cameraPort: 5177,
  agentPort: 47910,
  agentLanPort: 47911,
  dataDir: 'e2e/.tmp/agent-data',
};

export default defineConfig({
  testDir: './e2e',
  testMatch: /f3-.*\.spec\.ts$/,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${F3.kioskPort}`,
    trace: 'retain-on-failure',
    viewport: { width: 1920, height: 1080 },
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        // Both "devices" share one machine: keep WebRTC on host candidates without mDNS.
        '--disable-features=WebRtcHideLocalIpsWithMdns',
      ],
    },
    permissions: ['camera'],
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
  webServer: [
    {
      command: `node -e "require('fs').rmSync('${F3.dataDir}',{recursive:true,force:true})" && pnpm --dir ../agent exec tsx src/main.ts`,
      url: `http://127.0.0.1:${F3.agentPort}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PB_AGENT_DATA: `../kiosk/${F3.dataDir}`,
        PB_AGENT_PORT: String(F3.agentPort),
        PB_AGENT_LAN_PORT: String(F3.agentLanPort),
        PB_AGENT_LAN_HOST: '127.0.0.1',
        PB_AGENT_ADVERTISE_HOSTS: '127.0.0.1',
        PB_AGENT_ORIGINS: `http://localhost:${F3.kioskPort}`,
        PB_PRINT_MODE: 'virtual',
        PB_AGENT_TELEMETRY: '0',
        PB_API_URL: 'http://127.0.0.1:9',
        PB_SHORT_LINK_BASE: 'https://pb.test',
      },
    },
    {
      command: 'pnpm exec tsx scripts/ensure-dev-config.ts --reset && pnpm exec vite',
      url: `http://localhost:${F3.kioskPort}/booth-config.json`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PB_KIOSK_PORT: String(F3.kioskPort),
        PB_KIOSK_CONFIG: 'e2e/.tmp/f3-booth-config.json',
        VITE_AGENT_URL: `http://127.0.0.1:${F3.agentPort}`,
        VITE_SHORT_LINK_BASE: 'https://pb.test',
      },
    },
    {
      command: 'pnpm --dir ../camera exec vite',
      url: `http://localhost:${F3.cameraPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PB_CAMERA_PORT: String(F3.cameraPort) },
    },
  ],
});
