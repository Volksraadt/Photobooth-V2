import { z } from 'zod';
import { IdSchema } from './common';

export const FilterParamsSchema = z.object({
  /** 1 = normal */
  brightness: z.number().min(0).max(2),
  /** 1 = normal */
  contrast: z.number().min(0).max(2),
  /** 1 = normal, 0 = grayscale */
  saturation: z.number().min(0).max(2),
  /** degrees */
  hueRotate: z.number().min(-180).max(180),
  /** -1..1 (blue..orange tint) */
  warmth: z.number().min(-1).max(1),
  sepia: z.number().min(0).max(1),
  grain: z.number().min(0).max(1),
  vignette: z.number().min(0).max(1),
});
export type FilterParams = z.infer<typeof FilterParamsSchema>;

export const NEUTRAL_FILTER_PARAMS: FilterParams = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  hueRotate: 0,
  warmth: 0,
  sepia: 0,
  grain: 0,
  vignette: 0,
};

export const FilterSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(60),
  thumbnailAssetId: IdSchema.optional(),
  params: FilterParamsSchema,
  enabled: z.boolean(),
  isDefault: z.boolean(),
});
export type Filter = z.infer<typeof FilterSchema>;
