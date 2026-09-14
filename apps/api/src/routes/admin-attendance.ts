import bcrypt from 'bcryptjs';
import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  createStationRequest,
  MAX_STATIONS_PER_FORM,
  updateStationRequest,
  type ScanStationDto,
  type StationCredentialsDto,
} from '@syjonevent/shared';
import type { ScanStation } from '@prisma/client';
import { requireAdmin } from '../auth/middleware.js';
import {
  generateStationLoginToken,
  generateStationPin,
  revokeAllStationSessions,
  stationLoginUrl,
} from '../auth/station.js';
import { asyncHandler } from '../http/async-handler.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { prisma } from '../prisma.js';
import { checkInStats } from '../services/check-in.js';
import { guessDisplayName } from '../services/participants.js';
import { reissueTicketNonce, sendTicketEmail } from '../services/tickets.js';
import { toCsv } from '../utils/csv.js';
import { ticketReference } from '../utils/ticket-code.js';

/** Montowane pod /api/forms/:formId/attendance. */
export const adminAttendanceRouter: Router = Router({ mergeParams: true });
adminAttendanceRouter.use(requireAdmin);

const uuid = z.string().uuid();

async function getFormOr404(formId: unknown) {
  const parsed = uuid.safeParse(formId);
  if (!parsed.success) throw notFound('Nie znaleziono wydarzenia');
  const form = await prisma.form.findUnique({ where: { id: parsed.data } });
  if (!form) throw notFound('Nie znaleziono wydarzenia');
  return form;
}

async function getStationOr404(formId: string, stationId: unknown) {
  const parsed = uuid.safeParse(stationId);
  const station = parsed.success
    ? await prisma.scanStation.findFirst({ where: { id: parsed.data, formId } })
    : null;
  if (!station) throw notFound('Nie znaleziono stanowiska');
  return station;
}

function toStationDto(station: ScanStation, checkInCount: number): ScanStationDto {
  return {
    id: station.id,
    name: station.name,
    isActive: station.isActive,
    lastSeenAt: station.lastSeenAt?.toISOString() ?? null,
    checkInCount,
    loginUrl: stationLoginUrl(station.loginToken),
    createdAt: station.createdAt.toISOString(),
  };
}

const PIN_HASH_ROUNDS = 10;

/* ------------------------------ statystyki ------------------------------ */

adminAttendanceRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.formId);
    res.json(await checkInStats(form.id));
  }),
);

/* ------------------------------ stanowiska ------------------------------ */

adminAttendanceRouter.get(
  '/stations',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.formId);
    const [stations, counts] = await Promise.all([
      prisma.scanStation.findMany({ where: { formId: form.id }, orderBy: { createdAt: 'asc' } }),
      prisma.submission.groupBy({
        by: ['checkedInStationId'],
        where: { formId: form.id, checkedInStationId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const byStation = new Map(counts.map((row) => [row.checkedInStationId, row._count._all]));
    res.json({ stations: stations.map((station) => toStationDto(station, byStation.get(station.id) ?? 0)) });
  }),
);

adminAttendanceRouter.post(
  '/stations',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.formId);
    const { name } = createStationRequest.parse(req.body);
    if ((await prisma.scanStation.count({ where: { formId: form.id } })) >= MAX_STATIONS_PER_FORM) {
      throw badRequest(`Maksymalna liczba stanowisk to ${MAX_STATIONS_PER_FORM}`);
    }
    const pin = generateStationPin();
    const station = await prisma.scanStation.create({
      data: {
        formId: form.id,
        name,
        loginToken: generateStationLoginToken(),
        pinHash: await bcrypt.hash(pin, PIN_HASH_ROUNDS),
      },
    });
    const dto: StationCredentialsDto = { station: toStationDto(station, 0), pin };
    res.status(201).json(dto);
  }),
);

adminAttendanceRouter.patch(
  '/stations/:stationId',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.formId);
    const station = await getStationOr404(form.id, req.params.stationId);
    const body = updateStationRequest.parse(req.body);
    const updated = await prisma.scanStation.update({
      where: { id: station.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    if (body.isActive === false) await revokeAllStationSessions(station.id);
    const checkInCount = await prisma.submission.count({ where: { checkedInStationId: station.id } });
    res.json({ station: toStationDto(updated, checkInCount) });
  }),
);

/** Nowy PIN i nowy link logowania — wszystkie telefony zalogowane na to stanowisko zostają wylogowane. */
adminAttendanceRouter.post(
  '/stations/:stationId/reset-access',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.formId);
    const station = await getStationOr404(form.id, req.params.stationId);
    const pin = generateStationPin();
    const updated = await prisma.scanStation.update({
      where: { id: station.id },
      data: {
        loginToken: generateStationLoginToken(),
        pinHash: await bcrypt.hash(pin, PIN_HASH_ROUNDS),
        failedPinCount: 0,
        lockedUntil: null,
      },
    });
    await revokeAllStationSessions(station.id);
    const checkInCount = await prisma.submission.count({ where: { checkedInStationId: station.id } });
    const dto: StationCredentialsDto = { station: toStationDto(updated, checkInCount), pin };
    res.json(dto);
  }),
);

adminAttendanceRouter.get(
  '/stations/:stationId/login-qr.png',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.formId);
    const station = await getStationOr404(form.id, req.params.stationId);
    const png = await QRCode.toBuffer(stationLoginUrl(station.loginToken), {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 480,
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(png);
  }),
);

/* -------------------------------- bilety -------------------------------- */

adminAttendanceRouter.post(
  '/tickets/:submissionId/resend',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.formId);
    const submission = await prisma.submission.findFirst({
      where: { id: String(req.params.submissionId), formId: form.id },
    });
    if (!submission) throw notFound('Nie znaleziono zgłoszenia');
    if (submission.status !== 'PAID') throw conflict('Bilet można wysłać tylko dla opłaconego zgłoszenia', 'NOT_PAID');
    const sent = await sendTicketEmail(submission.id, { reissued: false });
    if (!sent) throw conflict('Nie udało się wysłać e-maila — sprawdź konfigurację SMTP', 'MAIL_FAILED');
    res.json({ ok: true });
  }),
);

adminAttendanceRouter.post(
  '/tickets/:submissionId/reissue',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.formId);
    const submission = await prisma.submission.findFirst({
      where: { id: String(req.params.submissionId), formId: form.id },
    });
    if (!submission) throw notFound('Nie znaleziono zgłoszenia');
    const nonce = await reissueTicketNonce(submission.id);
    if (!nonce) throw conflict('Nowy kod można wystawić tylko dla opłaconego zgłoszenia', 'NOT_PAID');
    const sent = await sendTicketEmail(submission.id, { reissued: true });
    res.json({ ok: true, emailSent: sent });
  }),
);

/**
 * Wysyła bilety QR osobom, które opłaciły udział, zanim wprowadzono bilety. Działa w tle —
 * wysyłka setek maili trwałaby dłużej niż timeout żądania.
 */
adminAttendanceRouter.post(
  '/tickets/send-missing',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.formId);
    const pending = await prisma.submission.findMany({
      where: { formId: form.id, status: 'PAID', ticketNonce: null },
      select: { id: true },
    });
    void (async () => {
      let failed = 0;
      for (const { id } of pending) {
        if (!(await sendTicketEmail(id, { reissued: false }))) failed += 1;
      }
      console.info(`[tickets] wysyłka brakujących biletów (${form.slug}): ${pending.length - failed} ok, ${failed} błędów`);
    })();
    res.status(202).json({ queued: pending.length });
  }),
);

/* -------------------------------- eksport ------------------------------- */

const csvDateTime = (date: Date | null) =>
  date ? new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Warsaw' }).format(date) : '';

adminAttendanceRouter.get(
  '/export.csv',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.formId);
    const submissions = await prisma.submission.findMany({
      where: { formId: form.id, status: 'PAID' },
      orderBy: [{ checkedInAt: 'asc' }, { createdAt: 'asc' }],
      include: { checkedInStation: { select: { name: true } } },
    });
    const rows = submissions.map((s) => [
      ticketReference(s.id),
      guessDisplayName(s.schemaSnapshotJson, s.payloadJson) ?? '',
      s.buyerEmail,
      s.buyerPhone ?? '',
      s.ticketNameSnapshot,
      s.checkedInAt ? 'obecny' : 'nieobecny',
      csvDateTime(s.checkedInAt),
      s.checkedInStation?.name ?? '',
    ]);
    const header = ['nr_biletu', 'uczestnik', 'e-mail', 'telefon', 'bilet', 'obecnosc', 'godzina_wejscia', 'stanowisko'];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="obecnosc-${form.slug}.csv"`);
    res.send(toCsv([header, ...rows]));
  }),
);

const RESULT_LABELS = { SUCCESS: 'wejście', DUPLICATE: 'duplikat', INVALID: 'nieprawidłowy kod', EXPIRED: 'kod wygasły' };

adminAttendanceRouter.get(
  '/log.csv',
  asyncHandler(async (req, res) => {
    const form = await getFormOr404(req.params.formId);
    const attempts = await prisma.checkInAttempt.findMany({
      where: { formId: form.id },
      orderBy: { createdAt: 'asc' },
      include: {
        station: { select: { name: true } },
        submission: { select: { id: true, buyerEmail: true, payloadJson: true, schemaSnapshotJson: true } },
      },
    });
    const rows = attempts.map((a) => [
      csvDateTime(a.createdAt),
      a.station.name,
      a.method === 'QR' ? 'skan QR' : 'ręcznie',
      RESULT_LABELS[a.result],
      a.reason ?? '',
      a.submission ? ticketReference(a.submission.id) : '',
      a.submission ? (guessDisplayName(a.submission.schemaSnapshotJson, a.submission.payloadJson) ?? a.submission.buyerEmail) : '',
      a.codeHash ?? '',
    ]);
    const header = ['czas', 'stanowisko', 'metoda', 'wynik', 'powod', 'nr_biletu', 'uczestnik', 'skrot_kodu'];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="skany-${form.slug}.csv"`);
    res.send(toCsv([header, ...rows]));
  }),
);
