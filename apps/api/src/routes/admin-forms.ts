import { randomUUID } from 'node:crypto';
import { copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import {
  buildAnswersSchema,
  createFormRequest,
  depositError,
  discountCodeInput,
  EMPTY_FORM_SCHEMA,
  flattenSections,
  formSchemaJson,
  MAX_DISCOUNT_CODES_PER_FORM,
  pickVisibleAnswers,
  type ConsentRecord,
  MAX_TICKET_TYPES_PER_FORM,
  ticketTypeInput,
  updateDiscountCodeRequest,
  updateFormRequest,
  updateSubmissionRequest,
  updateTicketTypeRequest,
} from '@syjonevent/shared';
import { requireAdmin } from '../auth/middleware.js';
import { asyncHandler } from '../http/async-handler.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { prisma } from '../prisma.js';
import { audit, changedKeys } from '../services/audit.js';
import { countOccupancy, isUniqueViolation } from '../services/capacity.js';
import { recordManualBalancePayment, sendDepositEmail } from '../services/payments.js';
import { guessDisplayName, normalizeSearchText } from '../services/participants.js';
import { parseFormSchema } from '../services/registration.js';
import { imageUpload, UPLOAD_DIR, uploadPublicUrl } from '../uploads.js';
import { toCsv } from '../utils/csv.js';
import { ticketReference } from '../utils/ticket-code.js';

export const adminFormsRouter: Router = Router();
adminFormsRouter.use(requireAdmin);

const uuid = z.string().uuid();

async function getFormOr404(id: string) {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) throw notFound('Nie znaleziono formularza');
  const form = await prisma.form.findUnique({
    where: { id: parsed.data },
    include: {
      ticketTypes: { orderBy: { sortOrder: 'asc' } },
      discountCodes: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!form) throw notFound('Nie znaleziono formularza');
  return form;
}

/* --------------------------------- formularze ------------------------------ */

/** Czytelne nazwy pól wydarzenia w dzienniku zmian. */
const FORM_FIELD_LABELS: Record<string, string> = {
  slug: 'adres',
  title: 'tytuł',
  description: 'opis',
  eventDate: 'data',
  closesAt: 'zamknięcie zapisów',
  location: 'miejsce',
  capacityTotal: 'limit miejsc',
  termsVersion: 'wersja regulaminu',
  privacyPolicyVersion: 'wersja polityki prywatności',
  paymentSuccessTitle: 'strona po płatności',
  paymentSuccessBody: 'strona po płatności',
  paymentErrorTitle: 'strona po płatności',
  paymentErrorBody: 'strona po płatności',
  confirmationEmailTitle: 'e-mail',
  confirmationEmailBody: 'e-mail',
  balanceDueAt: 'termin dopłaty',
  depositEmailTitle: 'e-mail po zaliczce',
  depositEmailBody: 'e-mail po zaliczce',
  schemaJson: 'pola formularza',
};

adminFormsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const forms = await prisma.form.findMany({
      orderBy: { createdAt: 'desc' },
      include: { createdByAdmin: { select: { email: true } } },
    });
    const counts = await prisma.submission.groupBy({
      by: ['formId', 'status'],
      _count: { _all: true },
    });

    res.json({
      forms: forms.map((form) => {
        const rows = counts.filter((c) => c.formId === form.id);
        const byStatus = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
        return {
          id: form.id,
          slug: form.slug,
          title: form.title,
          status: form.status,
          eventDate: form.eventDate.toISOString(),
          closesAt: form.closesAt.toISOString(),
          isOpen: form.status === 'PUBLISHED' && form.closesAt > now,
          capacityTotal: form.capacityTotal,
          paidCount: byStatus.PAID ?? 0,
          reservedCount: byStatus.RESERVED ?? 0,
          depositPaidCount: byStatus.DEPOSIT_PAID ?? 0,
          // Wszystkie zgłoszenia (także wygasłe/anulowane) — decyduje, czy wydarzenie można usunąć.
          submissionCount: rows.reduce((sum, r) => sum + r._count._all, 0),
          thumbnailUrl: form.backgroundImageDesktopUrl ?? form.backgroundImageMobileUrl,
          createdByEmail: form.createdByAdmin?.email ?? null,
        };
      }),
    });
  }),
);

adminFormsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createFormRequest.parse(req.body);
    try {
      const form = await prisma.form.create({
        data: {
          slug: body.slug,
          title: body.title,
          description: body.description ?? null,
          eventDate: new Date(body.eventDate),
          closesAt: new Date(body.closesAt),
          location: body.location || null,
          capacityTotal: body.capacityTotal ?? null,
          termsVersion: body.termsVersion,
          privacyPolicyVersion: body.privacyPolicyVersion,
          paymentSuccessTitle: body.paymentSuccessTitle ?? null,
          paymentSuccessBody: body.paymentSuccessBody ?? null,
          paymentErrorTitle: body.paymentErrorTitle ?? null,
          paymentErrorBody: body.paymentErrorBody ?? null,
          confirmationEmailTitle: body.confirmationEmailTitle ?? null,
          confirmationEmailBody: body.confirmationEmailBody ?? null,
          balanceDueAt: body.balanceDueAt ? new Date(body.balanceDueAt) : null,
          depositEmailTitle: body.depositEmailTitle ?? null,
          depositEmailBody: body.depositEmailBody ?? null,
          schemaJson: (body.schemaJson ?? EMPTY_FORM_SCHEMA) as object,
          createdByAdminId: req.admin!.id,
        },
      });
      await audit(req, { action: 'form.create', formId: form.id, entityId: form.id, summary: `Utworzono wydarzenie „${form.title}”` });
      res.status(201).json({ form });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Formularz z tym adresem (slug) już istnieje', 'SLUG_TAKEN');
      throw error;
    }
  }),
);

adminFormsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    const [occupancy, usageCounts] = await Promise.all([
      countOccupancy(prisma, form.id, new Date()),
      prisma.submission.groupBy({
        by: ['discountCodeId'],
        where: { formId: form.id, discountCodeId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const usageByCode = new Map(usageCounts.map((row) => [row.discountCodeId as string, row._count._all]));

    res.json({
      form: {
        ...form,
        schemaJson: parseFormSchema(form.schemaJson),
        discountCodes: form.discountCodes.map((code) => ({
          ...code,
          usageCount: usageByCode.get(code.id) ?? 0,
        })),
      },
      occupancy: {
        total: occupancy.total,
        perTicketType: Object.fromEntries(occupancy.perTicketType),
      },
    });
  }),
);

adminFormsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    const body = updateFormRequest.parse(req.body);
    if (body.schemaJson) formSchemaJson.parse(body.schemaJson);

    try {
      const updated = await prisma.form.update({
        where: { id: form.id },
        data: {
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description ?? null } : {}),
          ...(body.eventDate !== undefined ? { eventDate: new Date(body.eventDate) } : {}),
          ...(body.closesAt !== undefined ? { closesAt: new Date(body.closesAt) } : {}),
          ...(body.location !== undefined ? { location: body.location || null } : {}),
          ...(body.capacityTotal !== undefined ? { capacityTotal: body.capacityTotal ?? null } : {}),
          ...(body.termsVersion !== undefined ? { termsVersion: body.termsVersion } : {}),
          ...(body.privacyPolicyVersion !== undefined
            ? { privacyPolicyVersion: body.privacyPolicyVersion }
            : {}),
          ...(body.paymentSuccessTitle !== undefined
            ? { paymentSuccessTitle: body.paymentSuccessTitle ?? null }
            : {}),
          ...(body.paymentSuccessBody !== undefined
            ? { paymentSuccessBody: body.paymentSuccessBody ?? null }
            : {}),
          ...(body.paymentErrorTitle !== undefined
            ? { paymentErrorTitle: body.paymentErrorTitle ?? null }
            : {}),
          ...(body.paymentErrorBody !== undefined
            ? { paymentErrorBody: body.paymentErrorBody ?? null }
            : {}),
          ...(body.confirmationEmailTitle !== undefined
            ? { confirmationEmailTitle: body.confirmationEmailTitle ?? null }
            : {}),
          ...(body.confirmationEmailBody !== undefined
            ? { confirmationEmailBody: body.confirmationEmailBody ?? null }
            : {}),
          ...(body.balanceDueAt !== undefined
            ? { balanceDueAt: body.balanceDueAt ? new Date(body.balanceDueAt) : null }
            : {}),
          ...(body.depositEmailTitle !== undefined ? { depositEmailTitle: body.depositEmailTitle ?? null } : {}),
          ...(body.depositEmailBody !== undefined ? { depositEmailBody: body.depositEmailBody ?? null } : {}),
          ...(body.schemaJson !== undefined ? { schemaJson: body.schemaJson as object } : {}),
        },
      });
      const changed = changedKeys(
        {
          ...form,
          eventDate: form.eventDate.toISOString(),
          closesAt: form.closesAt.toISOString(),
          balanceDueAt: form.balanceDueAt?.toISOString() ?? null,
          schemaJson: parseFormSchema(form.schemaJson),
        },
        { ...body, ...(body.schemaJson ? { schemaJson: parseFormSchema(body.schemaJson) } : {}) },
      );
      if (changed.length > 0) {
        await audit(req, {
          action: 'form.update',
          formId: form.id,
          entityId: form.id,
          summary: `Zmieniono wydarzenie „${updated.title}”: ${changed.map((key) => FORM_FIELD_LABELS[key] ?? key).join(', ')}`,
          details: { changed },
        });
      }
      res.json({ form: updated });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('Formularz z tym adresem (slug) już istnieje', 'SLUG_TAKEN');
      throw error;
    }
  }),
);

adminFormsRouter.post(
  '/:id/publish',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    if (form.archivedAt) throw conflict('Zarchiwizowanego formularza nie można opublikować', 'FORM_ARCHIVED');
    if (form.ticketTypes.filter((t) => t.isActive).length === 0) {
      throw badRequest('Formularz musi mieć przynajmniej jeden aktywny typ biletu');
    }
    if (form.closesAt <= new Date()) {
      throw badRequest('Data zamknięcia rejestracji musi być w przyszłości');
    }
    if (form.ticketTypes.some((t) => t.isActive && t.depositCents !== null) && !form.balanceDueAt) {
      throw badRequest('Bilety z zaliczką wymagają terminu dopłaty — ustaw go w sekcji „Bilety”');
    }
    const updated = await prisma.form.update({ where: { id: form.id }, data: { status: 'PUBLISHED' } });
    await audit(req, { action: 'form.publish', formId: form.id, entityId: form.id, summary: `Opublikowano „${form.title}”` });
    res.json({ form: updated });
  }),
);

adminFormsRouter.post(
  '/:id/archive',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    // Bez hard-delete: dane zgłoszeń i płatności zostają nietknięte.
    const updated = await prisma.form.update({
      where: { id: form.id },
      data: { status: 'ARCHIVED', archivedAt: form.archivedAt ?? new Date() },
    });
    await audit(req, { action: 'form.archive', formId: form.id, entityId: form.id, summary: `Zarchiwizowano „${form.title}”` });
    res.json({ form: updated });
  }),
);

/** Wolny slug dla kopii: "wyjazd-kopia", "wyjazd-kopia-2", … */
async function freeCopySlug(slug: string): Promise<string> {
  const base = `${slug.slice(0, 70)}-kopia`;
  for (let n = 1; n < 100; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await prisma.form.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

/** Kopia pliku tła — każde wydarzenie ma własny plik, bo usunięcie tła kasuje go z dysku. */
async function copyUploadedFile(url: string | null): Promise<string | null> {
  if (!url || !url.startsWith('/api/uploads/')) return url;
  const source = path.basename(url);
  const target = `${randomUUID()}${path.extname(source)}`;
  try {
    await copyFile(path.join(UPLOAD_DIR, source), path.join(UPLOAD_DIR, target));
    return uploadPublicUrl(target);
  } catch {
    return null;
  }
}

/**
 * Kopia wydarzenia jako szkic: treści, pola, zgody, bilety, kody rabatowe i grafiki.
 * Zgłoszenia, stanowiska skanowania i historia nie są kopiowane.
 */
adminFormsRouter.post(
  '/:id/duplicate',
  asyncHandler(async (req, res) => {
    const source = await getFormOr404(req.params.id as string);
    const [desktopUrl, mobileUrl] = await Promise.all([
      copyUploadedFile(source.backgroundImageDesktopUrl),
      copyUploadedFile(source.backgroundImageMobileUrl),
    ]);
    const copy = await prisma.form.create({
      data: {
        slug: await freeCopySlug(source.slug),
        title: `${source.title} (kopia)`.slice(0, 200),
        description: source.description,
        status: 'DRAFT',
        schemaJson: source.schemaJson as object,
        capacityTotal: source.capacityTotal,
        eventDate: source.eventDate,
        closesAt: source.closesAt,
        location: source.location,
        termsVersion: source.termsVersion,
        privacyPolicyVersion: source.privacyPolicyVersion,
        paymentSuccessTitle: source.paymentSuccessTitle,
        paymentSuccessBody: source.paymentSuccessBody,
        paymentErrorTitle: source.paymentErrorTitle,
        paymentErrorBody: source.paymentErrorBody,
        confirmationEmailTitle: source.confirmationEmailTitle,
        confirmationEmailBody: source.confirmationEmailBody,
        balanceDueAt: source.balanceDueAt,
        depositEmailTitle: source.depositEmailTitle,
        depositEmailBody: source.depositEmailBody,
        backgroundImageDesktopUrl: desktopUrl,
        backgroundImageMobileUrl: mobileUrl,
        createdByAdminId: req.admin!.id,
        ticketTypes: {
          create: source.ticketTypes.map((ticket) => ({
            name: ticket.name,
            priceCents: ticket.priceCents,
            depositCents: ticket.depositCents,
            currency: ticket.currency,
            capacity: ticket.capacity,
            sortOrder: ticket.sortOrder,
            isActive: ticket.isActive,
          })),
        },
        discountCodes: {
          create: source.discountCodes.map((code) => ({
            code: code.code,
            type: code.type,
            value: code.value,
            isActive: code.isActive,
          })),
        },
      },
    });
    await audit(req, {
      action: 'form.duplicate',
      formId: copy.id,
      entityId: copy.id,
      summary: `Utworzono kopię „${source.title}”`,
      details: { sourceFormId: source.id },
    });
    res.status(201).json({ form: copy });
  }),
);

/* ------------------------------ tło wydarzenia ------------------------------ */

const backgroundVariant = z.enum(['desktop', 'mobile']);
const backgroundField = { desktop: 'backgroundImageDesktopUrl', mobile: 'backgroundImageMobileUrl' } as const;

async function deleteUploadedFile(url: string | null) {
  if (!url || !url.startsWith('/api/uploads/')) return;
  try {
    await unlink(path.join(UPLOAD_DIR, path.basename(url)));
  } catch {
    // Plik mógł już nie istnieć — usunięcie rekordu nie może się na tym wywrócić.
  }
}

adminFormsRouter.post(
  '/:id/background/:variant',
  imageUpload.single('image'),
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    const variant = backgroundVariant.parse(req.params.variant);
    if (!req.file) throw badRequest('Brak pliku obrazu (pole "image")');

    const field = backgroundField[variant];
    await deleteUploadedFile(form[field]);

    const updated = await prisma.form.update({
      where: { id: form.id },
      data: { [field]: uploadPublicUrl(req.file.filename) },
    });
    await audit(req, { action: 'form.background', formId: form.id, entityId: form.id, summary: `Wgrano grafikę tła (${variant}) w „${form.title}”` });
    res.json({ form: updated });
  }),
);

adminFormsRouter.delete(
  '/:id/background/:variant',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    const variant = backgroundVariant.parse(req.params.variant);
    const field = backgroundField[variant];

    await deleteUploadedFile(form[field]);
    const updated = await prisma.form.update({ where: { id: form.id }, data: { [field]: null } });
    res.json({ form: updated });
  }),
);

adminFormsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    const force = req.query.force === 'true';
    const submissionCount = await prisma.submission.count({ where: { formId: form.id } });
    if (submissionCount > 0 && !force) {
      throw conflict(
        'Nie można usunąć formularza ze zgłoszeniami — zarchiwizuj go albo usuń trwale wraz z danymi',
        'FORM_HAS_SUBMISSIONS',
      );
    }

    await deleteUploadedFile(form.backgroundImageDesktopUrl);
    await deleteUploadedFile(form.backgroundImageMobileUrl);

    await prisma.$transaction([
      // Kolejność wymuszona przez onDelete: Restrict — dzieci znikają przed rodzicami.
      prisma.checkInAttempt.deleteMany({ where: { formId: form.id } }),
      prisma.payment.deleteMany({ where: { submission: { formId: form.id } } }),
      prisma.submission.deleteMany({ where: { formId: form.id } }),
      prisma.scanStation.deleteMany({ where: { formId: form.id } }),
      prisma.discountCode.deleteMany({ where: { formId: form.id } }),
      prisma.ticketType.deleteMany({ where: { formId: form.id } }),
      prisma.form.delete({ where: { id: form.id } }),
    ]);

    await audit(req, {
      action: 'form.delete',
      formId: form.id,
      entityId: form.id,
      summary: `Usunięto wydarzenie „${form.title}”${submissionCount > 0 ? ` wraz z ${submissionCount} zgłoszeniami` : ''}`,
    });
    res.status(204).end();
  }),
);

/* ----------------------------------- bilety -------------------------------- */

adminFormsRouter.post(
  '/:id/tickets',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    if (form.ticketTypes.length >= MAX_TICKET_TYPES_PER_FORM) {
      throw badRequest(`Maksymalna liczba typów biletów to ${MAX_TICKET_TYPES_PER_FORM}`);
    }
    const body = ticketTypeInput.parse(req.body);
    const ticket = await prisma.ticketType.create({
      data: {
        formId: form.id,
        name: body.name,
        priceCents: body.priceCents,
        depositCents: body.depositCents ?? null,
        capacity: body.capacity ?? null,
        sortOrder: body.sortOrder,
        isActive: body.isActive,
      },
    });
    await audit(req, { action: 'ticket_type.create', formId: form.id, entityId: ticket.id, summary: `Dodano bilet „${ticket.name}” w „${form.title}”` });
    res.status(201).json({ ticket });
  }),
);

adminFormsRouter.patch(
  '/:id/tickets/:ticketId',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    const body = updateTicketTypeRequest.parse(req.body);
    const ticket = form.ticketTypes.find((t) => t.id === req.params.ticketId);
    if (!ticket) throw notFound('Nie znaleziono typu biletu');
    const deposit = depositError(
      body.priceCents ?? ticket.priceCents,
      body.depositCents !== undefined ? body.depositCents : ticket.depositCents,
    );
    if (deposit) throw badRequest(deposit, { depositCents: deposit });

    const updated = await prisma.ticketType.update({
      where: { id: ticket.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.priceCents !== undefined ? { priceCents: body.priceCents } : {}),
        ...(body.depositCents !== undefined ? { depositCents: body.depositCents ?? null } : {}),
        ...(body.capacity !== undefined ? { capacity: body.capacity ?? null } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    const changedTicket = changedKeys(ticket as Record<string, unknown>, { ...body });
    if (changedTicket.length > 0) {
      await audit(req, {
        action: 'ticket_type.update',
        formId: form.id,
        entityId: ticket.id,
        summary: `Zmieniono bilet „${updated.name}” w „${form.title}”`,
        details: { changed: changedTicket },
      });
    }
    // Zmiana ceny/nazwy nie rusza istniejących zgłoszeń — one mają własne snapshoty.
    res.json({ ticket: updated });
  }),
);

adminFormsRouter.post(
  '/:id/tickets/:ticketId/deactivate',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    const ticket = form.ticketTypes.find((t) => t.id === req.params.ticketId);
    if (!ticket) throw notFound('Nie znaleziono typu biletu');
    const updated = await prisma.ticketType.update({
      where: { id: ticket.id },
      data: { isActive: false },
    });
    res.json({ ticket: updated });
  }),
);

/* ------------------------------- kody rabatowe ------------------------------ */

adminFormsRouter.post(
  '/:id/discount-codes',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    if (form.discountCodes.length >= MAX_DISCOUNT_CODES_PER_FORM) {
      throw badRequest(`Maksymalna liczba kodów rabatowych to ${MAX_DISCOUNT_CODES_PER_FORM}`);
    }
    const body = discountCodeInput.parse(req.body);
    try {
      const discountCode = await prisma.discountCode.create({
        data: {
          formId: form.id,
          code: body.code,
          type: body.type,
          value: body.value,
          isActive: body.isActive,
        },
      });
      await audit(req, { action: 'discount_code.create', formId: form.id, entityId: discountCode.id, summary: `Dodano kod rabatowy ${discountCode.code} w „${form.title}”` });
      res.status(201).json({ discountCode: { ...discountCode, usageCount: 0 } });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('Taki kod już istnieje dla tego wydarzenia', 'DISCOUNT_CODE_TAKEN');
      }
      throw error;
    }
  }),
);

adminFormsRouter.patch(
  '/:id/discount-codes/:codeId',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    const body = updateDiscountCodeRequest.parse(req.body);
    const discountCode = form.discountCodes.find((c) => c.id === req.params.codeId);
    if (!discountCode) throw notFound('Nie znaleziono kodu rabatowego');

    try {
      const updated = await prisma.discountCode.update({
        where: { id: discountCode.id },
        data: {
          ...(body.code !== undefined ? { code: body.code } : {}),
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.value !== undefined ? { value: body.value } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      });
      if (changedKeys(discountCode as Record<string, unknown>, { ...body }).length > 0) {
        await audit(req, { action: 'discount_code.update', formId: form.id, entityId: discountCode.id, summary: `Zmieniono kod rabatowy ${updated.code} w „${form.title}”` });
      }
      // Zmiana wartości/kodu nie rusza już złożonych zgłoszeń — one mają własny snapshot.
      res.json({ discountCode: updated });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('Taki kod już istnieje dla tego wydarzenia', 'DISCOUNT_CODE_TAKEN');
      }
      throw error;
    }
  }),
);

adminFormsRouter.post(
  '/:id/discount-codes/:codeId/deactivate',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    const discountCode = form.discountCodes.find((c) => c.id === req.params.codeId);
    if (!discountCode) throw notFound('Nie znaleziono kodu rabatowego');
    const updated = await prisma.discountCode.update({
      where: { id: discountCode.id },
      data: { isActive: false },
    });
    res.json({ discountCode: updated });
  }),
);

/* --------------------------------- zgłoszenia ------------------------------ */

/** Odpowiedzi po edycji przez admina — ta sama logika pól warunkowych co przy rejestracji. */
function validAnswers(schema: ReturnType<typeof parseFormSchema>, answers: Record<string, unknown>) {
  const visible = pickVisibleAnswers(flattenSections(schema.sections), answers);
  return buildAnswersSchema(visible.fields).parse(visible.answers);
}

async function submissionDetail(formId: string, submissionId: string) {
  const found = await prisma.submission.findFirst({
    where: { id: submissionId, formId },
    include: {
      payments: { orderBy: { createdAt: 'desc' } },
      checkedInStation: { select: { name: true } },
    },
  });
  if (!found) throw notFound('Nie znaleziono zgłoszenia');
  // Nonce biletu i hash tokenu nie są potrzebne w panelu — nie wysyłamy ich do przeglądarki.
  const {
    ticketNonce,
    publicTokenHash: _publicTokenHash,
    emailTokenHash: _emailTokenHash,
    checkedInStation,
    ...submission
  } = found;
  return {
    ...submission,
    schemaSnapshotJson: parseFormSchema(submission.schemaSnapshotJson),
    ticketIssued: ticketNonce !== null,
    ticketReference: ticketReference(submission.id),
    checkedInStationName: checkedInStation?.name ?? null,
  };
}

const submissionFilterQuery = z.object({
  status: z.enum(['RESERVED', 'DEPOSIT_PAID', 'PAID', 'EXPIRED', 'CANCELLED']).optional(),
  q: z.string().trim().min(1).max(320).optional(),
});

const submissionQuery = submissionFilterQuery.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Warunek wyszukiwania po e-mailu, imieniu/nazwisku lub numerze biletu. Imię leży w JSON-ie
 * odpowiedzi, a numer biletu to prefiks id — dopasowujemy w pamięci i zwracamy listę id.
 */
async function submissionSearchWhere(formId: string, q: string | undefined) {
  if (!q) return { formId };
  const rows = await prisma.submission.findMany({
    where: { formId },
    select: { id: true, buyerEmail: true, schemaSnapshotJson: true, payloadJson: true },
  });
  const needle = normalizeSearchText(q);
  const referenceNeedle = q.toUpperCase();
  const ids = rows
    .filter(
      (row) =>
        normalizeSearchText(row.buyerEmail).includes(needle) ||
        normalizeSearchText(guessDisplayName(row.schemaSnapshotJson, row.payloadJson) ?? '').includes(needle) ||
        ticketReference(row.id).startsWith(referenceNeedle),
    )
    .map((row) => row.id);
  return { formId, id: { in: ids } };
}

adminFormsRouter.get(
  '/:id/submissions',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    const query = submissionQuery.parse(req.query);

    // Liczniki zakładek statusów i przychód liczymy bez filtra statusu (ale z wyszukiwaniem),
    // żeby zakładki pokazywały, ile wyników jest w każdej z nich.
    const baseWhere = await submissionSearchWhere(form.id, query.q);
    const where = { ...baseWhere, ...(query.status ? { status: query.status } : {}) };

    const [total, submissions, grouped] = await Promise.all([
      prisma.submission.count({ where }),
      prisma.submission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          buyerEmail: true,
          buyerPhone: true,
          ticketNameSnapshot: true,
          ticketPriceCents: true,
          currency: true,
          discountCodeSnapshot: true,
          discountAmountCents: true,
          depositCents: true,
          paidCents: true,
          status: true,
          reservationExpiresAt: true,
          createdAt: true,
          schemaSnapshotJson: true,
          payloadJson: true,
        },
      }),
      prisma.submission.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: { _all: true },
        _sum: { ticketPriceCents: true, paidCents: true },
      }),
    ]);

    // Przychód = faktyczne wpłaty (także zaliczki); reszta zaliczkowiczów to kwota do dopłaty.
    const statusCounts = { RESERVED: 0, DEPOSIT_PAID: 0, PAID: 0, EXPIRED: 0, CANCELLED: 0 };
    let paidRevenueCents = 0;
    let outstandingCents = 0;
    for (const row of grouped) {
      statusCounts[row.status] = row._count._all;
      paidRevenueCents += row._sum.paidCents ?? 0;
      if (row.status === 'DEPOSIT_PAID') {
        outstandingCents = (row._sum.ticketPriceCents ?? 0) - (row._sum.paidCents ?? 0);
      }
    }

    res.json({
      total,
      page: query.page,
      pageSize: query.pageSize,
      submissions: submissions.map(({ schemaSnapshotJson, payloadJson, ...row }) => ({
        ...row,
        displayName: guessDisplayName(schemaSnapshotJson, payloadJson),
      })),
      statusCounts,
      paidRevenueCents,
      outstandingCents,
    });
  }),
);

const plnCell = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

adminFormsRouter.get(
  '/:id/submissions.csv',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    // Eksport respektuje filtry z listy zgłoszeń (zakładka statusu i wyszukiwanie).
    const query = submissionFilterQuery.parse(req.query);
    const baseWhere = await submissionSearchWhere(form.id, query.q);
    const submissions = await prisma.submission.findMany({
      where: { ...baseWhere, ...(query.status ? { status: query.status } : {}) },
      orderBy: { createdAt: 'asc' },
    });

    // Kolumny budujemy z UNII snapshotów — usunięte dziś pole nadal trafia do eksportu.
    const dynamicKeys: string[] = [];
    const labels = new Map<string, string>();
    for (const submission of submissions) {
      const snapshot = parseFormSchema(submission.schemaSnapshotJson);
      for (const field of flattenSections(snapshot.sections)) {
        if (!labels.has(field.key)) {
          labels.set(field.key, field.label);
          dynamicKeys.push(field.key);
        }
      }
      for (const key of Object.keys((submission.payloadJson ?? {}) as Record<string, unknown>)) {
        if (!labels.has(key)) {
          labels.set(key, key);
          dynamicKeys.push(key);
        }
      }
    }

    // Zgody dodatkowe: kolumna na każdą zgodę, która wystąpiła w eksportowanych zgłoszeniach.
    const consentLabels = new Map<string, string>();
    for (const submission of submissions) {
      for (const consent of submission.consentsJson as unknown as ConsentRecord[]) {
        if (!consentLabels.has(consent.key)) consentLabels.set(consent.key, consent.label);
      }
    }
    const consentKeys = [...consentLabels.keys()];

    const header = [
      'id',
      'utworzono',
      'status',
      'e-mail',
      'telefon',
      'adres',
      'bilet',
      'cena_pln',
      'waluta',
      'kod_rabatowy',
      'rabat_pln',
      'zaliczka_pln',
      'wplacono_pln',
      'do_doplaty_pln',
      'regulamin_wersja',
      'polityka_wersja',
      'akceptacja_czas',
      ...dynamicKeys.map((key) => labels.get(key) ?? key),
      ...consentKeys.map((key) => `zgoda: ${consentLabels.get(key)}`),
    ];

    const rows = submissions.map((submission) => {
      const payload = (submission.payloadJson ?? {}) as Record<string, unknown>;
      return [
        submission.id,
        submission.createdAt.toISOString(),
        submission.status,
        submission.buyerEmail,
        submission.buyerPhone ?? '',
        submission.buyerAddress ?? '',
        submission.ticketNameSnapshot,
        (submission.ticketPriceCents / 100).toFixed(2).replace('.', ','),
        submission.currency,
        submission.discountCodeSnapshot ?? '',
        (submission.discountAmountCents / 100).toFixed(2).replace('.', ','),
        submission.depositCents !== null ? plnCell(submission.depositCents) : '',
        plnCell(submission.paidCents),
        submission.status === 'DEPOSIT_PAID' ? plnCell(submission.ticketPriceCents - submission.paidCents) : '',
        submission.termsVersionAccepted,
        submission.privacyPolicyVersionAccepted,
        submission.legalAcceptedAt.toISOString(),
        ...dynamicKeys.map((key) => payload[key] ?? ''),
        ...consentKeys.map((key) => {
          const consent = (submission.consentsJson as unknown as ConsentRecord[]).find((c) => c.key === key);
          return consent ? (consent.accepted ? 'tak' : 'nie') : '';
        }),
      ];
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="zgloszenia-${form.slug}.csv"`);
    res.send(toCsv([header, ...rows]));
  }),
);

adminFormsRouter.get(
  '/:id/submissions/:submissionId',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    res.json({ submission: await submissionDetail(form.id, req.params.submissionId as string) });
  }),
);

adminFormsRouter.patch(
  '/:id/submissions/:submissionId',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    const submission = await prisma.submission.findFirst({
      where: { id: req.params.submissionId as string, formId: form.id },
    });
    if (!submission) throw notFound('Nie znaleziono zgłoszenia');

    const body = updateSubmissionRequest.parse(req.body);
    const schema = parseFormSchema(submission.schemaSnapshotJson);

    const updated = await prisma.submission.update({
      where: { id: submission.id },
      data: {
        ...(body.buyerEmail !== undefined ? { buyerEmail: body.buyerEmail } : {}),
        ...(body.buyerPhone !== undefined ? { buyerPhone: body.buyerPhone } : {}),
        ...(body.buyerAddress !== undefined ? { buyerAddress: body.buyerAddress } : {}),
        // Odpowiedzi walidujemy tym samym schematem co przy rejestracji — ten sam
        // snapshot pól, który obowiązywał w momencie zgłoszenia.
        ...(body.answers !== undefined ? { payloadJson: validAnswers(schema, body.answers) as object } : {}),
      },
    });
    const changedSubmission = changedKeys(
      { buyerEmail: submission.buyerEmail, buyerPhone: submission.buyerPhone, buyerAddress: submission.buyerAddress, answers: submission.payloadJson },
      {
        ...(body.buyerEmail !== undefined ? { buyerEmail: updated.buyerEmail } : {}),
        ...(body.buyerPhone !== undefined ? { buyerPhone: updated.buyerPhone } : {}),
        ...(body.buyerAddress !== undefined ? { buyerAddress: updated.buyerAddress } : {}),
        ...(body.answers !== undefined ? { answers: updated.payloadJson } : {}),
      },
    );
    if (changedSubmission.length > 0) {
      await audit(req, {
        action: 'submission.update',
        formId: form.id,
        entityId: submission.id,
        summary: `Edytowano zgłoszenie ${ticketReference(submission.id)} (${updated.buyerEmail})`,
        details: { changed: changedSubmission },
      });
    }

    res.json({ submission: await submissionDetail(form.id, updated.id) });
  }),
);

const formatPln = (cents: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(cents / 100);

/** Dopłata przyjęta poza Paynow (gotówka, przelew) — zgłoszenie staje się opłacone i dostaje bilet. */
adminFormsRouter.post(
  '/:id/submissions/:submissionId/balance-payment',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    const submission = await prisma.submission.findFirst({
      where: { id: req.params.submissionId as string, formId: form.id },
    });
    if (!submission) throw notFound('Nie znaleziono zgłoszenia');

    const payment = await recordManualBalancePayment(submission.id);
    await audit(req, {
      action: 'submission.balance_payment',
      formId: form.id,
      entityId: submission.id,
      summary: `Odnotowano dopłatę ${formatPln(payment.amountCents)} za zgłoszenie ${ticketReference(submission.id)} (${submission.buyerEmail})`,
      details: { paymentId: payment.id, amountCents: payment.amountCents },
    });
    res.json({ submission: await submissionDetail(form.id, submission.id) });
  }),
);

/** Ponowna wysyłka e-maila z linkiem do dopłaty — poprzedni link przestaje działać. */
adminFormsRouter.post(
  '/:id/submissions/:submissionId/deposit-email',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    const submission = await prisma.submission.findFirst({
      where: { id: req.params.submissionId as string, formId: form.id },
    });
    if (!submission) throw notFound('Nie znaleziono zgłoszenia');
    if (submission.status !== 'DEPOSIT_PAID') {
      throw conflict('Link do dopłaty można wysłać tylko przy wpłaconej zaliczce', 'NOT_DEPOSIT_PAID');
    }
    if (!(await sendDepositEmail(submission.id, { resend: true }))) {
      throw conflict('Nie udało się wysłać e-maila — spróbuj ponownie', 'EMAIL_FAILED');
    }
    await audit(req, {
      action: 'submission.deposit_email',
      formId: form.id,
      entityId: submission.id,
      summary: `Wysłano ponownie link do dopłaty dla ${ticketReference(submission.id)} (${submission.buyerEmail})`,
    });
    res.json({ submission: await submissionDetail(form.id, submission.id) });
  }),
);
