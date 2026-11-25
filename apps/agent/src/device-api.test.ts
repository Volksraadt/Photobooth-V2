import { describe, expect, it } from 'vitest';
import { DeviceApiError, isApiUnreachable } from './device-api';

describe('isApiUnreachable', () => {
  it('treats network failures as unreachable', () => {
    expect(isApiUnreachable(new TypeError('fetch failed'))).toBe(true);
  });

  it('treats proxy/tunnel gateway errors without an API error code as unreachable', () => {
    for (const status of [502, 503, 504, 520, 522, 524, 530]) {
      expect(isApiUnreachable(new DeviceApiError(status, `HTTP ${status}`))).toBe(true);
    }
  });

  it('treats any answer from the API itself as reachable', () => {
    expect(isApiUnreachable(new DeviceApiError(502, 'Midtrans error', 'provider_error'))).toBe(
      false,
    );
    expect(isApiUnreachable(new DeviceApiError(503, 'busy', 'pairing_busy'))).toBe(false);
    expect(isApiUnreachable(new DeviceApiError(500, 'HTTP 500'))).toBe(false);
    expect(isApiUnreachable(new DeviceApiError(404, 'HTTP 404'))).toBe(false);
    expect(isApiUnreachable(new DeviceApiError(401, 'revoked', 'unauthorized'))).toBe(false);
  });
});
