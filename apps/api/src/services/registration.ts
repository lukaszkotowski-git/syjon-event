import type { DiscountCode, Form, Submission, TicketType } from '@prisma/client';
import {
  applyDiscount,
  buildAnswersSchema,
  depositSplit,
  EMPTY_FORM_SCHEMA,
  flattenSections,
  formSchemaJson,
  MIN_PAID_AMOUNT_CENTS,
  normalizeDiscountCode,
  pickVisibleAnswers,
  resolveConsents,
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

  // Walidacja odpowiedzi po stronie serwera tym samym kodem, co na froncie. Pola ukryte
  // warunkiem pomijamy — nie są wymagane i nie trafiają do bazy.
  const visible = pickVisibleAnswers(flattenSections(schema.sections), body.answers);
  const answers = buildAnswersSchema(visible.fields).parse(visible.answers);

  const consents = resolveConsents(schema.consents, body.consents);
  if (!consents.ok) throw badRequest(consents.message, { consent: consents.key });

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
    // Zaliczka tylko przed terminem dopłaty — po nim nie dałoby się już dopłacić online.
    const split =
      body.paymentOption === 'DEPOSIT' && form.balanceDueAt !== null && form.balanceDueAt > now
        ? depositSplit(finalPriceCents, ticketType.depositCents)
        : null;

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
        depositCents: split?.depositCents ?? null,
        buyerEmail: body.buyer.email,
        buyerPhone: body.buyer.phone ?? null,
        buyerAddress: body.buyer.address ?? null,
        payloadJson: answers as object,
        schemaSnapshotJson: schema as object,
        termsVersionAccepted: form.termsVersion,
        privacyPolicyVersionAccepted: form.privacyPolicyVersion,
        legalAcceptedAt: now,
        consentsJson: consents.consents as object[],
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

/** Kwota, którą zgłoszenie ma teraz zapłacić: zaliczka, reszta po zaliczce albo całość. */
export function amountDueCents(submission: Pick<Submission, 'status' | 'ticketPriceCents' | 'depositCents' | 'paidCents'>): number {
  if (submission.status === 'DEPOSIT_PAID') return Math.max(0, submission.ticketPriceCents - submission.paidCents);
  if (submission.status === 'RESERVED') return submission.depositCents ?? submission.ticketPriceCents;
  return 0;
}

/** Dopłatę online przyjmujemy do końca dnia terminu (termin jest zapisywany jako koniec dnia). */
export function canPayBalanceOnline(form: Pick<Form, 'balanceDueAt'>, now = new Date()): boolean {
  return form.balanceDueAt !== null && form.balanceDueAt > now;
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

/** Akceptuje token z rejestracji albo token z linku dopłaty w e-mailu. */
export function assertPublicToken(submission: Submission, token: string | undefined): void {
  const hash = token ? hashPublicToken(token) : null;
  if (!hash || (submission.publicTokenHash !== hash && submission.emailTokenHash !== hash)) {
    throw notFound('Nie znaleziono zgłoszenia');
  }
}
