/** What Studio shows for a session's file delivery (F5). Pure, so it is easy to test. */

export type JobView = {
  target: 'storage' | 'drive';
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  lastError: string | null;
  errorCode: string | null;
  nextAttemptAt: Date | null;
};

export type SessionUploadInput = {
  status: string;
  filesCompleteAt: Date | null;
  driveFolderUrl: string | null;
};

export type UploadState = {
  kind: 'waiting' | 'processing' | 'retrying' | 'done' | 'failed' | 'none';
  label: string;
  /** Plain-language reason (failed / retrying). */
  detail: string | null;
  /** The owner can press "Coba lagi". */
  canRetry: boolean;
  driveUrl: string | null;
};

/** Owner-facing text for the machine codes the worker stores in `upload_jobs.error_code`. */
export const JOB_ERROR_TEXT: Record<string, string> = {
  drive_not_connected: 'Google Drive belum terhubung. Hubungkan di menu Integrasi.',
  drive_revoked: 'Akses Google Drive dicabut. Hubungkan ulang di menu Integrasi.',
  drive_quota: 'Penyimpanan Google Drive penuh. Kosongkan ruang Drive.',
  drive_folder_missing: 'Folder di Google Drive tidak ditemukan. Pilih folder di menu Integrasi.',
  storage_missing: 'File sesi hilang dari penyimpanan server.',
  config_missing: 'Config sesi tidak ditemukan.',
  asset_rejected:
    'Aset desain (gambar/font/musik) bukan dari penyimpanan platform atau isinya berubah. Unggah ulang aset di editor lalu publikasikan.',
};

export function uploadState(s: SessionUploadInput, jobs: JobView[]): UploadState {
  const storage = jobs.find((j) => j.target === 'storage');
  const drive = jobs.find((j) => j.target === 'drive');
  const failed = [storage, drive].find((j) => j?.status === 'failed');
  const driveUrl = s.driveFolderUrl;

  if (driveUrl && drive?.status === 'done') {
    return { kind: 'done', label: 'Terkirim ke Drive', detail: null, canRetry: false, driveUrl };
  }
  if (failed) {
    const detail =
      (failed.errorCode && JOB_ERROR_TEXT[failed.errorCode]) || failed.lastError || 'Gagal.';
    return { kind: 'failed', label: 'Gagal', detail, canRetry: true, driveUrl: null };
  }
  const retrying = [storage, drive].find((j) => j && j.status === 'pending' && j.attempts > 0);
  if (retrying) {
    return {
      kind: 'retrying',
      label: `Mencoba ulang (${retrying.attempts}×)`,
      detail: retrying.lastError,
      canRetry: false,
      driveUrl: null,
    };
  }
  if (storage || drive) {
    return {
      kind: 'processing',
      label: drive ? 'Mengunggah ke Drive' : 'Memproses file',
      detail: null,
      canRetry: false,
      driveUrl: null,
    };
  }
  if (s.status === 'completed' || s.status === 'capturing') {
    return {
      kind: 'waiting',
      label: s.filesCompleteAt ? 'Menunggu pemrosesan' : 'Menunggu booth mengunggah',
      detail: 'File ada di booth dan diunggah otomatis saat booth online.',
      canRetry: false,
      driveUrl: null,
    };
  }
  return { kind: 'none', label: '—', detail: null, canRetry: false, driveUrl: null };
}
