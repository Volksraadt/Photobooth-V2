import { createHash } from 'node:crypto';
import { createDefaultBoothConfig, type AssetRef, type BoothConfig } from '@pb/schema';
import { describe, expect, it, vi } from 'vitest';
import { createAssetLoader } from './assets';
import { JobError } from './types';

const PREFIXES = ['https://studio.test/media/'];
const bytes = Buffer.from('fake png bytes');
const sha = createHash('sha256').update(bytes).digest('hex');

function configWith(asset: Partial<AssetRef>): BoothConfig {
  const config = createDefaultBoothConfig({ boothId: 'booth1', boothName: 'Booth' });
  return {
    ...config,
    assets: [
      ...config.assets,
      { id: 'a1', kind: 'image', url: '', sha256: sha, bytes: bytes.length, ...asset },
    ],
  };
}

describe('worker asset loader (SSRF guard)', () => {
  it('fetches platform assets without redirects and checks the hash', async () => {
    const fetchImpl = vi.fn(async () => new Response(bytes));
    const load = createAssetLoader(
      configWith({ url: 'https://studio.test/media/o/a.png' }),
      PREFIXES,
      fetchImpl as unknown as typeof fetch,
    );
    expect(await load('a1')).toEqual(bytes);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://studio.test/media/o/a.png',
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('never requests a URL outside the platform storage', async () => {
    const fetchImpl = vi.fn(async () => new Response(bytes));
    const load = createAssetLoader(
      configWith({ url: 'http://169.254.169.254/latest/meta-data/' }),
      PREFIXES,
      fetchImpl as unknown as typeof fetch,
    );
    await expect(load('a1')).rejects.toMatchObject({ code: 'asset_rejected', permanent: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects bytes that do not match the AssetRef sha256', async () => {
    const fetchImpl = vi.fn(async () => new Response('something else'));
    const load = createAssetLoader(
      configWith({ url: 'https://studio.test/media/o/a.png' }),
      PREFIXES,
      fetchImpl as unknown as typeof fetch,
    );
    const err = await load('a1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobError);
    expect((err as JobError).code).toBe('asset_rejected');
  });
});
