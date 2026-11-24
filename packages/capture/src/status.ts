import type { CaptureError, CaptureStatus, CaptureStatusListener } from './types';

/** Small status holder shared by the source implementations. */
export class StatusEmitter {
  private current: CaptureStatus = 'idle';
  private error: CaptureError | null = null;
  private readonly listeners = new Set<CaptureStatusListener>();

  get status(): CaptureStatus {
    return this.current;
  }

  get lastError(): CaptureError | null {
    return this.error;
  }

  set(status: CaptureStatus, error: CaptureError | null = null): void {
    if (status === this.current && error === this.error) return;
    this.current = status;
    this.error = status === 'error' ? error : null;
    for (const listener of [...this.listeners]) {
      try {
        listener(this.current, this.error);
      } catch (err) {
        // A faulty listener must not break the source.
        console.error('[capture] status listener failed', err);
      }
    }
  }

  subscribe(listener: CaptureStatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
