import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { SubmissionStatusDto } from '@syjonevent/shared';
import { api, ApiError, formatPln } from '../lib/api';

const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 15;

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
    <main className="mx-auto max-w-xl px-6 py-16">
      <div className="card space-y-4">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!status && !error && <p className="text-slate-500">Sprawdzanie statusu…</p>}

        {status?.status === 'PAID' && (
          <>
            <h1 className="text-2xl font-semibold text-emerald-700">
              {content?.successTitle || 'Rejestracja potwierdzona'}
            </h1>
            {content?.successBody && (
              <p className="whitespace-pre-line text-slate-600">{content.successBody}</p>
            )}
            <p className="text-slate-600">
              Bilet: {status.ticketName} ·{' '}
              {status.amountCents === 0 ? 'bezpłatny' : formatPln(status.amountCents)}
            </p>
            <p className="text-sm text-slate-500">
              Zachowaj ten adres — pod nim zawsze sprawdzisz status swojego zgłoszenia.
            </p>
          </>
        )}

        {status?.status === 'RESERVED' && paymentFailed && (
          <>
            <h1 className="text-2xl font-semibold text-red-700">
              {content?.errorTitle || 'Płatność nie została zakończona'}
            </h1>
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
            <h1 className="text-2xl font-semibold">Czekamy na potwierdzenie płatności</h1>
            <p className="text-slate-600">
              Miejsce jest zarezerwowane
              {status.reservationExpiresAt
                ? ` do ${new Intl.DateTimeFormat('pl-PL', { timeStyle: 'short' }).format(new Date(status.reservationExpiresAt))}`
                : ''}
              . Strona odświeża status automatycznie.
            </p>
            <p className="text-sm text-slate-500">
              Ostatnia próba płatności: {status.lastPayment?.status ?? 'brak'}
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
            <h1 className="text-2xl font-semibold text-amber-700">
              {content?.errorTitle || 'Rezerwacja wygasła'}
            </h1>
            <p className="whitespace-pre-line text-slate-600">
              {content?.errorBody ||
                'Czas na opłacenie minął i miejsce wróciło do puli. Wypełnij formularz ponownie, jeśli bilety są nadal dostępne.'}
            </p>
          </>
        )}

        {status?.status === 'CANCELLED' && (
          <>
            <h1 className="text-2xl font-semibold text-slate-700">
              {content?.errorTitle || 'Zgłoszenie anulowane'}
            </h1>
            {content?.errorBody && (
              <p className="whitespace-pre-line text-slate-600">{content.errorBody}</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
