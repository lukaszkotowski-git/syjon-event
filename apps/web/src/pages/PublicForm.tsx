import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  buildAnswersSchema,
  type CreateSubmissionResponse,
  type FieldDefinition,
  type PublicFormDto,
} from '@syjonevent/shared';
import { api, ApiError, formatDateTime, formatPln } from '../lib/api';

type Answers = Record<string, string | boolean>;

export default function PublicForm() {
  const { slug } = useParams();
  const [form, setForm] = useState<PublicFormDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ticketTypeId, setTicketTypeId] = useState('');
  const [buyer, setBuyer] = useState({ email: '', phone: '' });
  const [answers, setAnswers] = useState<Answers>({});
  const [legal, setLegal] = useState({ terms: false, privacy: false });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<PublicFormDto>(`/api/public/f/${slug}`)
      .then((data) => {
        setForm(data);
        const firstAvailable = data.ticketTypes.find((t) => !t.soldOut);
        if (firstAvailable) setTicketTypeId(firstAvailable.id);
      })
      .catch((err: ApiError) => setLoadError(err.message));
  }, [slug]);

  // Własny kod JS admina (np. ukrywanie sekcji w zależności od kontekstu). Konfigurowany
  // w panelu admina, nigdy nie renderowany jako widoczne pole formularza — uruchamiamy go
  // tylko raz, po załadowaniu formularza, jako prawdziwy <script> (nie działa przez
  // dangerouslySetInnerHTML, przeglądarka go wtedy nie wykona).
  useEffect(() => {
    const code = form?.schemaJson.customScript;
    if (!code) return;
    const script = document.createElement('script');
    script.textContent = code;
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, [form]);

  if (loadError) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <div className="card text-center">
          <h1 className="text-xl font-semibold">Rejestracja niedostępna</h1>
          <p className="mt-2 text-slate-600">{loadError}</p>
        </div>
      </main>
    );
  }
  if (!form) return <p className="p-8 text-slate-500">Ładowanie…</p>;

  const fields = form.schemaJson.fields as FieldDefinition[];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});

    // Ta sama walidacja co na serwerze — pochodzi z @syjonevent/shared.
    const parsed = buildAnswersSchema(fields).safeParse(
      Object.fromEntries(fields.map((field) => [field.key, answers[field.key] ?? (field.type === 'checkbox' ? false : '')])),
    );
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors(Object.fromEntries(Object.entries(flat).map(([key, msgs]) => [key, msgs?.[0] ?? 'Błąd'])));
      setBusy(false);
      return;
    }

    try {
      const response = await api.post<CreateSubmissionResponse>(`/api/public/f/${form.slug}/submissions`, {
        ticketTypeId,
        buyer: { email: buyer.email, phone: buyer.phone || null },
        answers: parsed.data,
        acceptTerms: legal.terms,
        acceptPrivacy: legal.privacy,
      });
      window.location.href = response.redirectUrl ?? response.confirmationUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nie udało się wysłać zgłoszenia');
      setBusy(false);
    }
  }

  const allSoldOut = form.soldOut || form.ticketTypes.every((t) => t.soldOut);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold">{form.title}</h1>
        {form.description && <p className="mt-2 whitespace-pre-line text-slate-600">{form.description}</p>}
        <p className="mt-2 text-sm text-slate-500">Rejestracja do {formatDateTime(form.closesAt)}</p>
      </header>

      {allSoldOut ? (
        <div className="card border-amber-200 bg-amber-50">
          <h2 className="font-medium text-amber-900">Brak wolnych miejsc</h2>
          <p className="mt-1 text-sm text-amber-800">
            Wszystkie bilety na to wydarzenie zostały już sprzedane.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="card space-y-6">
          <section>
            <h2 className="mb-3 text-lg font-medium">Wybierz bilet</h2>
            <div className="space-y-2">
              {form.ticketTypes.map((ticket) => (
                <label
                  key={ticket.id}
                  className={`flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 ${
                    ticket.soldOut
                      ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'
                      : ticketTypeId === ticket.id
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-slate-200'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="ticket"
                      value={ticket.id}
                      disabled={ticket.soldOut}
                      checked={ticketTypeId === ticket.id}
                      onChange={() => setTicketTypeId(ticket.id)}
                    />
                    <span className="font-medium">{ticket.name}</span>
                    {ticket.soldOut && <span className="badge bg-red-100 text-red-700">wyprzedane</span>}
                  </span>
                  <span className="font-medium">
                    {ticket.priceCents === 0 ? 'bezpłatny' : formatPln(ticket.priceCents)}
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">Dane kupującego</h2>
            <div>
              <label className="label">E-mail *</label>
              <input
                type="email"
                className="input"
                value={buyer.email}
                onChange={(e) => setBuyer({ ...buyer, email: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Telefon {form.requirePhone ? '*' : '(opcjonalnie)'}</label>
              <input
                className="input"
                placeholder="+48 601 234 567"
                value={buyer.phone}
                onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })}
                required={form.requirePhone}
              />
            </div>
          </section>

          {fields.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-medium">Dodatkowe informacje</h2>
              {fields.map((field) => {
                const hasError = Boolean(fieldErrors[field.key]);
                return (
                  <div key={field.key} data-field-key={field.key}>
                    {field.type === 'checkbox' ? (
                      <label
                        className={`flex items-start gap-2 text-sm ${hasError ? 'text-red-700' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(answers[field.key])}
                          onChange={(e) => setAnswers({ ...answers, [field.key]: e.target.checked })}
                        />
                        <span>
                          {field.label} {field.required && '*'}
                        </span>
                      </label>
                    ) : (
                      <>
                        <label className={`label ${hasError ? 'text-red-700' : ''}`}>
                          {field.label} {field.required && '*'}
                        </label>
                        {field.type === 'select' ? (
                          <select
                            className={`input ${hasError ? 'input-error' : ''}`}
                            value={String(answers[field.key] ?? '')}
                            onChange={(e) => setAnswers({ ...answers, [field.key]: e.target.value })}
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
                            className={`input ${hasError ? 'input-error' : ''}`}
                            type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                            value={String(answers[field.key] ?? '')}
                            onChange={(e) => setAnswers({ ...answers, [field.key]: e.target.value })}
                          />
                        )}
                      </>
                    )}
                    {hasError && <p className="mt-1 text-xs text-red-600">{fieldErrors[field.key]}</p>}
                  </div>
                );
              })}
            </section>
          )}

          <section className="space-y-2 border-t border-slate-200 pt-4 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={legal.terms}
                onChange={(e) => setLegal({ ...legal, terms: e.target.checked })}
                required
              />
              <span>
                Akceptuję regulamin wydarzenia (wersja {form.termsVersion}) *
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={legal.privacy}
                onChange={(e) => setLegal({ ...legal, privacy: e.target.checked })}
                required
              />
              <span>
                Zapoznałem się z polityką prywatności (wersja {form.privacyPolicyVersion}) *
              </span>
            </label>
          </section>

          {/*
            Podsumowanie błędów przy przycisku. Bez niego formularz „nic nie robi”, gdy
            niepoprawne pole jest niewidoczne — np. ukryte własnym kodem JS admina.
          */}
          {Object.keys(fieldErrors).length > 0 && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <p className="font-medium">Popraw poniższe pola:</p>
              <ul className="mt-1 list-disc pl-5">
                {fields
                  .filter((field) => fieldErrors[field.key])
                  .map((field) => (
                    <li key={field.key}>
                      {field.label}: {fieldErrors[field.key]}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button type="submit" className="btn-primary w-full" disabled={busy || !ticketTypeId}>
            {busy ? 'Przetwarzanie…' : 'Zarejestruj się i przejdź do płatności'}
          </button>
        </form>
      )}
    </main>
  );
}
