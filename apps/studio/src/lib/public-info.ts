/** Who runs this deployment and how to reach them (public pages). Set per deployment. */
export function operatorName(): string {
  return process.env.PB_OPERATOR_NAME?.trim() || 'Photobooth Studio';
}

/** Support / privacy contact e-mail, or null when not configured. */
export function supportEmail(): string | null {
  return process.env.PB_SUPPORT_EMAIL?.trim() || null;
}

/** Days session files stay on platform storage before cleanup (same variable as the worker). */
export function storageRetentionDays(): number {
  return Number(process.env.PB_STORAGE_RETENTION_DAYS ?? 30);
}
