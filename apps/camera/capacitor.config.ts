import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'id.photobooth.camera',
  appName: 'Kamera Booth',
  webDir: 'dist',
  android: {
    // The agent is plain HTTP/WS on the booth LAN; the app origin is https://localhost.
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  plugins: {
    CapacitorHttp: { enabled: false },
  },
};

export default config;
