import { describe, expect, it } from 'vitest';
import { assetUrlPrefixesFromEnv, isAllowedAssetUrl } from './asset-urls';

describe('asset URL allowlist', () => {
  const prefixes = assetUrlPrefixesFromEnv({
    PB_MEDIA_BASE_URL: 'https://studio.example.com/',
    NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  });

  it('derives the platform storage prefixes', () => {
    expect(prefixes).toEqual([
      'https://studio.example.com/media/',
      'https://abc.supabase.co/storage/v1/object/public/assets/',
    ]);
    expect(
      assetUrlPrefixesFromEnv({ PB_ASSET_URL_PREFIXES: 'https://cdn.x/a, https://cdn.y/b/' }),
    ).toEqual(['https://cdn.x/a/', 'https://cdn.y/b/']);
  });

  it('accepts built-in data URLs and platform storage', () => {
    expect(isAllowedAssetUrl('data:image/svg+xml;base64,AAAA', prefixes)).toBe(true);
    expect(isAllowedAssetUrl('https://studio.example.com/media/org1/ab.png', prefixes)).toBe(true);
    expect(
      isAllowedAssetUrl(
        'https://abc.supabase.co/storage/v1/object/public/assets/org1/ab.png',
        prefixes,
      ),
    ).toBe(true);
  });

  it('rejects internal addresses, other hosts and escapes', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:6379/',
      'https://studio.example.com.evil.test/media/x.png',
      'https://studio.example.com/medias/x.png',
      'https://studio.example.com/media/../api/secret',
      'https://studio.example.com/media/%2e%2e/api',
      'https://user:pw@studio.example.com/media/x.png',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(isAllowedAssetUrl(url, prefixes), url).toBe(false);
    }
  });
});
