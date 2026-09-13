import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { SubmissionStatusDto } from '@syjonevent/shared';
import { api, ApiError, formatPln } from '../lib/api';
import Stepper from '../components/Stepper';
import { paymentStatusLabel } from '../lib/status';

const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 15;

const REVIEW_STEPS = [
  { key: 'fields', label: 'Informacje' },
  { key: 'ticket', label: 'Bilet i dane' },
  { key: 'review', label: 'Podsumowanie' },
];

function StatusIcon({ tone, path }: { tone: 'success' | 'error' | 'warning' | 'pending' | 'neutral'; path: string }) {
  const toneClasses: Record<typeof tone, string> = {
    success: 'bg-brand-100 text-brand-700',
    error: 'bg-red-100 text-red-600',
    warning: 'bg-amber-100 text-amber-700',
    pending: 'bg-brand-50 text-brand-600',
    neutral: 'bg-slate-100 text-slate-600',
  };
  return (
    <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${toneClasses[tone]}`}>
      <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
        <path d={path} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

const ICONS = {
  check: 'M5 13l4 4L19 7',
  cross: 'M6 6l12 12M18 6 6 18',
  clock: 'M12 7v5l3 3M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  warning: 'M12 9v4m0 4h.01M10.29 3.86 1.82 18a1 1 0 0 0 .87 1.5h18.62a1 1 0 0 0 .87-1.5L13.71 3.86a1 1 0 0 0-1.72 0Z',
  ban: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM6 6l12 12',
};

export default function Confirmation() {
  const { submissionId } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<SubmissionStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      if (!data || data.status !== 'RESERVED' || polls.current >= MAX_POLLS) clearInterval(timer);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

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

  const content = status?.paymentResultContent;
  // Nieudana próba płatności przy wciąż ważnej rezerwacji to dla uczestnika „błąd
  // płatności”, mimo że zgłoszenie technicznie nadal czeka (RESERVED).
  const paymentFailed =
    status?.status === 'RESERVED' &&
    ['REJECTED', 'ERROR', 'ABANDONED', 'EXPIRED'].includes(status.lastPayment?.status ?? '');

  return (
    <main className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="card">
        <Stepper steps={REVIEW_STEPS} currentIndex={2} />
      </div>

      <div className="card mt-6 space-y-4 text-center">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {!status && !error && (
          <div className="py-6">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
            <p className="mt-4 text-sm text-slate-500">Sprawdzanie statusu…</p>
          </div>
        )}

        {status?.status === 'PAID' && (
          <>
            <StatusIcon tone="success" path={ICONS.check} />
            <h1 className="text-2xl font-bold text-slate-900">{content?.successTitle || 'Rejestracja potwierdzona'}</h1>
            {content?.successBody && <p className="whitespace-pre-line text-slate-600">{content.successBody}</p>}
            <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-left">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-brand-700/80">Bilet</span>
                <span className="font-semibold text-slate-900">{status.ticketName}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-brand-700/80">Kwota</span>
                <span className="text-lg font-bold text-brand-800">
                  {status.amountCents === 0 ? 'Bezpłatny' : formatPln(status.amountCents)}
                </span>
              </div>
            </div>
            <p className="text-sm text-slate-500">
              Zachowaj ten adres — pod nim zawsze sprawdzisz status swojego zgłoszenia.
            </p>
          </>
        )}

        {status?.status === 'RESERVED' && paymentFailed && (
          <>
            <StatusIcon tone="error" path={ICONS.cross} />
            <h1 className="text-2xl font-bold text-slate-900">{content?.errorTitle || 'Płatność nie została zakończona'}</h1>
            <p className="whitespace-pre-line text-slate-600">
              {content?.errorBody ||
                'Płatność nie doszła do skutku. Możesz spróbować ponownie, dopóki rezerwacja jest ważna.'}
            </p>
            {status.reservationExpiresAt && (
              <p className="text-sm text-slate-500">
                Miejsce jest trzymane do{' '}
                {new Intl.DateTimeFormat('pl-PL', { timeStyle: 'short' }).format(
                  new Date(status.reservationExpiresAt),
                )}
                .
              </p>
            )}
            {status.canRetry && (
              <button className="btn-primary" onClick={retry} disabled={busy}>
                {busy ? 'Przekierowanie…' : 'Ponów płatność'}
              </button>
            )}
          </>
        )}

        {status?.status === 'RESERVED' && !paymentFailed && (
          <>
            <StatusIcon tone="pending" path={ICONS.clock} />
            <h1 className="text-2xl font-bold text-slate-900">Czekamy na potwierdzenie płatności</h1>
            <p className="text-slate-600">
              Miejsce jest zarezerwowane
              {status.reservationExpiresAt
                ? ` do ${new Intl.DateTimeFormat('pl-PL', { timeStyle: 'short' }).format(new Date(status.reservationExpiresAt))}`
                : ''}
              . Strona odświeża status automatycznie.
            </p>
            <p className="text-sm text-slate-500">
              Ostatnia próba płatności: {paymentStatusLabel(status.lastPayment?.status)}
            </p>
            {status.canRetry && (
              <button className="btn-primary" onClick={retry} disabled={busy}>
                {busy ? 'Przekierowanie…' : 'Ponów płatność'}
              </button>
            )}
          </>
        )}

        {status?.status === 'EXPIRED' && (
          <>
            <StatusIcon tone="warning" path={ICONS.warning} />
            <h1 className="text-2xl font-bold text-slate-900">{content?.errorTitle || 'Rezerwacja wygasła'}</h1>
            <p className="whitespace-pre-line text-slate-600">
              {content?.errorBody ||
                'Czas na opłacenie minął i miejsce wróciło do puli. Wypełnij formularz ponownie, jeśli bilety są nadal dostępne.'}
            </p>
          </>
        )}

        {status?.status === 'CANCELLED' && (
          <>
            <StatusIcon tone="neutral" path={ICONS.ban} />
            <h1 className="text-2xl font-bold text-slate-900">{content?.errorTitle || 'Zgłoszenie anulowane'}</h1>
            {content?.errorBody && <p className="whitespace-pre-line text-slate-600">{content.errorBody}</p>}
          </>
        )}
      </div>
    </main>
  );
}
