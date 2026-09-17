import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  ListChecks,
  Lock,
  Mail,
  Pencil,
  Phone,
  ShieldCheck,
  Ticket,
  TicketPercent,
  TicketX,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  buildAnswersSchema,
  buyerSchema,
  flattenSections,
  type CreateSubmissionResponse,
  type DiscountCodeCheckResponse,
  type FieldDefinition,
  type FormSection,
  type PublicFormDto,
} from '@syjonevent/shared';
import { api, ApiError, formatPln } from '../lib/api';
import { PRIVACY_POLICY_URL, TERMS_URL } from '../lib/legal';
import Stepper, { type StepConfig } from '../components/Stepper';
import IconButton from '../components/ui/IconButton';

type Answers = Record<string, string | boolean>;

function answerDisplayValue(field: FieldDefinition, value: string | boolean | undefined) {
  if (field.type === 'checkbox') return value ? 'Tak' : 'Nie';
  const text = String(value ?? '').trim();
  return text || '—';
}

function closingDateBadge(iso: string) {
  const date = new Date(iso);
  const strip = (s: string) => s.replace('.', '').toUpperCase();
  return {
    day: new Intl.DateTimeFormat('pl-PL', { day: '2-digit' }).format(date),
    month: strip(new Intl.DateTimeFormat('pl-PL', { month: 'short' }).format(date)),
    full: new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeStyle: 'short' }).format(date),
  };
}

/** Przewija do pierwszego pola z błędem — po walidacji uczestnik od razu widzi, co poprawić. */
function focusFirstError() {
  // Po zmianie kroku React musi najpierw wyrenderować pola z błędami.
  window.setTimeout(() => {
    const el = document.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.focus({ preventScroll: true });
  }, 60);
}

function StepHeading({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <h2 className="text-lg font-semibold leading-tight text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

const legalLinkClass = 'font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900';

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
  const [discountFieldOpen, setDiscountFieldOpen] = useState(false);
  const [discountCodeText, setDiscountCodeText] = useState('');
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [discountBusy, setDiscountBusy] = useState(false);
  const [appliedDiscount, setAppliedDiscount] = useState<DiscountCodeCheckResponse | null>(null);
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

  const sections = useMemo(
    () => ((form?.schemaJson.sections as FormSection[] | undefined) ?? []).filter((s) => s.fields.length > 0),
    [form],
  );
  const fields = useMemo(() => flattenSections(sections), [sections]);
  const hasCustomFields = sections.length > 0;

  const steps: StepConfig[] = useMemo(() => {
    const list: StepConfig[] = [];
    if (hasCustomFields) list.push({ key: 'fields', label: 'Informacje' });
    list.push({ key: 'ticket', label: 'Bilet i dane' });
    list.push({ key: 'review', label: 'Podsumowanie' });
    return list;
  }, [hasCustomFields]);

  const currentStepKey = steps[stepIndex]?.key;
  const selectedTicket = form?.ticketTypes.find((t) => t.id === ticketTypeId) ?? null;
  const effectivePriceCents = appliedDiscount
    ? appliedDiscount.discountedPriceCents
    : (selectedTicket?.priceCents ?? 0);
  const isPaid = effectivePriceCents > 0;

  // Wybrany bilet się zmienił (np. wrócono do kroku 1) — kod trzeba przeliczyć na nową cenę.
  useEffect(() => {
    if (!appliedDiscount || !form || !ticketTypeId) return;
    api
      .post<DiscountCodeCheckResponse>(`/api/public/f/${form.slug}/discount-codes/check`, {
        code: appliedDiscount.code,
        ticketTypeId,
      })
      .then(setAppliedDiscount)
      .catch(() => setAppliedDiscount(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketTypeId]);

  async function applyDiscountCode() {
    if (!form || !ticketTypeId || !discountCodeText.trim()) return;
    setDiscountBusy(true);
    setDiscountError(null);
    try {
      const res = await api.post<DiscountCodeCheckResponse>(`/api/public/f/${form.slug}/discount-codes/check`, {
        code: discountCodeText.trim(),
        ticketTypeId,
      });
      setAppliedDiscount(res);
    } catch (err) {
      setAppliedDiscount(null);
      setDiscountError(err instanceof ApiError ? err.message : 'Nie udało się sprawdzić kodu');
    } finally {
      setDiscountBusy(false);
    }
  }

  function removeDiscountCode() {
    setAppliedDiscount(null);
    setDiscountCodeText('');
    setDiscountError(null);
    setDiscountFieldOpen(false);
  }

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
        focusFirstError();
        return;
      }
      setFieldErrors({});
    } else if (currentStepKey === 'ticket') {
      if (!validateBuyerAndTicket()) {
        focusFirstError();
        return;
      }
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
      focusFirstError();
      return;
    }
    if (!validateBuyerAndTicket()) {
      goToStep('ticket');
      focusFirstError();
      return;
    }
    if (!legal.terms || !legal.privacy) {
      setLegalError('Zaakceptuj regulamin i politykę prywatności, aby kontynuować');
      focusFirstError();
      return;
    }

    setBusy(true);
    try {
      const response = await api.post<CreateSubmissionResponse>(`/api/public/f/${form.slug}/submissions`, {
        ticketTypeId,
        buyer: { email: buyer.email, phone: buyer.phone || null },
        answers: fieldsResult.data,
        discountCode: appliedDiscount?.code,
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
  const closing = closingDateBadge(form.closesAt);

  const editButton = (label: string, step: string) => (
    <IconButton icon={Pencil} label={label} size="sm" onClick={() => goToStep(step)} />
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10 lg:max-w-4xl">
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

          {allSoldOut ? (
            <span className="absolute left-5 top-5 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-900 shadow-sm">
              <TicketX className="h-3.5 w-3.5" aria-hidden />
              Brak wolnych miejsc
            </span>
          ) : (
            <span className="absolute left-5 top-5 inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-900 shadow-sm">
              <img src="/logo.png" alt="" className="h-3.5 w-3.5" />
              Rejestracja otwarta
            </span>
          )}

          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-100/90">Rejestracja na wydarzenie</p>
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
            aria-expanded={aboutOpen}
            className="flex w-full items-center justify-between gap-4 p-5 text-left sm:p-8"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">O wydarzeniu</span>
            <svg
              viewBox="0 0 20 20"
              fill="none"
              className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-300 ${aboutOpen ? 'rotate-180' : ''}`}
            >
              <path d="M5 7.5 10 12.5 15 7.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
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
              {!formRevealed && !allSoldOut && (
                <div className="pb-5 sm:pb-8">
                  <button type="button" onClick={revealForm} className="btn-primary">
                    Przejdź do rejestracji
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {allSoldOut ? (
          // Brak miejsc: zostawiamy zdjęcie i opis wydarzenia, zamiast samego komunikatu.
          <div className="flex items-start gap-3 border-t border-amber-200 bg-amber-50 p-5 sm:p-8">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <TicketX className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="font-semibold text-amber-900">Brak wolnych miejsc</h2>
              <p className="mt-0.5 text-sm text-amber-800">Wszystkie bilety na to wydarzenie zostały już sprzedane.</p>
            </div>
          </div>
        ) : !formRevealed ? (
          <button
            type="button"
            onClick={revealForm}
            className="flex w-full items-center justify-between gap-4 border-t border-slate-200 p-5 text-left sm:p-8"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Formularz rejestracyjny</span>
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-slate-400">
              <path d="M5 7.5 10 12.5 15 7.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <div className="border-t border-slate-200 p-5 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-display text-xl font-bold leading-snug text-slate-900">{form.title}</h2>
              <div
                className="shrink-0 rounded-2xl bg-brand-900 px-3.5 py-2.5 text-center text-white"
                title={`Zapisy trwają do ${closing.full}`}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-200">Zapisy do</p>
                <p className="text-xl font-bold leading-none">{closing.day}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-200">{closing.month}</p>
              </div>
            </div>

            <div className="mt-6">
              <Stepper steps={steps} currentIndex={stepIndex} />
            </div>

            <div className="mt-8 space-y-6">
              {currentStepKey === 'fields' && (
                <section className="space-y-5">
                  <StepHeading
                    icon={ListChecks}
                    title="Formularz rejestracyjny"
                    subtitle="Organizator prosi o uzupełnienie poniższych pól. Pola z * są wymagane."
                  />
                  {sections.map((section) => (
                    <div key={section.id} className="space-y-4">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{section.name}</h3>
                      {section.fields.map((field) => {
                        const hasError = Boolean(fieldErrors[field.key]);
                        const inputId = `field-${field.key}`;
                        return (
                          <div key={field.key} data-field-key={field.key}>
                            {field.type === 'checkbox' ? (
                              <label className={`flex items-start gap-2 text-sm ${hasError ? 'text-red-700' : ''}`}>
                                <input
                                  type="checkbox"
                                  aria-invalid={hasError || undefined}
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
                                <label className={`label ${hasError ? 'text-red-700' : ''}`} htmlFor={inputId}>
                                  {field.label} {field.required && '*'}
                                </label>
                                {field.type === 'select' ? (
                                  <select
                                    id={inputId}
                                    aria-invalid={hasError || undefined}
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
                                    id={inputId}
                                    aria-invalid={hasError || undefined}
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
                    </div>
                  ))}
                </section>
              )}

              {currentStepKey === 'ticket' && (
                <section className="space-y-6">
                  <StepHeading icon={Ticket} title="Wybierz bilet" subtitle="Wskaż rodzaj biletu, na który się rejestrujesz." />
                  <div className="space-y-3" role="radiogroup" aria-label="Rodzaj biletu" data-invalid={Boolean(ticketError) || undefined}>
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

                  {form.hasDiscountCodes && selectedTicket && selectedTicket.priceCents > 0 && (
                    <div>
                      {appliedDiscount ? (
                        <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
                          <p className="flex items-center gap-2 text-sm text-emerald-800">
                            <CircleCheck className="h-4 w-4 shrink-0" aria-hidden />
                            Kod <span className="font-mono font-semibold">{appliedDiscount.code}</span> zastosowany —
                            rabat {formatPln(appliedDiscount.discountAmountCents)}
                          </p>
                          <IconButton icon={X} label="Usuń kod rabatowy" size="sm" onClick={removeDiscountCode} />
                        </div>
                      ) : discountFieldOpen ? (
                        <div className="rounded-2xl border-2 border-brand-300 bg-brand-50/50 p-4">
                          <label
                            htmlFor="discount-code"
                            className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-brand-900"
                          >
                            <TicketPercent className="h-4 w-4" aria-hidden />
                            Masz kod rabatowy?
                          </label>
                          <div className="flex items-start gap-2">
                            <div className="flex-1">
                              <input
                                id="discount-code"
                                className={`input bg-white font-mono uppercase ${discountError ? 'input-error' : ''}`}
                                placeholder="np. WOLONTARIUSZ"
                                autoFocus
                                value={discountCodeText}
                                onChange={(e) => {
                                  setDiscountCodeText(e.target.value.toUpperCase());
                                  setDiscountError(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void applyDiscountCode();
                                  }
                                }}
                              />
                              {discountError && <p className="mt-1 text-xs text-red-600">{discountError}</p>}
                            </div>
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => void applyDiscountCode()}
                              disabled={discountBusy || !discountCodeText.trim()}
                            >
                              {discountBusy ? 'Sprawdzam…' : 'Zastosuj'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50/60 px-4 py-3.5 text-left transition hover:border-brand-400 hover:bg-brand-50"
                          onClick={() => setDiscountFieldOpen(true)}
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
                            <TicketPercent className="h-5 w-5" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-brand-900">Mam kod rabatowy</span>
                            <span className="block text-xs text-brand-700/80">Wpisz kod i zapłać mniej za bilet</span>
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-brand-400" aria-hidden />
                        </button>
                      )}
                    </div>
                  )}

                  <div className="space-y-3 border-t border-slate-100 pt-5">
                    <h3 className="font-semibold text-slate-900">Dane kupującego</h3>
                    <div>
                      <label className="label" htmlFor="buyer-email">
                        E-mail *
                      </label>
                      <div className="relative">
                        <Mail
                          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                          aria-hidden
                        />
                        <input
                          id="buyer-email"
                          type="email"
                          autoComplete="email"
                          aria-invalid={Boolean(buyerErrors.email) || undefined}
                          className={`input pl-10 ${buyerErrors.email ? 'input-error' : ''}`}
                          placeholder="jan.kowalski@example.com"
                          value={buyer.email}
                          onChange={(e) => setBuyer({ ...buyer, email: e.target.value })}
                          required
                        />
                      </div>
                      {buyerErrors.email ? (
                        <p className="mt-1 text-xs text-red-600">{buyerErrors.email}</p>
                      ) : (
                        <p className="mt-1 text-xs text-slate-500">Na ten adres wyślemy potwierdzenie.</p>
                      )}
                    </div>
                    <div>
                      <label className="label" htmlFor="buyer-phone">
                        Telefon {form.requirePhone ? '*' : '(opcjonalnie)'}
                      </label>
                      <div className="relative">
                        <Phone
                          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                          aria-hidden
                        />
                        <input
                          id="buyer-phone"
                          type="tel"
                          autoComplete="tel"
                          aria-invalid={Boolean(buyerErrors.phone) || undefined}
                          className={`input pl-10 ${buyerErrors.phone ? 'input-error' : ''}`}
                          placeholder="+48 601 234 567"
                          value={buyer.phone}
                          onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })}
                          required={form.requirePhone}
                        />
                      </div>
                      {buyerErrors.phone && <p className="mt-1 text-xs text-red-600">{buyerErrors.phone}</p>}
                    </div>
                  </div>
                </section>
              )}

              {currentStepKey === 'review' && (
                <section className="space-y-5">
                  <StepHeading
                    icon={ClipboardCheck}
                    title="Podsumowanie zamówienia"
                    subtitle={isPaid ? 'Sprawdź dane przed przejściem do płatności.' : 'Sprawdź dane przed wysłaniem zgłoszenia.'}
                  />

                  <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Ticket className="h-5 w-5 text-brand-600" aria-hidden />
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-brand-700/80">Bilet</p>
                          <p className="font-semibold text-slate-900">{selectedTicket?.name}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          {appliedDiscount && selectedTicket && (
                            <p className="text-xs text-slate-400 line-through">{formatPln(selectedTicket.priceCents)}</p>
                          )}
                          <p className="text-lg font-bold text-brand-800">
                            {isPaid ? formatPln(effectivePriceCents) : 'Bezpłatny'}
                          </p>
                        </div>
                        {editButton('Zmień bilet', 'ticket')}
                      </div>
                    </div>
                    {appliedDiscount && (
                      <p className="mt-2 flex items-center gap-1.5 border-t border-brand-100 pt-2 text-xs text-emerald-700">
                        <TicketPercent className="h-3.5 w-3.5" aria-hidden />
                        Kod <span className="font-mono font-semibold">{appliedDiscount.code}</span> — rabat{' '}
                        {formatPln(appliedDiscount.discountAmountCents)}
                      </p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Dane kupującego</p>
                      {editButton('Edytuj dane kupującego', 'ticket')}
                    </div>
                    <dl className="mt-2 space-y-1.5 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <dt className="inline-flex items-center gap-1.5 text-slate-500">
                          <Mail className="h-3.5 w-3.5" aria-hidden />
                          E-mail
                        </dt>
                        <dd className="break-all text-right font-medium text-slate-800">{buyer.email}</dd>
                      </div>
                      {buyer.phone && (
                        <div className="flex items-center justify-between gap-4">
                          <dt className="inline-flex items-center gap-1.5 text-slate-500">
                            <Phone className="h-3.5 w-3.5" aria-hidden />
                            Telefon
                          </dt>
                          <dd className="font-medium text-slate-800">{buyer.phone}</dd>
                        </div>
                      )}
                    </dl>
                  </div>

                  {hasCustomFields && (
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Twoje odpowiedzi</p>
                        {editButton('Edytuj odpowiedzi', 'fields')}
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

                  <div
                    className="space-y-2.5 border-t border-slate-100 pt-5 text-sm"
                    data-invalid={Boolean(legalError) || undefined}
                  >
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600 focus:ring-brand-200"
                        checked={legal.terms}
                        onChange={(e) => setLegal({ ...legal, terms: e.target.checked })}
                      />
                      <span>
                        Akceptuję{' '}
                        <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className={legalLinkClass}>
                          regulamin
                        </a>{' '}
                        (wersja {form.termsVersion}) *
                      </span>
                    </label>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600 focus:ring-brand-200"
                        checked={legal.privacy}
                        onChange={(e) => setLegal({ ...legal, privacy: e.target.checked })}
                      />
                      <span>
                        Zapoznałem się z{' '}
                        <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" className={legalLinkClass}>
                          polityką prywatności
                        </a>{' '}
                        (wersja {form.privacyPolicyVersion}) *
                      </span>
                    </label>
                    {legalError && <p className="text-xs text-red-600">{legalError}</p>}
                  </div>

                  {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                </section>
              )}
            </div>

            <div className="mt-8 border-t border-slate-100 pt-5">
              <div className="flex items-center justify-between gap-3">
                {stepIndex > 0 ? (
                  <button type="button" className="btn-secondary" onClick={goBack}>
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                    Wstecz
                  </button>
                ) : (
                  <span />
                )}

                {currentStepKey === 'review' ? (
                  <button type="button" className="btn-primary" onClick={onSubmitFinal} disabled={busy}>
                    {busy ? (
                      'Przetwarzanie…'
                    ) : isPaid ? (
                      <>
                        <Lock className="h-4 w-4" aria-hidden />
                        Przejdź do płatności
                      </>
                    ) : (
                      <>
                        <CircleCheck className="h-4 w-4" aria-hidden />
                        Zarejestruj się bezpłatnie
                      </>
                    )}
                  </button>
                ) : (
                  <button type="button" className="btn-primary" onClick={goNext}>
                    Dalej
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
              {currentStepKey === 'review' && isPaid && (
                <p className="mt-3 flex items-center justify-end gap-1.5 text-xs text-slate-500">
                  <ShieldCheck className="h-3.5 w-3.5 text-brand-600" aria-hidden />
                  Bezpieczna płatność przez Paynow
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
