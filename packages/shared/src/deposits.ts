import { MIN_PAID_AMOUNT_CENTS } from './constants.js';

export const PAYMENT_OPTIONS = ['FULL', 'DEPOSIT'] as const;
export type PaymentOption = (typeof PAYMENT_OPTIONS)[number];

/**
 * Podział ceny na zaliczkę i dopłatę. Zaliczka jest stała, a rabat zmniejsza dopłatę.
 * null = zaliczka nie ma sensu (brak zaliczki w bilecie albo dopłata wyszłaby poniżej
 * minimum Paynow) — płaci się wtedy całość od razu.
 */
export function depositSplit(
  priceCents: number,
  depositCents: number | null | undefined,
): { depositCents: number; balanceCents: number } | null {
  if (!depositCents || depositCents < MIN_PAID_AMOUNT_CENTS) return null;
  const balanceCents = priceCents - depositCents;
  if (balanceCents < MIN_PAID_AMOUNT_CENTS) return null;
  return { depositCents, balanceCents };
}

/** Komunikat błędu zaliczki w edytorze biletu; null = poprawna (albo brak zaliczki). */
export function depositError(priceCents: number, depositCents: number | null | undefined): string | null {
  if (depositCents === null || depositCents === undefined) return null;
  if (priceCents === 0) return 'Bilet bezpłatny nie może mieć zaliczki';
  if (depositCents < MIN_PAID_AMOUNT_CENTS) return 'Zaliczka musi wynosić min. 1,00 zł';
  if (priceCents - depositCents < MIN_PAID_AMOUNT_CENTS) return 'Zaliczka musi być co najmniej 1,00 zł niższa od ceny';
  return null;
}
