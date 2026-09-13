import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChartColumn,
  ChartPie,
  CircleAlert,
  History,
  LoaderCircle,
  Ticket,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { DashboardDto } from '@syjonevent/shared';
import { api, ApiError, formatDateTime, formatPln } from '../lib/api';
import { plural } from '../lib/format';
import { SUBMISSION_STATUS, type SubmissionStatus } from '../lib/status';
import StatusBadge from '../components/ui/StatusBadge';

const STATUS_COLORS: Record<SubmissionStatus, string> = {
  PAID: '#10b981',
  RESERVED: '#3b82f6',
  EXPIRED: '#94a3b8',
  CANCELLED: '#f59e0b',
};

function KpiCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="card flex items-center gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="truncate text-2xl font-semibold text-slate-900">{value}</p>
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </div>
  );
}

function StatusDonut({ breakdown }: { breakdown: DashboardDto['statusBreakdown'] }) {
  const total = breakdown.reduce((sum, row) => sum + row.count, 0);
  let acc = 0;
  const segments = breakdown
    .filter((row) => row.count > 0)
    .map((row) => {
      const start = (acc / total) * 360;
      acc += row.count;
      const end = (acc / total) * 360;
      return `${STATUS_COLORS[row.status]} ${start}deg ${end}deg`;
    });
  const background = total > 0 ? `conic-gradient(${segments.join(', ')})` : '#e2e8f0';

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
      <div className="relative h-36 w-36 shrink-0 rounded-full" style={{ background }} role="img" aria-label="Rozkład statusów zgłoszeń">
        <div className="absolute inset-3 flex flex-col items-center justify-center rounded-full bg-white">
          <span className="text-2xl font-semibold text-slate-900">{total}</span>
          <span className="text-xs text-slate-500">zgłoszeń</span>
        </div>
      </div>
      <ul className="w-full max-w-xs space-y-2.5">
        {breakdown.map((row) => (
          <li key={row.status} className="flex items-center gap-2 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: STATUS_COLORS[row.status] }}
              aria-hidden
            />
            <span className="text-slate-600">{SUBMISSION_STATUS[row.status].label}</span>
            <span className="ml-auto font-medium text-slate-900">{row.count}</span>
            <span className="w-9 text-right text-xs text-slate-400">
              {total > 0 ? Math.round((row.count / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EventsBarChart({ events }: { events: DashboardDto['events'] }) {
  if (events.length === 0) return <p className="text-sm text-slate-500">Brak wydarzeń.</p>;
  const max = Math.max(1, ...events.map((e) => e.submissionCount));

  return (
    <ul className="space-y-3.5">
      {events.map((event) => (
        <li key={event.formId}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <Link
              to={`/admin/formularze/${event.formId}/zgloszenia`}
              className="truncate font-medium text-slate-800 hover:text-brand-700"
            >
              {event.title}
            </Link>
            <span className="shrink-0 whitespace-nowrap text-xs text-slate-500">
              {plural(event.submissionCount, 'zgłoszenie', 'zgłoszenia', 'zgłoszeń')}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-brand-500"
              style={{ width: `${(event.submissionCount / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<DashboardDto>('/api/dashboard')
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : 'Nie udało się wczytać statystyk'));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="card flex items-center gap-2 text-sm text-red-700">
        <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-500">
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
        Ładowanie statystyk…
      </div>
    );
  }

  const { totals } = data;

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Statystyki</h1>
        <p className="mt-1 text-sm text-slate-500">
          {plural(totals.eventsPublished, 'opublikowane wydarzenie', 'opublikowane wydarzenia', 'opublikowanych wydarzeń')} ·{' '}
          {plural(totals.eventsDraft, 'szkic', 'szkice', 'szkiców')} ·{' '}
          {plural(totals.eventsArchived, 'archiwum', 'archiwa', 'archiwów')}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Users} label="Zgłoszenia łącznie" value={String(totals.submissions)} />
        <KpiCard icon={Wallet} label="Przychód (opłacone)" value={formatPln(totals.revenueCents)} />
        <KpiCard icon={Ticket} label="Opłacone bilety" value={String(totals.paid)} />
        <KpiCard icon={History} label="Rezerwacje w toku" value={String(totals.reserved)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 font-display text-base font-semibold">
            <ChartPie className="h-4.5 w-4.5 text-brand-600" aria-hidden />
            Statusy zgłoszeń
          </h2>
          <StatusDonut breakdown={data.statusBreakdown} />
        </div>

        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 font-display text-base font-semibold">
            <ChartColumn className="h-4.5 w-4.5 text-brand-600" aria-hidden />
            Zgłoszenia wg wydarzenia
          </h2>
          <EventsBarChart events={data.events} />
        </div>
      </div>

      <div className="card">
        <h2 className="mb-4 flex items-center gap-2 font-display text-base font-semibold">
          <History className="h-4.5 w-4.5 text-brand-600" aria-hidden />
          Ostatnie rejestracje
        </h2>
        {data.recentRegistrations.length === 0 ? (
          <p className="text-sm text-slate-500">Jeszcze nikt się nie zarejestrował.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4 font-medium">Uczestnik</th>
                  <th className="py-2 pr-4 font-medium">Wydarzenie</th>
                  <th className="py-2 pr-4 font-medium">Data</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recentRegistrations.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-slate-800">{row.displayName ?? row.buyerEmail}</td>
                    <td className="py-2.5 pr-4 text-slate-600">{row.formTitle}</td>
                    <td className="py-2.5 pr-4 whitespace-nowrap text-slate-500">{formatDateTime(row.createdAt)}</td>
                    <td className="py-2.5">
                      <StatusBadge meta={SUBMISSION_STATUS[row.status]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
