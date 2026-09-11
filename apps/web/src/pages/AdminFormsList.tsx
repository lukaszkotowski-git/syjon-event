import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDateTime } from '../lib/api';

interface FormRow {
  id: string;
  slug: string;
  title: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  closesAt: string;
  isOpen: boolean;
  capacityTotal: number | null;
  paidCount: number;
  reservedCount: number;
}

const statusStyle: Record<FormRow['status'], string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  ARCHIVED: 'bg-amber-100 text-amber-800',
};

export default function AdminFormsList() {
  const [forms, setForms] = useState<FormRow[] | null>(null);

  useEffect(() => {
    api.get<{ forms: FormRow[] }>('/api/forms').then((data) => setForms(data.forms));
  }, []);

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Formularze</h1>
        <Link to="/admin/formularze/nowy" className="btn-primary">
          Nowy formularz
        </Link>
      </div>

      {!forms && <p className="text-slate-500">Ładowanie…</p>}
      {forms?.length === 0 && <p className="text-slate-500">Brak formularzy. Utwórz pierwszy.</p>}

      <div className="grid gap-3">
        {forms?.map((form) => (
          <article key={form.id} className="card flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate font-medium">{form.title}</h2>
                <span className={`badge ${statusStyle[form.status]}`}>{form.status}</span>
                {!form.isOpen && form.status === 'PUBLISHED' && (
                  <span className="badge bg-red-100 text-red-700">zamknięty</span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-500">
                /f/{form.slug} · zamknięcie {formatDateTime(form.closesAt)} · opłacone {form.paidCount}
                {form.capacityTotal !== null ? ` / ${form.capacityTotal}` : ''} · rezerwacje{' '}
                {form.reservedCount}
              </p>
            </div>
            <div className="flex gap-2">
              <Link to={`/admin/formularze/${form.id}`} className="btn-secondary">
                Edytuj
              </Link>
              <Link to={`/admin/formularze/${form.id}/zgloszenia`} className="btn-secondary">
                Zgłoszenia
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
