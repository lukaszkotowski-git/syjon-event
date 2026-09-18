import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Archive,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CircleCheck,
  Copy,
  ExternalLink,
  Hourglass,
  Lock,
  Pencil,
  ScanLine,
  Plus,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { api, ApiError, formatDateTime } from '../lib/api';
import { plural } from '../lib/format';
import { FORM_STATUS, type FormStatus } from '../lib/status';
import { useConfirm } from '../components/ui/ConfirmDialog';
import IconButton from '../components/ui/IconButton';
import StatusBadge from '../components/ui/StatusBadge';
import { useToast } from '../components/ui/Toast';

interface FormRow {
  id: string;
  slug: string;
  title: string;
  status: FormStatus;
  eventDate: string;
  closesAt: string;
  isOpen: boolean;
  capacityTotal: number | null;
  paidCount: number;
  reservedCount: number;
  submissionCount: number;
  thumbnailUrl: string | null;
  createdByEmail: string | null;
}

type Tab = 'ALL' | FormStatus;

const TABS: { value: Tab; label: string }[] = [
  { value: 'ALL', label: 'Wszystkie' },
  { value: 'PUBLISHED', label: 'Opublikowane' },
  { value: 'DRAFT', label: 'Szkice' },
  { value: 'ARCHIVED', label: 'Archiwum' },
];

function isTab(value: string | null): value is Tab {
  return TABS.some((t) => t.value === value);
}

export default function AdminFormsList() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('status');
  const tab: Tab = isTab(tabParam) ? tabParam : 'ALL';

  const [forms, setForms] = useState<FormRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ forms: FormRow[] }>('/api/forms')
      .then((data) => setForms(data.forms))
      .catch((error) => {
        setForms([]);
        toast.error(error instanceof ApiError ? error.message : 'Nie udało się pobrać wydarzeń');
      });
  }, [toast]);

  function setTab(next: Tab) {
    setSearchParams(next === 'ALL' ? {} : { status: next }, { replace: true });
  }

  async function copyLink(form: FormRow) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/f/${form.slug}`);
      toast.success('Skopiowano link do formularza');
    } catch {
      toast.error('Nie udało się skopiować linku');
    }
  }

  async function archiveForm(form: FormRow) {
    const confirmed = await confirm({
      title: 'Zarchiwizować wydarzenie?',
      description: (
        <>
          <strong className="font-medium text-slate-800">{form.title}</strong> przestanie przyjmować zgłoszenia.
          Istniejące zgłoszenia i płatności zostaną zachowane.
        </>
      ),
      confirmLabel: 'Archiwizuj',
      tone: 'danger',
    });
    if (!confirmed) return;
    setBusyId(form.id);
    try {
      const data = await api.post<{ form: { status: FormStatus } }>(`/api/forms/${form.id}/archive`);
      setForms((prev) =>
        prev?.map((f) => (f.id === form.id ? { ...f, status: data.form.status, isOpen: false } : f)) ?? prev,
      );
      toast.success('Wydarzenie zarchiwizowane');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się zarchiwizować wydarzenia');
    } finally {
      setBusyId(null);
    }
  }

  async function deleteForm(form: FormRow) {
    const confirmed = await confirm({
      title: 'Usunąć wydarzenie?',
      description: (
        <>
          <strong className="font-medium text-slate-800">{form.title}</strong> zostanie trwale usunięte. Tej operacji
          nie można cofnąć.
        </>
      ),
      confirmLabel: 'Usuń wydarzenie',
      tone: 'danger',
    });
    if (!confirmed) return;
    setBusyId(form.id);
    try {
      await api.delete(`/api/forms/${form.id}`);
      setForms((prev) => prev?.filter((f) => f.id !== form.id) ?? prev);
      toast.success('Wydarzenie usunięte');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się usunąć wydarzenia');
    } finally {
      setBusyId(null);
    }
  }

  async function purgeForm(form: FormRow) {
    const confirmed = await confirm({
      title: 'Usunąć wydarzenie trwale?',
      description: (
        <>
          <strong className="font-medium text-slate-800">{form.title}</strong> oraz{' '}
          <strong className="font-medium text-slate-800">wszystkie {form.submissionCount} zgłoszenia(-ń)</strong> i
          powiązane płatności zostaną nieodwracalnie usunięte z bazy danych. Tej operacji nie można cofnąć.
        </>
      ),
      confirmLabel: 'Usuń trwale wraz z danymi',
      tone: 'danger',
    });
    if (!confirmed) return;
    setBusyId(form.id);
    try {
      await api.delete(`/api/forms/${form.id}?force=true`);
      setForms((prev) => prev?.filter((f) => f.id !== form.id) ?? prev);
      toast.success('Wydarzenie usunięte trwale');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się usunąć wydarzenia');
    } finally {
      setBusyId(null);
    }
  }

  const counts: Record<Tab, number> = {
    ALL: forms?.length ?? 0,
    PUBLISHED: forms?.filter((f) => f.status === 'PUBLISHED').length ?? 0,
    DRAFT: forms?.filter((f) => f.status === 'DRAFT').length ?? 0,
    ARCHIVED: forms?.filter((f) => f.status === 'ARCHIVED').length ?? 0,
  };
  const visible = forms?.filter((f) => tab === 'ALL' || f.status === tab) ?? [];

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Wydarzenia</h1>
          {forms && forms.length > 0 && (
            <p className="text-sm text-slate-500">
              {plural(counts.PUBLISHED, 'opublikowane', 'opublikowane', 'opublikowanych')} ·{' '}
              {plural(counts.DRAFT, 'szkic', 'szkice', 'szkiców')}
            </p>
          )}
        </div>
        <Link to="/admin/formularze/nowy" className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden />
          Nowe wydarzenie
        </Link>
      </div>

      {forms && forms.length > 0 && (
        <div role="tablist" aria-label="Status wydarzenia" className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {TABS.map((item) => {
            const active = tab === item.value;
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.value)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-brand-600 text-white shadow-soft' : 'text-slate-600 hover:bg-white'
                }`}
              >
                {item.label}
                <span
                  className={`rounded-full px-1.5 text-xs tabular-nums ${
                    active ? 'bg-white/20 text-white' : 'bg-slate-200/70 text-slate-500'
                  }`}
                >
                  {counts[item.value]}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!forms && (
        <div className="grid gap-3" aria-busy="true" aria-label="Ładowanie wydarzeń">
          {[0, 1].map((i) => (
            <div key={i} className="card flex animate-pulse gap-4">
              <div className="hidden h-24 w-36 rounded-xl bg-slate-100 sm:block" />
              <div className="flex-1 space-y-3 py-1">
                <div className="h-4 w-1/3 rounded bg-slate-100" />
                <div className="h-3 w-1/4 rounded bg-slate-100" />
                <div className="h-3 w-1/2 rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      )}

      {forms?.length === 0 && (
        <div className="card flex flex-col items-center px-6 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <CalendarPlus className="h-7 w-7" aria-hidden />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-900">Nie masz jeszcze wydarzeń</h2>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            Utwórz pierwsze wydarzenie — formularz rejestracji, bilety i płatności skonfigurujesz w jednym miejscu.
          </p>
          <Link to="/admin/formularze/nowy" className="btn-primary mt-5">
            <Plus className="h-4 w-4" aria-hidden />
            Utwórz wydarzenie
          </Link>
        </div>
      )}

      {forms && forms.length > 0 && visible.length === 0 && (
        <div className="card py-10 text-center text-sm text-slate-500">
          Brak wydarzeń w tej zakładce.{' '}
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setTab('ALL')}>
            Pokaż wszystkie
          </button>
        </div>
      )}

      <div className="grid gap-3">
        {visible.map((form) => {
          const taken = form.paidCount + form.reservedCount;
          const capacity = form.capacityTotal;
          const paidPercent = capacity ? Math.min(100, (form.paidCount / capacity) * 100) : 0;
          const reservedPercent = capacity ? Math.min(100 - paidPercent, (form.reservedCount / capacity) * 100) : 0;
          const closed = new Date(form.closesAt) <= new Date();
          const busy = busyId === form.id;

          return (
            <article
              key={form.id}
              className={`card flex flex-col gap-4 transition hover:shadow-soft sm:flex-row sm:items-center ${
                form.status === 'ARCHIVED' ? 'opacity-80' : ''
              }`}
            >
              <Link
                to={`/admin/formularze/${form.id}`}
                tabIndex={-1}
                aria-hidden
                className="relative hidden h-24 w-36 shrink-0 overflow-hidden rounded-xl bg-brand-gradient sm:block"
              >
                {form.thumbnailUrl ? (
                  <img src={form.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <img
                    src="/logo.png"
                    alt=""
                    className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 opacity-80"
                  />
                )}
              </Link>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/admin/formularze/${form.id}`}
                    className="truncate font-display text-base font-semibold text-slate-900 hover:text-brand-700"
                  >
                    {form.title}
                  </Link>
                  <StatusBadge meta={FORM_STATUS[form.status]} />
                  {form.status === 'PUBLISHED' && !form.isOpen && (
                    <StatusBadge meta={{ label: 'Zapisy zamknięte', icon: Lock, className: 'bg-red-100 text-red-700' }} />
                  )}
                </div>

                <div className="mt-0.5 flex items-center gap-1">
                  <span className="truncate font-mono text-xs text-slate-400">/f/{form.slug}</span>
                  <IconButton icon={Copy} label="Kopiuj link" size="sm" onClick={() => void copyLink(form)} />
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                  <span className="inline-flex items-center gap-1.5" title="Data wydarzenia">
                    <CalendarDays className="h-4 w-4 text-slate-400" aria-hidden />
                    {formatDateTime(form.eventDate)}
                  </span>
                  {form.status === 'PUBLISHED' && (
                    <span className="inline-flex items-center gap-1.5 text-slate-400" title="Zamknięcie zapisów">
                      <CalendarClock className="h-4 w-4" aria-hidden />
                      {closed ? 'Zapisy zamknięte ' : 'Zapisy do '}
                      {formatDateTime(form.closesAt)}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <CircleCheck className="h-4 w-4 text-emerald-500" aria-hidden />
                    {plural(form.paidCount, 'opłacone', 'opłacone', 'opłaconych')}
                  </span>
                  {form.reservedCount > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <Hourglass className="h-4 w-4 text-blue-500" aria-hidden />
                      {plural(form.reservedCount, 'rezerwacja', 'rezerwacje', 'rezerwacji')}
                    </span>
                  )}
                  {form.createdByEmail && (
                    <span className="inline-flex items-center gap-1.5 text-slate-400" title="Utworzone przez">
                      <UserRound className="h-4 w-4" aria-hidden />
                      {form.createdByEmail}
                    </span>
                  )}
                </div>

                {capacity !== null && (
                  <div className="mt-2.5 flex items-center gap-3">
                    <div
                      className="flex h-2 w-full max-w-xs overflow-hidden rounded-full bg-slate-100"
                      role="img"
                      aria-label={`Zajęte ${taken} z ${capacity} miejsc`}
                    >
                      <div className="h-full bg-brand-600" style={{ width: `${paidPercent}%` }} />
                      <div className="h-full bg-brand-300" style={{ width: `${reservedPercent}%` }} />
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">
                      {taken} / {capacity} miejsc
                    </span>
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <Link to={`/admin/formularze/${form.id}/zgloszenia`} className="btn-secondary px-3.5">
                  <Users className="h-4 w-4" aria-hidden />
                  Zgłoszenia
                  <span className="rounded-full bg-slate-100 px-1.5 text-xs tabular-nums text-slate-600">
                    {form.submissionCount}
                  </span>
                </Link>
                {form.paidCount > 0 && (
                  <IconButton
                    icon={ScanLine}
                    label="Obecność i skanowanie"
                    size="lg"
                    onClick={() => navigate(`/admin/formularze/${form.id}/obecnosc`)}
                  />
                )}
                <IconButton
                  icon={Pencil}
                  label="Edytuj"
                  size="lg"
                  onClick={() => navigate(`/admin/formularze/${form.id}`)}
                />
                {form.status === 'PUBLISHED' && (
                  <IconButton
                    icon={ExternalLink}
                    label="Otwórz formularz"
                    size="lg"
                    onClick={() => window.open(`/f/${form.slug}`, '_blank', 'noopener')}
                  />
                )}
                {form.submissionCount === 0 ? (
                  <IconButton
                    icon={Trash2}
                    label="Usuń"
                    tone="danger"
                    size="lg"
                    disabled={busy}
                    onClick={() => void deleteForm(form)}
                  />
                ) : form.status !== 'ARCHIVED' ? (
                  // Wydarzenia ze zgłoszeniami nie da się usunąć od razu — proponujemy archiwizację jako pierwszy krok.
                  <IconButton
                    icon={Archive}
                    label="Archiwizuj"
                    tone="danger"
                    size="lg"
                    disabled={busy}
                    onClick={() => void archiveForm(form)}
                  />
                ) : (
                  // Zarchiwizowane wydarzenie ze zgłoszeniami można usunąć trwale wraz z danymi.
                  <IconButton
                    icon={Trash2}
                    label="Usuń trwale"
                    tone="danger"
                    size="lg"
                    disabled={busy}
                    onClick={() => void purgeForm(form)}
                  />
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
