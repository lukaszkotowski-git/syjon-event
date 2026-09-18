import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  applyDiscount,
  checkDiscountCodeRequest,
  createSubmissionRequest,
  normalizeDiscountCode,
  type CreateSubmissionResponse,
  type DiscountCodeCheckResponse,
  type PublicEventListItemDto,
  type PublicFormDto,
  type SubmissionStatusDto,
} from '@syjonevent/shared';
import { asyncHandler } from '../http/async-handler.js';
import { conflict, gone, notFound } from '../http/errors.js';
import { renderCustomEmailContent } from '../services/email-variables.js';
import { buildFreeConfirmationEmail, sendMail } from '../services/mailer.js';
import { ensureTicketNonce, renderTicketQrPng, ticketEmailAttachment } from '../services/tickets.js';
import { guessDisplayName } from '../services/participants.js';
import { ticketReference } from '../utils/ticket-code.js';
import { toSummary } from '../utils/text.js';
import { prisma } from '../prisma.js';
import { countOccupancy } from '../services/capacity.js';
import { confirmationUrl, startPaymentAttempt, syncOpenPayments } from '../services/payments.js';
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

/** Lista wydarzeń z otwartymi zapisami — strona główna dla osoby niezalogowanej. */
publicRouter.get(
  '/events',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const forms = await prisma.form.findMany({
      where: { status: 'PUBLISHED', archivedAt: null, closesAt: { gt: now } },
      orderBy: { eventDate: 'asc' },
    });

    const events: PublicEventListItemDto[] = await Promise.all(
      forms.map(async (form) => {
        const occupancy = await countOccupancy(prisma, form.id, now);
        return {
          slug: form.slug,
          title: form.title,
          summary: toSummary(form.description),
          eventDate: form.eventDate.toISOString(),
          closesAt: form.closesAt.toISOString(),
          location: form.location,
          imageUrl: form.backgroundImageDesktopUrl ?? form.backgroundImageMobileUrl,
          soldOut: form.capacityTotal !== null && occupancy.total >= form.capacityTotal,
        };
      }),
    );

    res.json({ events });
  }),
);

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

    const [occupancy, activeDiscountCodes] = await Promise.all([
      countOccupancy(prisma, form.id, now),
      prisma.discountCode.count({ where: { formId: form.id, isActive: true } }),
    ]);
    const formSoldOut = form.capacityTotal !== null && occupancy.total >= form.capacityTotal;

    const dto: PublicFormDto = {
      slug: form.slug,
      title: form.title,
      description: form.description,
      eventDate: form.eventDate.toISOString(),
      closesAt: form.closesAt.toISOString(),
      location: form.location,
      termsVersion: form.termsVersion,
      privacyPolicyVersion: form.privacyPolicyVersion,
      schemaJson: parseFormSchema(form.schemaJson),
      hasDiscountCodes: activeDiscountCodes > 0,
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
  '/f/:slug/discount-codes/check',
  writeLimiter,
  asyncHandler(async (req, res) => {
    const body = checkDiscountCodeRequest.parse(req.body);
    const form = await prisma.form.findUnique({ where: { slug: req.params.slug as string } });
    if (!form) throw notFound('Formularz niedostępny');
    assertFormOpen(form);

    const ticket = await prisma.ticketType.findFirst({
      where: { id: body.ticketTypeId, formId: form.id, isActive: true },
    });
    if (!ticket) throw notFound('Wybrany typ biletu nie istnieje');

    const discountCode = await prisma.discountCode.findFirst({
      where: { formId: form.id, code: normalizeDiscountCode(body.code), isActive: true },
    });
    if (!discountCode) throw conflict('Nieprawidłowy kod rabatowy', 'INVALID_DISCOUNT_CODE');

    const discountedPriceCents = applyDiscount(ticket.priceCents, discountCode.type, discountCode.value);
    const dto: DiscountCodeCheckResponse = {
      code: discountCode.code,
      type: discountCode.type,
      value: discountCode.value,
      originalPriceCents: ticket.priceCents,
      discountedPriceCents,
      discountAmountCents: ticket.priceCents - discountedPriceCents,
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
      const ticket = submission.ticketNonce
        ? await ticketEmailAttachment(submission.id, submission.ticketNonce)
        : null;
      const { subject, html, text } = buildFreeConfirmationEmail({
        formTitle: form.title,
        eventDate: form.eventDate,
        location: form.location,
        ticketName: submission.ticketNameSnapshot,
        amountCents: submission.ticketPriceCents,
        currency: submission.currency,
        ...renderCustomEmailContent(form, submission),
        confirmationUrl: confirmation,
        ticketQr: ticket?.ticketQr,
      });
      const sent = await sendMail(submission.buyerEmail, subject, html, text, ticket ? [ticket.image] : []);
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

    let redirectUrl: string | null = null;
    try {
      redirectUrl = (await startPaymentAttempt(submission, publicToken, form.title)).redirectUrl;
    } catch (error) {
      // Zgłoszenie już istnieje i trzyma miejsce — bez tokenu klient nie mógłby do niego
      // wrócić. Kierujemy go na stronę potwierdzenia, skąd ponowi płatność.
      console.error(`[paynow] nie udało się rozpocząć płatności dla zgłoszenia ${submission.id}:`, error);
    }

    const response: CreateSubmissionResponse = {
      submissionId: submission.id,
      publicToken,
      confirmationUrl: confirmation,
      redirectUrl,
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
      include: { form: true },
    });
    if (!submissionRecord) throw notFound('Nie znaleziono zgłoszenia');
    assertPublicToken(submissionRecord, extractToken(req as never));

    // Fallback: webhook mógł jeszcze nie dotrzeć — pytamy Paynow o status serwerowo.
    if (submissionRecord.status === 'RESERVED') await syncOpenPayments(submissionRecord.id);

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
      discountCodeSnapshot: fresh.discountCodeSnapshot,
      discountAmountCents: fresh.discountAmountCents,
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
      formTitle: submissionRecord.form.title,
      formSlug: submissionRecord.form.slug,
      eventDate: submissionRecord.form.eventDate.toISOString(),
      location: submissionRecord.form.location,
      confirmationEmailSent: fresh.confirmationEmailSentAt !== null,
      ticketReference: fresh.status === 'PAID' ? ticketReference(fresh.id) : null,
      checkedInAt: fresh.checkedInAt?.toISOString() ?? null,
      buyerName: guessDisplayName(fresh.schemaSnapshotJson, fresh.payloadJson),
      buyerEmail: fresh.buyerEmail,
    };
    res.json(dto);
  }),
);

publicRouter.get(
  '/submissions/:id/ticket.png',
  asyncHandler(async (req, res) => {
    const submission = await prisma.submission.findUnique({ where: { id: req.params.id as string } });
    if (!submission) throw notFound('Nie znaleziono zgłoszenia');
    assertPublicToken(submission, extractToken(req as never));

    const nonce = await ensureTicketNonce(submission.id);
    if (!nonce) throw notFound('Bilet jest dostępny dopiero po potwierdzeniu zgłoszenia');

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(await renderTicketQrPng(submission.id, nonce));
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

    // Otwarta próba mogła się już rozstrzygnąć w Paynow — bez tego wznowilibyśmy martwą bramkę.
    await syncOpenPayments(submission.id);
    const fresh = await materializeExpiry(
      await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } }),
    );
    if (fresh.status === 'PAID') throw conflict('Zgłoszenie jest już opłacone', 'ALREADY_PAID');
    if (fresh.status !== 'RESERVED' || !fresh.reservationExpiresAt || fresh.reservationExpiresAt <= new Date()) {
      throw gone(
        'Rezerwacja wygasła. Wypełnij formularz ponownie, jeśli miejsca są nadal dostępne.',
        'RESERVATION_EXPIRED',
      );
    }

    // Ponowna próba nie może "wskrzesić" miejsca — rezerwacja wciąż musi być ważna,
    // a jej TTL nie jest przedłużany. Niezakończona płatność w Paynow jest wznawiana, a nie dublowana.
    const payment = await startPaymentAttempt(fresh, token as string, submission.form.title);
    res.json({ redirectUrl: payment.redirectUrl });
  }),
);
