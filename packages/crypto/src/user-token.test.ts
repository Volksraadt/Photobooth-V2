import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { devUserTokenVerifier, hs256UserTokenVerifier, signDevUserToken } from './user-token';

const secret = 'x'.repeat(40);
const claims = { userId: '6f1c1c55-8f0a-4c3e-9a51-6a0c3f1c2b11', email: 'a@example.com' };

describe('user tokens', () => {
  it('round-trips a dev token', async () => {
    const token = await signDevUserToken(secret, claims);
    expect(await devUserTokenVerifier(secret)(token)).toEqual(claims);
  });

  it('rejects wrong secret, expired and tampered tokens', async () => {
    const token = await signDevUserToken(secret, claims);
    expect(await devUserTokenVerifier('y'.repeat(40))(token)).toBeNull();
    expect(await devUserTokenVerifier(secret)(`${token}x`)).toBeNull();
    const expired = await signDevUserToken(secret, claims, -10);
    expect(await devUserTokenVerifier(secret)(expired)).toBeNull();
  });

  it('rejects tokens without the authenticated role', async () => {
    const anon = await new SignJWT({ role: 'anon' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.userId)
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret));
    expect(await hs256UserTokenVerifier(secret)(anon)).toBeNull();
  });

  it('rejects short secrets', async () => {
    await expect(signDevUserToken('short', claims)).rejects.toThrow(/32/);
  });
});
