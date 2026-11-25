import { describe, expect, it } from 'vitest';
import { sessionPoolerUrl } from './client';

describe('sessionPoolerUrl', () => {
  it('moves the Supabase transaction pooler (6543) to the session pooler (5432)', () => {
    expect(
      sessionPoolerUrl('postgres://u:p@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres'),
    ).toBe('postgres://u:p@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres');
    expect(sessionPoolerUrl('postgres://postgres:postgres@127.0.0.1:54329/photobooth')).toBe(
      'postgres://postgres:postgres@127.0.0.1:54329/photobooth',
    );
  });
});
