import { Prisma } from '@prisma/client';
import type { Tx } from '../prisma.js';

/**
 * Miejsce jest zajęte przez zgłoszenie PAID, DEPOSIT_PAID albo RESERVED z aktywną rezerwacją.
 * Zaliczka trzyma miejsce na stałe — także po terminie dopłaty (decyzja należy do organizatora).
 * Wygasła rezerwacja nie blokuje miejsca — nie potrzebujemy do tego crona.
 */
export function occupiedWhere(now: Date) {
  return {
    OR: [
      { status: 'PAID' as const },
      { status: 'DEPOSIT_PAID' as const },
      { status: 'RESERVED' as const, reservationExpiresAt: { gt: now } },
    ],
  };
}

/**
 * Blokada per formularz na czas transakcji. Dwa równoległe zgłoszenia na ostatnie
 * miejsce serializują się tutaj, więc nie mogą obie utworzyć aktywnej rezerwacji.
 */
export async function lockForm(tx: Tx, formId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${formId}))`;
}

export interface AvailabilityInput {
  formId: string;
  ticketTypeId: string;
  capacityTotal: number | null;
  ticketCapacity: number | null;
  now: Date;
}

export type AvailabilityResult =
  | { available: true }
  | { available: false; reason: 'FORM_SOLD_OUT' | 'TICKET_SOLD_OUT' };

export async function checkAvailability(
  tx: Tx,
  input: AvailabilityInput,
): Promise<AvailabilityResult> {
  const { formId, ticketTypeId, capacityTotal, ticketCapacity, now } = input;

  if (capacityTotal !== null) {
    const taken = await tx.submission.count({ where: { formId, ...occupiedWhere(now) } });
    if (taken >= capacityTotal) return { available: false, reason: 'FORM_SOLD_OUT' };
  }

  if (ticketCapacity !== null) {
    const taken = await tx.submission.count({ where: { ticketTypeId, ...occupiedWhere(now) } });
    if (taken >= ticketCapacity) return { available: false, reason: 'TICKET_SOLD_OUT' };
  }

  return { available: true };
}

/** Liczniki do panelu admina i publicznej informacji o wyprzedaniu. */
export async function countOccupancy(
  tx: Tx,
  formId: string,
  now: Date,
): Promise<{ total: number; perTicketType: Map<string, number> }> {
  const grouped = await tx.submission.groupBy({
    by: ['ticketTypeId'],
    where: { formId, ...occupiedWhere(now) },
    _count: { _all: true },
  });

  const perTicketType = new Map<string, number>();
  let total = 0;
  for (const row of grouped) {
    perTicketType.set(row.ticketTypeId, row._count._all);
    total += row._count._all;
  }
  return { total, perTicketType };
}

export const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
