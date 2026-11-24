import { shortLinkState } from '@pb/db';
import { Hono } from 'hono';
import type { AppEnv } from '../types';

const CODE = /^[A-HJ-NP-Z2-9]{8}$/;

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * Buyer-facing pages are plain, self-contained HTML (no scripts, no external requests): they open
 * from a QR on any phone, even on slow connections.
 */
function page(opts: {
  title: string;
  heading: string;
  body: string;
  refreshSec?: number;
  spinner?: boolean;
}) {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
${opts.refreshSec ? `<meta http-equiv="refresh" content="${opts.refreshSec}">` : ''}
<title>${esc(opts.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    background: #f6f5f3; color: #1c1b19; }
  main { max-width: 26rem; text-align: center; }
  h1 { font-size: 1.4rem; margin: 1rem 0 .5rem; }
  p { margin: .4rem 0; color: #55524c; }
  .spin { width: 44px; height: 44px; margin: 0 auto; border-radius: 50%;
    border: 4px solid #d8d4cc; border-top-color: #1c1b19; animation: s 1s linear infinite; }
  .icon { font-size: 2.5rem; }
  @keyframes s { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1917; color: #f1efe9; } p { color: #b7b3aa; }
    .spin { border-color: #3b3934; border-top-color: #f1efe9; }
  }
</style>
</head>
<body>
<main>
${opts.spinner ? '<div class="spin" role="status" aria-label="Memuat"></div>' : '<div class="icon" aria-hidden="true">📷</div>'}
<h1>${esc(opts.heading)}</h1>
${opts.body}
</main>
</body>
</html>`;
}

const NO_STORE = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
};

/** `GET /s/:code`: the target of every download QR (print and Result page). */
export function shortLinkRoutes() {
  const app = new Hono<AppEnv>();

  const notFound = () =>
    new Response(
      page({
        title: 'Link tidak ditemukan',
        heading: 'Link tidak ditemukan',
        body: '<p>Periksa kembali kode pada cetakan Anda.</p><p>Jika Anda baru berfoto dan booth sedang tanpa internet, foto Anda akan tersedia di link ini begitu booth tersambung. Coba lagi nanti.</p>',
      }),
      { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE } },
    );

  app.get('/:code', async (c) => {
    const code = c.req.param('code').toUpperCase();
    if (!CODE.test(code)) return notFound();
    const state = await shortLinkState(c.var.deps.db, code);
    if (state.state === 'not_found') return notFound();
    if (state.state === 'ready') {
      return new Response(null, {
        status: 302,
        headers: { location: state.driveFolderUrl, ...NO_STORE },
      });
    }
    if (state.state === 'failed') {
      return c.html(
        page({
          title: 'Foto belum bisa diambil',
          heading: 'Foto Anda belum bisa diambil',
          body: '<p>Terjadi kendala saat menyiapkan file. Silakan hubungi pemilik booth dan sebutkan kode pada cetakan Anda.</p>',
        }),
        200,
        NO_STORE,
      );
    }
    return c.html(
      page({
        title: 'Foto sedang diproses',
        heading: 'Foto Anda sedang diproses',
        body: '<p>Halaman ini akan terbuka otomatis saat file siap. Biasanya kurang dari dua menit.</p>',
        refreshSec: 5,
        spinner: true,
      }),
      200,
      NO_STORE,
    );
  });

  return app;
}
