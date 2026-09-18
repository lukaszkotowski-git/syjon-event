import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import {
  buildAnswersSchema,
  createFormRequest,
  discountCodeInput,
  EMPTY_FORM_SCHEMA,
  flattenSections,
  formSchemaJson,
  MAX_DISCOUNT_CODES_PER_FORM,
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
import { countOccupancy, isUniqueViolation } from '../services/capacity.js';
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
          capacityTotal: body.capacityTotal ?? null,
          termsVersion: body.termsVersion,
          privacyPolicyVersion: body.privacyPolicyVersion,
          paymentSuccessTitle: body.paymentSuccessTitle ?? null,
          paymentSuccessBody: body.paymentSuccessBody ?? null,
          paymentErrorTitle: body.paymentErrorTitle ?? null,
          paymentErrorBody: body.paymentErrorBody ?? null,
          confirmationEmailTitle: body.confirmationEmailTitle ?? null,
          confirmationEmailBody: body.confirmationEmailBody ?? null,
          schemaJson: (body.schemaJson ?? EMPTY_FORM_SCHEMA) as object,
          createdByAdminId: req.admin!.id,
        },
      });
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
          ...(body.schemaJson !== undefined ? { schemaJson: body.schemaJson as object } : {}),
        },
      });
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
    const updated = await prisma.form.update({ where: { id: form.id }, data: { status: 'PUBLISHED' } });
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
    res.json({ form: updated });
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
        capacity: body.capacity ?? null,
        sortOrder: body.sortOrder,
        isActive: body.isActive,
      },
    });
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

    const updated = await prisma.ticketType.update({
      where: { id: ticket.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.priceCents !== undefined ? { priceCents: body.priceCents } : {}),
        ...(body.capacity !== undefined ? { capacity: body.capacity ?? null } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
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
  const { ticketNonce, publicTokenHash: _publicTokenHash, checkedInStation, ...submission } = found;
  return {
    ...submission,
    schemaSnapshotJson: parseFormSchema(submission.schemaSnapshotJson),
    ticketIssued: ticketNonce !== null,
    ticketReference: ticketReference(submission.id),
    checkedInStationName: checkedInStation?.name ?? null,
  };
}

const submissionQuery = z.object({
  status: z.enum(['RESERVED', 'PAID', 'EXPIRED', 'CANCELLED']).optional(),
  email: z.string().trim().min(1).max(320).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

adminFormsRouter.get(
  '/:id/submissions',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    const query = submissionQuery.parse(req.query);

    // Liczniki zakładek statusów i przychód liczymy bez filtra statusu (ale z wyszukiwaniem),
    // żeby zakładki pokazywały, ile wyników jest w każdej z nich.
    const baseWhere = {
      formId: form.id,
      ...(query.email ? { buyerEmail: { contains: query.email.toLowerCase() } } : {}),
    };
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
          status: true,
          reservationExpiresAt: true,
          createdAt: true,
        },
      }),
      prisma.submission.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: { _all: true },
        _sum: { ticketPriceCents: true },
      }),
    ]);

    const statusCounts = { RESERVED: 0, PAID: 0, EXPIRED: 0, CANCELLED: 0 };
    let paidRevenueCents = 0;
    for (const row of grouped) {
      statusCounts[row.status] = row._count._all;
      if (row.status === 'PAID') paidRevenueCents = row._sum.ticketPriceCents ?? 0;
    }

    res.json({
      total,
      page: query.page,
      pageSize: query.pageSize,
      submissions,
      statusCounts,
      paidRevenueCents,
    });
  }),
);

adminFormsRouter.get(
  '/:id/submissions.csv',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.id as string);
    const submissions = await prisma.submission.findMany({
      where: { formId: form.id },
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
      'regulamin_wersja',
      'polityka_wersja',
      'akceptacja_czas',
      ...dynamicKeys.map((key) => labels.get(key) ?? key),
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
        submission.termsVersionAccepted,
        submission.privacyPolicyVersionAccepted,
        submission.legalAcceptedAt.toISOString(),
        ...dynamicKeys.map((key) => payload[key] ?? ''),
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
        ...(body.answers !== undefined
          ? { payloadJson: buildAnswersSchema(flattenSections(schema.sections)).parse(body.answers) as object }
          : {}),
      },
    });

    res.json({ submission: await submissionDetail(form.id, updated.id) });
  }),
);
