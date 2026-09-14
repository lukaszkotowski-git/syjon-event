import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  manualCheckInRequest,
  participantSearchQuery,
  scanRequest,
  stationLoginRequest,
  type StationLoginInfoDto,
  type StationMeDto,
} from '@syjonevent/shared';
import {
  STATION_COOKIE,
  clearStationCookie,
  createStationSession,
  requireStation,
  revokeStationSession,
  setStationCookie,
} from '../auth/station.js';
import { asyncHandler } from '../http/async-handler.js';
import { notFound, tooManyRequests, unauthorized } from '../http/errors.js';
import { prisma } from '../prisma.js';
import { manualCheckIn, scanTicket, searchParticipants, stationStats } from '../services/check-in.js';

const MAX_FAILED_PINS = 5;
const LOCK_MINUTES = 15;
const DUMMY_HASH = bcrypt.hashSync('000000-placeholder', 10);

const rateLimited = (message: string) => ({ error: { code: 'RATE_LIMITED', message } });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: rateLimited('Zbyt wiele prób logowania. Spróbuj za kilka minut.'),
});

// Liczone per stanowisko, nie per IP — kilka telefonów na jednym Wi-Fi nie blokuje się nawzajem.
const stationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `station:${req.station?.id ?? req.ip}`,
  message: rateLimited('Zbyt wiele skanów w krótkim czasie — zwolnij na chwilę.'),
});

export const scannerRouter: Router = Router();

async function findActiveStationByToken(token: string) {
  const station = await prisma.scanStation.findUnique({
    where: { loginToken: token },
    include: { form: { select: { title: true, eventDate: true, status: true } } },
  });
  return station && station.isActive && station.form.status !== 'ARCHIVED' ? station : null;
}

scannerRouter.get(
  '/login-info',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const token = typeof req.query.t === 'string' ? req.query.t : '';
    const station = token ? await findActiveStationByToken(token) : null;
    if (!station) throw notFound('Link logowania jest nieprawidłowy lub stanowisko zostało wyłączone');
    const dto: StationLoginInfoDto = { stationName: station.name, eventTitle: station.form.title };
    res.json(dto);
  }),
);

scannerRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { token, pin } = stationLoginRequest.parse(req.body);
    const station = await findActiveStationByToken(token);
    const now = new Date();

    if (station?.lockedUntil && station.lockedUntil > now) {
      const minutes = Math.ceil((station.lockedUntil.getTime() - now.getTime()) / 60_000);
      throw tooManyRequests(`Stanowisko zablokowane po błędnych PIN-ach. Spróbuj za ${minutes} min.`);
    }

    const pinOk = await bcrypt.compare(pin, station?.pinHash ?? DUMMY_HASH);
    if (!station || !pinOk) {
      if (station) {
        const failed = station.failedPinCount + 1;
        await prisma.scanStation.update({
          where: { id: station.id },
          data:
            failed >= MAX_FAILED_PINS
              ? { failedPinCount: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) }
              : { failedPinCount: failed },
        });
      }
      throw unauthorized('Nieprawidłowy PIN');
    }

    await prisma.scanStation.update({
      where: { id: station.id },
      data: { failedPinCount: 0, lockedUntil: null, lastSeenAt: now },
    });
    const session = await createStationSession(station.id);
    setStationCookie(res, session.token, session.expiresAt);
    res.json({ ok: true });
  }),
);

scannerRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[STATION_COOKIE] as string | undefined;
    if (token) await revokeStationSession(token);
    clearStationCookie(res);
    res.status(204).end();
  }),
);

scannerRouter.use(requireStation);

scannerRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const station = req.station!;
    const form = await prisma.form.findUniqueOrThrow({
      where: { id: station.formId },
      select: { id: true, title: true, eventDate: true },
    });
    const dto: StationMeDto = {
      station: { id: station.id, name: station.name },
      event: { id: form.id, title: form.title, eventDate: form.eventDate.toISOString() },
      stats: await stationStats(station.formId),
    };
    res.json(dto);
  }),
);

scannerRouter.post(
  '/scan',
  stationLimiter,
  asyncHandler(async (req, res) => {
    const { code } = scanRequest.parse(req.body);
    res.json(await scanTicket(req.station!, code));
  }),
);

scannerRouter.post(
  '/check-in',
  stationLimiter,
  asyncHandler(async (req, res) => {
    const { submissionId } = manualCheckInRequest.parse(req.body);
    res.json(await manualCheckIn(req.station!, submissionId));
  }),
);

scannerRouter.get(
  '/search',
  stationLimiter,
  asyncHandler(async (req, res) => {
    const { q } = participantSearchQuery.parse(req.query);
    res.json({ participants: await searchParticipants(req.station!.formId, q) });
  }),
);
