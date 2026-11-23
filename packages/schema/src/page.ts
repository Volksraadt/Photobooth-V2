import { z } from 'zod';
import { ColorSchema, IdSchema, TransitionSchema } from './common';
import { ElementSchema } from './elements';

export const PAGE_TYPES = [
  'cover',
  'tutorial',
  'framePick',
  'payment',
  'capture',
  'review',
  'processing',
  'result',
  'error',
] as const;
export const PageTypeSchema = z.enum(PAGE_TYPES);
export type PageType = z.infer<typeof PageTypeSchema>;

export const BackgroundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('color'), color: ColorSchema }),
  z.object({ kind: z.literal('gradient'), css: z.string().min(1).max(1000) }),
  z.object({ kind: z.literal('image'), assetId: IdSchema, fit: z.enum(['cover', 'contain']) }),
  z.object({
    kind: z.literal('video'),
    assetId: IdSchema,
    loop: z.literal(true),
    muted: z.literal(true),
  }),
]);
export type Background = z.infer<typeof BackgroundSchema>;

export const SlideSchema = z.object({
  id: IdSchema,
  elements: z.array(ElementSchema),
  background: BackgroundSchema.optional(),
  durationSec: z.number().positive().optional(),
});
export type Slide = z.infer<typeof SlideSchema>;

export const PageSchema = z.object({
  type: PageTypeSchema,
  background: BackgroundSchema,
  /** Array order = z-order (bottom → top). */
  elements: z.array(ElementSchema),
  slides: z.array(SlideSchema).optional(),
  transitionIn: TransitionSchema.optional(),
});
export type Page = z.infer<typeof PageSchema>;
