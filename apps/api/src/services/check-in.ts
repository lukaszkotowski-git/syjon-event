import type { CheckInMethod, Prisma } from '@prisma/client';
import type {
  CheckInAttemptDto,
  CheckInParticipantDto,
  CheckInReason,
  CheckInResult,
  CheckInStatsDto,
  ScanResultDto,
  StationStatsDto,
} from '@syjonevent/shared';
import { tooManyRequests } from '../http/errors.js';
import { prisma } from '../prisma.js';
import { decodeTicketCode, hashScannedCode, ticketReference } from '../utils/ticket-code.js';
import { guessDisplayName, maskEmail, normalizeSearchText } from './participants.js';

export interface StationContext {
  id: string;
  name: string;
  formId: string;
}

/** Tyle nieprawidłowych kodów w ciągu minuty z jednego stanowiska traktujemy jako próbę zgadywania. */
const INVALID_SCANS_PER_MINUTE = 15;

const participantSelect = {
  id: true,
  formId: true,
  status: true,
  buyerEmail: true,
  payloadJson: true,
  schemaSnapshotJson: true,
  ticketNameSnapshot: true,
  ticketNonce: true,
  ticketPriceCents: true,
  paidCents: true,
  currency: true,
  checkedInAt: true,
  checkedInStation: { select: { name: true } },
} satisfies Prisma.SubmissionSelect;

type ParticipantRow = Prisma.SubmissionGetPayload<{ select: typeof participantSelect }>;

export function toParticipantDto(row: ParticipantRow): CheckInParticipantDto {
  return {
    submissionId: row.id,
    // Bez pola z imieniem pokazujemy zamaskowany e-mail — operator wejścia nie widzi pełnego adresu.
    displayName: guessDisplayName(row.schemaSnapshotJson, row.payloadJson) ?? maskEmail(row.buyerEmail),
    maskedEmail: maskEmail(row.buyerEmail),
    ticketName: row.ticketNameSnapshot,
    ticketReference: ticketReference(row.id),
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    checkedInStationName: row.checkedInStation?.name ?? null,
    balanceDueCents: row.status === 'DEPOSIT_PAID' ? Math.max(0, row.ticketPriceCents - row.paidCents) : null,
  };
}

const plnFormat = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const formatPln = (cents: number) => plnFormat.format(cents / 100);

/** Powód odmowy dla zgłoszenia, które nie jest opłacone w całości. */
const unpaidReason = (row: ParticipantRow): CheckInReason => (row.status === 'DEPOSIT_PAID' ? 'BALANCE_DUE' : 'NOT_PAID');

export async function stationStats(formId: string): Promise<StationStatsDto> {
  const [total, checkedIn] = await Promise.all([
    prisma.submission.count({ where: { formId, status: 'PAID' } }),
    prisma.submission.count({ where: { formId, status: 'PAID', checkedInAt: { not: null } } }),
  ]);
  return { total, checkedIn };
}

const timeFormat = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' });

function resultMessage(result: CheckInResult, reason: CheckInReason | null, participant: CheckInParticipantDto | null) {
  switch (result) {
    case 'SUCCESS':
      return 'Bilet ważny — wpuść uczestnika';
    case 'DUPLICATE': {
      const when = participant?.checkedInAt ? timeFormat.format(new Date(participant.checkedInAt)) : null;
      const where = participant?.checkedInStationName;
      return when ? `Pierwsze wejście o ${when}${where ? ` · ${where}` : ''}` : 'Ten bilet został już zameldowany';
    }
    case 'EXPIRED':
      if (reason === 'REISSUED') return 'Kod unieważniony — uczestnik ma nowszy kod QR w e-mailu';
      if (reason === 'BALANCE_DUE') {
        const due = participant?.balanceDueCents;
        return `Wpłacona tylko zaliczka${due ? ` — do dopłaty ${formatPln(due)}` : ''}. Skieruj do organizatora`;
      }
      return 'Bilet nieważny — zgłoszenie nie jest opłacone';
    case 'INVALID':
      if (reason === 'WRONG_EVENT') return 'Bilet na inne wydarzenie';
      if (reason === 'MALFORMED') return 'To nie jest kod biletu';
      if (reason === 'UNKNOWN_TICKET') return 'Nie znaleziono biletu';
      return 'Nieprawidłowy kod biletu';
  }
}

async function recordAttempt(
  client: Prisma.TransactionClient,
  station: StationContext,
  data: {
    method: CheckInMethod;
    result: CheckInResult;
    reason: CheckInReason | null;
    submissionId: string | null;
    codeHash: string | null;
  },
) {
  await client.checkInAttempt.create({
    data: { formId: station.formId, stationId: station.id, ...data },
  });
}

async function finish(
  station: StationContext,
  result: CheckInResult,
  reason: CheckInReason | null,
  participant: CheckInParticipantDto | null,
): Promise<ScanResultDto> {
  return {
    result,
    reason,
    message: resultMessage(result, reason, participant),
    participant,
    stats: await stationStats(station.formId),
  };
}

/**
 * Zameldowanie jednym UPDATE z warunkiem `checkedInAt IS NULL`: przy dwóch stanowiskach skanujących
 * ten sam bilet naraz Postgres zablokuje wiersz, a drugie zapytanie po odblokowaniu nie znajdzie już
 * pasującego wiersza — dostanie DUPLICATE, nigdy drugi SUCCESS.
 */
async function checkIn(
  station: StationContext,
  submissionId: string,
  method: CheckInMethod,
  codeHash: string | null,
): Promise<ScanResultDto> {
  const outcome = await prisma.$transaction(async (tx) => {
    const updated = await tx.submission.updateMany({
      where: { id: submissionId, formId: station.formId, status: 'PAID', checkedInAt: null },
      data: { checkedInAt: new Date(), checkedInStationId: station.id },
    });
    const row = await tx.submission.findUniqueOrThrow({ where: { id: submissionId }, select: participantSelect });

    let result: CheckInResult = 'SUCCESS';
    let reason: CheckInReason | null = null;
    if (updated.count === 0) {
      [result, reason] = row.status !== 'PAID' ? ['EXPIRED', unpaidReason(row)] : ['DUPLICATE', 'ALREADY_CHECKED_IN'];
    }
    await recordAttempt(tx, station, { method, result, reason, submissionId, codeHash });
    return { result, reason, row };
  });
  return finish(station, outcome.result, outcome.reason, toParticipantDto(outcome.row));
}

async function reject(
  station: StationContext,
  method: CheckInMethod,
  result: CheckInResult,
  reason: CheckInReason,
  row: ParticipantRow | null,
  codeHash: string | null,
): Promise<ScanResultDto> {
  await recordAttempt(prisma, station, { method, result, reason, submissionId: row?.id ?? null, codeHash });
  return finish(station, result, reason, row ? toParticipantDto(row) : null);
}

async function assertNotGuessing(station: StationContext): Promise<void> {
  const recentInvalid = await prisma.checkInAttempt.count({
    where: { stationId: station.id, result: 'INVALID', createdAt: { gte: new Date(Date.now() - 60_000) } },
  });
  if (recentInvalid >= INVALID_SCANS_PER_MINUTE) {
    throw tooManyRequests('Zbyt wiele nieprawidłowych kodów w krótkim czasie — odczekaj minutę');
  }
}

export async function scanTicket(station: StationContext, rawCode: string): Promise<ScanResultDto> {
  await assertNotGuessing(station);
  const codeHash = hashScannedCode(rawCode);

  const decoded = decodeTicketCode(rawCode);
  if (!decoded.ok) return reject(station, 'QR', 'INVALID', decoded.reason, null, codeHash);

  const row = await prisma.submission.findUnique({ where: { id: decoded.submissionId }, select: participantSelect });
  if (!row) return reject(station, 'QR', 'INVALID', 'UNKNOWN_TICKET', null, codeHash);
  // Danych uczestnika innego wydarzenia nie pokazujemy obsłudze tego stanowiska.
  if (row.formId !== station.formId) return reject(station, 'QR', 'INVALID', 'WRONG_EVENT', null, codeHash);
  if (row.status !== 'PAID') return reject(station, 'QR', 'EXPIRED', unpaidReason(row), row, codeHash);
  if (row.ticketNonce !== decoded.nonce) return reject(station, 'QR', 'EXPIRED', 'REISSUED', row, codeHash);

  return checkIn(station, row.id, 'QR', codeHash);
}

export async function manualCheckIn(station: StationContext, submissionId: string): Promise<ScanResultDto> {
  const row = await prisma.submission.findUnique({ where: { id: submissionId }, select: participantSelect });
  if (!row || row.formId !== station.formId) return reject(station, 'MANUAL', 'INVALID', 'UNKNOWN_TICKET', null, null);
  if (row.status !== 'PAID') return reject(station, 'MANUAL', 'EXPIRED', unpaidReason(row), row, null);
  return checkIn(station, row.id, 'MANUAL', null);
}

const normalize = normalizeSearchText;

const MAX_SEARCH_RESULTS = 20;

/**
 * Wyszukiwanie po imieniu/nazwisku, e-mailu lub numerze biletu. Imię leży w JSON-ie odpowiedzi, więc filtrujemy w pamięci.
 * Osoby z samą zaliczką też się pokazują — obsługa wejścia widzi, że muszą najpierw dopłacić.
 */
export async function searchParticipants(formId: string, query: string): Promise<CheckInParticipantDto[]> {
  const rows = await prisma.submission.findMany({
    where: { formId, status: { in: ['PAID', 'DEPOSIT_PAID'] } },
    select: participantSelect,
    orderBy: { createdAt: 'asc' },
  });
  const needle = normalize(query.trim());
  const referenceNeedle = query.trim().toUpperCase();

  return rows
    .map(toParticipantDto)
    .filter((participant, index) => {
      const email = (rows[index] as ParticipantRow).buyerEmail;
      return (
        normalize(participant.displayName).includes(needle) ||
        normalize(email).includes(needle) ||
        participant.ticketReference.startsWith(referenceNeedle)
      );
    })
    .sort((a, b) => Number(a.checkedInAt !== null) - Number(b.checkedInAt !== null))
    .slice(0, MAX_SEARCH_RESULTS);
}

export async function checkInStats(formId: string): Promise<CheckInStatsDto> {
  const paid = { formId, status: 'PAID' as const };
  const [total, checkedIn, ticketsNotIssued, byTicket, byTicketCheckedIn, byStation, stations, attempts] =
    await Promise.all([
      prisma.submission.count({ where: paid }),
      prisma.submission.count({ where: { ...paid, checkedInAt: { not: null } } }),
      prisma.submission.count({ where: { ...paid, ticketNonce: null } }),
      prisma.submission.groupBy({ by: ['ticketNameSnapshot'], where: paid, _count: { _all: true } }),
      prisma.submission.groupBy({
        by: ['ticketNameSnapshot'],
        where: { ...paid, checkedInAt: { not: null } },
        _count: { _all: true },
      }),
      prisma.submission.groupBy({
        by: ['checkedInStationId'],
        where: { ...paid, checkedInStationId: { not: null } },
        _count: { _all: true },
      }),
      prisma.scanStation.findMany({ where: { formId }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } }),
      prisma.checkInAttempt.findMany({
        where: { formId },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: {
          station: { select: { name: true } },
          submission: { select: { buyerEmail: true, payloadJson: true, schemaSnapshotJson: true, ticketNameSnapshot: true } },
        },
      }),
    ]);

  const checkedInByTicket = new Map(byTicketCheckedIn.map((row) => [row.ticketNameSnapshot, row._count._all]));
  const checkedInByStation = new Map(byStation.map((row) => [row.checkedInStationId, row._count._all]));

  return {
    total,
    checkedIn,
    remaining: total - checkedIn,
    ticketsNotIssued,
    perTicketType: byTicket
      .map((row) => ({
        ticketName: row.ticketNameSnapshot,
        total: row._count._all,
        checkedIn: checkedInByTicket.get(row.ticketNameSnapshot) ?? 0,
      }))
      .sort((a, b) => b.total - a.total),
    perStation: stations.map((station) => ({
      stationId: station.id,
      stationName: station.name,
      checkedIn: checkedInByStation.get(station.id) ?? 0,
    })),
    recentAttempts: attempts.map(
      (attempt): CheckInAttemptDto => ({
        id: attempt.id,
        createdAt: attempt.createdAt.toISOString(),
        result: attempt.result,
        reason: attempt.reason as CheckInReason | null,
        method: attempt.method,
        stationName: attempt.station.name,
        participantName: attempt.submission
          ? (guessDisplayName(attempt.submission.schemaSnapshotJson, attempt.submission.payloadJson) ??
            attempt.submission.buyerEmail)
          : null,
        ticketName: attempt.submission?.ticketNameSnapshot ?? null,
      }),
    ),
  };
}
