import type { Request } from 'express';
import { prisma } from '../prisma.js';

interface AuditEntry {
  /** Np. "form.update", "submission.update", "ticket.reissue". */
  action: string;
  summary: string;
  formId?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Zapisuje wpis w dzienniku zmian. Nigdy nie rzuca — błąd zapisu dziennika
 * nie może cofnąć operacji, którą admin właśnie wykonał.
 */
export async function audit(req: Request, entry: AuditEntry): Promise<void> {
  if (!req.admin) return;
  try {
    await prisma.auditLog.create({
      data: {
        adminId: req.admin.id,
        adminEmail: req.admin.email,
        action: entry.action,
        summary: entry.summary,
        formId: entry.formId ?? null,
        entityId: entry.entityId ?? null,
        detailsJson: (entry.details as object | undefined) ?? undefined,
      },
    });
  } catch (error) {
    console.error(`[audit] nie udało się zapisać wpisu ${entry.action}:`, error);
  }
}

/** Nazwy zmienionych pól — do czytelnego opisu wpisu ("zmieniono: tytuł, datę"). */
export function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}
