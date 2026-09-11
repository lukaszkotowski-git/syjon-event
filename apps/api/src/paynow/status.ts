import type { PaymentStatus } from '@prisma/client';

export const PAYNOW_STATUSES = [
  'NEW',
  'PENDING',
  'CONFIRMED',
  'REJECTED',
  'ERROR',
  'ABANDONED',
  'EXPIRED',
] as const;

export type PaynowStatus = (typeof PAYNOW_STATUSES)[number];

export function isPaynowStatus(value: unknown): value is PaynowStatus {
  return typeof value === 'string' && (PAYNOW_STATUSES as readonly string[]).includes(value);
}

/** CONFIRMED jest terminalny — spóźniona notyfikacja nie może go cofnąć. */
export function isTerminal(status: PaymentStatus): boolean {
  return status === 'CONFIRMED';
}

export interface StatusUpdateDecision {
  apply: boolean;
  reason: 'ok' | 'terminal' | 'out-of-order' | 'duplicate';
}

/**
 * Decyduje, czy notyfikacja Paynow może zmienić lokalny stan płatności.
 * Notyfikacje bywają duplikowane i przychodzą poza kolejnością.
 */
export function decideStatusUpdate(params: {
  currentStatus: PaymentStatus;
  currentModifiedAt: Date | null;
  incomingStatus: PaymentStatus;
  incomingModifiedAt: Date | null;
}): StatusUpdateDecision {
  const { currentStatus, currentModifiedAt, incomingStatus, incomingModifiedAt } = params;

  if (isTerminal(currentStatus)) {
    return { apply: false, reason: incomingStatus === currentStatus ? 'duplicate' : 'terminal' };
  }

  if (currentModifiedAt && incomingModifiedAt) {
    if (incomingModifiedAt.getTime() < currentModifiedAt.getTime()) {
      return { apply: false, reason: 'out-of-order' };
    }
    if (incomingModifiedAt.getTime() === currentModifiedAt.getTime() && incomingStatus === currentStatus) {
      return { apply: false, reason: 'duplicate' };
    }
  }

  if (incomingStatus === currentStatus) {
    return { apply: false, reason: 'duplicate' };
  }

  return { apply: true, reason: 'ok' };
}
