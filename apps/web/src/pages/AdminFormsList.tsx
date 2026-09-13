import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { api, ApiError, formatDateTime } from '../lib/api';
import { FORM_STATUS, type FormStatus } from '../lib/status';
import { useConfirm } from '../components/ui/ConfirmDialog';
import StatusBadge from '../components/ui/StatusBadge';
import { useToast } from '../components/ui/Toast';

interface FormRow {
  id: string;
  slug: string;
  title: string;
  status: FormStatus;
  closesAt: string;
  isOpen: boolean;
  capacityTotal: number | null;
  paidCount: number;
  reservedCount: number;
}

export default function AdminFormsList() {
  const [forms, setForms] = useState<FormRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    api.get<{ forms: FormRow[] }>('/api/forms').then((data) => setForms(data.forms));
  }, []);

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
                <StatusBadge meta={FORM_STATUS[form.status]} />
                {!form.isOpen && form.status === 'PUBLISHED' && (
                  <StatusBadge meta={{ label: 'Zapisy zamknięte', icon: Lock, className: 'bg-red-100 text-red-700' }} />
                )}
              </div>
              <p className="mt-1 font-mono text-xs text-slate-400">/f/{form.slug}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                <span>
                  <span className="text-slate-400">Zamknięcie: </span>
                  {formatDateTime(form.closesAt)}
                </span>
                <span>
                  <span className="text-slate-400">Opłacone: </span>
                  {form.paidCount}
                  {form.capacityTotal !== null ? ` / ${form.capacityTotal}` : ''}
                </span>
                <span>
                  <span className="text-slate-400">Rezerwacje: </span>
                  {form.reservedCount}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Link to={`/admin/formularze/${form.id}`} className="btn-secondary">
                Edytuj
              </Link>
              <Link to={`/admin/formularze/${form.id}/zgloszenia`} className="btn-secondary">
                Zgłoszenia
              </Link>
              <button
                type="button"
                className="btn-secondary text-red-600"
                disabled={busyId === form.id}
                onClick={() => deleteForm(form)}
              >
                {busyId === form.id ? 'Usuwanie…' : 'Usuń'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
