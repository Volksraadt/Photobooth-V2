export type FitResult = {
  scale: number;
  /** Letterbox offsets in container px. */
  offsetX: number;
  offsetY: number;
};

/** Scale an artboard into a container keeping its aspect ratio (letterbox). */
export function computeFit(
  container: { width: number; height: number },
  artboard: { width: number; height: number },
): FitResult {
  if (container.width <= 0 || container.height <= 0) return { scale: 0, offsetX: 0, offsetY: 0 };
  const scale = Math.min(container.width / artboard.width, container.height / artboard.height);
  return {
    scale,
    offsetX: (container.width - artboard.width * scale) / 2,
    offsetY: (container.height - artboard.height * scale) / 2,
  };
}

/** Rect of `aspect` (w/h) inside a box, scaled like object-fit. */
export function fitRect(
  box: { width: number; height: number },
  content: { width: number; height: number },
  fit: 'cover' | 'contain',
): { x: number; y: number; width: number; height: number } {
  const s =
    fit === 'cover'
      ? Math.max(box.width / content.width, box.height / content.height)
      : Math.min(box.width / content.width, box.height / content.height);
  const width = content.width * s;
  const height = content.height * s;
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}

/**
 * Crop guide for the camera view: the part of the camera image the compositor keeps for a slot
 * (center crop to the slot aspect), mapped into the element box. Matches compositor behavior.
 */
export function cropGuideRect(
  box: { width: number; height: number },
  video: { width: number; height: number },
  slotAspect: number,
  fit: 'cover' | 'contain',
): { x: number; y: number; width: number; height: number } {
  const shown = fitRect(box, video, fit);
  const scale = shown.width / video.width;
  const videoAspect = video.width / video.height;
  const cropW = videoAspect > slotAspect ? video.height * slotAspect : video.width;
  const cropH = videoAspect > slotAspect ? video.height : video.width / slotAspect;
  const width = cropW * scale;
  const height = cropH * scale;
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}
