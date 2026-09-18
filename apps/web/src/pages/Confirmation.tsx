import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  CalendarDays,
  CalendarPlus,
  CircleCheck,
  CircleX,
  Clock,
  Copy,
  Download,
  Hourglass,
  MailCheck,
  QrCode,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { SubmissionStatusDto } from '@syjonevent/shared';
import { api, ApiError, formatPln } from '../lib/api';
import { paymentStatusLabel } from '../lib/status';
import { useToast } from '../components/ui/Toast';

const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 15;

const eventDateFormat = new Intl.DateTimeFormat('pl-PL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Znacznik czasu iCalendar (UTC), np. 20261231T190000Z. */
function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Dzień w formacie iCalendar (lokalnie), np. 20261231 — wydarzenia mają samą datę, bez godziny. */
function icsDay(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function icsEscape(text: string): string {
  return text.replace(/[\\;,]/g, (ch) => `\\${ch}`).replace(/\n/g, '\\n');
}

/** Plik .ics z wydarzeniem — otwiera się w kalendarzu telefonu, Google i Outlooku. */
function downloadCalendarFile(status: SubmissionStatusDto, pageUrl: string) {
  const start = new Date(status.eventDate);
  const nextDay = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Syjon Event//PL',
    'BEGIN:VEVENT',
    `UID:${status.submissionId}@syjonevent`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART;VALUE=DATE:${icsDay(start)}`,
    `DTEND;VALUE=DATE:${icsDay(nextDay)}`,
    `SUMMARY:${icsEscape(status.formTitle)}`,
    `DESCRIPTION:${icsEscape(`Bilet: ${status.ticketName}\nStatus zgłoszenia i kod QR: ${pageUrl}`)}`,
    `URL:${pageUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${status.formSlug}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Wiersz podsumowania: etykieta po lewej, wartość po prawej — długie wartości (e-mail) się łamią. */
function SummaryRow({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-brand-700/80">{label}</span>
      <span className="min-w-0 break-words text-right [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

type Tone = 'success' | 'error' | 'warning' | 'pending' | 'neutral';

function StatusIcon({ tone, icon: Icon }: { tone: Tone; icon: LucideIcon }) {
  const toneClasses: Record<Tone, string> = {
    success: 'bg-brand-100 text-brand-700',
    error: 'bg-red-100 text-red-600',
    warning: 'bg-amber-100 text-amber-700',
    pending: 'bg-brand-50 text-brand-600',
    neutral: 'bg-slate-100 text-slate-600',
  };
  return (
    <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${toneClasses[tone]}`}>
      <Icon className="h-8 w-8" aria-hidden />
    </div>
  );
}

/** Odliczanie do końca rezerwacji; po dojściu do zera wywołuje `onExpire` (odświeżenie statusu). */
function ReservationCountdown({ expiresAt, onExpire }: { expiresAt: string; onExpire: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const expiredRef = useRef(false);
  const remainingMs = new Date(expiresAt).getTime() - now;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (remainingMs <= 0 && !expiredRef.current) {
      expiredRef.current = true;
      onExpire();
    }
  }, [remainingMs, onExpire]);

  if (remainingMs <= 0) {
    return <p className="text-sm text-slate-500">Czas rezerwacji minął — sprawdzamy status…</p>;
  }

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  const urgent = totalSeconds <= 120;

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm ${
        urgent ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'
      }`}
    >
      <Clock className="h-4 w-4" aria-hidden />
      Miejsce trzymamy jeszcze
      <span className="font-semibold tabular-nums">
        {minutes}:{seconds}
      </span>
    </div>
  );
}

export default function Confirmation() {
  const { submissionId } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const toast = useToast();
  const [status, setStatus] = useState<SubmissionStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pollingDone, setPollingDone] = useState(false);
  const [checking, setChecking] = useState(false);
  const polls = useRef(0);

  const load = useCallback(async () => {
    try {
      const data = await api.get<SubmissionStatusDto>(
        `/api/public/submissions/${submissionId}/status?token=${encodeURIComponent(token)}`,
      );
      setStatus(data);
      return data;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nie udało się pobrać statusu');
      return null;
    }
  }, [submissionId, token]);

  useEffect(() => {
    void load();
    const timer = setInterval(async () => {
      polls.current += 1;
      const data = await load();
      // Webhook jest źródłem prawdy; odpytujemy, dopóki rezerwacja czeka na płatność.
      if (!data || data.status !== 'RESERVED' || polls.current >= MAX_POLLS) {
        clearInterval(timer);
        setPollingDone(true);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const refresh = useCallback(() => void load(), [load]);

  async function checkAgain() {
    setChecking(true);
    setError(null);
    await load();
    setChecking(false);
  }

  async function retry() {
    setBusy(true);
    try {
      const data = await api.post<{ redirectUrl: string | null }>(
        `/api/public/submissions/${submissionId}/retry`,
        { token },
      );
      if (data.redirectUrl) window.location.href = data.redirectUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nie udało się ponowić płatności');
    } finally {
      setBusy(false);
    }
  }

  async function copyPageLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Skopiowano link do strony zgłoszenia');
    } catch {
      toast.error('Nie udało się skopiować linku');
    }
  }

  const content = status?.paymentResultContent;
  // Nieudana próba płatności przy wciąż ważnej rezerwacji to dla uczestnika „błąd
  // płatności”, mimo że zgłoszenie technicznie nadal czeka (RESERVED).
  const paymentFailed =
    status?.status === 'RESERVED' &&
    ['REJECTED', 'ERROR', 'ABANDONED', 'EXPIRED'].includes(status.lastPayment?.status ?? '');
  // Paynow nie odpowiedział przy tworzeniu płatności — klient jeszcze nie był na bramce.
  const paymentNotStarted = status?.status === 'RESERVED' && !paymentFailed && !status.lastPayment?.redirectUrl;
  const eventUrl = status ? `/f/${status.formSlug}` : '/';

  const retryButton = status?.canRetry && (
    <div>
      <button className="btn-primary" onClick={retry} disabled={busy}>
        <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden />
        {busy ? 'Przekierowanie…' : paymentNotStarted ? 'Przejdź do płatności' : 'Ponów płatność'}
      </button>
    </div>
  );

  return (
    <main className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="card space-y-4 text-center">
        {status?.formTitle && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-700/80">{status.formTitle}</p>
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-600">
              <CalendarDays className="h-4 w-4 text-brand-600" aria-hidden />
              <span className="inline-block first-letter:uppercase">
                {eventDateFormat.format(new Date(status.eventDate))}
              </span>
            </p>
          </div>
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {!status && !error && (
          <div className="py-6">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
            <p className="mt-4 text-sm text-slate-500">Sprawdzanie statusu…</p>
          </div>
        )}

        {status?.status === 'PAID' && (
          <>
            <StatusIcon tone="success" icon={CircleCheck} />
            <h1 className="text-2xl font-bold text-slate-900">{content?.successTitle || 'Rejestracja potwierdzona'}</h1>
            {content?.successBody && <p className="whitespace-pre-line text-slate-600">{content.successBody}</p>}
            <div className="space-y-2 rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-left">
              {status.buyerName && (
                <SummaryRow label="Uczestnik">
                  <span className="font-semibold text-slate-900">{status.buyerName}</span>
                </SummaryRow>
              )}
              <SummaryRow label="E-mail">
                <span className="font-semibold text-slate-900">{status.buyerEmail}</span>
              </SummaryRow>
              <SummaryRow label="Bilet">
                <span className="font-semibold text-slate-900">{status.ticketName}</span>
              </SummaryRow>
              <SummaryRow label="Kwota">
                <span className="text-lg font-bold text-brand-800">
                  {status.amountCents === 0 ? 'Bezpłatny' : formatPln(status.amountCents)}
                </span>
              </SummaryRow>
              {status.discountCodeSnapshot && (
                <SummaryRow label="Kod rabatowy" className="border-t border-brand-100 pt-2">
                  <span className="font-mono text-sm font-semibold text-emerald-700">
                    {status.discountCodeSnapshot} (-{formatPln(status.discountAmountCents)})
                  </span>
                </SummaryRow>
              )}
            </div>
            {status.ticketReference && (
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-brand-700/80">
                  <QrCode className="h-3.5 w-3.5" aria-hidden />
                  Twój bilet wstępu
                </p>
                <img
                  src={`/api/public/submissions/${submissionId}/ticket.png?token=${encodeURIComponent(token)}`}
                  alt="Kod QR biletu"
                  className="mx-auto mt-3 aspect-square w-full max-w-[14rem]"
                />
                <p className="mt-2 text-sm text-slate-600">
                  Pokaż ten kod przy wejściu · nr biletu{' '}
                  <span className="font-mono font-semibold text-slate-900">{status.ticketReference}</span>
                </p>
                <p className="mt-1 text-xs text-slate-500">Kod jest jednorazowy — nie udostępniaj go innym.</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <a
                    href={`/api/public/submissions/${submissionId}/ticket.png?token=${encodeURIComponent(token)}`}
                    download={`bilet-${status.ticketReference}.png`}
                    className="btn-secondary"
                  >
                    <Download className="h-4 w-4" aria-hidden />
                    Pobierz bilet
                  </a>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => downloadCalendarFile(status, window.location.href)}
                  >
                    <CalendarPlus className="h-4 w-4" aria-hidden />
                    Dodaj do kalendarza
                  </button>
                </div>
                {status.checkedInAt && (
                  <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
                    <CircleCheck className="h-4 w-4" aria-hidden />
                    Wejście zarejestrowane {new Date(status.checkedInAt).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                )}
              </div>
            )}
            {status.confirmationEmailSent && (
              <p className="flex items-center justify-center gap-2 text-sm text-emerald-700">
                <MailCheck className="h-4 w-4" aria-hidden />
                Potwierdzenie wysłaliśmy na Twój adres e-mail.
              </p>
            )}
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-500">
                Zachowaj link do tej strony — pod nim zawsze sprawdzisz status zgłoszenia.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" className="btn-secondary" onClick={() => void copyPageLink()}>
                  <Copy className="h-4 w-4" aria-hidden />
                  Kopiuj link
                </button>
                <Link to={eventUrl} className="btn-ghost">
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Wróć do wydarzenia
                </Link>
              </div>
            </div>
          </>
        )}

        {status?.status === 'RESERVED' && paymentFailed && (
          <>
            <StatusIcon tone="error" icon={CircleX} />
            <h1 className="text-2xl font-bold text-slate-900">{content?.errorTitle || 'Płatność nie została zakończona'}</h1>
            <p className="whitespace-pre-line text-slate-600">
              {content?.errorBody ||
                'Płatność nie doszła do skutku. Możesz spróbować ponownie, dopóki rezerwacja jest ważna.'}
            </p>
            {status.reservationExpiresAt && (
              <ReservationCountdown expiresAt={status.reservationExpiresAt} onExpire={refresh} />
            )}
            {retryButton}
          </>
        )}

        {status?.status === 'RESERVED' && !paymentFailed && (
          <>
            <StatusIcon tone="pending" icon={Hourglass} />
            <h1 className="text-2xl font-bold text-slate-900">
              {paymentNotStarted ? 'Dokończ płatność' : 'Czekamy na potwierdzenie płatności'}
            </h1>
            <p className="text-slate-600">
              {paymentNotStarted
                ? 'Miejsce jest zarezerwowane, ale nie udało się połączyć z operatorem płatności. Spróbuj ponownie.'
                : pollingDone
                  ? 'Miejsce jest zarezerwowane. Potwierdzenie płatności jeszcze nie dotarło — sprawdź status ponownie za chwilę.'
                  : 'Miejsce jest zarezerwowane. Strona odświeża status automatycznie.'}
            </p>
            {status.reservationExpiresAt && (
              <ReservationCountdown expiresAt={status.reservationExpiresAt} onExpire={refresh} />
            )}
            <p className="text-sm text-slate-500">
              Ostatnia próba płatności: {paymentStatusLabel(status.lastPayment?.status)}
            </p>
            {pollingDone && !paymentNotStarted && (
              <div>
                <button type="button" className="btn-secondary" onClick={() => void checkAgain()} disabled={checking}>
                  <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} aria-hidden />
                  {checking ? 'Sprawdzam…' : 'Sprawdź ponownie'}
                </button>
              </div>
            )}
            {retryButton}
          </>
        )}

        {status?.status === 'EXPIRED' && (
          <>
            <StatusIcon tone="warning" icon={TriangleAlert} />
            <h1 className="text-2xl font-bold text-slate-900">{content?.errorTitle || 'Rezerwacja wygasła'}</h1>
            <p className="whitespace-pre-line text-slate-600">
              {content?.errorBody ||
                'Czas na opłacenie minął i miejsce wróciło do puli. Wypełnij formularz ponownie, jeśli bilety są nadal dostępne.'}
            </p>
            <div>
              <Link to={eventUrl} className="btn-primary">
                <RefreshCw className="h-4 w-4" aria-hidden />
                Zarejestruj się ponownie
              </Link>
            </div>
          </>
        )}

        {status?.status === 'CANCELLED' && (
          <>
            <StatusIcon tone="neutral" icon={Ban} />
            <h1 className="text-2xl font-bold text-slate-900">{content?.errorTitle || 'Zgłoszenie anulowane'}</h1>
            {content?.errorBody && <p className="whitespace-pre-line text-slate-600">{content.errorBody}</p>}
            <div>
              <Link to={eventUrl} className="btn-ghost">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Wróć do wydarzenia
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
