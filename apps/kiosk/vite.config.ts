import { readFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import { defineConfig, normalizePath, type Plugin } from 'vite';
import { devConfigPath } from './scripts/dev-config-path.ts';

/**
 * Dev: serves the local booth config file at /booth-config.json and reloads the kiosk when it
 * changes. In F2 the config comes from the API (via the agent cache) instead.
 */
function boothConfigFile(): Plugin {
  const path = devConfigPath();
  return {
    name: 'pb-booth-config-file',
    configureServer(server) {
      server.watcher.add(path);
      server.watcher.on('change', (file) => {
        if (normalizePath(file) === normalizePath(path)) server.ws.send({ type: 'full-reload' });
      });
      server.middlewares.use('/booth-config.json', async (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        try {
          res.end(await readFile(path));
        } catch {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: `Config tidak ditemukan: ${path}` }));
        }
      });
    },
  };
}

const port = Number(process.env.PB_KIOSK_PORT ?? 5173);

export default defineConfig({
  plugins: [react(), boothConfigFile()],
  server: { port, strictPort: true },
  preview: { port, strictPort: true },
});
