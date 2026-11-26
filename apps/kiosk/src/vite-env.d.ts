/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CAPTURE?: 'webcam' | 'mock' | 'tablet';
  readonly VITE_CONFIG_URL?: string;
  /** `agent` (paired device; `api` = F2 name) or `file`. */
  readonly VITE_CONFIG_SOURCE?: 'file' | 'agent' | 'api';
  /** Local agent base URL; `0` disables the agent (browser-only mode). */
  readonly VITE_AGENT_URL?: string;
  readonly VITE_SHORT_LINK_BASE?: string;
  /** `1` on a real booth (`pnpm booth`): no dev overlay, kiosk hardening on. */
  readonly VITE_BOOTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
