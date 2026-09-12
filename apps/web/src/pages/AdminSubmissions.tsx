import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { flattenSections, type FormSection } from '@syjonevent/shared';
import { api, ApiError, formatDateTime, formatPln } from '../lib/api';

interface SubmissionRow {
  id: string;
  buyerEmail: string;
  buyerPhone: string | null;
  ticketNameSnapshot: string;
  ticketPriceCents: number;
  currency: string;
  status: 'RESERVED' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  reservationExpiresAt: string | null;
  createdAt: string;
}

interface SubmissionDetail {
  id: string;
  buyerEmail: string;
  buyerPhone: string | null;
  ticketNameSnapshot: string;
  ticketPriceCents: number;
  status: SubmissionRow['status'];
  payloadJson: Record<string, string | number | boolean>;
  schemaSnapshotJson: { sections: FormSection[] };
  createdAt: string;
}

const statusStyle: Record<SubmissionRow['status'], string> = {
  PAID: 'bg-emerald-100 text-emerald-700',
  RESERVED: 'bg-blue-100 text-blue-700',
  EXPIRED: 'bg-slate-100 text-slate-600',
  CANCELLED: 'bg-amber-100 text-amber-800',
};

export default function AdminSubmissions() {
  const { id } = useParams();
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [email, setEmail] = useState('');
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [editBuyer, setEditBuyer] = useState({ email: '', phone: '' });
  const [editAnswers, setEditAnswers] = useState<Record<string, string | number | boolean>>({});
  const [saveMessage, setSaveMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  function openDetail(submission: SubmissionDetail) {
    setDetail(submission);
    setEditBuyer({ email: submission.buyerEmail, phone: submission.buyerPhone ?? '' });
    setEditAnswers(submission.payloadJson ?? {});
    setSaveMessage(null);
  }

  async function saveDetail() {
    if (!detail) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const data = await api.patch<{ submission: SubmissionDetail }>(
        `/api/forms/${id}/submissions/${detail.id}`,
        { buyerEmail: editBuyer.email, buyerPhone: editBuyer.phone || null, answers: editAnswers },
      );
      openDetail(data.submission);
      setSaveMessage({ kind: 'ok', text: 'Zapisano zmiany' });
      void load();
    } catch (error) {
      setSaveMessage({ kind: 'error', text: error instanceof ApiError ? error.message : 'Błąd zapisu' });
    } finally {
      setSaving(false);
    }
  }

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (email) params.set('email', email);
    const data = await api.get<{ submissions: SubmissionRow[]; total: number }>(
      `/api/forms/${id}/submissions?${params.toString()}`,
    );
    setRows(data.submissions);
    setTotal(data.total);
  }, [id, status, email]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Link to="/admin" className="btn-secondary">
            ← Wydarzenia
          </Link>
          <h1 className="text-2xl font-semibold">Zgłoszenia ({total})</h1>
        </div>
        <div className="flex gap-2">
          <a className="btn-secondary" href={`/api/forms/${id}/submissions.csv`}>
            Eksport CSV
          </a>
          <Link to={`/admin/formularze/${id}`} className="btn-secondary">
            Edytuj wydarzenie
          </Link>
        </div>
      </div>

      <div className="card flex flex-wrap gap-3">
        <select className="input max-w-[200px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Wszystkie statusy</option>
          <option value="PAID">Opłacone</option>
          <option value="RESERVED">Rezerwacja</option>
          <option value="EXPIRED">Wygasłe</option>
          <option value="CANCELLED">Anulowane</option>
        </select>
        <input
          className="input max-w-[280px]"
          placeholder="Szukaj po e-mailu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Bilet</th>
              <th className="px-4 py-3">Kwota</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
                <td className="px-4 py-3">{row.buyerEmail}</td>
                <td className="px-4 py-3">{row.ticketNameSnapshot}</td>
                <td className="px-4 py-3">{formatPln(row.ticketPriceCents)}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${statusStyle[row.status]}`}>{row.status}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    className="text-brand-600 hover:underline"
                    onClick={async () => {
                      const data = await api.get<{ submission: SubmissionDetail }>(
                        `/api/forms/${id}/submissions/${row.id}`,
                      );
                      openDetail(data.submission);
                    }}
                  >
                    Szczegóły
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={6}>
                  Brak zgłoszeń dla wybranych filtrów.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">
              Edycja zgłoszenia · {detail.ticketNameSnapshot} · {formatPln(detail.ticketPriceCents)}
            </h2>
            <button className="btn-secondary" onClick={() => setDetail(null)}>
              Zamknij
            </button>
          </div>

          {saveMessage && (
            <p
              className={`rounded-lg px-3 py-2 text-sm ${
                saveMessage.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
              }`}
            >
              {saveMessage.text}
            </p>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">E-mail kupującego</label>
              <input
                className="input"
                type="email"
                value={editBuyer.email}
                onChange={(e) => setEditBuyer({ ...editBuyer, email: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Telefon</label>
              <input
                className="input"
                value={editBuyer.phone}
                onChange={(e) => setEditBuyer({ ...editBuyer, phone: e.target.value })}
              />
            </div>
          </div>

          {flattenSections(detail.schemaSnapshotJson.sections).length > 0 && (
            <div className="space-y-3">
              <p className="label">Odpowiedzi</p>
              {flattenSections(detail.schemaSnapshotJson.sections).map((field) => (
                <div key={field.key}>
                  {field.type === 'checkbox' ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(editAnswers[field.key])}
                        onChange={(e) => setEditAnswers({ ...editAnswers, [field.key]: e.target.checked })}
                      />
                      {field.label}
                    </label>
                  ) : (
                    <>
                      <label className="label">{field.label}</label>
                      {field.type === 'select' ? (
                        <select
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
                          className="input"
                          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                          value={String(editAnswers[field.key] ?? '')}
                          onChange={(e) => setEditAnswers({ ...editAnswers, [field.key]: e.target.value })}
                        />
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-slate-500">
            Status: {detail.status} · Zgłoszono {formatDateTime(detail.createdAt)}. Status, bilet i płatności
            edytuje się osobno — tu poprawiasz tylko dane kupującego i odpowiedzi.
          </p>

          <button className="btn-primary" onClick={saveDetail} disabled={saving}>
            {saving ? 'Zapisywanie…' : 'Zapisz zmiany'}
          </button>
        </div>
      )}
    </section>
  );
}
