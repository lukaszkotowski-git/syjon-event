import { z } from 'zod';

export const CHECK_IN_RESULTS = ['SUCCESS', 'DUPLICATE', 'INVALID', 'EXPIRED'] as const;
export type CheckInResult = (typeof CHECK_IN_RESULTS)[number];
export type CheckInMethod = 'QR' | 'MANUAL';

/** Szczegół wyniku skanu — trafia do audytu i pozwala operatorowi zrozumieć odmowę. */
export type CheckInReason =
  | 'MALFORMED'
  | 'BAD_SIGNATURE'
  | 'UNKNOWN_TICKET'
  | 'WRONG_EVENT'
  | 'REISSUED'
  | 'NOT_PAID'
  | 'ALREADY_CHECKED_IN';

export const STATION_PIN_LENGTH = 6;
export const MAX_STATIONS_PER_FORM = 30;

export const createStationRequest = z.object({
  name: z.string().trim().min(1, 'Podaj nazwę stanowiska').max(60),
});

export const updateStationRequest = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  isActive: z.boolean().optional(),
});

export const stationLoginRequest = z.object({
  token: z.string().trim().min(10).max(100),
  pin: z.string().regex(/^\d{6}$/, 'PIN ma 6 cyfr'),
});

export const scanRequest = z.object({
  code: z.string().min(1).max(500),
});

export const manualCheckInRequest = z.object({
  submissionId: z.string().uuid(),
});

export const participantSearchQuery = z.object({
  q: z.string().trim().min(2, 'Wpisz co najmniej 2 znaki').max(100),
});

export interface CheckInParticipantDto {
  submissionId: string;
  displayName: string;
  /** E-mail częściowo zamaskowany — wystarcza do rozróżnienia osób, nie ujawnia adresu obsłudze. */
  maskedEmail: string;
  ticketName: string;
  ticketReference: string;
  checkedInAt: string | null;
  checkedInStationName: string | null;
}

export interface ScanResultDto {
  result: CheckInResult;
  reason: CheckInReason | null;
  message: string;
  participant: CheckInParticipantDto | null;
  stats: StationStatsDto;
}

export interface StationStatsDto {
  checkedIn: number;
  total: number;
}

export interface StationMeDto {
  station: { id: string; name: string };
  event: { id: string; title: string; eventDate: string };
  stats: StationStatsDto;
}

export interface StationLoginInfoDto {
  stationName: string;
  eventTitle: string;
}

export interface ScanStationDto {
  id: string;
  name: string;
  isActive: boolean;
  lastSeenAt: string | null;
  checkInCount: number;
  loginUrl: string;
  createdAt: string;
}

/** Zwracane tylko przy tworzeniu stanowiska i zmianie PIN-u — PIN nie jest nigdzie zapisany jawnie. */
export interface StationCredentialsDto {
  station: ScanStationDto;
  pin: string;
}

export interface CheckInAttemptDto {
  id: string;
  createdAt: string;
  result: CheckInResult;
  reason: CheckInReason | null;
  method: CheckInMethod;
  stationName: string;
  participantName: string | null;
  ticketName: string | null;
}

export interface CheckInStatsDto {
  total: number;
  checkedIn: number;
  remaining: number;
  ticketsNotIssued: number;
  perTicketType: { ticketName: string; total: number; checkedIn: number }[];
  perStation: { stationId: string; stationName: string; checkedIn: number }[];
  recentAttempts: CheckInAttemptDto[];
}
