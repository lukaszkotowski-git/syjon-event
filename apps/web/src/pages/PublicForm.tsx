import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  ListChecks,
  Lock,
  Mail,
  MapPin,
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

/**
 * Maska polskiego numeru: dopisuje +48 i grupuje cyfry po 3, np. "+48 601 234 567".
 * Najpierw zdejmuje sam prefiks +48/48 dopisany przez poprzednie sformatowanie — inaczej jego
 * cyfry "4" i "8" byłyby przy każdym naciśnięciu klawisza ponownie doliczane jako wpisane przez użytkownika.
 */
function formatPlPhoneInput(raw: string): string {
  const withoutPrefix = raw.replace(/^\s*\+?48\s*/, '');
  let digits = withoutPrefix.replace(/\D/g, '');
  if (digits.length > 9 && digits.startsWith('48')) {
    digits = digits.slice(2);
  }
  digits = digits.slice(0, 9);
  if (!digits) return '';
  const groups = digits.match(/.{1,3}/g) ?? [];
  return `+48 ${groups.join(' ')}`;
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

/** Szkic rejestracji w sessionStorage — odświeżenie strony nie kasuje wpisanych danych. */
interface Draft {
  ticketTypeId: string;
  buyer: { email: string; phone: string; address: string };
  answers: Answers;
}

const draftKey = (slug: string) => `syjonevent:draft:${slug}`;

function loadDraft(slug: string): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey(slug));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function saveDraft(slug: string, draft: Draft) {
  try {
    window.sessionStorage.setItem(draftKey(slug), JSON.stringify(draft));
  } catch {
    // Brak dostępu do sessionStorage (np. tryb prywatny) — formularz działa dalej bez szkicu.
  }
}

function clearDraft(slug: string) {
  try {
    window.sessionStorage.removeItem(draftKey(slug));
  } catch {
    // jw.
  }
}

const eventDateFormat = new Intl.DateTimeFormat('pl-PL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const closesAtFormat = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long' });

/** Gwiazdka pola wymaganego — wizualna; czytnik ekranu dostaje `aria-required` na polu. */
const RequiredMark = () => (
  <span aria-hidden className="text-red-600">
    {' '}*
  </span>
);

const legalLinkClass = 'font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900';

export default function PublicForm() {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form, setForm] = useState<PublicFormDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ticketTypeId, setTicketTypeId] = useState('');
  const [buyer, setBuyer] = useState({ email: '', phone: '', address: '' });
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

  useEffect(() => {
    api
      .get<PublicFormDto>(`/api/public/f/${slug}`)
      .then((data) => {
        const draft = loadDraft(data.slug);
        if (draft) {
          setBuyer(draft.buyer);
          setAnswers(draft.answers);
        }
        const draftTicket = data.ticketTypes.find((t) => t.id === draft?.ticketTypeId && !t.soldOut);
        const firstAvailable = draftTicket ?? data.ticketTypes.find((t) => !t.soldOut);
        if (firstAvailable) setTicketTypeId(firstAvailable.id);
        setForm(data);
      })
      .catch((err: ApiError) => setLoadError(err.message));
  }, [slug]);

  useEffect(() => {
    if (form) saveDraft(form.slug, { ticketTypeId, buyer, answers });
  }, [form, ticketTypeId, buyer, answers]);

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

  // Krok jest w adresie (?krok=…), więc systemowe „wstecz” cofa o krok zamiast wychodzić z formularza.
  const stepParam = searchParams.get('krok');
  const stepIndex = Math.max(
    0,
    steps.findIndex((s) => s.key === stepParam),
  );
  const currentStepKey = steps[stepIndex]?.key;

  function setStep(index: number) {
    const key = steps[index]?.key;
    const next = new URLSearchParams(searchParams);
    if (!key || index === 0) next.delete('krok');
    else next.set('krok', key);
    setSearchParams(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
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

      // E-mail i telefon uczestnik często już podał wyżej w formularzu — nie każmy wpisywać ich drugi raz.
      const emailField = fields.find((f) => f.type === 'email');
      const phoneField = fields.find((f) => f.type === 'tel');
      const answeredEmail = emailField ? String(result.data[emailField.key] ?? '').trim() : '';
      const answeredPhone = phoneField ? String(result.data[phoneField.key] ?? '').trim() : '';
      if (answeredEmail || answeredPhone) {
        setBuyer((prev) => ({
          ...prev,
          email: prev.email || answeredEmail,
          phone: prev.phone || formatPlPhoneInput(answeredPhone),
        }));
      }
    } else if (currentStepKey === 'ticket') {
      if (!validateBuyerAndTicket()) {
        focusFirstError();
        return;
      }
    }
    setStep(Math.min(steps.length - 1, stepIndex + 1));
  }

  function goBack() {
    setStep(Math.max(0, stepIndex - 1));
  }

  function goToStep(key: string) {
    const idx = steps.findIndex((s) => s.key === key);
    if (idx >= 0) setStep(idx);
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
        buyer: { email: buyer.email, phone: buyer.phone || null, address: buyer.address || null },
        answers: fieldsResult.data,
        discountCode: appliedDiscount?.code,
        acceptTerms: legal.terms,
        acceptPrivacy: legal.privacy,
      });
      clearDraft(form.slug);
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
  const availablePrices = form.ticketTypes.filter((t) => !t.soldOut).map((t) => t.priceCents);
  const paidPrices = availablePrices.filter((p) => p > 0);
  const hasFreeTicket = paidPrices.length < availablePrices.length;
  const minPaid = paidPrices.length > 0 ? Math.min(...paidPrices) : null;
  const paidLabel =
    minPaid === null ? null : `${paidPrices.some((p) => p !== minPaid) ? 'od ' : ''}${formatPln(minPaid)}`;
  const priceLabel =
    availablePrices.length === 0
      ? null
      : paidLabel === null
        ? 'Bezpłatny'
        : hasFreeTicket
          ? `Bezpłatny lub ${paidLabel}`
          : paidLabel.charAt(0).toUpperCase() + paidLabel.slice(1);
  const hasHeroImage = Boolean(form.backgroundImageDesktopUrl || form.backgroundImageMobileUrl);

  const editButton = (label: string, step: string) => (
    <IconButton icon={Pencil} label={label} size="sm" onClick={() => goToStep(step)} />
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10 lg:max-w-4xl">
      <div className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-card">
        {/* Zdjęcie wydarzenia (lub gradient marki). Ze zdjęciem — pełny podgląd, bez kadrowania: wysokość dopasowuje się do proporcji obrazu. */}
        <div className="relative overflow-hidden">
          {hasHeroImage ? (
            <>
              {form.backgroundImageMobileUrl && (
                <img
                  src={form.backgroundImageMobileUrl}
                  alt=""
                  className="block w-full bg800:hidden"
                />
              )}
              <img
                src={form.backgroundImageDesktopUrl ?? form.backgroundImageMobileUrl ?? undefined}
                alt=""
                className={`block w-full ${form.backgroundImageMobileUrl ? 'hidden bg800:block' : ''}`}
              />
            </>
          ) : (
            <div className="min-h-[260px] bg-brand-gradient sm:min-h-[340px]" />
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

        {/* Najważniejsze informacje: kiedy, do kiedy zapisy i ile kosztuje. */}
        <dl className="grid gap-3 border-t border-slate-200 p-5 text-sm sm:grid-cols-3 sm:p-8 sm:py-5">
          <div className="flex items-start gap-2.5">
            <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            <div>
              <dt className="text-xs text-slate-500">Termin</dt>
              <dd className="font-medium first-letter:uppercase text-slate-900">
                {eventDateFormat.format(new Date(form.eventDate))}
              </dd>
            </div>
          </div>
          {!allSoldOut && (
            <div className="flex items-start gap-2.5">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              <div>
                <dt className="text-xs text-slate-500">Zapisy do</dt>
                <dd className="font-medium text-slate-900">{closesAtFormat.format(new Date(form.closesAt))}</dd>
              </div>
            </div>
          )}
          {priceLabel && (
            <div className="flex items-start gap-2.5">
              <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              <div>
                <dt className="text-xs text-slate-500">Cena</dt>
                <dd className="font-medium text-slate-900">{priceLabel}</dd>
              </div>
            </div>
          )}
        </dl>

        {/* O wydarzeniu — akordeon, domyślnie rozwinięty; formularz jest od razu pod nim. */}
        {form.description && (
          <div className="border-t border-slate-200 bg-brand-50/40">
            <button
              type="button"
              onClick={() => setAboutOpen((v) => !v)}
              aria-expanded={aboutOpen}
              aria-controls="event-about"
              className="flex w-full items-center justify-between gap-4 p-5 text-left sm:p-8"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">O wydarzeniu</span>
              <svg
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden
                className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-300 ${aboutOpen ? 'rotate-180' : ''}`}
              >
                <path d="M5 7.5 10 12.5 15 7.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div
              id="event-about"
              className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${aboutOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            >
              <div className="overflow-hidden px-5 sm:px-8">
                <div
                  className="prose prose-slate max-w-none pb-5 text-sm text-slate-600 sm:pb-8 sm:text-base [&_a]:text-brand-700 [&_a]:underline"
                  dangerouslySetInnerHTML={{ __html: form.description }}
                />
              </div>
            </div>
          </div>
        )}

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
        ) : (
          <div id="rejestracja" className="border-t border-slate-200 p-5 sm:p-8">
            <Stepper steps={steps} currentIndex={stepIndex} />

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
                        const errorId = `${inputId}-error`;
                        const a11y = {
                          'aria-invalid': hasError || undefined,
                          'aria-required': field.required || undefined,
                          'aria-describedby': hasError ? errorId : undefined,
                        };
                        return (
                          <div key={field.key} data-field-key={field.key}>
                            {field.type === 'checkbox' ? (
                              <label className={`flex items-start gap-2 text-sm ${hasError ? 'text-red-700' : ''}`}>
                                <input
                                  type="checkbox"
                                  {...a11y}
                                  className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600 focus:ring-brand-200"
                                  checked={Boolean(answers[field.key])}
                                  onChange={(e) => setAnswers({ ...answers, [field.key]: e.target.checked })}
                                />
                                <span>
                                  {field.label}
                                  {field.required && <RequiredMark />}
                                </span>
                              </label>
                            ) : (
                              <>
                                <label className={`label ${hasError ? 'text-red-700' : ''}`} htmlFor={inputId}>
                                  {field.label}
                                  {field.required && <RequiredMark />}
                                </label>
                                {field.type === 'select' ? (
                                  <select
                                    id={inputId}
                                    {...a11y}
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
                                    {...a11y}
                                    className={`input ${hasError ? 'input-error' : ''}`}
                                    type={
                                      field.type === 'number'
                                        ? 'number'
                                        : field.type === 'date'
                                          ? 'date'
                                          : field.type === 'tel'
                                            ? 'tel'
                                            : 'text'
                                    }
                                    placeholder={field.type === 'tel' ? '+48 601 234 567' : undefined}
                                    value={String(answers[field.key] ?? '')}
                                    onChange={(e) =>
                                      setAnswers({
                                        ...answers,
                                        [field.key]:
                                          field.type === 'tel' ? formatPlPhoneInput(e.target.value) : e.target.value,
                                      })
                                    }
                                  />
                                )}
                              </>
                            )}
                            {hasError && (
                              <p id={errorId} className="mt-1 text-xs text-red-600">
                                {fieldErrors[field.key]}
                              </p>
                            )}
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
                  <div
                    className="space-y-3"
                    role="radiogroup"
                    aria-label="Rodzaj biletu"
                    aria-describedby={ticketError ? 'ticket-error' : undefined}
                    data-invalid={Boolean(ticketError) || undefined}
                  >
                    {form.ticketTypes.map((ticket) => {
                      const active = ticketTypeId === ticket.id;
                      return (
                        <label
                          key={ticket.id}
                          className={`flex cursor-pointer items-center justify-between gap-4 rounded-2xl border-2 p-4 transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand-200 ${
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
                  {ticketError && (
                    <p id="ticket-error" className="text-sm text-red-600">
                      {ticketError}
                    </p>
                  )}

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
                                aria-invalid={Boolean(discountError) || undefined}
                                aria-describedby={discountError ? 'discount-code-error' : undefined}
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
                              {discountError && (
                                <p id="discount-code-error" className="mt-1 text-xs text-red-600">
                                  {discountError}
                                </p>
                              )}
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
                        E-mail
                        <RequiredMark />
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
                          aria-describedby="buyer-email-hint"
                          className={`input pl-10 ${buyerErrors.email ? 'input-error' : ''}`}
                          placeholder="jan.kowalski@example.com"
                          value={buyer.email}
                          onChange={(e) => setBuyer({ ...buyer, email: e.target.value })}
                          required
                        />
                      </div>
                      {buyerErrors.email ? (
                        <p id="buyer-email-hint" className="mt-1 text-xs text-red-600">
                          {buyerErrors.email}
                        </p>
                      ) : (
                        <p id="buyer-email-hint" className="mt-1 text-xs text-slate-500">
                          Na ten adres wyślemy potwierdzenie i bilet.
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="label" htmlFor="buyer-phone">
                        Telefon (opcjonalnie)
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
                          aria-describedby={buyerErrors.phone ? 'buyer-phone-error' : undefined}
                          className={`input pl-10 ${buyerErrors.phone ? 'input-error' : ''}`}
                          placeholder="+48 601 234 567"
                          value={buyer.phone}
                          onChange={(e) => setBuyer({ ...buyer, phone: formatPlPhoneInput(e.target.value) })}
                        />
                      </div>
                      {buyerErrors.phone && (
                        <p id="buyer-phone-error" className="mt-1 text-xs text-red-600">
                          {buyerErrors.phone}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="label" htmlFor="buyer-address">
                        Adres
                      </label>
                      <div className="relative">
                        <MapPin
                          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                          aria-hidden
                        />
                        <input
                          id="buyer-address"
                          type="text"
                          autoComplete="street-address"
                          className="input pl-10"
                          placeholder="Ul. Przykładowa 1, 00-001 Warszawa"
                          value={buyer.address}
                          onChange={(e) => setBuyer({ ...buyer, address: e.target.value })}
                        />
                      </div>
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
                      {buyer.address && (
                        <div className="flex items-center justify-between gap-4">
                          <dt className="inline-flex items-center gap-1.5 text-slate-500">
                            <MapPin className="h-3.5 w-3.5" aria-hidden />
                            Adres
                          </dt>
                          <dd className="text-right font-medium text-slate-800">{buyer.address}</dd>
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
                        aria-invalid={(Boolean(legalError) && !legal.terms) || undefined}
                        aria-required
                        aria-describedby={legalError ? 'legal-error' : undefined}
                        checked={legal.terms}
                        onChange={(e) => setLegal({ ...legal, terms: e.target.checked })}
                      />
                      <span>
                        Akceptuję{' '}
                        <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className={legalLinkClass}>
                          regulamin
                        </a>{' '}
                        (wersja {form.termsVersion})
                        <RequiredMark />
                      </span>
                    </label>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600 focus:ring-brand-200"
                        aria-invalid={(Boolean(legalError) && !legal.privacy) || undefined}
                        aria-required
                        aria-describedby={legalError ? 'legal-error' : undefined}
                        checked={legal.privacy}
                        onChange={(e) => setLegal({ ...legal, privacy: e.target.checked })}
                      />
                      <span>
                        Zapoznałem/-am się z{' '}
                        <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" className={legalLinkClass}>
                          polityką prywatności
                        </a>{' '}
                        (wersja {form.privacyPolicyVersion})
                        <RequiredMark />
                      </span>
                    </label>
                    {legalError && (
                      <p id="legal-error" className="text-xs text-red-600">
                        {legalError}
                      </p>
                    )}
                  </div>

                  {error && (
                    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                      {error}
                    </p>
                  )}
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
