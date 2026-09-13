import type { Payment, PaymentStatus, Submission } from '@prisma/client';
import { env } from '../env.js';
import { buildPaidConfirmationEmail, sendMail } from './mailer.js';
import { createPayment, PaynowTransientError } from '../paynow/client.js';
import { decideStatusUpdate } from '../paynow/status.js';
import { prisma } from '../prisma.js';
import { generateIdempotencyKey } from '../utils/tokens.js';

export function confirmationUrl(submissionId: string, publicToken: string): string {
  const base = env().APP_BASE_URL.replace(/\/+$/, '');
  return `${base}/potwierdzenie/${submissionId}?token=${encodeURIComponent(publicToken)}`;
}

/**
 * Tworzy (lub odtwarza) próbę płatności i pobiera z Paynow redirectUrl.
 *
 * Kolejność jest ważna: najpierw lokalny rekord z Idempotency-Key, potem wywołanie
 * Paynow. Jeśli Paynow nie odpowie (timeout/5xx), rekord zostaje i ponowienie
 * używa DOKŁADNIE tego samego klucza — Paynow utworzy wtedy jeden obiekt biznesowy.
 */
export async function startPaymentAttempt(
  submission: Submission,
  publicToken: string,
  formTitle: string,
): Promise<Payment> {
  const reusable = await prisma.payment.findFirst({
    where: { submissionId: submission.id, status: 'NEW', providerPaymentId: null },
    orderBy: { createdAt: 'desc' },
  });

  const payment =
    reusable ??
    (await prisma.payment.create({
      data: {
        submissionId: submission.id,
        idempotencyKey: generateIdempotencyKey(),
        amountCents: submission.ticketPriceCents,
        currency: submission.currency,
        status: 'NEW',
      },
    }));

  const validitySeconds = remainingReservationSeconds(submission);

  const result = await createPayment({
    amountCents: payment.amountCents,
    currency: payment.currency,
    externalId: submission.id,
    description: `${formTitle} — ${submission.ticketNameSnapshot}`,
    buyerEmail: submission.buyerEmail,
    buyerPhone: submission.buyerPhone,
    continueUrl: confirmationUrl(submission.id, publicToken),
    validitySeconds,
    idempotencyKey: payment.idempotencyKey,
  });

  return prisma.payment.update({
    where: { id: payment.id },
    data: {
      providerPaymentId: result.paymentId,
      redirectUrl: result.redirectUrl,
      status: result.status as PaymentStatus,
    },
  });
}

/** validityTime w Paynow = dokładnie tyle, ile zostało lokalnej rezerwacji (min. 60 s wg API). */
export function remainingReservationSeconds(submission: Submission, now = new Date()): number {
  const configured = env().PAYNOW_VALIDITY_SECONDS;
  if (!submission.reservationExpiresAt) return configured;
  const remaining = Math.floor((submission.reservationExpiresAt.getTime() - now.getTime()) / 1000);
  return Math.max(60, Math.min(configured, remaining));
}

export interface ApplyStatusInput {
  providerPaymentId: string;
  incomingStatus: PaymentStatus;
  incomingModifiedAt: Date | null;
  rawPayload: unknown;
}

export type ApplyStatusResult =
  | { outcome: 'unknown-payment' }
  | { outcome: 'ignored'; reason: string }
  | { outcome: 'applied'; paymentStatus: PaymentStatus; submissionPaid: boolean; submissionId: string };

/** Wysyła e-mail z potwierdzeniem zakupu — z idempotencją po `confirmationEmailSentAt`. */
async function sendPaidConfirmationEmailIfNeeded(submissionId: string): Promise<void> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { form: true },
  });
  if (!submission || submission.confirmationEmailSentAt) return;

  const { subject, html, text } = buildPaidConfirmationEmail({
    formTitle: submission.form.title,
    formSlug: submission.form.slug,
    ticketName: submission.ticketNameSnapshot,
    amountCents: submission.ticketPriceCents,
    currency: submission.currency,
    customTitle: submission.form.confirmationEmailTitle,
    customBody: submission.form.confirmationEmailBody,
  });

  const sent = await sendMail(submission.buyerEmail, subject, html, text);
  if (sent) {
    await prisma.submission.update({
      where: { id: submissionId },
      data: { confirmationEmailSentAt: new Date() },
    });
  }
}

/**
 * Jedyne miejsce zmieniające status płatności — używane i przez webhook,
 * i przez fallbackowy status-check. Idempotentne i odporne na złą kolejność.
 */
export async function applyProviderStatus(input: ApplyStatusInput): Promise<ApplyStatusResult> {
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { providerPaymentId: input.providerPaymentId },
      include: { submission: true },
    });
    if (!payment) return { outcome: 'unknown-payment' } as const;

    const decision = decideStatusUpdate({
      currentStatus: payment.status,
      currentModifiedAt: payment.providerModifiedAt,
      incomingStatus: input.incomingStatus,
      incomingModifiedAt: input.incomingModifiedAt,
    });

    if (!decision.apply) {
      // Duplikat lub spóźniona notyfikacja: zapisujemy tylko ślad audytowy.
      await tx.payment.update({
        where: { id: payment.id },
        data: { providerPayloadJson: input.rawPayload as object },
      });
      return { outcome: 'ignored', reason: decision.reason } as const;
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: input.incomingStatus,
        providerModifiedAt: input.incomingModifiedAt ?? new Date(),
        providerPayloadJson: input.rawPayload as object,
      },
    });

    let submissionPaid = false;
    if (input.incomingStatus === 'CONFIRMED' && payment.submission.status !== 'PAID') {
      await tx.submission.update({
        where: { id: payment.submissionId },
        data: { status: 'PAID', reservationExpiresAt: null },
      });
      submissionPaid = true;

      // Pozostałe otwarte próby tej samej rejestracji są już nieaktualne.
      await tx.payment.updateMany({
        where: {
          submissionId: payment.submissionId,
          id: { not: payment.id },
          status: { in: ['NEW', 'PENDING'] },
        },
        data: { status: 'ABANDONED' },
      });
    }

    // REJECTED/ERROR/ABANDONED/EXPIRED nie kasują rezerwacji — retry jest możliwe
    // do końca reservation_expires_at.
    return {
      outcome: 'applied',
      paymentStatus: input.incomingStatus,
      submissionPaid,
      submissionId: payment.submissionId,
    } as const;
  });

  if (result.outcome === 'applied' && result.submissionPaid) {
    await sendPaidConfirmationEmailIfNeeded(result.submissionId);
  }

  return result;
}

export { PaynowTransientError };
