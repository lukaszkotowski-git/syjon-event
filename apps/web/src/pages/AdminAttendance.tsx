import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CircleCheck,
  Copy,
  Download,
  KeyRound,
  LoaderCircle,
  Plus,
  QrCode,
  RefreshCw,
  ScanLine,
  Send,
  ShieldX,
  Smartphone,
  TimerOff,
  TriangleAlert,
  UserRoundCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type {
  CheckInAttemptDto,
  CheckInResult,
  CheckInStatsDto,
  ScanStationDto,
  StationCredentialsDto,
} from '@syjonevent/shared';
import { api, ApiError } from '../lib/api';
import { plural } from '../lib/format';
import { useConfirm } from '../components/ui/ConfirmDialog';
import Drawer from '../components/ui/Drawer';
import IconButton from '../components/ui/IconButton';
import StatusBadge from '../components/ui/StatusBadge';
import Switch from '../components/ui/Switch';
import { useToast } from '../components/ui/Toast';

const POLL_MS = 5000;

const RESULT_META: Record<CheckInResult, { label: string; icon: LucideIcon; className: string }> = {
  SUCCESS: { label: 'Wejście', icon: CircleCheck, className: 'bg-emerald-100 text-emerald-700' },
  DUPLICATE: { label: 'Duplikat', icon: TriangleAlert, className: 'bg-amber-100 text-amber-800' },
  INVALID: { label: 'Nieprawidłowy', icon: ShieldX, className: 'bg-red-100 text-red-700' },
  EXPIRED: { label: 'Wygasły', icon: TimerOff, className: 'bg-orange-100 text-orange-800' },
};

const REASON_LABELS: Record<string, string> = {
  MALFORMED: 'to nie kod biletu',
  BAD_SIGNATURE: 'podrobiony kod',
  UNKNOWN_TICKET: 'nieznany bilet',
  WRONG_EVENT: 'inne wydarzenie',
  REISSUED: 'wystawiono nowy kod',
  NOT_PAID: 'zgłoszenie nieopłacone',
};

const time = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function relativeTime(iso: string | null): string {
  if (!iso) return 'jeszcze nie logowane';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 2) return 'aktywne teraz';
  if (minutes < 60) return `aktywne ${minutes} min temu`;
  return `ostatnio ${new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))}`;
}

function AttemptRow({ attempt }: { attempt: CheckInAttemptDto }) {
  const meta = RESULT_META[attempt.result];
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-slate-500">
        {time.format(new Date(attempt.createdAt))}
      </span>
      <StatusBadge meta={meta} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">
          {attempt.participantName ?? (attempt.reason ? REASON_LABELS[attempt.reason] ?? attempt.reason : '—')}
        </p>
        <p className="truncate text-xs text-slate-500">
          {attempt.stationName}
          {attempt.method === 'MANUAL' ? ' · ręcznie' : ''}
          {attempt.ticketName ? ` · ${attempt.ticketName}` : ''}
          {attempt.participantName && attempt.reason && attempt.result !== 'DUPLICATE'
            ? ` · ${REASON_LABELS[attempt.reason] ?? attempt.reason}`
            : ''}
        </p>
      </div>
    </li>
  );
}

export default function AdminAttendance() {
  const { id } = useParams();
  const toast = useToast();
  const confirm = useConfirm();
  const [formTitle, setFormTitle] = useState<string | null>(null);
  const [stats, setStats] = useState<CheckInStatsDto | null>(null);
  const [stations, setStations] = useState<ScanStationDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newStationName, setNewStationName] = useState('');
  const [creating, setCreating] = useState(false);
  const [access, setAccess] = useState<{ station: ScanStationDto; pin: string | null } | null>(null);
  const [sendingTickets, setSendingTickets] = useState(false);

  const base = `/api/forms/${id}/attendance`;

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.get<CheckInStatsDto>(`${base}/stats`));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'Brak połączenia z serwerem');
    }
  }, [base]);

  const loadStations = useCallback(async () => {
    const data = await api.get<{ stations: ScanStationDto[] }>(`${base}/stations`);
    setStations(data.stations);
  }, [base]);

  useEffect(() => {
    api
      .get<{ form: { title: string } }>(`/api/forms/${id}`)
      .then((data) => setFormTitle(data.form.title))
      .catch(() => setFormTitle(null));
    void loadStations().catch(() => undefined);
    void loadStats();
    // Panel "na żywo": statystyki i historia odświeżają się same, stanowiska rzadziej (ostatnia aktywność).
    const statsTimer = window.setInterval(() => void loadStats(), POLL_MS);
    const stationsTimer = window.setInterval(() => void loadStations().catch(() => undefined), 30_000);
    return () => {
      window.clearInterval(statsTimer);
      window.clearInterval(stationsTimer);
    };
  }, [id, loadStats, loadStations]);

  async function createStation(event: FormEvent) {
    event.preventDefault();
    if (!newStationName.trim()) return;
    setCreating(true);
    try {
      const data = await api.post<StationCredentialsDto>(`${base}/stations`, { name: newStationName.trim() });
      setNewStationName('');
      setAccess({ station: data.station, pin: data.pin });
      await loadStations();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się dodać stanowiska');
    } finally {
      setCreating(false);
    }
  }

  async function toggleStation(station: ScanStationDto, isActive: boolean) {
    if (!isActive) {
      const ok = await confirm({
        title: `Wyłączyć „${station.name}”?`,
        description: 'Telefony zalogowane na to stanowisko zostaną wylogowane i nie zameldują już nikogo.',
        confirmLabel: 'Wyłącz',
        tone: 'danger',
      });
      if (!ok) return;
    }
    try {
      await api.patch(`${base}/stations/${station.id}`, { isActive });
      await loadStations();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się zmienić stanowiska');
    }
  }

  async function resetAccess(station: ScanStationDto) {
    const ok = await confirm({
      title: 'Wygenerować nowy PIN i kod QR?',
      description: 'Stary kod i PIN przestaną działać, a telefony zalogowane na to stanowisko zostaną wylogowane.',
      confirmLabel: 'Wygeneruj',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const data = await api.post<StationCredentialsDto>(`${base}/stations/${station.id}/reset-access`);
      setAccess({ station: data.station, pin: data.pin });
      await loadStations();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się wygenerować dostępu');
    }
  }

  async function sendMissingTickets() {
    if (!stats) return;
    const ok = await confirm({
      title: `Wysłać bilety QR (${stats.ticketsNotIssued})?`,
      description: 'E-mail z kodem QR dostaną osoby, które opłaciły udział, zanim wprowadzono bilety QR.',
      confirmLabel: 'Wyślij',
    });
    if (!ok) return;
    setSendingTickets(true);
    try {
      const data = await api.post<{ queued: number }>(`${base}/tickets/send-missing`);
      toast.success(`Wysyłka ${plural(data.queued, 'biletu', 'biletów', 'biletów')} rozpoczęta`);
      window.setTimeout(() => void loadStats(), 3000);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się rozpocząć wysyłki');
    } finally {
      setSendingTickets(false);
    }
  }

  async function copyLoginUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Skopiowano link logowania');
    } catch {
      toast.error('Nie udało się skopiować');
    }
  }

  const progress = stats && stats.total > 0 ? Math.round((stats.checkedIn / stats.total) * 100) : 0;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link
            to="/admin"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Wydarzenia
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Obecność</h1>
          <p className="text-sm text-slate-500">{formTitle ?? '…'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href={`${base}/export.csv`}>
            <Download className="h-4 w-4" aria-hidden />
            Lista obecności
          </a>
          <a className="btn-secondary" href={`${base}/log.csv`}>
            <Download className="h-4 w-4" aria-hidden />
            Historia skanów
          </a>
        </div>
      </div>

      {loadError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-medium text-slate-500">
              <UserRoundCheck className="h-4 w-4 text-emerald-600" aria-hidden />
              Weszło
            </p>
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden />
              na żywo
            </span>
          </div>
          <p className="mt-2 font-display text-5xl font-bold tabular-nums text-slate-900">
            {stats?.checkedIn ?? '–'}
            <span className="text-2xl font-semibold text-slate-400"> / {stats?.total ?? '–'}</span>
          </p>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${progress}% uczestników weszło`}>
            <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
            <span>{progress}%</span>
            <span>Pozostało: <strong className="text-slate-900">{stats?.remaining ?? '–'}</strong></span>
          </div>

          {stats && stats.perTicketType.length > 0 && (
            <ul className="mt-5 space-y-3 border-t border-slate-100 pt-4">
              {stats.perTicketType.map((row) => (
                <li key={row.ticketName}>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-700">{row.ticketName}</span>
                    <span className="tabular-nums text-slate-500">
                      {row.checkedIn} / {row.total}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${row.total ? (row.checkedIn / row.total) * 100 : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          <div className="card">
            <p className="flex items-center gap-2 text-sm font-medium text-slate-500">
              <ScanLine className="h-4 w-4 text-brand-600" aria-hidden />
              Wejścia wg stanowisk
            </p>
            {stats?.perStation.length ? (
              <ul className="mt-3 space-y-2">
                {stats.perStation.map((row) => (
                  <li key={row.stationId} className="flex justify-between text-sm">
                    <span className="truncate text-slate-700">{row.stationName}</span>
                    <span className="font-semibold tabular-nums text-slate-900">{row.checkedIn}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Dodaj stanowisko poniżej, aby zacząć skanować.</p>
            )}
          </div>

          {stats && stats.ticketsNotIssued > 0 && (
            <div className="card border-amber-200 bg-amber-50">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
                <QrCode className="h-4 w-4" aria-hidden />
                {plural(stats.ticketsNotIssued, 'osoba bez biletu QR', 'osoby bez biletu QR', 'osób bez biletu QR')}
              </p>
              <p className="mt-1 text-xs text-amber-800">Opłacili udział, zanim wprowadzono bilety QR.</p>
              <button
                type="button"
                className="btn-secondary mt-3 w-full"
                disabled={sendingTickets}
                onClick={() => void sendMissingTickets()}
              >
                <Send className="h-4 w-4" aria-hidden />
                Wyślij bilety e-mailem
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <Users className="h-4 w-4 text-brand-600" aria-hidden />
            Ostatnie skany
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">Wszystkie próby, także odrzucone — pomagają wyjaśnić sporne sytuacje.</p>
          {stats?.recentAttempts.length ? (
            <ul className="mt-2 divide-y divide-slate-100">
              {stats.recentAttempts.map((attempt) => (
                <AttemptRow key={attempt.id} attempt={attempt} />
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-500">Jeszcze nikt nie został zeskanowany.</p>
          )}
        </div>

        <div className="card">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <Smartphone className="h-4 w-4 text-brand-600" aria-hidden />
            Stanowiska skanujące
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Każdy telefon na wejściu loguje się kodem QR stanowiska i PIN-em. Operator ma dostęp tylko do skanera.
          </p>

          <form onSubmit={(e) => void createStation(e)} className="mt-4 flex gap-2">
            <input
              className="input"
              placeholder="np. Wejście główne"
              maxLength={60}
              value={newStationName}
              onChange={(e) => setNewStationName(e.target.value)}
            />
            <button type="submit" className="btn-primary shrink-0" disabled={creating || !newStationName.trim()}>
              {creating ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
              Dodaj
            </button>
          </form>

          {stations === null ? (
            <p className="mt-4 text-sm text-slate-500">Ładowanie…</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {stations.map((station) => (
                <li
                  key={station.id}
                  className={`flex items-center gap-3 rounded-xl border p-3 ${
                    station.isActive ? 'border-slate-200' : 'border-dashed border-slate-300 bg-slate-50'
                  }`}
                >
                  <Switch
                    size="sm"
                    hideLabel
                    label={station.isActive ? `Wyłącz ${station.name}` : `Włącz ${station.name}`}
                    checked={station.isActive}
                    onChange={(value) => void toggleStation(station, value)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{station.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {station.isActive ? relativeTime(station.lastSeenAt) : 'wyłączone'} ·{' '}
                      {plural(station.checkInCount, 'wejście', 'wejścia', 'wejść')}
                    </p>
                  </div>
                  <IconButton
                    icon={QrCode}
                    label="Pokaż kod QR logowania"
                    disabled={!station.isActive}
                    onClick={() => setAccess({ station, pin: null })}
                  />
                  <IconButton icon={KeyRound} label="Nowy PIN i kod QR" onClick={() => void resetAccess(station)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Drawer
        open={access !== null}
        onClose={() => setAccess(null)}
        title={access?.station.name ?? ''}
        subtitle="Logowanie stanowiska"
      >
        {access && (
          <div className="space-y-5">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
              <li>Operator otwiera aparat w telefonie i skanuje kod poniżej.</li>
              <li>Na stronie, która się otworzy, wpisuje PIN.</li>
            </ol>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <img
                src={`${base}/stations/${access.station.id}/login-qr.png?v=${encodeURIComponent(access.station.loginUrl)}`}
                alt={`Kod QR logowania stanowiska ${access.station.name}`}
                className="mx-auto aspect-square w-full max-w-[16rem]"
              />
            </div>
            {access.pin ? (
              <div className="rounded-2xl bg-brand-50 p-4 text-center">
                <p className="text-xs font-medium uppercase tracking-wide text-brand-700">PIN stanowiska</p>
                <p className="mt-1 font-mono text-4xl font-bold tracking-[0.3em] text-brand-900">{access.pin}</p>
                <p className="mt-2 text-xs text-brand-800">
                  Zapisz go teraz — ze względów bezpieczeństwa nie pokażemy go ponownie. W razie potrzeby wygeneruj nowy.
                </p>
              </div>
            ) : (
              <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                PIN był widoczny tylko przy utworzeniu stanowiska. Jeśli go nie masz, wygeneruj nowy.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => void copyLoginUrl(access.station.loginUrl)}>
                <Copy className="h-4 w-4" aria-hidden />
                Kopiuj link
              </button>
              {!access.pin && (
                <button type="button" className="btn-secondary" onClick={() => void resetAccess(access.station)}>
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  Nowy PIN
                </button>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </section>
  );
}
