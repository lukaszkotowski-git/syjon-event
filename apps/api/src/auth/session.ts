import crypto from 'node:crypto';
import type { Response } from 'express';
import { env } from '../env.js';
import { prisma } from '../prisma.js';

export const SESSION_COOKIE = 'syjonevent_session';

/** Token trafia wyłącznie do cookie. W bazie leży jego HMAC — wyciek bazy nie daje sesji. */
export function hashSessionToken(token: string): string {
  return crypto.createHmac('sha256', env().SESSION_SECRET).update(token).digest('hex');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export async function createSession(adminId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_HOURS * 3600 * 1000);
  await prisma.session.create({
    data: { idHash: hashSessionToken(token), adminId, expiresAt },
  });
  return { token, expiresAt };
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { idHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}
