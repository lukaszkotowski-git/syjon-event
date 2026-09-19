import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import {
  CalendarCog,
  History,
  LoaderCircle,
  Mail,
  QrCode,
  ScanLine,
  Ticket,
  UserCog,
  UserPen,
  X,
  type LucideIcon,
} from 'lucide-react';
import { hasFullAccess, type AuditLogEntryDto } from '@syjonevent/shared';
import Pagination from '../components/ui/Pagination';
import { useToast } from '../components/ui/Toast';
import { useAdmin } from '../lib/admin';
import { api, ApiError, formatDateTime } from '../lib/api';

const PAGE_SIZE = 50;

/** Ikona wpisu po prefiksie akcji ("form.update" → form). */
const ACTION_ICONS: Record<string, LucideIcon> = {
  form: CalendarCog,
  ticket_type: Ticket,
  discount_code: Ticket,
  submission: UserPen,
  ticket: QrCode,
  station: ScanLine,
  message: Mail,
  admin: UserCog,
};

export default function AdminAuditLog() {
  const me = useAdmin();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const formId = searchParams.get('formId');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ entries: AuditLogEntryDto[]; total: number } | null>(null);

  useEffect(() => {
    if (!hasFullAccess(me.role)) return;
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (formId) params.set('formId', formId);
    api
      .get<{ entries: AuditLogEntryDto[]; total: number }>(`/api/audit?${params.toString()}`)
      .then(setData)
      .catch((error) => toast.error(error instanceof ApiError ? error.message : 'Nie udało się pobrać dziennika'));
  }, [me.role, formId, page, toast]);

  useEffect(() => setPage(1), [formId]);

  if (!hasFullAccess(me.role)) return <Navigate to="/admin" replace />;

  const filteredTitle = formId ? data?.entries.find((e) => e.formId === formId)?.formTitle : null;

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Dziennik zmian</h1>
        <p className="text-sm text-slate-500">Kto, co i kiedy zmienił w panelu.</p>
      </div>

      {formId && (
        <p className="inline-flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-900">
          Tylko wydarzenie: <strong className="font-medium">{filteredTitle ?? 'wybrane wydarzenie'}</strong>
          <button
            type="button"
            className="rounded-md p-0.5 text-brand-700 hover:bg-brand-100"
            aria-label="Pokaż wszystkie wpisy"
            onClick={() => setSearchParams({})}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </p>
      )}

      <div className="card p-0">
        {!data ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            Ładowanie dziennika…
          </div>
        ) : data.entries.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-12 text-center">
            <History className="h-8 w-8 text-slate-300" aria-hidden />
            <p className="mt-3 font-medium text-slate-800">Brak wpisów</p>
            <p className="mt-1 text-sm text-slate-500">Zmiany wprowadzone w panelu pojawią się tutaj.</p>
          </div>
        ) : (
          <ol className="divide-y divide-slate-100">
            {data.entries.map((entry) => {
              const Icon = ACTION_ICONS[entry.action.split('.')[0] ?? ''] ?? History;
              return (
                <li key={entry.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-900">{entry.summary}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {entry.adminEmail} · {formatDateTime(entry.createdAt)}
                      {entry.formId && entry.formTitle && !formId && (
                        <>
                          {' · '}
                          <Link to={`/admin/dziennik?formId=${entry.formId}`} className="text-brand-700 hover:underline">
                            {entry.formTitle}
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {data && <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />}
      </div>
    </section>
  );
}
