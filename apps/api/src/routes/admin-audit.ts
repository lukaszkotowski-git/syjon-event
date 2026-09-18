import { Router } from 'express';
import { z } from 'zod';
import type { AuditLogEntryDto } from '@syjonevent/shared';
import { requireAdmin, requireFullAdmin } from '../auth/middleware.js';
import { asyncHandler } from '../http/async-handler.js';
import { prisma } from '../prisma.js';

/** Dziennik zmian w panelu — kto, co i kiedy. Tylko dla administratorów. */
export const adminAuditRouter: Router = Router();
adminAuditRouter.use(requireAdmin, requireFullAdmin);

const auditQuery = z.object({
  formId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

adminAuditRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = auditQuery.parse(req.query);
    const where = query.formId ? { formId: query.formId } : {};
    const [total, entries] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    // Wpis zostaje po usunięciu wydarzenia — wtedy tytuł jest tylko w opisie wpisu.
    const formIds = [...new Set(entries.map((e) => e.formId).filter((id): id is string => id !== null))];
    const forms = await prisma.form.findMany({ where: { id: { in: formIds } }, select: { id: true, title: true } });
    const titles = new Map(forms.map((f) => [f.id, f.title]));

    const dto: AuditLogEntryDto[] = entries.map((entry) => ({
      id: entry.id,
      adminEmail: entry.adminEmail,
      action: entry.action,
      formId: entry.formId,
      formTitle: entry.formId ? (titles.get(entry.formId) ?? null) : null,
      entityId: entry.entityId,
      summary: entry.summary,
      createdAt: entry.createdAt.toISOString(),
    }));
    res.json({ entries: dto, total, page: query.page, pageSize: query.pageSize });
  }),
);
