import { z } from 'zod';

export const IdSchema = z.string().min(1).max(64);

/** Any CSS color string (hex, rgb(a), hsl(a), named). Kept loose; renderer passes it to CSS. */
export const ColorSchema = z.string().min(1).max(64);

export const NonNegative = z.number().finite().nonnegative();

export const TextStyleSchema = z.object({
  fontFamily: z.string().min(1),
  fontSize: z.number().positive(),
  fontWeight: z.number().int().min(100).max(900),
  color: ColorSchema,
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number().positive(),
  letterSpacing: z.number().finite(),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const ShadowSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  blur: NonNegative,
  color: ColorSchema,
});

export const BoxStyleSchema = z.object({
  fill: ColorSchema.optional(),
  borderColor: ColorSchema.optional(),
  borderWidth: NonNegative.optional(),
  borderRadius: NonNegative.optional(),
  shadow: ShadowSchema.optional(),
});
export type BoxStyle = z.infer<typeof BoxStyleSchema>;

export const TransitionSchema = z.object({
  kind: z.enum(['none', 'fade', 'slide-left', 'slide-up', 'zoom']),
  durationMs: z.number().int().min(0).max(2000),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const ElementAnimationSchema = z.object({
  entrance: z
    .object({
      kind: z.enum(['none', 'fade', 'slide-up', 'slide-left', 'zoom']),
      delayMs: z.number().int().min(0),
      durationMs: z.number().int().min(0).max(5000),
    })
    .optional(),
  loop: z.enum(['none', 'pulse', 'bounce', 'float']).optional(),
});
export type ElementAnimation = z.infer<typeof ElementAnimationSchema>;

export const TimezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Zona waktu tidak dikenal' },
);
