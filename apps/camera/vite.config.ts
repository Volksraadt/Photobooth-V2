import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const port = Number(process.env.PB_CAMERA_PORT ?? 5175);

// Dev: `http://localhost:5175` is a secure context, so a laptop tab can act as the tablet.
// On the device the app runs from the Capacitor origin (capacitor://localhost, https://localhost).
export default defineConfig({
  plugins: [react()],
  server: { port, strictPort: true, host: true },
  preview: { port, strictPort: true },
  build: { target: 'es2022' },
});
