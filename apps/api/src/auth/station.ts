import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../env.js';
import { unauthorized } from '../http/errors.js';
import { prisma } from '../prisma.js';
import { generateSessionToken, hashSessionToken } from './session.js';

/** Osobne cookie niż panel admina — operator skanera nie ma żadnego dostępu do panelu. */
export const STATION_COOKIE = 'syjonevent_station';
const STATION_SESSION_HOURS = 18;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      station?: { id: string; name: string; formId: string };
    }
  }
}

export function generateStationPin(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function generateStationLoginToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function stationLoginUrl(loginToken: string): string {
  return `${env().APP_BASE_URL.replace(/\/+$/, '')}/skaner/login?t=${encodeURIComponent(loginToken)}`;
}

export async function createStationSession(stationId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + STATION_SESSION_HOURS * 3600 * 1000);
  await prisma.stationSession.create({ data: { idHash: hashSessionToken(token), stationId, expiresAt } });
  return { token, expiresAt };
}

export async function revokeStationSession(token: string): Promise<void> {
  await prisma.stationSession.updateMany({
    where: { idHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Wylogowuje wszystkie telefony zalogowane na stanowisko (zmiana PIN-u, wyłączenie). */
export async function revokeAllStationSessions(stationId: string): Promise<void> {
  await prisma.stationSession.updateMany({
    where: { stationId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

const cookieOptions = () => ({
  httpOnly: true,
  secure: env().NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
});

export function setStationCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(STATION_COOKIE, token, { ...cookieOptions(), expires: expiresAt });
}

export function clearStationCookie(res: Response): void {
  res.clearCookie(STATION_COOKIE, cookieOptions());
}

export async function requireStation(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[STATION_COOKIE] as string | undefined;
    if (!token) throw unauthorized('Zaloguj stanowisko, skanując kod QR od organizatora');

    const session = await prisma.stationSession.findUnique({
      where: { idHash: hashSessionToken(token) },
      include: { station: true },
    });
    const now = new Date();
    if (!session || session.revokedAt !== null || session.expiresAt <= now || !session.station.isActive) {
      throw unauthorized('Sesja stanowiska wygasła lub została wyłączona — zaloguj się ponownie');
    }

    req.station = { id: session.station.id, name: session.station.name, formId: session.station.formId };

    if (!session.station.lastSeenAt || now.getTime() - session.station.lastSeenAt.getTime() > 60_000) {
      await prisma.scanStation.update({ where: { id: session.station.id }, data: { lastSeenAt: now } });
    }
    next();
  } catch (error) {
    next(error);
  }
}
