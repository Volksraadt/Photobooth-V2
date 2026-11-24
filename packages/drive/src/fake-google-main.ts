import { FakeGoogle } from './fake-google';

/** `pnpm --filter @pb/drive fake` → try F5 locally without a Google Cloud project. */
const port = Number(process.env.FAKE_GOOGLE_PORT ?? 9099);
const fake = new FakeGoogle();
const base = await fake.start(port);
console.log(`[fake-google] listening on ${base}`);
console.log('[fake-google] start api + worker with:');
console.log(`  PB_GOOGLE_BASE_URL=${base} GOOGLE_CLIENT_ID=fake GOOGLE_CLIENT_SECRET=fake`);
setInterval(() => {
  const n = [...fake.files.values()].filter((f) => f.bytes).length;
  console.log(`[fake-google] ${fake.files.size} items, ${n} files`);
}, 30_000).unref();
