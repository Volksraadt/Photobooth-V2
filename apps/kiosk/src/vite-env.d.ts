/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CAPTURE?: 'webcam' | 'mock';
  readonly VITE_CONFIG_URL?: string;
  readonly VITE_CONFIG_SOURCE?: 'file' | 'api';
  readonly VITE_API_URL?: string;
  readonly VITE_SHORT_LINK_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
