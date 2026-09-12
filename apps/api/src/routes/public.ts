import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  createSubmissionRequest,
  type CreateSubmissionResponse,
  type PublicFormDto,
  type SubmissionStatusDto,
} from '@syjonevent/shared';
import { asyncHandler } from '../http/async-handler.js';
import { conflict, gone, notFound } from '../http/errors.js';
import { getPaymentStatus } from '../paynow/client.js';
import { buildFreeConfirmationEmail, sendMail } from '../services/mailer.js';
import { prisma } from '../prisma.js';
import { countOccupancy } from '../services/capacity.js';
import {
  applyProviderStatus,
  confirmationUrl,
  PaynowTransientError,
  startPaymentAttempt,
} from '../services/payments.js';
import {
  assertFormOpen,
  assertPublicToken,
  createRegistration,
  materializeExpiry,
  parseFormSchema,
} from '../services/registration.js';

const writeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Zbyt wiele prób. Spróbuj za chwilę.' } },
});

export const publicRouter: Router = Router();

publicRouter.get(
  '/f/:slug',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const form = await prisma.form.findUnique({
      where: { slug: req.params.slug as string },
      include: { ticketTypes: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!form) throw notFound('Formularz niedostępny');
    assertFormOpen(form, now);

    const occupancy = await countOccupancy(prisma, form.id, now);
    const formSoldOut = form.capacityTotal !== null && occupancy.total >= form.capacityTotal;

    const dto: PublicFormDto = {
      slug: form.slug,
      title: form.title,
      description: form.description,
      closesAt: form.closesAt.toISOString(),
      requirePhone: form.requirePhone,
      termsVersion: form.termsVersion,
      privacyPolicyVersion: form.privacyPolicyVersion,
      schemaJson: parseFormSchema(form.schemaJson),
      soldOut: formSoldOut,
      backgroundImageDesktopUrl: form.backgroundImageDesktopUrl,
      backgroundImageMobileUrl: form.backgroundImageMobileUrl,
      ticketTypes: form.ticketTypes.map((ticket) => {
        const taken = occupancy.perTicketType.get(ticket.id) ?? 0;
        return {
          id: ticket.id,
          name: ticket.name,
          priceCents: ticket.priceCents,
          currency: ticket.currency as 'PLN',
          soldOut: formSoldOut || (ticket.capacity !== null && taken >= ticket.capacity),
        };
      }),
    };

    res.json(dto);
  }),
);

publicRouter.post(
  '/f/:slug/submissions',
  writeLimiter,
  asyncHandler(async (req, res) => {
    const body = createSubmissionRequest.parse(req.body);
    const form = await prisma.form.findUnique({ where: { slug: req.params.slug as string } });
    if (!form) throw notFound('Formularz niedostępny');
    assertFormOpen(form);

    const { submission, publicToken } = await createRegistration(form, body);
    const confirmation = confirmationUrl(submission.id, publicToken);

    if (submission.status === 'PAID') {
      const { subject, html, text } = buildFreeConfirmationEmail({
        formTitle: form.title,
        ticketName: submission.ticketNameSnapshot,
        amountCents: submission.ticketPriceCents,
        currency: submission.currency,
        confirmationUrl: confirmation,
      });
      const sent = await sendMail(submission.buyerEmail, subject, html, text);
      if (sent) {
        await prisma.submission.update({
          where: { id: submission.id },
          data: { confirmationEmailSentAt: new Date() },
        });
      }

      const response: CreateSubmissionResponse = {
        submissionId: submission.id,
        publicToken,
        confirmationUrl: confirmation,
        redirectUrl: null,
        status: 'PAID',
      };
      res.status(201).json(response);
      return;
    }

    const payment = await startPaymentAttempt(submission, publicToken, form.title);

    const response: CreateSubmissionResponse = {
      submissionId: submission.id,
      publicToken,
      confirmationUrl: confirmation,
      redirectUrl: payment.redirectUrl,
      status: 'RESERVED',
    };
    res.status(201).json(response);
  }),
);

function extractToken(req: { query: Record<string, unknown>; body?: unknown }): string | undefined {
  const fromQuery = req.query.token;
  if (typeof fromQuery === 'string') return fromQuery;
  const body = req.body as { token?: unknown } | undefined;
  return typeof body?.token === 'string' ? body.token : undefined;
}

publicRouter.get(
  '/submissions/:id/status',
  asyncHandler(async (req, res) => {
    const submissionRecord = await prisma.submission.findUnique({
      where: { id: req.params.id as string },
      include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 }, form: true },
    });
    if (!submissionRecord) throw notFound('Nie znaleziono zgłoszenia');
    assertPublicToken(submissionRecord, extractToken(req as never));

    const latest = submissionRecord.payments[0] ?? null;

    // Fallback: webhook mógł jeszcze nie dotrzeć — pytamy Paynow o status serwerowo.
    if (
      latest?.providerPaymentId &&
      submissionRecord.status === 'RESERVED' &&
      ['NEW', 'PENDING'].includes(latest.status)
    ) {
      try {
        const remote = await getPaymentStatus(latest.providerPaymentId);
        if (remote) {
          await applyProviderStatus({
            providerPaymentId: latest.providerPaymentId,
            incomingStatus: remote.status,
            incomingModifiedAt: remote.modifiedAt,
            rawPayload: remote.raw,
          });
        }
      } catch (error) {
        // Brak odpowiedzi Paynow nie może wywrócić strony potwierdzenia.
        if (!(error instanceof PaynowTransientError)) throw error;
      }
    }

    const fresh = await materializeExpiry(
      (await prisma.submission.findUniqueOrThrow({ where: { id: submissionRecord.id } })),
    );
    const payment = await prisma.payment.findFirst({
      where: { submissionId: fresh.id },
      orderBy: { createdAt: 'desc' },
    });

    const canRetry =
      fresh.status === 'RESERVED' &&
      fresh.reservationExpiresAt !== null &&
      fresh.reservationExpiresAt > new Date() &&
      (payment === null || ['REJECTED', 'ERROR', 'ABANDONED', 'EXPIRED', 'NEW'].includes(payment.status));

    const dto: SubmissionStatusDto = {
      submissionId: fresh.id,
      status: fresh.status,
      ticketName: fresh.ticketNameSnapshot,
      amountCents: fresh.ticketPriceCents,
      currency: fresh.currency,
      reservationExpiresAt: fresh.reservationExpiresAt?.toISOString() ?? null,
      lastPayment: payment
        ? {
            status: payment.status,
            redirectUrl: payment.redirectUrl,
            updatedAt: payment.updatedAt.toISOString(),
          }
        : null,
      canRetry,
      paymentResultContent: {
        successTitle: submissionRecord.form.paymentSuccessTitle,
        successBody: submissionRecord.form.paymentSuccessBody,
        errorTitle: submissionRecord.form.paymentErrorTitle,
        errorBody: submissionRecord.form.paymentErrorBody,
      },
    };
    res.json(dto);
  }),
);

publicRouter.post(
  '/submissions/:id/retry',
  writeLimiter,
  asyncHandler(async (req, res) => {
    const token = extractToken(req as never);
    const submission = await prisma.submission.findUnique({
      where: { id: req.params.id as string },
      include: { form: true },
    });
    if (!submission) throw notFound('Nie znaleziono zgłoszenia');
    assertPublicToken(submission, token);

    const fresh = await materializeExpiry(submission);
    if (fresh.status === 'PAID') throw conflict('Zgłoszenie jest już opłacone', 'ALREADY_PAID');
    if (fresh.status !== 'RESERVED' || !fresh.reservationExpiresAt || fresh.reservationExpiresAt <= new Date()) {
      throw gone(
        'Rezerwacja wygasła. Wypełnij formularz ponownie, jeśli miejsca są nadal dostępne.',
        'RESERVATION_EXPIRED',
      );
    }

    // Ponowna próba nie może "wskrzesić" miejsca — rezerwacja wciąż musi być ważna,
    // a jej TTL nie jest przedłużany.
    const payment = await startPaymentAttempt(fresh, token as string, submission.form.title);
    res.json({ redirectUrl: payment.redirectUrl });
  }),
);
