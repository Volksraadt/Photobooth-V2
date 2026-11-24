import { describe, expect, it } from 'vitest';
import { uploadState, type JobView } from './upload-status';

const job = (p: Partial<JobView> & Pick<JobView, 'target' | 'status'>): JobView => ({
  attempts: 0,
  lastError: null,
  errorCode: null,
  nextAttemptAt: null,
  ...p,
});
const session = { status: 'completed', filesCompleteAt: null, driveFolderUrl: null };

describe('uploadState', () => {
  it('waits for the booth when nothing has arrived', () => {
    expect(uploadState(session, []).kind).toBe('waiting');
    expect(uploadState(session, []).label).toContain('booth');
  });

  it('shows processing, then done with the Drive link', () => {
    expect(uploadState(session, [job({ target: 'storage', status: 'running' })]).kind).toBe(
      'processing',
    );
    const url = 'https://drive.google.com/drive/folders/x';
    const done = uploadState({ ...session, driveFolderUrl: url }, [
      job({ target: 'storage', status: 'done' }),
      job({ target: 'drive', status: 'done' }),
    ]);
    expect(done).toMatchObject({ kind: 'done', driveUrl: url, canRetry: false });
  });

  it('explains a revoked Drive in plain Indonesian and allows retry', () => {
    const s = uploadState(session, [
      job({ target: 'storage', status: 'done' }),
      job({ target: 'drive', status: 'failed', errorCode: 'drive_revoked', lastError: 'x' }),
    ]);
    expect(s.kind).toBe('failed');
    expect(s.canRetry).toBe(true);
    expect(s.detail).toContain('dicabut');
  });

  it('shows retries without offering a manual retry', () => {
    const s = uploadState(session, [
      job({ target: 'storage', status: 'done' }),
      job({ target: 'drive', status: 'pending', attempts: 2, lastError: 'HTTP 503' }),
    ]);
    expect(s).toMatchObject({ kind: 'retrying', canRetry: false });
    expect(s.label).toContain('2');
  });
});
