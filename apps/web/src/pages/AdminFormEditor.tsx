import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { FieldDefinition } from '@syjonevent/shared';
import FieldBuilder from '../components/FieldBuilder';
import { api, ApiError, formatPln } from '../lib/api';

interface Ticket {
  id: string;
  name: string;
  priceCents: number;
  capacity: number | null;
  sortOrder: number;
  isActive: boolean;
}

interface FormDetails {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  closesAt: string;
  capacityTotal: number | null;
  requirePhone: boolean;
  termsVersion: string;
  privacyPolicyVersion: string;
  paymentSuccessTitle: string | null;
  paymentSuccessBody: string | null;
  paymentErrorTitle: string | null;
  paymentErrorBody: string | null;
  schemaJson: { fields: FieldDefinition[]; customScript?: string };
  ticketTypes: Ticket[];
}

const toLocalInput = (iso: string) => {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

export default function AdminFormEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const [form, setForm] = useState<FormDetails | null>(null);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [customScript, setCustomScript] = useState('');
  const [occupancy, setOccupancy] = useState<{ total: number; perTicketType: Record<string, number> }>({
    total: 0,
    perTicketType: {},
  });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState({
    slug: '',
    title: '',
    description: '',
    closesAt: toLocalInput(new Date(Date.now() + 30 * 86_400_000).toISOString()),
    capacityTotal: '',
    requirePhone: false,
    termsVersion: '1.0',
    privacyPolicyVersion: '1.0',
    paymentSuccessTitle: '',
    paymentSuccessBody: '',
    paymentErrorTitle: '',
    paymentErrorBody: '',
  });

  useEffect(() => {
    if (!id) return;
    api
      .get<{ form: FormDetails; occupancy: { total: number; perTicketType: Record<string, number> } }>(
        `/api/forms/${id}`,
      )
      .then((data) => {
        setForm(data.form);
        setOccupancy(data.occupancy);
        setFields(data.form.schemaJson.fields ?? []);
        setCustomScript(data.form.schemaJson.customScript ?? '');
        setDraft({
          slug: data.form.slug,
          title: data.form.title,
          description: data.form.description ?? '',
          closesAt: toLocalInput(data.form.closesAt),
          capacityTotal: data.form.capacityTotal?.toString() ?? '',
          requirePhone: data.form.requirePhone,
          termsVersion: data.form.termsVersion,
          privacyPolicyVersion: data.form.privacyPolicyVersion,
          paymentSuccessTitle: data.form.paymentSuccessTitle ?? '',
          paymentSuccessBody: data.form.paymentSuccessBody ?? '',
          paymentErrorTitle: data.form.paymentErrorTitle ?? '',
          paymentErrorBody: data.form.paymentErrorBody ?? '',
        });
      })
      .catch((error: ApiError) => setMessage({ kind: 'error', text: error.message }));
  }, [id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    // Siatka bezpieczeństwa: opcje select mogą zawierać niedoczyszczone puste
    // wiersze podczas edycji (czyszczenie dzieje się na onBlur w FieldBuilder).
    const cleanedFields = fields.map((field) =>
      field.type === 'select'
        ? { ...field, options: field.options.map((o) => o.trim()).filter(Boolean) }
        : field,
    );
    const payload = {
      slug: draft.slug,
      title: draft.title,
      description: draft.description || null,
      closesAt: new Date(draft.closesAt).toISOString(),
      capacityTotal: draft.capacityTotal === '' ? null : Number(draft.capacityTotal),
      requirePhone: draft.requirePhone,
      termsVersion: draft.termsVersion,
      privacyPolicyVersion: draft.privacyPolicyVersion,
      // Puste pole = brak własnej treści, czyli tekst domyślny aplikacji.
      paymentSuccessTitle: draft.paymentSuccessTitle || null,
      paymentSuccessBody: draft.paymentSuccessBody || null,
      paymentErrorTitle: draft.paymentErrorTitle || null,
      paymentErrorBody: draft.paymentErrorBody || null,
      schemaJson: { fields: cleanedFields, customScript: customScript || undefined },
    };
    try {
      if (isNew) {
        const created = await api.post<{ form: FormDetails }>('/api/forms', payload);
        navigate(`/admin/formularze/${created.form.id}`);
      } else {
        await api.patch(`/api/forms/${id}`, payload);
        setMessage({ kind: 'ok', text: 'Zapisano zmiany' });
      }
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof ApiError ? error.message : 'Błąd zapisu' });
    } finally {
      setBusy(false);
    }
  }

  async function action(path: string) {
    try {
      await api.post(`/api/forms/${id}/${path}`);
      const data = await api.get<{ form: FormDetails }>(`/api/forms/${id}`);
      setForm(data.form);
      setMessage({ kind: 'ok', text: 'Gotowe' });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof ApiError ? error.message : 'Błąd operacji' });
    }
  }

  async function addTicket() {
    try {
      await api.post(`/api/forms/${id}/tickets`, {
        name: 'Nowy bilet',
        priceCents: 0,
        sortOrder: (form?.ticketTypes.length ?? 0) + 1,
      });
      const data = await api.get<{ form: FormDetails }>(`/api/forms/${id}`);
      setForm(data.form);
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof ApiError ? error.message : 'Błąd' });
    }
  }

  async function saveTicket(ticket: Ticket) {
    try {
      await api.patch(`/api/forms/${id}/tickets/${ticket.id}`, {
        name: ticket.name,
        priceCents: ticket.priceCents,
        capacity: ticket.capacity,
        isActive: ticket.isActive,
      });
      setMessage({ kind: 'ok', text: `Zapisano bilet: ${ticket.name}` });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof ApiError ? error.message : 'Błąd zapisu biletu' });
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{isNew ? 'Nowy formularz' : form?.title ?? 'Formularz'}</h1>
        <Link to="/admin" className="btn-secondary">
          Wróć
        </Link>
      </div>

      {message && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            message.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </p>
      )}

      <form onSubmit={save} className="card space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label">Tytuł wydarzenia</label>
            <input
              className="input"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Slug (adres publiczny /f/…)</label>
            <input
              className="input font-mono"
              value={draft.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              required
            />
          </div>
        </div>

        <div>
          <label className="label">Opis</label>
          <textarea
            className="input h-24"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="label">Zamknięcie rejestracji</label>
            <input
              type="datetime-local"
              className="input"
              value={draft.closesAt}
              onChange={(e) => setDraft({ ...draft, closesAt: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Limit globalny (puste = brak)</label>
            <input
              type="number"
              min={1}
              className="input"
              value={draft.capacityTotal}
              onChange={(e) => setDraft({ ...draft, capacityTotal: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Wersja regulaminu</label>
            <input
              className="input"
              value={draft.termsVersion}
              onChange={(e) => setDraft({ ...draft, termsVersion: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Wersja polityki prywatności</label>
            <input
              className="input"
              value={draft.privacyPolicyVersion}
              onChange={(e) => setDraft({ ...draft, privacyPolicyVersion: e.target.value })}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.requirePhone}
            onChange={(e) => setDraft({ ...draft, requirePhone: e.target.checked })}
          />
          Telefon wymagany w tym wydarzeniu
        </label>

        <div>
          <h2 className="mb-2 text-lg font-medium">Pola dodatkowe</h2>
          <FieldBuilder fields={fields} onChange={setFields} />
        </div>

        <div>
          <h2 className="mb-2 text-lg font-medium">Strona po płatności</h2>
          <p className="mb-3 text-sm text-slate-500">
            Uczestnik wraca z Paynow na stronę potwierdzenia, która sama rozpoznaje wynik płatności
            (Paynow przyjmuje tylko jeden adres powrotu). Poniżej ustawisz, co ma tam zobaczyć.
            Puste pole = tekst domyślny.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
              <p className="text-sm font-medium text-emerald-800">Płatność się powiodła</p>
              <div>
                <label className="label">Tytuł</label>
                <input
                  className="input"
                  placeholder="Rejestracja potwierdzona"
                  value={draft.paymentSuccessTitle}
                  onChange={(e) => setDraft({ ...draft, paymentSuccessTitle: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Treść</label>
                <textarea
                  className="input h-24"
                  placeholder="Np. Bilet wyślemy mailem. Do zobaczenia!"
                  value={draft.paymentSuccessBody}
                  onChange={(e) => setDraft({ ...draft, paymentSuccessBody: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-red-200 bg-red-50/40 p-3">
              <p className="text-sm font-medium text-red-800">Płatność nieudana lub przerwana</p>
              <div>
                <label className="label">Tytuł</label>
                <input
                  className="input"
                  placeholder="Płatność nie została zakończona"
                  value={draft.paymentErrorTitle}
                  onChange={(e) => setDraft({ ...draft, paymentErrorTitle: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Treść</label>
                <textarea
                  className="input h-24"
                  placeholder="Np. Spróbuj ponownie albo napisz do nas na kontakt@…"
                  value={draft.paymentErrorBody}
                  onChange={(e) => setDraft({ ...draft, paymentErrorBody: e.target.value })}
                />
              </div>
            </div>
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-medium">Własny kod JS</h2>
          <p className="mb-2 text-sm text-slate-500">
            Zaawansowane. Kod wykonuje się na stronie publicznego formularza (np. do ukrywania
            sekcji w zależności od kontekstu) — to pole jest widoczne tylko tutaj, w panelu
            administratora, i nigdy nie jest renderowane jako pole formularza dla uczestnika.
          </p>
          <textarea
            className="input h-32 font-mono text-xs"
            spellCheck={false}
            placeholder={"document.querySelector('[data-field-key=\"...\"]').style.display = 'none';"}
            value={customScript}
            onChange={(e) => setCustomScript(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Zapisywanie…' : 'Zapisz'}
          </button>
          {!isNew && form?.status !== 'PUBLISHED' && (
            <button type="button" className="btn-secondary" onClick={() => action('publish')}>
              Opublikuj
            </button>
          )}
          {!isNew && form?.status !== 'ARCHIVED' && (
            <button type="button" className="btn-secondary" onClick={() => action('archive')}>
              Archiwizuj
            </button>
          )}
          {!isNew && (
            <a className="btn-secondary" href={`/f/${draft.slug}`} target="_blank" rel="noreferrer">
              Podgląd publiczny
            </a>
          )}
        </div>
      </form>

      {!isNew && form && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Typy biletów</h2>
            <button type="button" className="btn-secondary" onClick={addTicket}>
              Dodaj bilet
            </button>
          </div>
          <p className="text-sm text-slate-500">
            Zajęte miejsca łącznie: {occupancy.total}
            {form.capacityTotal !== null ? ` / ${form.capacityTotal}` : ''}. Bilet płatny musi kosztować
            minimum 1,00 zł (limit Paynow) albo być darmowy.
          </p>

          {form.ticketTypes.map((ticket, index) => (
            <div key={ticket.id} className="grid items-end gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-5">
              <div>
                <label className="label">Nazwa</label>
                <input
                  className="input"
                  value={ticket.name}
                  onChange={(e) => {
                    const next = [...form.ticketTypes];
                    next[index] = { ...ticket, name: e.target.value };
                    setForm({ ...form, ticketTypes: next });
                  }}
                />
              </div>
              <div>
                <label className="label">Cena (grosze)</label>
                <input
                  type="number"
                  min={0}
                  className="input"
                  value={ticket.priceCents}
                  onChange={(e) => {
                    const next = [...form.ticketTypes];
                    next[index] = { ...ticket, priceCents: Number(e.target.value) };
                    setForm({ ...form, ticketTypes: next });
                  }}
                />
                <p className="mt-1 text-xs text-slate-500">{formatPln(ticket.priceCents)}</p>
              </div>
              <div>
                <label className="label">Limit (puste = brak)</label>
                <input
                  type="number"
                  min={1}
                  className="input"
                  value={ticket.capacity ?? ''}
                  onChange={(e) => {
                    const next = [...form.ticketTypes];
                    next[index] = { ...ticket, capacity: e.target.value === '' ? null : Number(e.target.value) };
                    setForm({ ...form, ticketTypes: next });
                  }}
                />
                <p className="mt-1 text-xs text-slate-500">
                  zajęte: {occupancy.perTicketType[ticket.id] ?? 0}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ticket.isActive}
                  onChange={(e) => {
                    const next = [...form.ticketTypes];
                    next[index] = { ...ticket, isActive: e.target.checked };
                    setForm({ ...form, ticketTypes: next });
                  }}
                />
                Aktywny
              </label>
              <button type="button" className="btn-secondary" onClick={() => saveTicket(ticket)}>
                Zapisz bilet
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
