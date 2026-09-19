import { z } from 'zod';
import {
  CURRENCY,
  type SubmissionStatus,
  MAX_DESCRIPTION_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_TICKET_TYPES_PER_FORM,
  MIN_PAID_AMOUNT_CENTS,
} from './constants.js';
import { depositError, PAYMENT_OPTIONS } from './deposits.js';
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
  location: z.string().trim().max(MAX_LOCATION_LENGTH).nullish(),
  capacityTotal: z.number().int().positive().nullish(),
  termsVersion: z.string().trim().min(1).max(50).default('1.0'),
  privacyPolicyVersion: z.string().trim().min(1).max(50).default('1.0'),
  paymentSuccessTitle: z.string().trim().max(200).nullish(),
  paymentSuccessBody: z.string().trim().max(2000).nullish(),
  paymentErrorTitle: z.string().trim().max(200).nullish(),
  paymentErrorBody: z.string().trim().max(2000).nullish(),
  confirmationEmailTitle: z.string().trim().max(200).nullish(),
  confirmationEmailBody: z.string().trim().max(2000).nullish(),
  balanceDueAt: z.string().datetime({ offset: true }).nullish(),
  depositEmailTitle: z.string().trim().max(200).nullish(),
  depositEmailBody: z.string().trim().max(2000).nullish(),
  schemaJson: formSchemaJson.optional(),
});
export type CreateFormRequest = z.infer<typeof createFormRequest>;

export const updateFormRequest = createFormRequest.partial();
export type UpdateFormRequest = z.infer<typeof updateFormRequest>;

export const ticketTypeInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    priceCents: z.number().int().min(0).max(100_000_00),
    depositCents: z.number().int().positive().nullish(),
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
    const deposit = depositError(value.priceCents, value.depositCents);
    if (deposit) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['depositCents'], message: deposit });
  });
export type TicketTypeInput = z.infer<typeof ticketTypeInput>;

export const updateTicketTypeRequest = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    priceCents: z.number().int().min(0).max(100_000_00).optional(),
    // Poprawność względem ceny sprawdza API — tu cena może nie przyjść w tym samym żądaniu.
    depositCents: z.number().int().positive().nullish(),
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
  consents: z.record(z.boolean()).default({}),
  discountCode: z.string().trim().min(1).max(40).optional(),
  /** DEPOSIT = najpierw zaliczka; ignorowane, gdy bilet nie ma zaliczki. */
  paymentOption: z.enum(PAYMENT_OPTIONS).default('FULL'),
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
  /** Zaliczka dostępna przy rejestracji; null = tylko płatność w całości. */
  depositCents: number | null;
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
  location: string | null;
  imageUrl: string | null;
  soldOut: boolean;
}

export interface PublicFormDto {
  slug: string;
  title: string;
  description: string | null;
  eventDate: string;
  closesAt: string;
  location: string | null;
  termsVersion: string;
  privacyPolicyVersion: string;
  schemaJson: z.infer<typeof formSchemaJson>;
  ticketTypes: PublicTicketTypeDto[];
  hasDiscountCodes: boolean;
  /** Termin dopłaty reszty po zaliczce. */
  balanceDueAt: string | null;
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

/** Dopłata po zaliczce — widoczna na stronie zgłoszenia. */
export interface BalanceInfoDto {
  depositCents: number;
  paidCents: number;
  balanceCents: number;
  dueAt: string | null;
  /** false po terminie — wtedy dopłatę przyjmuje już tylko organizator. */
  canPayOnline: boolean;
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
  status: SubmissionStatus;
  count: number;
}

export interface DashboardEventStat {
  formId: string;
  title: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  submissionCount: number;
  paidCount: number;
  depositPaidCount: number;
  revenueCents: number;
}

export interface DashboardRecentRegistration {
  id: string;
  displayName: string | null;
  buyerEmail: string;
  formTitle: string;
  status: SubmissionStatus;
  createdAt: string;
}

export interface DashboardDto {
  totals: {
    submissions: number;
    paid: number;
    depositPaid: number;
    outstandingCents: number;
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
  status: SubmissionStatus;
  ticketName: string;
  amountCents: number;
  currency: string;
  discountCodeSnapshot: string | null;
  discountAmountCents: number;
  reservationExpiresAt: string | null;
  /** Kwota bieżącej płatności: zaliczka przy rezerwacji z zaliczką, pozostała reszta po niej. */
  amountDueCents: number;
  /** Obecne, gdy zgłoszenie jest (lub było) opłacane zaliczką. */
  balance: BalanceInfoDto | null;
  lastPayment: {
    status: string;
    redirectUrl: string | null;
    updatedAt: string;
  } | null;
  canRetry: boolean;
  paymentResultContent: PaymentResultContentDto;
  formTitle: string;
  formSlug: string;
  eventDate: string;
  location: string | null;
  confirmationEmailSent: boolean;
  /** Numer biletu — obecny tylko dla opłaconego zgłoszenia, wtedy dostępny jest też obraz QR. */
  ticketReference: string | null;
  checkedInAt: string | null;
  /** Zgadywane z pól formularza po etykiecie ("Imię"/"Nazwisko") — może nie być dopasowania. */
  buyerName: string | null;
  buyerEmail: string;
}

/* ------------------------------ zespół i role ------------------------------ */

export const ADMIN_ROLES = ['ADMIN', 'VIEWER'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface AdminMeDto {
  id: string;
  email: string;
  role: AdminRole;
}

export interface AdminUserDto {
  id: string;
  email: string;
  role: AdminRole;
  disabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export const createAdminUserRequest = z.object({
  email: z.string().trim().toLowerCase().email('Niepoprawny adres e-mail').max(320),
  password: z.string().min(12, 'Hasło musi mieć minimum 12 znaków').max(200),
  role: z.enum(ADMIN_ROLES),
});
export type CreateAdminUserRequest = z.infer<typeof createAdminUserRequest>;

export const updateAdminUserRequest = z.object({
  role: z.enum(ADMIN_ROLES).optional(),
  disabled: z.boolean().optional(),
  password: z.string().min(12, 'Hasło musi mieć minimum 12 znaków').max(200).optional(),
});
export type UpdateAdminUserRequest = z.infer<typeof updateAdminUserRequest>;

/* ------------------------------- dziennik zmian ------------------------------ */

export interface AuditLogEntryDto {
  id: string;
  adminEmail: string;
  action: string;
  formId: string | null;
  formTitle: string | null;
  entityId: string | null;
  summary: string;
  createdAt: string;
}

/* --------------------------- wiadomości do uczestników -------------------------- */

export const MESSAGE_AUDIENCE_STATUSES = ['PAID', 'DEPOSIT_PAID', 'RESERVED'] as const;

export const messageAudience = z.object({
  statuses: z.array(z.enum(MESSAGE_AUDIENCE_STATUSES)).min(1, 'Wybierz, do kogo wysłać wiadomość'),
  /** Pusta lista = wszystkie rodzaje biletów. */
  ticketTypeIds: z.array(z.string().uuid()).default([]),
});
export type MessageAudience = z.infer<typeof messageAudience>;

export const sendMessageRequest = z.object({
  subject: z.string().trim().min(1, 'Podaj temat').max(200),
  body: z.string().trim().min(1, 'Wpisz treść').max(10000),
  audience: messageAudience,
});
export type SendMessageRequest = z.infer<typeof sendMessageRequest>;

export interface FormMessageDto {
  id: string;
  subject: string;
  body: string;
  adminEmail: string | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  finished: boolean;
  createdAt: string;
}

/* ---------------------------------- raporty --------------------------------- */

export interface ReportParticipantDto {
  submissionId: string;
  displayName: string | null;
  email: string;
  phone: string | null;
  ticketName: string;
  ticketReference: string;
  checkedInAt: string | null;
}

export interface ReportAnswerSummaryDto {
  key: string;
  label: string;
  type: 'select' | 'checkbox';
  /** Liczba odpowiedzi na każdą opcję (checkbox: "Tak"/"Nie"). */
  counts: { option: string; count: number }[];
  /** Ile osób w ogóle widziało to pole (pole warunkowe mogło być ukryte). */
  answered: number;
}

export interface EventReportDto {
  form: { id: string; title: string; eventDate: string; location: string | null };
  generatedAt: string;
  finance: {
    /** Suma faktycznych wpłat (Paynow i wpłaty odnotowane ręcznie). */
    receivedCents: number;
    /** Reszta do dopłaty po zaliczkach. */
    outstandingCents: number;
    depositPaidCount: number;
  };
  participants: ReportParticipantDto[];
  answerSummaries: ReportAnswerSummaryDto[];
  consentSummaries: { key: string; label: string; accepted: number; total: number }[];
}
