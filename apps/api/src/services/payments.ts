import type { Form, Payment, PaymentKind, PaymentStatus, Submission, SubmissionStatus } from '@prisma/client';
import { env } from '../env.js';
import { conflict } from '../http/errors.js';
import { buildDepositConfirmationEmail, buildPaidConfirmationEmail, sendMail } from './mailer.js';
import { createPayment, getPaymentStatus, PaynowTransientError } from '../paynow/client.js';
import { decideStatusUpdate } from '../paynow/status.js';
import { prisma, type Tx } from '../prisma.js';
import { generateIdempotencyKey, generatePublicToken, hashPublicToken } from '../utils/tokens.js';
import { renderCustomEmailContent, renderDepositEmailContent } from './email-variables.js';
import { amountDueCents } from './registration.js';
import { ensureTicketNonce, newTicketFields, ticketEmailAttachment } from './tickets.js';

export function confirmationUrl(submissionId: string, publicToken: string): string {
  const base = env().APP_BASE_URL.replace(/\/+$/, '');
  return `${base}/potwierdzenie/${submissionId}?token=${encodeURIComponent(publicToken)}`;
}

/** Blokada per zgłoszenie — serializuje równoległe próby rozpoczęcia płatności. */
async function lockSubmission(tx: Tx, submissionId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:${submissionId}`}))`;
}

/** Czego dotyczy kolejna płatność zgłoszenia: zaliczki, dopłaty reszty czy całości. */
export function nextPaymentKind(submission: Pick<Submission, 'status' | 'depositCents'>): PaymentKind {
  if (submission.status === 'DEPOSIT_PAID') return 'BALANCE';
  return submission.depositCents !== null ? 'DEPOSIT' : 'FULL';
}

const KIND_DESCRIPTION: Record<PaymentKind, string> = { FULL: '', DEPOSIT: ' (zaliczka)', BALANCE: ' (dopłata)' };

/**
 * Tworzy, odtwarza albo wznawia próbę płatności i zwraca ją z redirectUrl z Paynow.
 *
 * Zgłoszenie ma najwyżej jedną otwartą próbę (NEW/PENDING). Jeśli już istnieje w Paynow,
 * klient wraca na tę samą bramkę — nowa płatność obok niezakończonej pozwalałaby
 * zapłacić dwa razy (np. z dwóch kart przeglądarki).
 *
 * Kolejność jest ważna: najpierw lokalny rekord z Idempotency-Key, potem wywołanie
 * Paynow. Jeśli Paynow nie odpowie (timeout/5xx), rekord zostaje i ponowienie
 * używa DOKŁADNIE tego samego klucza — Paynow utworzy wtedy jeden obiekt biznesowy.
 */
export async function startPaymentAttempt(
  submission: Submission,
  publicToken: string,
  form: Pick<Form, 'title' | 'balanceDueAt'>,
): Promise<Payment> {
  const kind = nextPaymentKind(submission);
  const payment = await prisma.$transaction(async (tx) => {
    await lockSubmission(tx, submission.id);
    const open = await tx.payment.findFirst({
      where: { submissionId: submission.id, kind, status: { in: ['NEW', 'PENDING'] } },
      orderBy: { createdAt: 'desc' },
    });
    return (
      open ??
      tx.payment.create({
        data: {
          submissionId: submission.id,
          idempotencyKey: generateIdempotencyKey(),
          kind,
          amountCents: amountDueCents(submission),
          currency: submission.currency,
          status: 'NEW',
        },
      })
    );
  });

  if (payment.providerPaymentId && payment.redirectUrl) return payment;

  // Dopłata nie ma rezerwacji — bramka nie może być ważna dłużej niż termin dopłaty.
  const deadline = kind === 'BALANCE' ? form.balanceDueAt : submission.reservationExpiresAt;
  const validitySeconds = remainingValiditySeconds(deadline);

  const result = await createPayment({
    amountCents: payment.amountCents,
    currency: payment.currency,
    externalId: submission.id,
    description: `${form.title} — ${submission.ticketNameSnapshot}${KIND_DESCRIPTION[kind]}`,
    buyerEmail: submission.buyerEmail,
    buyerPhone: submission.buyerPhone,
    continueUrl: confirmationUrl(submission.id, publicToken),
    validitySeconds,
    idempotencyKey: payment.idempotencyKey,
  });

  // Statusu nie nadpisujemy: notyfikacja mogła już dotrzeć i podpiąć się po externalId.
  return prisma.payment.update({
    where: { id: payment.id },
    data: { providerPaymentId: result.paymentId, redirectUrl: result.redirectUrl },
  });
}

/**
 * Dociąga z Paynow statusy otwartych prób zgłoszenia — na wypadek, gdyby webhook
 * jeszcze nie dotarł. Brak odpowiedzi Paynow nie jest błędem: zostaje stan lokalny.
 */
export async function syncOpenPayments(submissionId: string): Promise<void> {
  const open = await prisma.payment.findMany({
    where: { submissionId, status: { in: ['NEW', 'PENDING'] }, providerPaymentId: { not: null } },
  });
  for (const payment of open) {
    try {
      const remote = await getPaymentStatus(payment.providerPaymentId as string);
      if (!remote) continue;
      await applyProviderStatus({
        providerPaymentId: payment.providerPaymentId as string,
        incomingStatus: remote.status,
        incomingModifiedAt: remote.modifiedAt,
        rawPayload: remote.raw,
      });
    } catch (error) {
      if (!(error instanceof PaynowTransientError)) throw error;
    }
  }
}

/** validityTime w Paynow = dokładnie tyle, ile zostało do terminu (rezerwacji lub dopłaty), min. 60 s wg API. */
export function remainingValiditySeconds(deadline: Date | null, now = new Date()): number {
  const configured = env().PAYNOW_VALIDITY_SECONDS;
  if (!deadline) return configured;
  const remaining = Math.floor((deadline.getTime() - now.getTime()) / 1000);
  return Math.max(60, Math.min(configured, remaining));
}

export interface ApplyStatusInput {
  providerPaymentId: string;
  /** externalId z notyfikacji (= submission.id) — do podpięcia płatności, której paymentId jeszcze nie zapisaliśmy. */
  externalId?: string;
  incomingStatus: PaymentStatus;
  incomingModifiedAt: Date | null;
  rawPayload: unknown;
}

export type ApplyStatusResult =
  | { outcome: 'unknown-payment' }
  | { outcome: 'ignored'; reason: string }
  | {
      outcome: 'applied';
      paymentStatus: PaymentStatus;
      /** Nowy status zgłoszenia, jeśli ta płatność go zmieniła. */
      submissionStatus: 'PAID' | 'DEPOSIT_PAID' | null;
      submissionId: string;
    };

/**
 * Status zgłoszenia po potwierdzonej płatności danego rodzaju; null = zgłoszenie było już
 * opłacone tą częścią (albo w całości) i wpłata jest podwójna.
 */
export function statusAfterConfirmed(kind: PaymentKind, current: SubmissionStatus): 'PAID' | 'DEPOSIT_PAID' | null {
  if (current === 'PAID') return null;
  if (kind === 'DEPOSIT') return current === 'DEPOSIT_PAID' ? null : 'DEPOSIT_PAID';
  return 'PAID';
}

/**
 * E-mail po zaliczce z linkiem do dopłaty — z idempotencją po `depositEmailSentAt`
 * (`resend` pomija ją przy ponownej wysyłce z panelu). Zwraca false, gdy nie wysłano.
 */
export async function sendDepositEmail(submissionId: string, options: { resend: boolean }): Promise<boolean> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { form: true },
  });
  if (!submission || submission.status !== 'DEPOSIT_PAID') return false;
  if (submission.depositEmailSentAt && !options.resend) return false;

  // Jawny token z rejestracji już nie istnieje — link w e-mailu dostaje własny token
  // (nowy przy każdej wysyłce, więc link z poprzedniego e-maila przestaje działać).
  const token = generatePublicToken();
  await prisma.submission.update({ where: { id: submission.id }, data: { emailTokenHash: hashPublicToken(token) } });
  const balanceUrl = confirmationUrl(submission.id, token);

  const { subject, html, text } = buildDepositConfirmationEmail({
    formTitle: submission.form.title,
    eventDate: submission.form.eventDate,
    location: submission.form.location,
    ticketName: submission.ticketNameSnapshot,
    amountCents: submission.ticketPriceCents,
    currency: submission.currency,
    paidCents: submission.paidCents,
    balanceCents: submission.ticketPriceCents - submission.paidCents,
    balanceDueAt: submission.form.balanceDueAt,
    balanceUrl,
    ...renderDepositEmailContent(submission.form, submission, balanceUrl),
  });

  const sent = await sendMail(submission.buyerEmail, subject, html, text);
  if (sent) {
    await prisma.submission.update({ where: { id: submissionId }, data: { depositEmailSentAt: new Date() } });
  }
  return sent;
}

/** Wysyła e-mail z potwierdzeniem zakupu — z idempotencją po `confirmationEmailSentAt`. */
async function sendPaidConfirmationEmailIfNeeded(submissionId: string): Promise<void> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { form: true },
  });
  if (!submission || submission.confirmationEmailSentAt) return;

  const nonce = await ensureTicketNonce(submission.id);
  const ticket = nonce ? await ticketEmailAttachment(submission.id, nonce) : null;
  const { subject, html, text } = buildPaidConfirmationEmail({
    formTitle: submission.form.title,
    eventDate: submission.form.eventDate,
    location: submission.form.location,
    formSlug: submission.form.slug,
    ticketName: submission.ticketNameSnapshot,
    amountCents: submission.ticketPriceCents,
    currency: submission.currency,
    ...renderCustomEmailContent(submission.form, submission),
    ticketQr: ticket?.ticketQr,
  });

  const sent = await sendMail(submission.buyerEmail, subject, html, text, ticket ? [ticket.image] : []);
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
    const payment =
      (await tx.payment.findUnique({
        where: { providerPaymentId: input.providerPaymentId },
        include: { submission: true },
      })) ?? (await attachByExternalId(tx, input));
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

    const submissionStatus =
      input.incomingStatus === 'CONFIRMED' ? statusAfterConfirmed(payment.kind, payment.submission.status) : null;

    if (input.incomingStatus === 'CONFIRMED' && submissionStatus === null) {
      // Zgłoszenie opłacone już inną próbą — pieniądze wpłynęły drugi raz i trzeba je zwrócić.
      console.error(
        `[paynow] PODWÓJNA WPŁATA: płatność ${input.providerPaymentId} (${payment.kind}) potwierdzona dla już opłaconego zgłoszenia ${payment.submissionId} — wymaga zwrotu`,
      );
    }

    if (submissionStatus !== null) {
      await tx.submission.update({
        where: { id: payment.submissionId },
        data: {
          status: submissionStatus,
          reservationExpiresAt: null,
          paidCents: { increment: payment.amountCents },
          ...(submissionStatus === 'PAID' ? newTicketFields() : {}),
        },
      });

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
      submissionStatus,
      submissionId: payment.submissionId,
    } as const;
  });

  if (result.outcome === 'applied' && result.submissionStatus === 'PAID') {
    await sendPaidConfirmationEmailIfNeeded(result.submissionId);
  }
  if (result.outcome === 'applied' && result.submissionStatus === 'DEPOSIT_PAID') {
    await sendDepositEmail(result.submissionId, { resend: false });
  }

  return result;
}

/**
 * Dopłata przyjęta poza Paynow (gotówka, przelew) — odnotowana przez admina jako płatność
 * "manual", żeby suma wpłat i historia płatności zgadzały się z rzeczywistością.
 */
export async function recordManualBalancePayment(submissionId: string): Promise<Payment> {
  const payment = await prisma.$transaction(async (tx) => {
    await lockSubmission(tx, submissionId);
    const submission = await tx.submission.findUniqueOrThrow({ where: { id: submissionId } });
    if (submission.status !== 'DEPOSIT_PAID') {
      throw conflict('Dopłatę można odnotować tylko dla zgłoszenia z wpłaconą zaliczką', 'NOT_DEPOSIT_PAID');
    }
    const amountCents = amountDueCents(submission);
    const now = new Date();
    const created = await tx.payment.create({
      data: {
        submissionId,
        provider: 'manual',
        kind: 'BALANCE',
        idempotencyKey: generateIdempotencyKey(),
        amountCents,
        currency: submission.currency,
        status: 'CONFIRMED',
        providerModifiedAt: now,
      },
    });
    await tx.submission.update({
      where: { id: submissionId },
      data: { status: 'PAID', paidCents: { increment: amountCents }, ...newTicketFields(now) },
    });
    // Niezakończona bramka Paynow jest już zbędna; gdyby jednak wpłata doszła, webhook zgłosi podwójną wpłatę.
    await tx.payment.updateMany({
      where: { submissionId, id: { not: created.id }, status: { in: ['NEW', 'PENDING'] } },
      data: { status: 'ABANDONED' },
    });
    return created;
  });

  await sendPaidConfirmationEmailIfNeeded(submissionId);
  return payment;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Notyfikacja może wyprzedzić zapis paymentId po `POST /v3/payments` (albo ten zapis
 * w ogóle się nie udał przez timeout). Zgłoszenie ma najwyżej jedną otwartą próbę bez
 * paymentId, więc to ją Paynow utworzył — podpinamy identyfikator z podpisanej notyfikacji.
 */
async function attachByExternalId(tx: Tx, input: ApplyStatusInput) {
  if (!input.externalId || !UUID_RE.test(input.externalId)) return null;
  const pending = await tx.payment.findFirst({
    where: { submissionId: input.externalId, providerPaymentId: null, status: 'NEW' },
    orderBy: { createdAt: 'desc' },
  });
  if (!pending) return null;
  return tx.payment.update({
    where: { id: pending.id },
    data: { providerPaymentId: input.providerPaymentId },
    include: { submission: true },
  });
}

export { PaynowTransientError };
