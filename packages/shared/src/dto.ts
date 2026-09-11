import { z } from 'zod';
import { CURRENCY, MAX_TICKET_TYPES_PER_FORM, MIN_PAID_AMOUNT_CENTS } from './constants.js';
import { formSchemaJson } from './fields.js';
import { normalizePlPhone } from './phone.js';

/* ---------------------------------- auth ---------------------------------- */

export const loginRequest = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequest>;

/* --------------------------------- admin ---------------------------------- */

const slug = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug: małe litery, cyfry i myślniki');

export const createFormRequest = z.object({
  slug,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullish(),
  closesAt: z.string().datetime({ offset: true }),
  capacityTotal: z.number().int().positive().nullish(),
  requirePhone: z.boolean().default(false),
  termsVersion: z.string().trim().min(1).max(50).default('1.0'),
  privacyPolicyVersion: z.string().trim().min(1).max(50).default('1.0'),
  paymentSuccessTitle: z.string().trim().max(200).nullish(),
  paymentSuccessBody: z.string().trim().max(2000).nullish(),
  paymentErrorTitle: z.string().trim().max(200).nullish(),
  paymentErrorBody: z.string().trim().max(2000).nullish(),
  schemaJson: formSchemaJson.optional(),
});
export type CreateFormRequest = z.infer<typeof createFormRequest>;

export const updateFormRequest = createFormRequest.partial();
export type UpdateFormRequest = z.infer<typeof updateFormRequest>;

export const ticketTypeInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    priceCents: z.number().int().min(0).max(100_000_00),
    capacity: z.number().int().positive().nullish(),
    sortOrder: z.number().int().min(0).max(MAX_TICKET_TYPES_PER_FORM).default(0),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.priceCents > 0 && value.priceCents < MIN_PAID_AMOUNT_CENTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceCents'],
        message: `Bilet płatny musi kosztować minimum ${MIN_PAID_AMOUNT_CENTS} groszy (Paynow) albo być darmowy (0).`,
      });
    }
  });
export type TicketTypeInput = z.infer<typeof ticketTypeInput>;

export const updateTicketTypeRequest = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    priceCents: z.number().int().min(0).max(100_000_00).optional(),
    capacity: z.number().int().positive().nullish(),
    sortOrder: z.number().int().min(0).max(MAX_TICKET_TYPES_PER_FORM).optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.priceCents !== undefined && value.priceCents > 0 && value.priceCents < MIN_PAID_AMOUNT_CENTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceCents'],
        message: `Bilet płatny musi kosztować minimum ${MIN_PAID_AMOUNT_CENTS} groszy (Paynow) albo być darmowy (0).`,
      });
    }
  });
export type UpdateTicketTypeRequest = z.infer<typeof updateTicketTypeRequest>;

/* --------------------------------- public --------------------------------- */

export const buyerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Niepoprawny adres e-mail').max(320),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === '') return null;
      const normalized = normalizePlPhone(v);
      if (!normalized) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Niepoprawny numer telefonu (+48)' });
        return z.NEVER;
      }
      return normalized;
    })
    .nullish(),
});

export const createSubmissionRequest = z.object({
  ticketTypeId: z.string().uuid(),
  buyer: buyerSchema,
  answers: z.record(z.unknown()).default({}),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Akceptacja regulaminu jest wymagana' }) }),
  acceptPrivacy: z.literal(true, {
    errorMap: () => ({ message: 'Akceptacja polityki prywatności jest wymagana' }),
  }),
});
export type CreateSubmissionRequest = z.infer<typeof createSubmissionRequest>;

/* ------------------------------- odpowiedzi -------------------------------- */

export interface PublicTicketTypeDto {
  id: string;
  name: string;
  priceCents: number;
  currency: typeof CURRENCY;
  soldOut: boolean;
}

export interface PublicFormDto {
  slug: string;
  title: string;
  description: string | null;
  closesAt: string;
  requirePhone: boolean;
  termsVersion: string;
  privacyPolicyVersion: string;
  schemaJson: z.infer<typeof formSchemaJson>;
  ticketTypes: PublicTicketTypeDto[];
  soldOut: boolean;
}

export interface CreateSubmissionResponse {
  submissionId: string;
  publicToken: string;
  confirmationUrl: string;
  /** null dla biletu darmowego — nie ma przekierowania do bramki. */
  redirectUrl: string | null;
  status: 'RESERVED' | 'PAID';
}

/** Treści strony powrotu z płatności ustawione w formularzu; null = tekst domyślny. */
export interface PaymentResultContentDto {
  successTitle: string | null;
  successBody: string | null;
  errorTitle: string | null;
  errorBody: string | null;
}

export interface SubmissionStatusDto {
  submissionId: string;
  status: 'RESERVED' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  ticketName: string;
  amountCents: number;
  currency: string;
  reservationExpiresAt: string | null;
  lastPayment: {
    status: string;
    redirectUrl: string | null;
    updatedAt: string;
  } | null;
  canRetry: boolean;
  paymentResultContent: PaymentResultContentDto;
}
