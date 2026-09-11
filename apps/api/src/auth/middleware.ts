import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../http/errors.js';
import { prisma } from '../prisma.js';
import { SESSION_COOKIE, hashSessionToken } from './session.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: { id: string; email: string };
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

    req.admin = { id: session.admin.id, email: session.admin.email };
    req.sessionToken = token;

    // Odświeżamy last_seen_at maksymalnie raz na minutę, żeby nie zapisywać przy każdym requeście.
    if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
      await prisma.session.update({ where: { idHash: session.idHash }, data: { lastSeenAt: now } });
    }

    next();
  } catch (error) {
    next(error);
  }
}
