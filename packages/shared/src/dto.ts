import { z } from 'zod';
import {
  CURRENCY,
  MAX_DESCRIPTION_LENGTH,
  MAX_TICKET_TYPES_PER_FORM,
  MIN_PAID_AMOUNT_CENTS,
} from './constants.js';
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
  // HTML wzbogaconego opisu z edytora (pogrubienie, kolor, wstawiony własny kod HTML).
  description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).nullish(),
  eventDate: z.string().datetime({ offset: true }),
  closesAt: z.string().datetime({ offset: true }),
  capacityTotal: z.number().int().positive().nullish(),
  termsVersion: z.string().trim().min(1).max(50).default('1.0'),
  privacyPolicyVersion: z.string().trim().min(1).max(50).default('1.0'),
  paymentSuccessTitle: z.string().trim().max(200).nullish(),
  paymentSuccessBody: z.string().trim().max(2000).nullish(),
  paymentErrorTitle: z.string().trim().max(200).nullish(),
  paymentErrorBody: z.string().trim().max(2000).nullish(),
  confirmationEmailTitle: z.string().trim().max(200).nullish(),
  confirmationEmailBody: z.string().trim().max(2000).nullish(),
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

/* ------------------------------ kody rabatowe ------------------------------ */

export interface DiscountCodeDto {
  id: string;
  code: string;
  type: 'PERCENT' | 'AMOUNT';
  value: number;
  isActive: boolean;
  usageCount: number;
  createdAt: string;
}

export interface DiscountCodeCheckResponse {
  code: string;
  type: 'PERCENT' | 'AMOUNT';
  value: number;
  originalPriceCents: number;
  discountedPriceCents: number;
  discountAmountCents: number;
}

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
  address: z
    .string()
    .trim()
    .max(200)
    .transform((v) => v || null)
    .nullish(),
});

export const createSubmissionRequest = z.object({
  ticketTypeId: z.string().uuid(),
  buyer: buyerSchema,
  answers: z.record(z.unknown()).default({}),
  discountCode: z.string().trim().min(1).max(40).optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Akceptacja regulaminu jest wymagana' }) }),
  acceptPrivacy: z.literal(true, {
    errorMap: () => ({ message: 'Akceptacja polityki prywatności jest wymagana' }),
  }),
});
export type CreateSubmissionRequest = z.infer<typeof createSubmissionRequest>;

/** Edycja zgłoszenia przez administratora: dane kupującego i odpowiedzi na pola formularza. */
export const updateSubmissionRequest = z.object({
  buyerEmail: buyerSchema.shape.email.optional(),
  buyerPhone: buyerSchema.shape.phone.optional(),
  buyerAddress: buyerSchema.shape.address.optional(),
  answers: z.record(z.unknown()).optional(),
});
export type UpdateSubmissionRequest = z.infer<typeof updateSubmissionRequest>;

/* ------------------------------- odpowiedzi -------------------------------- */

export interface PublicTicketTypeDto {
  id: string;
  name: string;
  priceCents: number;
  currency: typeof CURRENCY;
  soldOut: boolean;
}

/** Kafelek wydarzenia na stronie głównej — tylko dane potrzebne do zaproszenia na formularz. */
export interface PublicEventListItemDto {
  slug: string;
  title: string;
  /** Opis bez HTML, skrócony do długości kafelka. */
  summary: string;
  eventDate: string;
  closesAt: string;
  imageUrl: string | null;
  soldOut: boolean;
}

export interface PublicFormDto {
  slug: string;
  title: string;
  description: string | null;
  eventDate: string;
  closesAt: string;
  termsVersion: string;
  privacyPolicyVersion: string;
  schemaJson: z.infer<typeof formSchemaJson>;
  ticketTypes: PublicTicketTypeDto[];
  hasDiscountCodes: boolean;
  soldOut: boolean;
  backgroundImageDesktopUrl: string | null;
  backgroundImageMobileUrl: string | null;
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

/* -------------------------------- dashboard -------------------------------- */

export interface DashboardStatusCount {
  status: 'RESERVED' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  count: number;
}

export interface DashboardEventStat {
  formId: string;
  title: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  submissionCount: number;
  paidCount: number;
  revenueCents: number;
}

export interface DashboardRecentRegistration {
  id: string;
  displayName: string | null;
  buyerEmail: string;
  formTitle: string;
  status: 'RESERVED' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  createdAt: string;
}

export interface DashboardDto {
  totals: {
    submissions: number;
    paid: number;
    reserved: number;
    expired: number;
    cancelled: number;
    revenueCents: number;
    eventsPublished: number;
    eventsDraft: number;
    eventsArchived: number;
  };
  statusBreakdown: DashboardStatusCount[];
  events: DashboardEventStat[];
  recentRegistrations: DashboardRecentRegistration[];
}

export interface SubmissionStatusDto {
  submissionId: string;
  status: 'RESERVED' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  ticketName: string;
  amountCents: number;
  currency: string;
  discountCodeSnapshot: string | null;
  discountAmountCents: number;
  reservationExpiresAt: string | null;
  lastPayment: {
    status: string;
    redirectUrl: string | null;
    updatedAt: string;
  } | null;
  canRetry: boolean;
  paymentResultContent: PaymentResultContentDto;
  formTitle: string;
  formSlug: string;
  confirmationEmailSent: boolean;
  /** Numer biletu — obecny tylko dla opłaconego zgłoszenia, wtedy dostępny jest też obraz QR. */
  ticketReference: string | null;
  checkedInAt: string | null;
}
