import { Router } from 'express';
import { z } from 'zod';
import { renderTemplate, sendMessageRequest, type FormMessageDto, type MessageAudience } from '@syjonevent/shared';
import type { Form, Prisma } from '@prisma/client';
import { requireAdmin } from '../auth/middleware.js';
import { asyncHandler } from '../http/async-handler.js';
import { badRequest, notFound } from '../http/errors.js';
import { prisma } from '../prisma.js';
import { audit } from '../services/audit.js';
import { emailTemplateValues } from '../services/email-variables.js';
import { buildParticipantMessageEmail, sendMail } from '../services/mailer.js';

/** Montowane pod /api/forms/:formId/messages — wiadomości organizatora do uczestników. */
export const adminMessagesRouter: Router = Router({ mergeParams: true });
adminMessagesRouter.use(requireAdmin);

async function getFormOr404(formId: unknown) {
  const parsed = z.string().uuid().safeParse(formId);
  const form = parsed.success ? await prisma.form.findUnique({ where: { id: parsed.data } }) : null;
  if (!form) throw notFound('Nie znaleziono wydarzenia');
  return form;
}

/** Odbiorcy: opłaceni, osoby z samą zaliczką i/lub z ważną rezerwacją, opcjonalnie tylko wybrane bilety. */
function recipientsWhere(formId: string, audience: MessageAudience, now = new Date()): Prisma.SubmissionWhereInput {
  const statusFilters: Prisma.SubmissionWhereInput[] = [];
  if (audience.statuses.includes('PAID')) statusFilters.push({ status: 'PAID' });
  if (audience.statuses.includes('DEPOSIT_PAID')) statusFilters.push({ status: 'DEPOSIT_PAID' });
  if (audience.statuses.includes('RESERVED')) {
    statusFilters.push({ status: 'RESERVED', reservationExpiresAt: { gt: now } });
  }
  return {
    formId,
    OR: statusFilters,
    ...(audience.ticketTypeIds.length > 0 ? { ticketTypeId: { in: audience.ticketTypeIds } } : {}),
  };
}

const audienceQuery = z.object({
  statuses: z
    .string()
    .default('PAID')
    .transform((v) => v.split(',').filter(Boolean)),
  ticketTypeIds: z
    .string()
    .default('')
    .transform((v) => v.split(',').filter(Boolean)),
});

adminMessagesRouter.get(
  '/recipients',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.formId);
    const raw = audienceQuery.parse(req.query);
    const audience = sendMessageRequest.shape.audience.safeParse(raw);
    if (!audience.success) {
      res.json({ recipientCount: 0 });
      return;
    }
    res.json({ recipientCount: await prisma.submission.count({ where: recipientsWhere(form.id, audience.data) }) });
  }),
);

adminMessagesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.formId);
    const messages = await prisma.formMessage.findMany({
      where: { formId: form.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { admin: { select: { email: true } } },
    });
    const dto: FormMessageDto[] = messages.map((message) => ({
      id: message.id,
      subject: message.subject,
      body: message.body,
      adminEmail: message.admin?.email ?? null,
      recipientCount: message.recipientCount,
      sentCount: message.sentCount,
      failedCount: message.failedCount,
      finished: message.finishedAt !== null,
      createdAt: message.createdAt.toISOString(),
    }));
    res.json({ messages: dto });
  }),
);

/** Wysyłka po kolei w tle — setki maili trwałyby dłużej niż timeout żądania. */
async function deliver(messageId: string, form: Form, subject: string, body: string, where: Prisma.SubmissionWhereInput) {
  const recipients = await prisma.submission.findMany({ where, orderBy: { createdAt: 'asc' } });
  let sent = 0;
  let failed = 0;
  for (const [index, submission] of recipients.entries()) {
    const values = emailTemplateValues(submission, form);
    const email = buildParticipantMessageEmail({
      subject: renderTemplate(subject, values),
      body: renderTemplate(body, values),
      formTitle: form.title,
      formSlug: form.slug,
      eventDate: form.eventDate,
      location: form.location,
    });
    if (await sendMail(submission.buyerEmail, email.subject, email.html, email.text)) sent += 1;
    else failed += 1;
    // Postęp zapisujemy co 10 maili — panel pokazuje go na liście wysłanych wiadomości.
    if (index % 10 === 9) {
      await prisma.formMessage.update({ where: { id: messageId }, data: { sentCount: sent, failedCount: failed } });
    }
  }
  await prisma.formMessage.update({
    where: { id: messageId },
    data: { sentCount: sent, failedCount: failed, finishedAt: new Date() },
  });
  console.info(`[messages] ${form.slug}: wysłano ${sent}, błędów ${failed}`);
}

adminMessagesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.formId);
    const body = sendMessageRequest.parse(req.body);
    const where = recipientsWhere(form.id, body.audience);
    const recipientCount = await prisma.submission.count({ where });
    if (recipientCount === 0) throw badRequest('Brak odbiorców dla wybranych filtrów');

    const message = await prisma.formMessage.create({
      data: {
        formId: form.id,
        adminId: req.admin!.id,
        subject: body.subject,
        body: body.body,
        audienceJson: body.audience,
        recipientCount,
      },
    });
    await audit(req, {
      action: 'message.send',
      formId: form.id,
      entityId: message.id,
      summary: `Wysłano wiadomość „${body.subject}” do ${recipientCount} odbiorców`,
    });

    void deliver(message.id, form, body.subject, body.body, where).catch((error: unknown) => {
      console.error(`[messages] wysyłka ${message.id} przerwana:`, error);
    });
    res.status(202).json({ messageId: message.id, recipientCount });
  }),
);
