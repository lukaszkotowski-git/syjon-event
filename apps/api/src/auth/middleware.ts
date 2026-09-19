import type { NextFunction, Request, Response } from 'express';
import type { AdminRole } from '@prisma/client';
import { hasFullAccess } from '@syjonevent/shared';
import { forbidden, unauthorized } from '../http/errors.js';
import { prisma } from '../prisma.js';
import { SESSION_COOKIE, hashSessionToken } from './session.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: { id: string; email: string; role: AdminRole };
      sessionToken?: string;
    }
  }
}

export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) throw unauthorized();

    const session = await prisma.session.findUnique({
      where: { idHash: hashSessionToken(token) },
      include: { admin: true },
    });

    const now = new Date();
    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt <= now ||
      session.admin.disabledAt !== null
    ) {
      throw unauthorized('Sesja wygasła lub jest nieaktywna');
    }

    req.admin = { id: session.admin.id, email: session.admin.email, role: session.admin.role };
    req.sessionToken = token;

    // Odświeżamy last_seen_at maksymalnie raz na minutę, żeby nie zapisywać przy każdym requeście.
    if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
      await prisma.session.update({ where: { idHash: session.idHash }, data: { lastSeenAt: now } });
    }

    // Konto "tylko podgląd" może czytać wszystko (także eksporty), ale niczego nie zmienia.
    if (session.admin.role === 'VIEWER' && !READ_METHODS.has(req.method)) {
      throw forbidden('Twoje konto ma dostęp tylko do podglądu');
    }

    next();
  } catch (error) {
    next(error);
  }
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Operacje zarezerwowane dla konta super administratora (np. usuwanie kont). */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  next(req.admin?.role === 'SUPER_ADMIN' ? undefined : forbidden('Tę operację może wykonać tylko super administrator'));
}

/** Dostęp tylko dla pełnych administratorów — np. zarządzanie kontami i dziennik zmian. */
export function requireFullAdmin(req: Request, _res: Response, next: NextFunction) {
  next(req.admin && hasFullAccess(req.admin.role) ? undefined : forbidden('Ta sekcja jest dostępna tylko dla administratorów'));
}
