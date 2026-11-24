/**
 * React-free part of the renderer, shared with the Node compositor so the printed strip uses the
 * exact same token formatting, QR modules and fitting math as the screen.
 */
export { computeFit, cropGuideRect, fitRect, type FitResult } from './fit';
export { qrPath, QR_QUIET_ZONE } from './qr-path';
export {
  formatBoothDate,
  formatIdr,
  formatMmSs,
  formatNumberId,
  formatPrice,
  resolveTextTokens,
  type TokenValues,
} from './tokens';
