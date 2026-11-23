import { z } from 'zod';
import { IdSchema, NonNegative } from './common';
import { ElementSchema } from './elements';

export const PhotoSlotSchema = z.object({
  /** 1..n, capture order. */
  index: z.number().int().min(1),
  /** Strip px. */
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  rotation: z.number().finite(),
  borderRadius: NonNegative,
});
export type PhotoSlot = z.infer<typeof PhotoSlotSchema>;

export const FrameSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  thumbnailAssetId: IdSchema,
  /** Transparent PNG/SVG sized to printProfile.stripPx. */
  overlayAssetId: IdSchema,
  underlayAssetId: IdSchema.optional(),
  /** Overrides pricing.basePrice. */
  price: z.number().int().nonnegative().optional(),
  slots: z.array(PhotoSlotSchema).min(1),
  /** text {{date}}, image logo, download-qr. Coordinates in strip px. */
  dynamicElements: z.array(ElementSchema),
  enabled: z.boolean(),
  sortOrder: z.number().int(),
});
export type Frame = z.infer<typeof FrameSchema>;

export const PrintProfileSchema = z.object({
  id: z.literal('strip-2x6'),
  paper: z.object({ widthIn: z.literal(4), heightIn: z.literal(6) }),
  dpi: z.literal(300),
  stripPx: z.object({ width: z.literal(600), height: z.literal(1800) }),
  layout: z.literal('two-strips-side-by-side'),
  cutMarks: z.boolean(),
  bleedPx: z.number().int().nonnegative(),
});
export type PrintProfile = z.infer<typeof PrintProfileSchema>;

export const STRIP_2X6_PROFILE: PrintProfile = {
  id: 'strip-2x6',
  paper: { widthIn: 4, heightIn: 6 },
  dpi: 300,
  stripPx: { width: 600, height: 1800 },
  layout: 'two-strips-side-by-side',
  cutMarks: true,
  bleedPx: 0,
};
