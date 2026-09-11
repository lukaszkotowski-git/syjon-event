import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  buildAnswersSchema,
  buyerSchema,
  type CreateSubmissionResponse,
  type FieldDefinition,
  type PublicFormDto,
} from '@syjonevent/shared';
import { api, ApiError, formatPln } from '../lib/api';
import Stepper, { type StepConfig } from '../components/Stepper';

type Answers = Record<string, string | boolean>;

function answerDisplayValue(field: FieldDefinition, value: string | boolean | undefined) {
  if (field.type === 'checkbox') return value ? 'Tak' : 'Nie';
  const text = String(value ?? '').trim();
  return text || '—';
}

function eventDateBadge(iso: string) {
  const date = new Date(iso);
  const strip = (s: string) => s.replace('.', '').toUpperCase();
  return {
    weekday: strip(new Intl.DateTimeFormat('pl-PL', { weekday: 'short' }).format(date)),
    day: new Intl.DateTimeFormat('pl-PL', { day: '2-digit' }).format(date),
    month: strip(new Intl.DateTimeFormat('pl-PL', { month: 'short' }).format(date)),
  };
}

export default function PublicForm() {
  const { slug } = useParams();
  const [form, setForm] = useState<PublicFormDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [ticketTypeId, setTicketTypeId] = useState('');
  const [buyer, setBuyer] = useState({ email: '', phone: '' });
  const [answers, setAnswers] = useState<Answers>({});
  const [legal, setLegal] = useState({ terms: false, privacy: false });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [buyerErrors, setBuyerErrors] = useState<Record<string, string>>({});
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(true);
  const [formRevealed, setFormRevealed] = useState(false);

  function revealForm() {
    setAboutOpen(false);
    setFormRevealed(true);
  }

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

  const fields = useMemo(() => (form?.schemaJson.fields as FieldDefinition[] | undefined) ?? [], [form]);
  const hasCustomFields = fields.length > 0;

  const steps: StepConfig[] = useMemo(() => {
    const list: StepConfig[] = [];
    if (hasCustomFields) list.push({ key: 'fields', label: 'Informacje' });
    list.push({ key: 'ticket', label: 'Bilet i dane' });
    list.push({ key: 'review', label: 'Podsumowanie' });
    return list;
  }, [hasCustomFields]);

  const currentStepKey = steps[stepIndex]?.key;
  const selectedTicket = form?.ticketTypes.find((t) => t.id === ticketTypeId) ?? null;

  function validateCustomFields() {
    const parsed = buildAnswersSchema(fields).safeParse(
      Object.fromEntries(fields.map((field) => [field.key, answers[field.key] ?? (field.type === 'checkbox' ? false : '')])),
    );
    if (parsed.success) return { data: parsed.data, errors: {} as Record<string, string> };
    const flat = parsed.error.flatten().fieldErrors;
    return {
      data: null,
      errors: Object.fromEntries(Object.entries(flat).map(([key, msgs]) => [key, msgs?.[0] ?? 'Błąd'])),
    };
  }

  function validateBuyerAndTicket() {
    let ok = true;
    if (!ticketTypeId) {
      setTicketError('Wybierz jeden z dostępnych biletów');
      ok = false;
    } else {
      setTicketError(null);
    }
    const parsed = buyerSchema.safeParse({ email: buyer.email, phone: buyer.phone || null });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setBuyerErrors({
        email: flat.email?.[0] ?? '',
        phone: flat.phone?.[0] ?? '',
      });
      ok = false;
    } else if (form?.requirePhone && !buyer.phone) {
      setBuyerErrors({ phone: 'Pole wymagane' });
      ok = false;
    } else {
      setBuyerErrors({});
    }
    return ok;
  }

  function goNext() {
    if (currentStepKey === 'fields') {
      const result = validateCustomFields();
      if (result.data === null) {
        setFieldErrors(result.errors);
        return;
      }
      setFieldErrors({});
    } else if (currentStepKey === 'ticket') {
      if (!validateBuyerAndTicket()) return;
    }
    setStepIndex((i) => Math.min(steps.length - 1, i + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goBack() {
    setStepIndex((i) => Math.max(0, i - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goToStep(key: string) {
    const idx = steps.findIndex((s) => s.key === key);
    if (idx >= 0) setStepIndex(idx);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function onSubmitFinal() {
    if (!form) return;
    setError(null);
    setLegalError(null);

    const fieldsResult = validateCustomFields();
    if (fieldsResult.data === null) {
      setFieldErrors(fieldsResult.errors);
      goToStep('fields');
      return;
    }
    if (!validateBuyerAndTicket()) {
      goToStep('ticket');
      return;
    }
    if (!legal.terms || !legal.privacy) {
      setLegalError('Zaakceptuj regulamin i politykę prywatności, aby kontynuować');
      return;
    }

    setBusy(true);
    try {
      const response = await api.post<CreateSubmissionResponse>(`/api/public/f/${form.slug}/submissions`, {
        ticketTypeId,
        buyer: { email: buyer.email, phone: buyer.phone || null },
        answers: fieldsResult.data,
        acceptTerms: legal.terms,
        acceptPrivacy: legal.privacy,
      });
      window.location.href = response.redirectUrl ?? response.confirmationUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nie udało się wysłać zgłoszenia');
      setBusy(false);
    }
  }

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
  if (!form) {
    return (
      <main className="mx-auto flex max-w-xl flex-col items-center px-6 py-24">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
        <p className="mt-4 text-sm text-slate-500">Ładowanie formularza…</p>
      </main>
    );
  }

  const allSoldOut = form.soldOut || form.ticketTypes.every((t) => t.soldOut);
  const hasHeroImage = Boolean(form.backgroundImageDesktopUrl || form.backgroundImageMobileUrl);
  const dateBadge = eventDateBadge(form.closesAt);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10 lg:max-w-4xl">
      {allSoldOut ? (
        <div className="card border-amber-200 bg-amber-50 text-center">
          <h2 className="font-semibold text-amber-900">Brak wolnych miejsc</h2>
          <p className="mt-1 text-sm text-amber-800">Wszystkie bilety na to wydarzenie zostały już sprzedane.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-card">
          {/* Zdjęcie wydarzenia (lub gradient marki). */}
          <div className="relative min-h-[260px] overflow-hidden sm:min-h-[340px]">
              {hasHeroImage ? (
                <>
                  {form.backgroundImageMobileUrl && (
                    <div
                      className="absolute inset-0 bg-cover bg-center bg-no-repeat bg800:hidden"
                      style={{ backgroundImage: `url(${form.backgroundImageMobileUrl})` }}
                    />
                  )}
                  <div
                    className={`absolute inset-0 bg-cover bg-center bg-no-repeat ${
                      form.backgroundImageMobileUrl ? 'hidden bg800:block' : ''
                    }`}
                    style={{
                      backgroundImage: `url(${form.backgroundImageDesktopUrl ?? form.backgroundImageMobileUrl})`,
                    }}
                  />
                </>
              ) : (
                <div className="absolute inset-0 bg-brand-gradient" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />

              <span className="absolute left-5 top-5 inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-900 shadow-sm">
                <img src="/logo.png" alt="" className="h-3.5 w-3.5" />
                Rejestracja otwarta
              </span>

              <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8">
                <p className="text-xs font-semibold uppercase tracking-widest text-brand-100/90">
                  Rejestracja na wydarzenie
                </p>
                <h1 className="mt-1 font-display text-3xl font-bold leading-tight text-white drop-shadow sm:text-4xl">
                  {form.title}
                </h1>
              </div>
            </div>

          {/* O wydarzeniu — akordeon, domyślnie rozwinięty. */}
          <div className="border-t border-slate-200 bg-brand-50/40">
            <button
              type="button"
              onClick={() => setAboutOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-4 p-5 text-left sm:p-8"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">O wydarzeniu</span>
              <svg
                viewBox="0 0 20 20"
                fill="none"
                className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-300 ${aboutOpen ? 'rotate-180' : ''}`}
              >
                <path
                  d="M5 7.5 10 12.5 15 7.5"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${aboutOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            >
              <div className="overflow-hidden px-5 sm:px-8">
                {form.description && (
                  <div
                    className="prose prose-slate max-w-none pb-5 text-sm text-slate-600 sm:pb-8 sm:text-base [&_a]:text-brand-700 [&_a]:underline"
                    dangerouslySetInnerHTML={{ __html: form.description }}
                  />
                )}
                {!formRevealed && (
                  <div className="pb-5 sm:pb-8">
                    <button type="button" onClick={revealForm} className="btn-primary">
                      Przejdź do rejestracji →
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Formularz rejestracyjny — zwinięty do czasu kliknięcia; potem zawsze rozwinięty. */}
          {!formRevealed ? (
            <button
              type="button"
              onClick={revealForm}
              className="flex w-full items-center justify-between gap-4 border-t border-slate-200 p-5 text-left sm:p-8"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Formularz rejestracyjny
              </span>
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-slate-400">
                <path
                  d="M5 7.5 10 12.5 15 7.5"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : (
          <div className="border-t border-slate-200 p-5 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <h2 className="font-display text-xl font-bold leading-snug text-slate-900">{form.title}</h2>
                <div className="shrink-0 rounded-2xl bg-brand-900 px-3.5 py-2.5 text-center text-white">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-200">{dateBadge.weekday}</p>
                  <p className="text-xl font-bold leading-none">{dateBadge.day}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-200">{dateBadge.month}</p>
                </div>
              </div>

            <div className="mt-6">
              <Stepper steps={steps} currentIndex={stepIndex} />
            </div>

          <div className="mt-8 space-y-6">
            {currentStepKey === 'fields' && (
              <section className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Dodatkowe informacje</h2>
                  <p className="text-sm text-slate-500">Organizator prosi o uzupełnienie poniższych pól.</p>
                </div>
                {fields.map((field) => {
                  const hasError = Boolean(fieldErrors[field.key]);
                  return (
                    <div key={field.key} data-field-key={field.key}>
                      {field.type === 'checkbox' ? (
                        <label className={`flex items-start gap-2 text-sm ${hasError ? 'text-red-700' : ''}`}>
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600 focus:ring-brand-200"
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

            {currentStepKey === 'ticket' && (
              <section className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Wybierz bilet</h2>
                  <p className="text-sm text-slate-500">Wskaż rodzaj biletu, na który się rejestrujesz.</p>
                </div>
                <div className="space-y-3">
                  {form.ticketTypes.map((ticket) => {
                    const active = ticketTypeId === ticket.id;
                    return (
                      <label
                        key={ticket.id}
                        className={`flex cursor-pointer items-center justify-between gap-4 rounded-2xl border-2 p-4 transition ${
                          ticket.soldOut
                            ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'
                            : active
                              ? 'border-brand-600 bg-brand-50 shadow-soft'
                              : 'border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/40'
                        }`}
                      >
                        <span className="flex items-center gap-3">
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                              active ? 'border-brand-600' : 'border-slate-300'
                            }`}
                          >
                            {active && <span className="h-2.5 w-2.5 rounded-full bg-brand-600" />}
                          </span>
                          <input
                            type="radio"
                            name="ticket"
                            className="sr-only"
                            value={ticket.id}
                            disabled={ticket.soldOut}
                            checked={active}
                            onChange={() => setTicketTypeId(ticket.id)}
                          />
                          <span>
                            <span className="block font-semibold text-slate-900">{ticket.name}</span>
                            {ticket.soldOut && <span className="badge mt-1 bg-red-100 text-red-700">wyprzedane</span>}
                          </span>
                        </span>
                        <span className={`text-lg font-bold ${ticket.priceCents === 0 ? 'text-brand-700' : 'text-slate-900'}`}>
                          {ticket.priceCents === 0 ? 'Bezpłatny' : formatPln(ticket.priceCents)}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {ticketError && <p className="text-sm text-red-600">{ticketError}</p>}

                <div className="space-y-3 border-t border-slate-100 pt-5">
                  <h3 className="font-semibold text-slate-900">Dane kupującego</h3>
                  <div>
                    <label className="label">E-mail *</label>
                    <input
                      type="email"
                      className={`input ${buyerErrors.email ? 'input-error' : ''}`}
                      value={buyer.email}
                      onChange={(e) => setBuyer({ ...buyer, email: e.target.value })}
                      required
                    />
                    {buyerErrors.email && <p className="mt-1 text-xs text-red-600">{buyerErrors.email}</p>}
                  </div>
                  <div>
                    <label className="label">Telefon {form.requirePhone ? '*' : '(opcjonalnie)'}</label>
                    <input
                      className={`input ${buyerErrors.phone ? 'input-error' : ''}`}
                      placeholder="+48 601 234 567"
                      value={buyer.phone}
                      onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })}
                      required={form.requirePhone}
                    />
                    {buyerErrors.phone && <p className="mt-1 text-xs text-red-600">{buyerErrors.phone}</p>}
                  </div>
                </div>
              </section>
            )}

            {currentStepKey === 'review' && (
              <section className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Podsumowanie zamówienia</h2>
                  <p className="text-sm text-slate-500">Sprawdź dane przed przejściem do płatności.</p>
                </div>

                <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-brand-700/80">Bilet</p>
                      <p className="font-semibold text-slate-900">{selectedTicket?.name}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-lg font-bold text-brand-800">
                        {selectedTicket && selectedTicket.priceCents > 0
                          ? formatPln(selectedTicket.priceCents)
                          : 'Bezpłatny'}
                      </p>
                      <button type="button" onClick={() => goToStep('ticket')} className="text-xs font-semibold text-brand-700 underline decoration-dotted underline-offset-2 hover:text-brand-900">
                        Edytuj
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Dane kupującego</p>
                    <button type="button" onClick={() => goToStep('ticket')} className="text-xs font-semibold text-brand-700 underline decoration-dotted underline-offset-2 hover:text-brand-900">
                      Edytuj
                    </button>
                  </div>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-slate-500">E-mail</dt>
                      <dd className="font-medium text-slate-800">{buyer.email}</dd>
                    </div>
                    {buyer.phone && (
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500">Telefon</dt>
                        <dd className="font-medium text-slate-800">{buyer.phone}</dd>
                      </div>
                    )}
                  </dl>
                </div>

                {hasCustomFields && (
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Twoje odpowiedzi</p>
                      <button type="button" onClick={() => goToStep('fields')} className="text-xs font-semibold text-brand-700 underline decoration-dotted underline-offset-2 hover:text-brand-900">
                        Edytuj
                      </button>
                    </div>
                    <dl className="mt-2 space-y-1.5 text-sm">
                      {fields.map((field) => (
                        <div key={field.key} className="flex justify-between gap-4">
                          <dt className="text-slate-500">{field.label}</dt>
                          <dd className="text-right font-medium text-slate-800">
                            {answerDisplayValue(field, answers[field.key])}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                <div className="space-y-2.5 border-t border-slate-100 pt-5 text-sm">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600 focus:ring-brand-200"
                      checked={legal.terms}
                      onChange={(e) => setLegal({ ...legal, terms: e.target.checked })}
                    />
                    <span>Akceptuję regulamin wydarzenia (wersja {form.termsVersion}) *</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600 focus:ring-brand-200"
                      checked={legal.privacy}
                      onChange={(e) => setLegal({ ...legal, privacy: e.target.checked })}
                    />
                    <span>Zapoznałem się z polityką prywatności (wersja {form.privacyPolicyVersion}) *</span>
                  </label>
                  {legalError && <p className="text-xs text-red-600">{legalError}</p>}
                </div>

                {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              </section>
            )}
          </div>

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
            {stepIndex > 0 ? (
              <button type="button" className="btn-secondary" onClick={goBack}>
                Wstecz
              </button>
            ) : (
              <span />
            )}

            {currentStepKey === 'review' ? (
              <button type="button" className="btn-primary" onClick={onSubmitFinal} disabled={busy}>
                {busy
                  ? 'Przetwarzanie…'
                  : selectedTicket && selectedTicket.priceCents > 0
                    ? 'Przejdź do płatności'
                    : 'Zarejestruj się bezpłatnie'}
              </button>
            ) : (
              <button type="button" className="btn-primary" onClick={goNext}>
                Dalej
              </button>
            )}
          </div>
          </div>
          )}
        </div>
      )}
    </main>
  );
}
