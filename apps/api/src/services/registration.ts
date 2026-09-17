import type { DiscountCode, Form, Submission, TicketType } from '@prisma/client';
import {
  applyDiscount,
  buildAnswersSchema,
  EMPTY_FORM_SCHEMA,
  flattenSections,
  formSchemaJson,
  MIN_PAID_AMOUNT_CENTS,
  normalizeDiscountCode,
  type CreateSubmissionRequest,
} from '@syjonevent/shared';
import { env } from '../env.js';
import { badRequest, conflict, gone, notFound } from '../http/errors.js';
import { prisma } from '../prisma.js';
import { generatePublicToken, hashPublicToken } from '../utils/tokens.js';
import { checkAvailability, lockForm } from './capacity.js';
import { newTicketFields } from './tickets.js';

export function parseFormSchema(raw: unknown) {
  const parsed = formSchemaJson.safeParse(raw ?? EMPTY_FORM_SCHEMA);
  return parsed.success ? parsed.data : EMPTY_FORM_SCHEMA;
}

/** Formularz jest publicznie dostępny tylko jako PUBLISHED przed closes_at. */
export function assertFormOpen(form: Form, now = new Date()): void {
  if (form.status !== 'PUBLISHED' || form.archivedAt !== null) throw notFound('Formularz niedostępny');
  if (form.closesAt <= now) throw gone('Rejestracja na to wydarzenie została zamknięta', 'REGISTRATION_CLOSED');
}

export interface CreatedRegistration {
  submission: Submission;
  publicToken: string;
  ticketType: TicketType;
}

/**
 * Atomowa rejestracja: walidacja → advisory lock → sprawdzenie limitów → zapis
 * zgłoszenia ze snapshotami. Bilet darmowy powstaje od razu jako PAID.
 */
export async function createRegistration(
  form: Form,
  body: CreateSubmissionRequest,
  now = new Date(),
): Promise<CreatedRegistration> {
  const schema = parseFormSchema(form.schemaJson);

  // Walidacja odpowiedzi po stronie serwera tym samym kodem, co na froncie.
  const answers = buildAnswersSchema(flattenSections(schema.sections)).parse(body.answers);

  if (form.requirePhone && !body.buyer.phone) {
    throw badRequest('Numer telefonu jest wymagany dla tego wydarzenia');
  }

  const publicToken = generatePublicToken();

  const result = await prisma.$transaction(async (tx) => {
    await lockForm(tx, form.id);

    const ticketType = await tx.ticketType.findFirst({
      where: { id: body.ticketTypeId, formId: form.id },
    });
    if (!ticketType) throw notFound('Wybrany typ biletu nie istnieje');
    if (!ticketType.isActive) throw conflict('Ten bilet nie jest już dostępny', 'TICKET_INACTIVE');
    if (ticketType.priceCents > 0 && ticketType.priceCents < MIN_PAID_AMOUNT_CENTS) {
      throw conflict('Bilet ma niepoprawną cenę i nie może zostać sprzedany', 'INVALID_TICKET_PRICE');
    }

    const availability = await checkAvailability(tx, {
      formId: form.id,
      ticketTypeId: ticketType.id,
      capacityTotal: form.capacityTotal,
      ticketCapacity: ticketType.capacity,
      now,
    });
    if (!availability.available) {
      throw conflict(
        availability.reason === 'FORM_SOLD_OUT'
          ? 'Wszystkie miejsca na to wydarzenie zostały już zajęte'
          : 'Wszystkie bilety tego typu zostały już sprzedane',
        availability.reason,
      );
    }

    let finalPriceCents = ticketType.priceCents;
    let discountCode: DiscountCode | null = null;
    if (body.discountCode) {
      discountCode = await tx.discountCode.findFirst({
        where: { formId: form.id, code: normalizeDiscountCode(body.discountCode), isActive: true },
      });
      if (!discountCode) throw conflict('Nieprawidłowy kod rabatowy', 'INVALID_DISCOUNT_CODE');
      finalPriceCents = applyDiscount(ticketType.priceCents, discountCode.type, discountCode.value);
    }
    const discountAmountCents = ticketType.priceCents - finalPriceCents;

    const isFree = finalPriceCents === 0;

    const submission = await tx.submission.create({
      data: {
        formId: form.id,
        ticketTypeId: ticketType.id,
        ticketNameSnapshot: ticketType.name,
        ticketPriceCents: finalPriceCents,
        currency: ticketType.currency,
        discountCodeId: discountCode?.id ?? null,
        discountCodeSnapshot: discountCode?.code ?? null,
        discountAmountCents,
        buyerEmail: body.buyer.email,
        buyerPhone: body.buyer.phone ?? null,
        buyerAddress: body.buyer.address ?? null,
        payloadJson: answers as object,
        schemaSnapshotJson: schema as object,
        termsVersionAccepted: form.termsVersion,
        privacyPolicyVersionAccepted: form.privacyPolicyVersion,
        legalAcceptedAt: now,
        status: isFree ? 'PAID' : 'RESERVED',
        reservationExpiresAt: isFree
          ? null
          : new Date(now.getTime() + env().PAYNOW_VALIDITY_SECONDS * 1000),
        ...(isFree ? newTicketFields(now) : {}),
        publicTokenHash: hashPublicToken(publicToken),
      },
    });

    return { submission, ticketType };
  });

  return { ...result, publicToken };
}

/** Wygasła rezerwacja jest materializowana leniwie — przy każdym odczycie. */
export async function materializeExpiry(submission: Submission, now = new Date()): Promise<Submission> {
  if (
    submission.status === 'RESERVED' &&
    submission.reservationExpiresAt !== null &&
    submission.reservationExpiresAt <= now
  ) {
    return prisma.submission.update({ where: { id: submission.id }, data: { status: 'EXPIRED' } });
  }
  return submission;
}

export function assertPublicToken(submission: Submission, token: string | undefined): void {
  if (!token || submission.publicTokenHash !== hashPublicToken(token)) {
    throw notFound('Nie znaleziono zgłoszenia');
  }
}
