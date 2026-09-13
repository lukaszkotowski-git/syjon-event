import { z } from 'zod';
import { MIN_PAID_AMOUNT_CENTS } from './constants.js';

export const DISCOUNT_TYPES = ['PERCENT', 'AMOUNT'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

const discountCodeText = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, 'Kod: litery, cyfry, myślnik i podkreślenie')
  .transform((value) => value.toUpperCase());

export const discountCodeInput = z
  .object({
    code: discountCodeText,
    type: z.enum(DISCOUNT_TYPES),
    value: z.number().int().positive(),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'PERCENT' && (value.value < 1 || value.value > 100)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Rabat procentowy musi być liczbą od 1 do 100',
      });
    }
    if (value.type === 'AMOUNT' && value.value > 100_000_00) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Zbyt duża kwota rabatu' });
    }
  });
export type DiscountCodeInput = z.infer<typeof discountCodeInput>;

export const updateDiscountCodeRequest = z
  .object({
    code: discountCodeText.optional(),
    type: z.enum(DISCOUNT_TYPES).optional(),
    value: z.number().int().positive().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'PERCENT' && value.value !== undefined && (value.value < 1 || value.value > 100)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Rabat procentowy musi być liczbą od 1 do 100',
      });
    }
    if (value.type === 'AMOUNT' && value.value !== undefined && value.value > 100_000_00) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Zbyt duża kwota rabatu' });
    }
  });
export type UpdateDiscountCodeRequest = z.infer<typeof updateDiscountCodeRequest>;

export const checkDiscountCodeRequest = z.object({
  code: z.string().trim().min(1).max(40),
  ticketTypeId: z.string().uuid(),
});
export type CheckDiscountCodeRequest = z.infer<typeof checkDiscountCodeRequest>;

/**
 * Cena biletu po rabacie. Wynik poniżej minimum płatności Paynow, ale wciąż dodatni,
 * schodzi do zera — inaczej kasa nigdy nie przyjęłaby takiej wpłaty (ten sam próg, którym
 * odrzucamy zbyt tanie płatne bilety przy tworzeniu typu biletu).
 */
export function applyDiscount(basePriceCents: number, type: DiscountType, value: number): number {
  const raw = type === 'PERCENT' ? Math.round((basePriceCents * (100 - value)) / 100) : basePriceCents - value;
  const clamped = Math.max(0, raw);
  return clamped > 0 && clamped < MIN_PAID_AMOUNT_CENTS ? 0 : clamped;
}

export function normalizeDiscountCode(code: string): string {
  return code.trim().toUpperCase();
}
