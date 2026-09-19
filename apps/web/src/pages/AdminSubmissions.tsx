import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronRight,
  Coins,
  Copy,
  Download,
  Inbox,
  Info,
  LoaderCircle,
  Mail,
  MailCheck,
  MailX,
  Pencil,
  Printer,
  ShieldCheck,
  QrCode,
  RefreshCw,
  ScanLine,
  Send,
  UserRoundCheck,
  Search,
  TicketPercent,
  Wallet,
  X,
} from 'lucide-react';
import { flattenSections, visibleFields, type ConsentRecord, type FormSection } from '@syjonevent/shared';
import { useCanEdit } from '../lib/admin';
import { api, ApiError, formatDateTime, formatPln } from '../lib/api';
import { useDebouncedValue } from '../lib/hooks';
import {
  PAYMENT_STATUS,
  SUBMISSION_STATUS,
  type PaymentStatus,
  type SubmissionStatus,
} from '../lib/status';
import { useConfirm } from '../components/ui/ConfirmDialog';
import Drawer from '../components/ui/Drawer';
import IconButton from '../components/ui/IconButton';
import Pagination from '../components/ui/Pagination';
import StatusBadge from '../components/ui/StatusBadge';
import { useToast } from '../components/ui/Toast';

const PAGE_SIZE = 50;

type Answers = Record<string, string | number | boolean>;

interface SubmissionRow {
  id: string;
  displayName: string | null;
  buyerEmail: string;
  buyerPhone: string | null;
  ticketNameSnapshot: string;
  ticketPriceCents: number;
  currency: string;
  discountCodeSnapshot: string | null;
  discountAmountCents: number;
  depositCents: number | null;
  paidCents: number;
  status: SubmissionStatus;
  reservationExpiresAt: string | null;
  createdAt: string;
}

interface PaymentAttempt {
  id: string;
  status: PaymentStatus;
  kind: 'FULL' | 'DEPOSIT' | 'BALANCE';
  provider: string;
  amountCents: number;
  createdAt: string;
}

const PAYMENT_KIND_LABEL: Record<PaymentAttempt['kind'], string | null> = {
  FULL: null,
  DEPOSIT: 'Zaliczka',
  BALANCE: 'Dopłata',
};

interface SubmissionDetail {
  id: string;
  buyerEmail: string;
  buyerPhone: string | null;
  buyerAddress: string | null;
  ticketNameSnapshot: string;
  ticketPriceCents: number;
  discountCodeSnapshot: string | null;
  discountAmountCents: number;
  depositCents: number | null;
  paidCents: number;
  status: SubmissionStatus;
  payloadJson: Answers;
  schemaSnapshotJson: { sections: FormSection[] };
  consentsJson: ConsentRecord[];
  reservationExpiresAt: string | null;
  confirmationEmailSentAt: string | null;
  depositEmailSentAt: string | null;
  ticketIssued: boolean;
  ticketReference: string;
  checkedInAt: string | null;
  checkedInStationName: string | null;
  createdAt: string;
  payments?: PaymentAttempt[];
}

interface ListResponse {
  submissions: SubmissionRow[];
  total: number;
  statusCounts: Record<SubmissionStatus, number>;
  paidRevenueCents: number;
  outstandingCents: number;
}

const STATUS_TABS: { value: SubmissionStatus | ''; label: string }[] = [
  { value: '', label: 'Wszystkie' },
  { value: 'PAID', label: SUBMISSION_STATUS.PAID.label },
  { value: 'DEPOSIT_PAID', label: 'Zaliczki' },
  { value: 'RESERVED', label: 'Rezerwacje' },
  { value: 'EXPIRED', label: SUBMISSION_STATUS.EXPIRED.label },
  { value: 'CANCELLED', label: SUBMISSION_STATUS.CANCELLED.label },
];

const EMPTY_COUNTS: Record<SubmissionStatus, number> = {
  RESERVED: 0,
  DEPOSIT_PAID: 0,
  PAID: 0,
  EXPIRED: 0,
  CANCELLED: 0,
};

/** Reszta do dopłaty po zaliczce. */
const balanceDue = (row: { ticketPriceCents: number; paidCents: number }) => Math.max(0, row.ticketPriceCents - row.paidCents);

export default function AdminSubmissions() {
  const { id } = useParams();
  const toast = useToast();
  const confirm = useConfirm();
  const canEdit = useCanEdit();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('zgloszenie');

  const [formTitle, setFormTitle] = useState<string | null>(null);
  const [rows, setRows] = useState<SubmissionRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState(EMPTY_COUNTS);
  const [paidRevenueCents, setPaidRevenueCents] = useState(0);
  const [outstandingCents, setOutstandingCents] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<SubmissionStatus | ''>('');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebouncedValue(searchQuery.trim());
  const requestSeq = useRef(0);

  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [editBuyer, setEditBuyer] = useState({ email: '', phone: '', address: '' });
  const [editAnswers, setEditAnswers] = useState<Answers>({});
  const [saving, setSaving] = useState(false);
  const [ticketBusy, setTicketBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ form: { title: string } }>(`/api/forms/${id}`)
      .then((data) => setFormTitle(data.form.title))
      .catch(() => setFormTitle(null));
  }, [id]);

  // Te same filtry trafiają do listy i do eksportu CSV.
  const filterParams = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (debouncedQuery) params.set('q', debouncedQuery);
    return params;
  }, [status, debouncedQuery]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    const params = new URLSearchParams(filterParams);
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    setLoading(true);
    try {
      const data = await api.get<ListResponse>(`/api/forms/${id}/submissions?${params.toString()}`);
      // Odpowiedź na starsze zapytanie (np. po szybkim pisaniu) nie może nadpisać nowszej.
      if (seq !== requestSeq.current) return;
      setRows(data.submissions);
      setTotal(data.total);
      setStatusCounts(data.statusCounts ?? EMPTY_COUNTS);
      setPaidRevenueCents(data.paidRevenueCents ?? 0);
      setOutstandingCents(data.outstandingCents ?? 0);
    } catch (error) {
      if (seq === requestSeq.current) {
        toast.error(error instanceof ApiError ? error.message : 'Nie udało się pobrać zgłoszeń');
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [id, filterParams, page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery]);

  const hydrateEditor = useCallback((submission: SubmissionDetail) => {
    setDetail(submission);
    setEditBuyer({ email: submission.buyerEmail, phone: submission.buyerPhone ?? '', address: submission.buyerAddress ?? '' });
    setEditAnswers(submission.payloadJson ?? {});
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setDetail(null);
    api
      .get<{ submission: SubmissionDetail }>(`/api/forms/${id}/submissions/${selectedId}`)
      .then((data) => {
        if (!cancelled) hydrateEditor(data.submission);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error instanceof ApiError ? error.message : 'Nie udało się otworzyć zgłoszenia');
        setSearchParams({}, { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [id, selectedId, hydrateEditor, toast, setSearchParams]);

  const dirty = useMemo(() => {
    if (!detail) return false;
    return (
      editBuyer.email !== detail.buyerEmail ||
      (editBuyer.phone || null) !== (detail.buyerPhone || null) ||
      (editBuyer.address || null) !== (detail.buyerAddress || null) ||
      JSON.stringify(editAnswers) !== JSON.stringify(detail.payloadJson ?? {})
    );
  }, [detail, editBuyer, editAnswers]);

  function openSubmission(submissionId: string) {
    setSearchParams({ zgloszenie: submissionId });
  }

  async function closeDrawer() {
    if (
      dirty &&
      !(await confirm({
        title: 'Porzucić niezapisane zmiany?',
        description: 'Zmiany w danych kupującego lub odpowiedziach nie zostaną zapisane.',
        confirmLabel: 'Porzuć zmiany',
        cancelLabel: 'Wróć do edycji',
        tone: 'danger',
      }))
    ) {
      return;
    }
    setSearchParams({});
  }

  async function saveDetail() {
    if (!detail) return;
    setSaving(true);
    try {
      const data = await api.patch<{ submission: SubmissionDetail }>(
        `/api/forms/${id}/submissions/${detail.id}`,
        {
          buyerEmail: editBuyer.email,
          buyerPhone: editBuyer.phone || null,
          buyerAddress: editBuyer.address || null,
          answers: editAnswers,
        },
      );
      // PATCH nie zwraca historii płatności — zachowujemy ją z poprzednio pobranych szczegółów.
      hydrateEditor({ ...data.submission, payments: detail.payments });
      toast.success('Zapisano zmiany w zgłoszeniu');
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Błąd zapisu');
    } finally {
      setSaving(false);
    }
  }

  async function copyEmail(email: string) {
    try {
      await navigator.clipboard.writeText(email);
      toast.success('Skopiowano adres e-mail');
    } catch {
      toast.error('Nie udało się skopiować adresu');
    }
  }

  async function resendTicket() {
    if (!detail) return;
    setTicketBusy(true);
    try {
      await api.post(`/api/forms/${id}/attendance/tickets/${detail.id}/resend`);
      toast.success(`Wysłano bilet na ${detail.buyerEmail}`);
      setDetail({ ...detail, ticketIssued: true });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się wysłać biletu');
    } finally {
      setTicketBusy(false);
    }
  }

  async function reissueTicket() {
    if (!detail) return;
    const ok = await confirm({
      title: 'Unieważnić kod QR i wystawić nowy?',
      description:
        'Użyj, gdy ktoś inny mógł skopiować bilet. Stary kod przestanie działać na wejściu, a uczestnik dostanie e-mail z nowym.',
      confirmLabel: 'Wystaw nowy kod',
      tone: 'danger',
    });
    if (!ok) return;
    setTicketBusy(true);
    try {
      const data = await api.post<{ emailSent: boolean }>(`/api/forms/${id}/attendance/tickets/${detail.id}/reissue`);
      if (data.emailSent) toast.success('Wystawiono nowy kod i wysłano go e-mailem');
      else toast.error('Nowy kod wystawiony, ale e-mail się nie wysłał — spróbuj „Wyślij ponownie”');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się wystawić nowego kodu');
    } finally {
      setTicketBusy(false);
    }
  }

  async function recordBalancePayment() {
    if (!detail) return;
    const ok = await confirm({
      title: `Odnotować dopłatę ${formatPln(balanceDue(detail))}?`,
      description:
        'Użyj, gdy uczestnik dopłacił gotówką lub przelewem. Zgłoszenie stanie się opłacone, a uczestnik dostanie e-mail z biletem QR.',
      confirmLabel: 'Odnotuj dopłatę',
    });
    if (!ok) return;
    setTicketBusy(true);
    try {
      await api.post(`/api/forms/${id}/submissions/${detail.id}/balance-payment`);
      // Odpowiedź POST nie ma historii płatności — pobieramy pełne szczegóły od nowa.
      const data = await api.get<{ submission: SubmissionDetail }>(`/api/forms/${id}/submissions/${detail.id}`);
      hydrateEditor(data.submission);
      toast.success('Odnotowano dopłatę — bilet wysłany do uczestnika');
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się odnotować dopłaty');
    } finally {
      setTicketBusy(false);
    }
  }

  async function resendDepositEmail() {
    if (!detail) return;
    setTicketBusy(true);
    try {
      await api.post(`/api/forms/${id}/submissions/${detail.id}/deposit-email`);
      toast.success(`Wysłano link do dopłaty na ${detail.buyerEmail}`);
      setDetail({ ...detail, depositEmailSentAt: new Date().toISOString() });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się wysłać e-maila');
    } finally {
      setTicketBusy(false);
    }
  }

  function resetFilters() {
    setStatus('');
    setSearchQuery('');
    setPage(1);
  }

  const allCount = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
  const hasFilters = Boolean(status || debouncedQuery);
  const csvQuery = filterParams.toString();

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/admin"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Wydarzenia
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Zgłoszenia</h1>
          {formTitle && <p className="truncate text-sm text-slate-500">{formTitle}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/admin/formularze/${id}/wiadomosci`} className="btn-secondary">
            <Mail className="h-4 w-4" aria-hidden />
            Wiadomość
          </Link>
          <Link to={`/admin/formularze/${id}/raporty`} className="btn-secondary">
            <Printer className="h-4 w-4" aria-hidden />
            Raporty
          </Link>
          <Link to={`/admin/formularze/${id}/obecnosc`} className="btn-secondary">
            <ScanLine className="h-4 w-4" aria-hidden />
            Obecność
          </Link>
          <a
            className="btn-secondary"
            href={`/api/forms/${id}/submissions.csv${csvQuery ? `?${csvQuery}` : ''}`}
            title={hasFilters ? 'Eksportuje tylko zgłoszenia pasujące do filtrów' : undefined}
          >
            <Download className="h-4 w-4" aria-hidden />
            {hasFilters ? 'Eksport CSV (filtry)' : 'Eksport CSV'}
          </a>
          <Link to={`/admin/formularze/${id}`} className="btn-secondary">
            <Pencil className="h-4 w-4" aria-hidden />
            Edytuj wydarzenie
          </Link>
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Status zgłoszenia" className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {/* Zakładka „Zaliczki” pojawia się dopiero, gdy w wydarzeniu jest jakaś wpłacona zaliczka. */}
            {STATUS_TABS.filter(
              (tab) => tab.value !== 'DEPOSIT_PAID' || statusCounts.DEPOSIT_PAID > 0 || status === 'DEPOSIT_PAID',
            ).map((tab) => {
              const active = status === tab.value;
              const count = tab.value ? statusCounts[tab.value] : allCount;
              return (
                <button
                  key={tab.value || 'all'}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setStatus(tab.value);
                    setPage(1);
                  }}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                    active ? 'bg-brand-600 text-white shadow-soft' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {tab.label}
                  <span
                    className={`rounded-full px-1.5 text-xs tabular-nums ${
                      active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
            <p className="inline-flex items-center gap-2">
              <Wallet className="h-4 w-4 text-brand-600" aria-hidden />
              Wpłaty:
              <span className="font-semibold text-slate-900">{formatPln(paidRevenueCents)}</span>
            </p>
            {outstandingCents > 0 && (
              <p className="inline-flex items-center gap-2">
                <Coins className="h-4 w-4 text-amber-600" aria-hidden />
                Do dopłaty:
                <span className="font-semibold text-slate-900">{formatPln(outstandingCents)}</span>
              </p>
            )}
          </div>
        </div>

        <div className="relative max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            className="input pl-9 pr-9"
            aria-label="Szukaj po imieniu, e-mailu lub numerze biletu"
            placeholder="Imię, e-mail lub nr biletu"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Wyczyść wyszukiwanie"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              onClick={() => setSearchQuery('')}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="card p-0">
        {/* Paginacja poza przewijanym kontenerem — inaczej podpowiedzi przycisków rozpychają tabelę w poziomie. */}
        <div className={`overflow-x-auto rounded-t-2xl transition-opacity ${loading && rows ? 'opacity-60' : ''}`}>
          {/* Na telefonie karty zamiast tabeli — bez przewijania w bok. */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {rows?.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => openSubmission(row.id)}
                  className={`flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left text-sm transition active:bg-brand-50 ${
                    selectedId === row.id ? 'bg-brand-50' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{row.displayName ?? row.buyerEmail}</span>
                    {row.displayName && <span className="block truncate text-xs text-slate-500">{row.buyerEmail}</span>}
                    <span className="mt-1 block text-xs text-slate-500">
                      {row.ticketNameSnapshot} · {row.ticketPriceCents === 0 ? 'Bezpłatny' : formatPln(row.ticketPriceCents)}
                      {row.status === 'DEPOSIT_PAID' && ` · do dopłaty ${formatPln(balanceDue(row))}`}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400">{formatDateTime(row.createdAt)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <StatusBadge meta={SUBMISSION_STATUS[row.status]} />
                    <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden />
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <table className="hidden w-full text-sm md:table">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Uczestnik</th>
                <th className="px-4 py-3">Bilet</th>
                <th className="px-4 py-3 text-right">Kwota</th>
                <th className="px-4 py-3">Status</th>
                <th className="w-10 px-4 py-3">
                  <span className="sr-only">Otwórz</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((row) => (
                <tr
                  key={row.id}
                  tabIndex={0}
                  onClick={() => openSubmission(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openSubmission(row.id);
                    }
                  }}
                  className={`group cursor-pointer border-t border-slate-100 outline-none transition hover:bg-brand-50/50 focus-visible:bg-brand-50 ${
                    selectedId === row.id ? 'bg-brand-50' : ''
                  }`}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-3">
                    {row.displayName && <p className="font-medium text-slate-900">{row.displayName}</p>}
                    <div className="flex items-center gap-1.5">
                      <span className={row.displayName ? 'text-slate-600' : 'font-medium text-slate-900'}>
                        {row.buyerEmail}
                      </span>
                      <IconButton
                        icon={Copy}
                        label="Kopiuj e-mail"
                        size="sm"
                        // Na ekranach dotykowych nie ma hovera — tam przycisk jest widoczny zawsze.
                        className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyEmail(row.buyerEmail);
                        }}
                      />
                    </div>
                    {row.buyerPhone && <p className="text-xs text-slate-500">{row.buyerPhone}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.ticketNameSnapshot}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">
                    {row.ticketPriceCents === 0 ? 'Bezpłatny' : formatPln(row.ticketPriceCents)}
                    {row.discountCodeSnapshot && (
                      <p className="flex items-center justify-end gap-1 text-xs font-normal text-emerald-700">
                        <TicketPercent className="h-3 w-3" aria-hidden />
                        {row.discountCodeSnapshot}
                      </p>
                    )}
                    {row.status === 'DEPOSIT_PAID' && (
                      <p className="text-xs font-normal text-amber-700">do dopłaty {formatPln(balanceDue(row))}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge meta={SUBMISSION_STATUS[row.status]} />
                  </td>
                  <td className="px-4 py-3 text-slate-300 group-hover:text-brand-600">
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!rows && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              Ładowanie zgłoszeń…
            </div>
          )}
          {rows?.length === 0 && (
            <div className="flex flex-col items-center px-4 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <Inbox className="h-6 w-6" aria-hidden />
              </div>
              <p className="mt-3 font-medium text-slate-800">
                {hasFilters ? 'Brak zgłoszeń dla wybranych filtrów' : 'Jeszcze nikt się nie zarejestrował'}
              </p>
              {hasFilters ? (
                <button type="button" className="btn-ghost mt-2" onClick={resetFilters}>
                  Wyczyść filtry
                </button>
              ) : (
                <p className="mt-1 text-sm text-slate-500">Zgłoszenia pojawią się tu zaraz po rejestracji.</p>
              )}
            </div>
          )}
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      </div>

      <Drawer
        open={Boolean(selectedId)}
        onClose={() => void closeDrawer()}
        title={detail?.buyerEmail ?? 'Zgłoszenie'}
        subtitle={detail ? `Zgłoszono ${formatDateTime(detail.createdAt)}` : undefined}
        footer={
          detail &&
          canEdit && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className={`inline-flex items-center gap-2 text-sm ${dirty ? 'text-amber-700' : 'text-slate-400'}`}>
                <span className={`h-2 w-2 rounded-full ${dirty ? 'bg-amber-500' : 'bg-slate-300'}`} />
                {dirty ? 'Niezapisane zmiany' : 'Brak zmian'}
              </span>
              <div className="flex gap-2">
                {dirty && (
                  <button type="button" className="btn-ghost" onClick={() => hydrateEditor(detail)}>
                    Cofnij zmiany
                  </button>
                )}
                <button type="button" className="btn-primary" onClick={saveDetail} disabled={!dirty || saving}>
                  {saving ? 'Zapisywanie…' : 'Zapisz zmiany'}
                </button>
              </div>
            </div>
          )
        }
      >
        {!detail ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            Ładowanie zgłoszenia…
          </div>
        ) : (
          <SubmissionDetailBody
            detail={detail}
            editBuyer={editBuyer}
            setEditBuyer={setEditBuyer}
            editAnswers={editAnswers}
            setEditAnswers={setEditAnswers}
            onCopyEmail={copyEmail}
            onResendTicket={() => void resendTicket()}
            onReissueTicket={() => void reissueTicket()}
            onRecordBalancePayment={() => void recordBalancePayment()}
            onResendDepositEmail={() => void resendDepositEmail()}
            ticketBusy={ticketBusy}
            readOnly={!canEdit}
          />
        )}
      </Drawer>
    </section>
  );
}

interface DetailBodyProps {
  detail: SubmissionDetail;
  editBuyer: { email: string; phone: string; address: string };
  setEditBuyer: (value: { email: string; phone: string; address: string }) => void;
  editAnswers: Answers;
  setEditAnswers: (value: Answers) => void;
  onCopyEmail: (email: string) => void;
  onResendTicket: () => void;
  onReissueTicket: () => void;
  onRecordBalancePayment: () => void;
  onResendDepositEmail: () => void;
  ticketBusy: boolean;
  readOnly: boolean;
}

function SubmissionDetailBody({
  detail,
  editBuyer,
  setEditBuyer,
  editAnswers,
  setEditAnswers,
  onCopyEmail,
  onResendTicket,
  onReissueTicket,
  onRecordBalancePayment,
  onResendDepositEmail,
  ticketBusy,
  readOnly,
}: DetailBodyProps) {
  // Pola warunkowe ukryte przy obecnych odpowiedziach nie są pokazywane (i nie zapisałyby się).
  const visibleKeys = new Set(
    visibleFields(flattenSections(detail.schemaSnapshotJson.sections), editAnswers).map((field) => field.key),
  );
  const sections = detail.schemaSnapshotJson.sections
    .map((section) => ({ ...section, fields: section.fields.filter((field) => visibleKeys.has(field.key)) }))
    .filter((section) => section.fields.length > 0);
  const payments = detail.payments ?? [];
  const consents = detail.consentsJson ?? [];

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Status</dt>
          <dd className="mt-1">
            <StatusBadge meta={SUBMISSION_STATUS[detail.status]} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Bilet</dt>
          <dd className="mt-1 font-medium text-slate-900">
            {detail.ticketNameSnapshot}
            <span className="ml-1.5 font-normal text-slate-500">
              {detail.ticketPriceCents === 0 ? 'bezpłatny' : formatPln(detail.ticketPriceCents)}
            </span>
          </dd>
        </div>
        {detail.discountCodeSnapshot && (
          <div>
            <dt className="text-xs text-slate-500">Kod rabatowy</dt>
            <dd className="mt-1 flex items-center gap-1.5 font-medium text-emerald-700">
              <TicketPercent className="h-4 w-4" aria-hidden />
              <span className="font-mono">{detail.discountCodeSnapshot}</span>
              <span className="font-normal text-slate-500">(-{formatPln(detail.discountAmountCents)})</span>
            </dd>
          </div>
        )}
        {detail.depositCents !== null && (
          <div>
            <dt className="text-xs text-slate-500">Płatność</dt>
            <dd className="mt-1 font-medium text-slate-900">
              Zaliczka {formatPln(detail.depositCents)}
              <span className="block text-xs font-normal text-slate-500">Wpłacono {formatPln(detail.paidCents)}</span>
            </dd>
          </div>
        )}
        {detail.status === 'RESERVED' && detail.reservationExpiresAt && (
          <div>
            <dt className="text-xs text-slate-500">Rezerwacja ważna do</dt>
            <dd className="mt-1 font-medium text-slate-900">{formatDateTime(detail.reservationExpiresAt)}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-slate-500">E-mail z potwierdzeniem</dt>
          <dd className="mt-1">
            {detail.confirmationEmailSentAt ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                <MailCheck className="h-4 w-4" aria-hidden />
                Wysłany {formatDateTime(detail.confirmationEmailSentAt)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-slate-500">
                <MailX className="h-4 w-4" aria-hidden />
                {detail.status === 'PAID' ? 'Nie wysłano' : 'Po opłaceniu'}
              </span>
            )}
          </dd>
        </div>
        {detail.status === 'PAID' && (
          <div>
            <dt className="text-xs text-slate-500">Obecność</dt>
            <dd className="mt-1">
              {detail.checkedInAt ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                  <UserRoundCheck className="h-4 w-4" aria-hidden />
                  Wejście {formatDateTime(detail.checkedInAt)}
                  {detail.checkedInStationName ? ` · ${detail.checkedInStationName}` : ''}
                </span>
              ) : (
                <span className="text-slate-500">Brak wejścia</span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {detail.status === 'DEPOSIT_PAID' && (
        <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex items-center gap-3">
            <Coins className="h-5 w-5 text-amber-600" aria-hidden />
            <div>
              <p className="text-sm font-medium text-slate-900">Do dopłaty {formatPln(balanceDue(detail))}</p>
              <p className="text-xs text-slate-500">
                Bilet QR zostanie wysłany po dopłacie.{' '}
                {detail.depositEmailSentAt
                  ? `Link do dopłaty wysłany ${formatDateTime(detail.depositEmailSentAt)}.`
                  : 'Link do dopłaty nie został wysłany.'}
              </p>
            </div>
          </div>
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={ticketBusy} onClick={onRecordBalancePayment}>
                <Wallet className="h-4 w-4" aria-hidden />
                Odnotuj dopłatę
              </button>
              <button type="button" className="btn-secondary" disabled={ticketBusy} onClick={onResendDepositEmail}>
                <Send className="h-4 w-4" aria-hidden />
                Wyślij link do dopłaty
              </button>
            </div>
          )}
        </div>
      )}

      {detail.status === 'PAID' && !readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <QrCode className="h-5 w-5 text-brand-600" aria-hidden />
            <div>
              <p className="text-sm font-medium text-slate-900">
                Bilet QR <span className="font-mono text-slate-500">#{detail.ticketReference}</span>
              </p>
              <p className="text-xs text-slate-500">{detail.ticketIssued ? 'Wystawiony' : 'Jeszcze nie wysłany'}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={ticketBusy} onClick={onResendTicket}>
              <Send className="h-4 w-4" aria-hidden />
              {detail.ticketIssued ? 'Wyślij ponownie' : 'Wyślij bilet'}
            </button>
            {detail.ticketIssued && (
              <IconButton
                icon={RefreshCw}
                label="Unieważnij kod i wystaw nowy"
                tone="danger"
                disabled={ticketBusy}
                onClick={onReissueTicket}
              />
            )}
          </div>
        </div>
      )}

      {payments.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Próby płatności</h3>
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <StatusBadge meta={PAYMENT_STATUS[payment.status]} />
                <span className="text-xs text-slate-500">
                  {[PAYMENT_KIND_LABEL[payment.kind], payment.provider === 'manual' ? 'ręcznie' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="ml-auto tabular-nums text-slate-700">{formatPln(payment.amountCents)}</span>
                <span className="text-xs text-slate-500">{formatDateTime(payment.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {consents.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Zgody dodatkowe</h3>
          <ul className="space-y-1.5 rounded-2xl border border-slate-200 p-4 text-sm">
            {consents.map((consent) => (
              <li key={consent.key} className="flex items-start gap-2">
                <ShieldCheck
                  className={`mt-0.5 h-4 w-4 shrink-0 ${consent.accepted ? 'text-emerald-600' : 'text-slate-300'}`}
                  aria-hidden
                />
                <span className={consent.accepted ? 'text-slate-800' : 'text-slate-400'}>
                  {consent.label}
                  <span className="ml-1.5 text-xs">{consent.accepted ? '— zgoda' : '— brak zgody'}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Konto "tylko podgląd" widzi te same pola, ale zablokowane. */}
      <fieldset disabled={readOnly} className="space-y-6">
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Dane kupującego</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="buyer-email">
                E-mail
              </label>
              <div className="flex gap-1.5">
                <input
                  id="buyer-email"
                  className="input"
                  type="email"
                  value={editBuyer.email}
                  onChange={(e) => setEditBuyer({ ...editBuyer, email: e.target.value })}
                />
                <IconButton
                  icon={Copy}
                  label="Kopiuj e-mail"
                  className="h-[42px] w-[42px] shrink-0 rounded-xl"
                  onClick={() => onCopyEmail(editBuyer.email)}
                />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="buyer-phone">
                Telefon
              </label>
              <input
                id="buyer-phone"
                className="input"
                value={editBuyer.phone}
                placeholder="—"
                onChange={(e) => setEditBuyer({ ...editBuyer, phone: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="buyer-address">
                Adres
              </label>
              <input
                id="buyer-address"
                className="input"
                value={editBuyer.address}
                placeholder="—"
                onChange={(e) => setEditBuyer({ ...editBuyer, address: e.target.value })}
              />
            </div>
          </div>
        </div>

        {sections.map((section) => (
          <div key={section.id}>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">{section.name}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {section.fields.map((field) => {
                const inputId = `answer-${field.key}`;
                return (
                  <div key={field.key}>
                    {field.type === 'checkbox' ? (
                      <label className="flex items-center gap-2 pt-1 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                          checked={Boolean(editAnswers[field.key])}
                          onChange={(e) => setEditAnswers({ ...editAnswers, [field.key]: e.target.checked })}
                        />
                        {field.label}
                      </label>
                    ) : (
                      <>
                        <label className="label" htmlFor={inputId}>
                          {field.label}
                        </label>
                        {field.type === 'select' ? (
                          <select
                            id={inputId}
                            className="input"
                            value={String(editAnswers[field.key] ?? '')}
                            onChange={(e) => setEditAnswers({ ...editAnswers, [field.key]: e.target.value })}
                          >
                            <option value="">— wybierz —</option>
                            {field.options.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={inputId}
                            className="input"
                            type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                            value={String(editAnswers[field.key] ?? '')}
                            onChange={(e) => setEditAnswers({ ...editAnswers, [field.key]: e.target.value })}
                          />
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      </fieldset>

      <p className="flex gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Tu poprawiasz tylko dane kupującego i odpowiedzi. Status, bilet i płatności zmieniają się automatycznie wraz z
        procesem płatności (wyjątek: dopłatę po zaliczce możesz odnotować ręcznie).
      </p>
    </div>
  );
}
