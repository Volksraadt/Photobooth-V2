// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverlayErrorBoundary, RootErrorBoundary } from './error-boundary';

function Boom(): never {
  throw new Error('kaboom');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('kiosk error boundaries (audit S3: never a white screen)', () => {
  it('a crash anywhere in the app shows the system screen instead of an empty page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <RootErrorBoundary>
        <Boom />
      </RootErrorBoundary>,
    );
    expect(screen.getByTestId('system-screen').textContent).toContain('Terjadi kesalahan');
    expect(screen.getByText(/Otomatis dalam/)).toBeTruthy();
  });

  it('a crashing overlay is closed and the page underneath keeps running', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onCrash = vi.fn();
    render(
      <div>
        <p>halaman booth</p>
        <OverlayErrorBoundary onCrash={onCrash}>
          <Boom />
        </OverlayErrorBoundary>
      </div>,
    );
    expect(screen.getByText('halaman booth')).toBeTruthy();
    expect(onCrash).toHaveBeenCalledWith(expect.objectContaining({ message: 'kaboom' }));
  });
});
