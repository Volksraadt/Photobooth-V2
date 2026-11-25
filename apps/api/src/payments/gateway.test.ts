import { describe, expect, it } from 'vitest';
import { mergeStoredSecret } from './gateway';

describe('mergeStoredSecret', () => {
  it('needs a server key for a new credential', () => {
    expect(mergeStoredSecret(null, { signatureKey: 'sig' })).toBeNull();
    expect(mergeStoredSecret(null, { serverKey: 'srv' })).toEqual({ serverKey: 'srv' });
    expect(mergeStoredSecret(null, { serverKey: 'srv', signatureKey: 'sig' })).toEqual({
      serverKey: 'srv',
      signatureKey: 'sig',
    });
  });

  it('keeps stored keys when fields are empty', () => {
    const stored = { serverKey: 'srv', signatureKey: 'sig' };
    expect(mergeStoredSecret(stored, {})).toBeNull();
    expect(mergeStoredSecret(stored, { serverKey: 'srv2' })).toEqual({
      serverKey: 'srv2',
      signatureKey: 'sig',
    });
  });

  it('adds a signature key to an existing credential without the server key', () => {
    expect(mergeStoredSecret({ serverKey: 'srv' }, { signatureKey: 'sig' })).toEqual({
      serverKey: 'srv',
      signatureKey: 'sig',
    });
  });

  it('keeps the replaced signature key as previous (Midtrans retries old signatures)', () => {
    const stored = { serverKey: 'srv', signatureKey: 'old', previousSignatureKey: 'older' };
    expect(mergeStoredSecret(stored, { signatureKey: 'new' })).toEqual({
      serverKey: 'srv',
      signatureKey: 'new',
      previousSignatureKey: 'old',
    });
    // Re-saving the same key does not drop the previous one.
    expect(mergeStoredSecret(stored, { signatureKey: 'old' })).toEqual(stored);
  });
});
