import { Router } from 'express';
import type { DashboardDto } from '@syjonevent/shared';
import { requireAdmin } from '../auth/middleware.js';
import { asyncHandler } from '../http/async-handler.js';
import { prisma } from '../prisma.js';
import { guessDisplayName } from '../services/participants.js';

export const adminDashboardRouter: Router = Router();
adminDashboardRouter.use(requireAdmin);

const STATUSES = ['RESERVED', 'PAID', 'EXPIRED', 'CANCELLED'] as const;

adminDashboardRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [forms, byStatus, byFormAndStatus, recent] = await Promise.all([
      prisma.form.findMany({ select: { id: true, title: true, status: true } }),
      prisma.submission.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: { ticketPriceCents: true },
      }),
      prisma.submission.groupBy({
        by: ['formId', 'status'],
        _count: { _all: true },
        _sum: { ticketPriceCents: true },
      }),
      prisma.submission.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { form: { select: { title: true } } },
      }),
    ]);

    const statusCounts = { RESERVED: 0, PAID: 0, EXPIRED: 0, CANCELLED: 0 };
    let revenueCents = 0;
    for (const row of byStatus) {
      statusCounts[row.status] = row._count._all;
      if (row.status === 'PAID') revenueCents = row._sum.ticketPriceCents ?? 0;
    }

    const events = forms
      .map((form) => {
        const rows = byFormAndStatus.filter((r) => r.formId === form.id);
        const paidRow = rows.find((r) => r.status === 'PAID');
        return {
          formId: form.id,
          title: form.title,
          status: form.status,
          submissionCount: rows.reduce((sum, r) => sum + r._count._all, 0),
          paidCount: paidRow?._count._all ?? 0,
          revenueCents: paidRow?._sum.ticketPriceCents ?? 0,
        };
      })
      .sort((a, b) => b.submissionCount - a.submissionCount);

    const dto: DashboardDto = {
      totals: {
        submissions: STATUSES.reduce((sum, s) => sum + statusCounts[s], 0),
        paid: statusCounts.PAID,
        reserved: statusCounts.RESERVED,
        expired: statusCounts.EXPIRED,
        cancelled: statusCounts.CANCELLED,
        revenueCents,
        eventsPublished: forms.filter((f) => f.status === 'PUBLISHED').length,
        eventsDraft: forms.filter((f) => f.status === 'DRAFT').length,
        eventsArchived: forms.filter((f) => f.status === 'ARCHIVED').length,
      },
      statusBreakdown: STATUSES.map((status) => ({ status, count: statusCounts[status] })),
      events,
      recentRegistrations: recent.map((submission) => ({
        id: submission.id,
        displayName: guessDisplayName(submission.schemaSnapshotJson, submission.payloadJson),
        buyerEmail: submission.buyerEmail,
        formTitle: submission.form.title,
        status: submission.status,
        createdAt: submission.createdAt.toISOString(),
      })),
    };

    res.json(dto);
  }),
);
