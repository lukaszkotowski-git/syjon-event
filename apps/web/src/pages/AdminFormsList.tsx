import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, formatDateTime } from '../lib/api';

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
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  useEffect(() => {
    api.get<{ forms: FormRow[] }>('/api/forms').then((data) => setForms(data.forms));
  }, []);

  async function deleteForm(id: string) {
    setBusyId(id);
    setErrorById((prev) => ({ ...prev, [id]: '' }));
    try {
      await api.delete(`/api/forms/${id}`);
      setForms((prev) => prev?.filter((f) => f.id !== id) ?? prev);
      setConfirmId(null);
    } catch (error) {
      setErrorById((prev) => ({
        ...prev,
        [id]: error instanceof ApiError ? error.message : 'Nie udało się usunąć wydarzenia',
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Wydarzenia</h1>
        <Link to="/admin/formularze/nowy" className="btn-primary">
          Nowe wydarzenie
        </Link>
      </div>

      {!forms && <p className="text-slate-500">Ładowanie…</p>}
      {forms?.length === 0 && <p className="text-slate-500">Brak wydarzeń. Utwórz pierwsze.</p>}

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
              {errorById[form.id] && <p className="mt-1.5 text-sm text-red-600">{errorById[form.id]}</p>}
            </div>
            <div className="flex gap-2">
              <Link to={`/admin/formularze/${form.id}`} className="btn-secondary">
                Edytuj
              </Link>
              <Link to={`/admin/formularze/${form.id}/zgloszenia`} className="btn-secondary">
                Zgłoszenia
              </Link>
              {confirmId === form.id ? (
                <>
                  <button
                    type="button"
                    className="btn-secondary text-red-600"
                    disabled={busyId === form.id}
                    onClick={() => deleteForm(form.id)}
                  >
                    {busyId === form.id ? 'Usuwanie…' : 'Na pewno usuń'}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setConfirmId(null)}>
                    Anuluj
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn-secondary text-red-600"
                  onClick={() => setConfirmId(form.id)}
                >
                  Usuń
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
