import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChartBar, ClipboardList, LoaderCircle, Printer, UserX, type LucideIcon } from 'lucide-react';
import type { EventReportDto } from '@syjonevent/shared';
import { useToast } from '../components/ui/Toast';
import { api, ApiError, formatDate, formatDateTime, formatPln } from '../lib/api';

type ReportKind = 'lista' | 'odpowiedzi' | 'nieobecni';

const REPORTS: { key: ReportKind; label: string; icon: LucideIcon; description: string }[] = [
  { key: 'lista', label: 'Lista obecności', icon: ClipboardList, description: 'Wszyscy z opłaconym biletem, alfabetycznie, z miejscem na podpis.' },
  { key: 'odpowiedzi', label: 'Zestawienie odpowiedzi', icon: ChartBar, description: 'Liczba odpowiedzi na listy wyboru i checkboxy (np. diety, rozmiary) oraz zgody.' },
  { key: 'nieobecni', label: 'Kto jeszcze nie przyszedł', icon: UserX, description: 'Osoby z biletem bez zarejestrowanego wejścia.' },
];

function isReportKind(value: string | null): value is ReportKind {
  return REPORTS.some((r) => r.key === value);
}

export default function AdminReports() {
  const { id } = useParams();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const kindParam = searchParams.get('raport');
  const kind: ReportKind = isReportKind(kindParam) ? kindParam : 'lista';
  const [report, setReport] = useState<EventReportDto | null>(null);

  useEffect(() => {
    api
      .get<EventReportDto>(`/api/forms/${id}/report`)
      .then(setReport)
      .catch((error) => toast.error(error instanceof ApiError ? error.message : 'Nie udało się przygotować raportu'));
  }, [id, toast]);

  const current = REPORTS.find((r) => r.key === kind) ?? REPORTS[0]!;
  const absent = report?.participants.filter((p) => !p.checkedInAt) ?? [];

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <Link
            to={`/admin/formularze/${id}/zgloszenia`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Zgłoszenia
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Raporty</h1>
          {report && <p className="truncate text-sm text-slate-500">{report.form.title}</p>}
        </div>
        <button type="button" className="btn-primary" onClick={() => window.print()} disabled={!report}>
          <Printer className="h-4 w-4" aria-hidden />
          Drukuj / zapisz PDF
        </button>
      </div>

      <div role="tablist" aria-label="Rodzaj raportu" className="grid gap-2 sm:grid-cols-3 print:hidden">
        {REPORTS.map((item) => {
          const active = item.key === kind;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSearchParams({ raport: item.key }, { replace: true })}
              className={`flex items-start gap-3 rounded-2xl border-2 p-3 text-left transition ${
                active ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-white hover:border-brand-300'
              }`}
            >
              <item.icon className={`mt-0.5 h-5 w-5 shrink-0 ${active ? 'text-brand-700' : 'text-slate-400'}`} aria-hidden />
              <span>
                <span className="block font-medium text-slate-900">{item.label}</span>
                <span className="block text-xs text-slate-500">{item.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      {!report ? (
        <div className="card flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          Przygotowuję raport…
        </div>
      ) : (
        <article className="card print:border-0 print:p-0 print:shadow-none">
          <header className="mb-4 border-b border-slate-200 pb-3">
            <h2 className="text-xl font-semibold">{current.label}</h2>
            <p className="text-sm text-slate-600">
              {report.form.title} · {formatDate(report.form.eventDate)}
              {report.form.location && ` · ${report.form.location}`}
            </p>
            <p className="text-xs text-slate-400">Stan na {formatDateTime(report.generatedAt)}</p>
            <p className="mt-1 text-sm text-slate-600">
              Wpłaty: <strong>{formatPln(report.finance.receivedCents)}</strong>
              {report.finance.depositPaidCount > 0 && (
                <>
                  {' '}
                  · Do dopłaty: <strong>{formatPln(report.finance.outstandingCents)}</strong> (
                  {report.finance.depositPaidCount} {report.finance.depositPaidCount === 1 ? 'osoba' : 'os.'} z samą
                  zaliczką — nie ma ich na liście, dopóki nie dopłacą)
                </>
              )}
            </p>
          </header>

          {kind === 'lista' && (
            <ParticipantTable participants={report.participants} withSignature emptyText="Brak osób z opłaconym biletem." />
          )}

          {kind === 'nieobecni' && (
            <>
              <p className="mb-3 text-sm text-slate-600">
                Nie weszło jeszcze: <strong>{absent.length}</strong> z {report.participants.length}
              </p>
              <ParticipantTable participants={absent} withPhone emptyText="Wszyscy są już na miejscu." />
            </>
          )}

          {kind === 'odpowiedzi' && (
            <div className="space-y-6">
              {report.answerSummaries.length === 0 && report.consentSummaries.length === 0 && (
                <p className="text-sm text-slate-500">Formularz nie ma list wyboru, checkboxów ani zgód do zestawienia.</p>
              )}
              {report.answerSummaries.map((summary) => (
                <div key={summary.key} className="break-inside-avoid">
                  <h3 className="font-medium text-slate-900">{summary.label}</h3>
                  <p className="text-xs text-slate-500">Odpowiedzi: {summary.answered}</p>
                  <table className="mt-2 w-full max-w-md text-sm">
                    <tbody>
                      {summary.counts.map((row) => {
                        const percent = summary.answered ? Math.round((row.count / summary.answered) * 100) : 0;
                        return (
                          <tr key={row.option} className="border-t border-slate-100">
                            <td className="py-1.5 pr-3 text-slate-700">{row.option}</td>
                            <td className="w-40 py-1.5 print:hidden">
                              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                <div className="h-full bg-brand-500" style={{ width: `${percent}%` }} />
                              </div>
                            </td>
                            <td className="w-20 py-1.5 text-right font-medium tabular-nums">{row.count}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
              {report.consentSummaries.length > 0 && (
                <div className="break-inside-avoid">
                  <h3 className="font-medium text-slate-900">Zgody dodatkowe</h3>
                  <table className="mt-2 w-full max-w-md text-sm">
                    <tbody>
                      {report.consentSummaries.map((consent) => (
                        <tr key={consent.key} className="border-t border-slate-100">
                          <td className="py-1.5 pr-3 text-slate-700">{consent.label}</td>
                          <td className="w-28 py-1.5 text-right font-medium tabular-nums">
                            {consent.accepted} / {consent.total}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </article>
      )}
    </section>
  );
}

function ParticipantTable({
  participants,
  withSignature = false,
  withPhone = false,
  emptyText,
}: {
  participants: EventReportDto['participants'];
  withSignature?: boolean;
  withPhone?: boolean;
  emptyText: string;
}) {
  if (participants.length === 0) return <p className="text-sm text-slate-500">{emptyText}</p>;
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="w-10 py-2 pr-2">#</th>
            <th className="py-2 pr-3">Uczestnik</th>
            <th className="py-2 pr-3">{withPhone ? 'Kontakt' : 'E-mail'}</th>
            <th className="py-2 pr-3">Bilet</th>
            <th className="py-2 pr-3">Nr</th>
            {withSignature && <th className="w-40 py-2">Podpis</th>}
          </tr>
        </thead>
        <tbody>
          {participants.map((p, index) => (
            <tr key={p.submissionId} className="break-inside-avoid border-t border-slate-200">
              <td className="py-2.5 pr-2 tabular-nums text-slate-400">{index + 1}</td>
              <td className="py-2.5 pr-3 font-medium text-slate-900">
                {p.displayName ?? '—'}
                {withSignature && p.checkedInAt && (
                  <span className="ml-1.5 text-xs font-normal text-emerald-700">✓ na miejscu</span>
                )}
              </td>
              <td className="py-2.5 pr-3 text-slate-600">
                {withPhone ? [p.phone, p.email].filter(Boolean).join(' · ') : p.email}
              </td>
              <td className="py-2.5 pr-3 text-slate-600">{p.ticketName}</td>
              <td className="py-2.5 pr-3 font-mono text-xs text-slate-600">{p.ticketReference}</td>
              {withSignature && <td className="border-b border-dotted border-slate-300 py-2.5" />}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
