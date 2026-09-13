/** Wspólne stałe domenowe — używane przez API i frontend. */

/** Minimalna kwota płatności akceptowana przez Paynow (grosze). */
export const MIN_PAID_AMOUNT_CENTS = 100;

/** Domyślny czas rezerwacji miejsca w sekundach (identyczny z validityTime Paynow). */
export const DEFAULT_RESERVATION_SECONDS = 900;

/** Twarde limity payloadu publicznego formularza. */
export const MAX_FIELDS_PER_FORM = 50;
export const MAX_SECTIONS_PER_FORM = 20;
export const MAX_TEXT_LENGTH = 2000;
export const MAX_DESCRIPTION_LENGTH = 20000;
export const MAX_OPTIONS_PER_SELECT = 100;
export const MAX_TICKET_TYPES_PER_FORM = 20;
export const MAX_CUSTOM_SCRIPT_LENGTH = 20000;
export const MAX_DISCOUNT_CODES_PER_FORM = 50;

export const CURRENCY = 'PLN' as const;

export const FORM_STATUS = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export const SUBMISSION_STATUS = ['RESERVED', 'PAID', 'EXPIRED', 'CANCELLED'] as const;
export const PAYMENT_STATUS = [
  'NEW',
  'PENDING',
  'CONFIRMED',
  'REJECTED',
  'ERROR',
  'ABANDONED',
  'EXPIRED',
] as const;

export type FormStatus = (typeof FORM_STATUS)[number];
export type SubmissionStatus = (typeof SUBMISSION_STATUS)[number];
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];
