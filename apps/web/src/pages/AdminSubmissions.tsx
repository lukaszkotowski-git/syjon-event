import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatDateTime, formatPln } from '../lib/api';

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
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Zgłoszenia ({total})</h1>
        <div className="flex gap-2">
          <a className="btn-secondary" href={`/api/forms/${id}/submissions.csv`}>
            Eksport CSV
          </a>
          <Link to={`/admin/formularze/${id}`} className="btn-secondary">
            Edytuj formularz
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
                      const data = await api.get<{ submission: Record<string, unknown> }>(
                        `/api/forms/${id}/submissions/${row.id}`,
                      );
                      setDetail(data.submission);
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
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-medium">Szczegóły zgłoszenia (dane snapshotowe)</h2>
            <button className="btn-secondary" onClick={() => setDetail(null)}>
              Zamknij
            </button>
          </div>
          <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
            {JSON.stringify(detail, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
