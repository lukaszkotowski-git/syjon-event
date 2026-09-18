import { Router } from 'express';
import { z } from 'zod';
import {
  flattenSections,
  type ConsentRecord,
  type EventReportDto,
  type ReportAnswerSummaryDto,
} from '@syjonevent/shared';
import { requireAdmin } from '../auth/middleware.js';
import { asyncHandler } from '../http/async-handler.js';
import { notFound } from '../http/errors.js';
import { prisma } from '../prisma.js';
import { guessDisplayName } from '../services/participants.js';
import { parseFormSchema } from '../services/registration.js';
import { ticketReference } from '../utils/ticket-code.js';

/** Montowane pod /api/forms/:formId/report — dane do raportów drukowanych w panelu. */
export const adminReportsRouter: Router = Router({ mergeParams: true });
adminReportsRouter.use(requireAdmin);

const collator = new Intl.Collator('pl', { sensitivity: 'base' });

adminReportsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = z.string().uuid().safeParse(req.params.formId);
    const form = parsed.success ? await prisma.form.findUnique({ where: { id: parsed.data } }) : null;
    if (!form) throw notFound('Nie znaleziono wydarzenia');

    // Raporty dotyczą osób, które mają bilet — rezerwacje bez płatności pomijamy.
    const submissions = await prisma.submission.findMany({
      where: { formId: form.id, status: 'PAID' },
      orderBy: { createdAt: 'asc' },
    });

    const participants = submissions
      .map((s) => ({
        submissionId: s.id,
        displayName: guessDisplayName(s.schemaSnapshotJson, s.payloadJson),
        email: s.buyerEmail,
        phone: s.buyerPhone,
        ticketName: s.ticketNameSnapshot,
        ticketReference: ticketReference(s.id),
        checkedInAt: s.checkedInAt?.toISOString() ?? null,
      }))
      .sort((a, b) => collator.compare(a.displayName ?? a.email, b.displayName ?? b.email));

    // Zestawienia liczymy dla pól z aktualnego formularza, które mają skończoną listę odpowiedzi.
    const schema = parseFormSchema(form.schemaJson);
    const answerSummaries: ReportAnswerSummaryDto[] = [];
    for (const field of flattenSections(schema.sections)) {
      if (field.type !== 'select' && field.type !== 'checkbox') continue;
      const options = field.type === 'select' ? field.options : ['Tak', 'Nie'];
      const counts = new Map<string, number>(options.map((option) => [option, 0]));
      let answered = 0;
      for (const s of submissions) {
        const payload = (s.payloadJson ?? {}) as Record<string, unknown>;
        if (!(field.key in payload)) continue;
        const value = payload[field.key];
        const option = field.type === 'checkbox' ? (value === true ? 'Tak' : 'Nie') : String(value);
        answered += 1;
        counts.set(option, (counts.get(option) ?? 0) + 1);
      }
      answerSummaries.push({
        key: field.key,
        label: field.label,
        type: field.type,
        answered,
        counts: [...counts.entries()].map(([option, count]) => ({ option, count })),
      });
    }

    const consentSummaries = schema.consents.map((definition) => {
      let accepted = 0;
      let total = 0;
      for (const s of submissions) {
        const consent = (s.consentsJson as unknown as ConsentRecord[]).find((c) => c.key === definition.key);
        if (!consent) continue;
        total += 1;
        if (consent.accepted) accepted += 1;
      }
      return { key: definition.key, label: definition.label, accepted, total };
    });

    const dto: EventReportDto = {
      form: { id: form.id, title: form.title, eventDate: form.eventDate.toISOString(), location: form.location },
      generatedAt: new Date().toISOString(),
      participants,
      answerSummaries,
      consentSummaries,
    };
    res.json(dto);
  }),
);
