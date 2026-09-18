import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import {
  Archive,
  ArrowLeft,
  Braces,
  ChevronDown,
  CircleCheck,
  CircleX,
  Code,
  Copy,
  CopyPlus,
  CreditCard,
  Ellipsis,
  ExternalLink,
  Eye,
  Globe,
  History,
  Image,
  Info,
  ListChecks,
  LoaderCircle,
  Mail,
  MapPin,
  Save,
  ScanLine,
  ShieldCheck,
  Ticket,
  TicketPercent,
  Trash2,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  EMAIL_BUILTIN_VARIABLES,
  flattenSections,
  knownVariableNames,
  normalizeVariableName,
  templateVariableNames,
  type ConsentDefinition,
  type DiscountCodeDto,
  type FormSection,
} from '@syjonevent/shared';
import SectionBuilder, { sectionBuilderErrors } from '../components/SectionBuilder';
import RichTextEditor from '../components/RichTextEditor';
import BackgroundUploader from '../components/editor/BackgroundUploader';
import ConsentsEditor, { consentsErrors } from '../components/editor/ConsentsEditor';
import DiscountCodesEditor, { discountCodeError, type DiscountCodeDraft } from '../components/editor/DiscountCodesEditor';
import EditorNav, { type NavSection } from '../components/editor/EditorNav';
import TicketsEditor, { ticketError, type TicketDraft } from '../components/editor/TicketsEditor';
import { useConfirm } from '../components/ui/ConfirmDialog';
import IconButton from '../components/ui/IconButton';
import Menu, { type MenuItem } from '../components/ui/Menu';
import StatusBadge from '../components/ui/StatusBadge';
import { useToast } from '../components/ui/Toast';
import { useCanEdit } from '../lib/admin';
import { api, ApiError } from '../lib/api';
import { centsToPlnInput, normalizeHtml, parsePlnInput, slugify } from '../lib/format';
import { FORM_STATUS, type FormStatus } from '../lib/status';

interface TicketDto {
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
  status: FormStatus;
  eventDate: string;
  closesAt: string;
  location: string | null;
  capacityTotal: number | null;
  termsVersion: string;
  privacyPolicyVersion: string;
  paymentSuccessTitle: string | null;
  paymentSuccessBody: string | null;
  paymentErrorTitle: string | null;
  paymentErrorBody: string | null;
  confirmationEmailTitle: string | null;
  confirmationEmailBody: string | null;
  backgroundImageDesktopUrl: string | null;
  backgroundImageMobileUrl: string | null;
  schemaJson: { sections: FormSection[]; consents?: ConsentDefinition[]; customScript?: string };
  ticketTypes: TicketDto[];
  discountCodes: DiscountCodeDto[];
}

interface Occupancy {
  total: number;
  perTicketType: Record<string, number>;
}

interface Draft {
  slug: string;
  title: string;
  description: string;
  eventDate: string;
  closesAt: string;
  location: string;
  capacityTotal: string;
  termsVersion: string;
  privacyPolicyVersion: string;
  paymentSuccessTitle: string;
  paymentSuccessBody: string;
  paymentErrorTitle: string;
  paymentErrorBody: string;
  confirmationEmailTitle: string;
  confirmationEmailBody: string;
}

interface EditorState {
  draft: Draft;
  sections: FormSection[];
  consents: ConsentDefinition[];
  customScript: string;
  tickets: TicketDraft[];
  discountCodes: DiscountCodeDraft[];
}

const NAV_SECTIONS: NavSection[] = [
  { id: 'podstawowe', label: 'Podstawowe', icon: Info },
  { id: 'pola', label: 'Pola formularza', icon: ListChecks },
  { id: 'bilety', label: 'Bilety', icon: Ticket },
  { id: 'rabaty', label: 'Kody rabatowe', icon: TicketPercent },
  { id: 'zgody', label: 'Zgody', icon: ShieldCheck },
  { id: 'wyglad', label: 'Wygląd', icon: Image },
  { id: 'email', label: 'E-mail', icon: Mail },
  { id: 'zaawansowane', label: 'Zaawansowane', icon: Code },
];

// Nadal działają, jeśli organizator wpisze je ręcznie — tylko nie proponujemy ich jako domyślne przyciski.
const HIDDEN_BUILTIN_VARIABLES = new Set(['email', 'telefon', 'kwota']);

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** ISO → "RRRR-MM-DD" w strefie przeglądarki (wartość pola typu date). */
const toLocalDateInput = (iso: string) => {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

// Wybieramy same daty: wydarzenie zaczyna się o północy, a zapisy trwają do końca wybranego dnia.
const eventDateToIso = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const closesAtToIso = (day: string) => new Date(`${day}T23:59:59`).toISOString();

function defaultSections(): FormSection[] {
  return [
    {
      id: crypto.randomUUID(),
      name: 'Dane osobowe',
      fields: [
        { key: 'imie', label: 'Imię', type: 'text', required: true },
        { key: 'nazwisko', label: 'Nazwisko', type: 'text', required: true },
        { key: 'data_urodzenia', label: 'Data urodzenia', type: 'date', required: true },
        { key: 'email', label: 'Adres e-mail', type: 'email', required: true },
        { key: 'telefon', label: 'Numer telefonu', type: 'tel', required: true },
      ],
    },
  ];
}

function emptyState(): EditorState {
  return {
    draft: {
      slug: '',
      title: '',
      description: '',
      eventDate: toLocalDateInput(new Date(Date.now() + 30 * 86_400_000).toISOString()),
      closesAt: toLocalDateInput(new Date(Date.now() + 29 * 86_400_000).toISOString()),
      location: '',
      capacityTotal: '',
      termsVersion: '1.0',
      privacyPolicyVersion: '1.0',
      paymentSuccessTitle: '',
      paymentSuccessBody: '',
      paymentErrorTitle: '',
      paymentErrorBody: '',
      confirmationEmailTitle: '',
      confirmationEmailBody: '',
    },
    sections: defaultSections(),
    consents: [],
    customScript: '',
    tickets: [],
    discountCodes: [],
  };
}

function stateFromForm(form: FormDetails): EditorState {
  return {
    draft: {
      slug: form.slug,
      title: form.title,
      description: form.description ?? '',
      eventDate: toLocalDateInput(form.eventDate),
      closesAt: toLocalDateInput(form.closesAt),
      location: form.location ?? '',
      capacityTotal: form.capacityTotal?.toString() ?? '',
      termsVersion: form.termsVersion,
      privacyPolicyVersion: form.privacyPolicyVersion,
      paymentSuccessTitle: form.paymentSuccessTitle ?? '',
      paymentSuccessBody: form.paymentSuccessBody ?? '',
      paymentErrorTitle: form.paymentErrorTitle ?? '',
      paymentErrorBody: form.paymentErrorBody ?? '',
      confirmationEmailTitle: form.confirmationEmailTitle ?? '',
      confirmationEmailBody: form.confirmationEmailBody ?? '',
    },
    sections: form.schemaJson.sections ?? [],
    consents: form.schemaJson.consents ?? [],
    customScript: form.schemaJson.customScript ?? '',
    tickets: [...form.ticketTypes]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({
        key: t.id,
        id: t.id,
        name: t.name,
        priceInput: centsToPlnInput(t.priceCents),
        capacityInput: t.capacity?.toString() ?? '',
        isActive: t.isActive,
      })),
    discountCodes: form.discountCodes.map((c) => ({
      key: c.id,
      id: c.id,
      code: c.code,
      type: c.type,
      valueInput: c.type === 'PERCENT' ? String(c.value) : centsToPlnInput(c.value),
      isActive: c.isActive,
      usageCount: c.usageCount,
    })),
  };
}

/** Porównywalny odcisk stanu edytora — różny od zapisanego = są niezapisane zmiany. */
function snapshot(state: EditorState): string {
  return JSON.stringify({
    ...state.draft,
    description: normalizeHtml(state.draft.description),
    sections: state.sections,
    consents: state.consents,
    customScript: state.customScript,
    tickets: state.tickets.map(({ key: _key, priceInput, ...rest }) => ({
      ...rest,
      price: parsePlnInput(priceInput) ?? priceInput,
    })),
    discountCodes: state.discountCodes.map(({ key: _key, usageCount: _usageCount, valueInput, type, ...rest }) => ({
      ...rest,
      type,
      value: type === 'PERCENT' ? Number(valueInput) : (parsePlnInput(valueInput) ?? valueInput),
    })),
  });
}

function VariableChip({ name, label, onInsert }: { name: string; label: string; onInsert: (name: string) => void }) {
  return (
    <button
      type="button"
      title={`Wstaw {{${name}}}`}
      // Bez tego kliknięcie zabiera fokus z pola i nie wiemy, gdzie był kursor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onInsert(name)}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition hover:border-brand-300 hover:bg-brand-50"
    >
      {label}
      <code className="font-mono text-[11px] text-slate-400">{`{{${name}}}`}</code>
    </button>
  );
}

function EditorCard({
  id,
  icon: Icon,
  title,
  description,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = !collapsible || open;

  const header = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-medium leading-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {collapsible && (
        <ChevronDown
          className={`mt-1.5 h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden
        />
      )}
    </>
  );

  return (
    <section id={id} className="card scroll-mt-16 space-y-5 lg:scroll-mt-6">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={isOpen}
          className="flex w-full items-start gap-3 text-left"
        >
          {header}
        </button>
      ) : (
        <header className="flex items-start gap-3">{header}</header>
      )}
      {isOpen && children}
    </section>
  );
}

export default function AdminFormEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const isNew = !id;
  const canEdit = useCanEdit();
  const formRef = useRef<HTMLFormElement>(null);
  const emailTitleRef = useRef<HTMLInputElement>(null);
  const emailBodyRef = useRef<HTMLTextAreaElement>(null);
  const emailTargetRef = useRef<'confirmationEmailTitle' | 'confirmationEmailBody'>('confirmationEmailBody');

  const [initial] = useState(emptyState);
  const [form, setForm] = useState<FormDetails | null>(null);
  const [occupancy, setOccupancy] = useState<Occupancy>({ total: 0, perTicketType: {} });
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [sections, setSections] = useState<FormSection[]>(initial.sections);
  const [consents, setConsents] = useState<ConsentDefinition[]>(initial.consents);
  const [customScript, setCustomScript] = useState(initial.customScript);
  const [tickets, setTickets] = useState<TicketDraft[]>(initial.tickets);
  const [discountCodes, setDiscountCodes] = useState<DiscountCodeDraft[]>(initial.discountCodes);
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot(initial));
  const [slugTouched, setSlugTouched] = useState(false);
  const [showTicketErrors, setShowTicketErrors] = useState(false);
  const [showDiscountErrors, setShowDiscountErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState<'desktop' | 'mobile' | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Po udanym zapisie nowego wydarzenia przechodzimy na jego adres — ta nawigacja nie może być blokowana.
  const allowNavigationRef = useRef(false);

  const applyState = useCallback((state: EditorState) => {
    setDraft(state.draft);
    setSections(state.sections);
    setConsents(state.consents);
    setCustomScript(state.customScript);
    setTickets(state.tickets);
    setDiscountCodes(state.discountCodes);
    setSavedSnapshot(snapshot(state));
    setShowTicketErrors(false);
    setShowDiscountErrors(false);
  }, []);

  const hydrate = useCallback(
    (data: { form: FormDetails; occupancy: Occupancy }) => {
      setForm(data.form);
      setOccupancy(data.occupancy);
      applyState(stateFromForm(data.form));
    },
    [applyState],
  );

  const fetchForm = useCallback(
    (formId: string) => api.get<{ form: FormDetails; occupancy: Occupancy }>(`/api/forms/${formId}`),
    [],
  );

  useEffect(() => {
    allowNavigationRef.current = false;
    if (!id) {
      // Ten sam komponent obsługuje "nowe" i "edycję" — przy przejściu z edycji czyścimy stan.
      setForm(null);
      setSlugTouched(false);
      applyState(emptyState());
      return;
    }
    setLoadError(null);
    fetchForm(id)
      .then(hydrate)
      .catch((error: ApiError) => setLoadError(error.message));
  }, [id, fetchForm, hydrate, applyState]);

  const current: EditorState = { draft, sections, consents, customScript, tickets, discountCodes };
  const currentSnapshot = snapshot(current);
  const dirty = currentSnapshot !== savedSnapshot;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !allowNavigationRef.current && dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void confirm({
      title: 'Opuścić edycję bez zapisywania?',
      description: 'Masz niezapisane zmiany w tym wydarzeniu. Jeśli wyjdziesz, zostaną utracone.',
      confirmLabel: 'Wyjdź bez zapisywania',
      cancelLabel: 'Zostań',
      tone: 'danger',
    }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
    // Tylko przy wejściu w stan "blocked" — kolejne rendery w tym stanie nie mogą otwierać okna ponownie.
  }, [blocker.state]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function scrollToSection(sectionId: string) {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Zapisuje wydarzenie i bilety jednym ruchem. Zwraca true, gdy wszystko się udało. */
  async function persist(): Promise<boolean> {
    if (tickets.some((t) => Object.keys(ticketError(t)).length > 0)) {
      setShowTicketErrors(true);
      toast.error('Popraw zaznaczone pola w biletach');
      scrollToSection('bilety');
      return false;
    }
    if (discountCodes.some((c) => Object.keys(discountCodeError(c)).length > 0)) {
      setShowDiscountErrors(true);
      toast.error('Popraw zaznaczone pola w kodach rabatowych');
      scrollToSection('rabaty');
      return false;
    }
    const builderErrors = sectionBuilderErrors(sections);
    if (builderErrors.length > 0) {
      toast.error(builderErrors[0] as string);
      scrollToSection('pola');
      return false;
    }
    const consentProblems = consentsErrors(consents);
    if (consentProblems.length > 0) {
      toast.error(consentProblems[0] as string);
      scrollToSection('zgody');
      return false;
    }

    setBusy(true);
    // Siatka bezpieczeństwa: opcje select mogą zawierać niedoczyszczone puste
    // wiersze podczas edycji (czyszczenie dzieje się na onBlur w SectionBuilder).
    const cleanedSections = sections.map((section) => ({
      ...section,
      name: section.name.trim(),
      fields: section.fields.map((field) =>
        field.type === 'select'
          ? { ...field, options: field.options.map((o) => o.trim()).filter(Boolean) }
          : field,
      ),
    }));
    const payload = {
      slug: draft.slug,
      title: draft.title,
      description: draft.description || null,
      eventDate: eventDateToIso(draft.eventDate),
      closesAt: closesAtToIso(draft.closesAt),
      location: draft.location.trim() || null,
      capacityTotal: draft.capacityTotal === '' ? null : Number(draft.capacityTotal),
      termsVersion: draft.termsVersion,
      privacyPolicyVersion: draft.privacyPolicyVersion,
      // Puste pole = brak własnej treści, czyli tekst domyślny aplikacji.
      paymentSuccessTitle: draft.paymentSuccessTitle || null,
      paymentSuccessBody: draft.paymentSuccessBody || null,
      paymentErrorTitle: draft.paymentErrorTitle || null,
      paymentErrorBody: draft.paymentErrorBody || null,
      confirmationEmailTitle: draft.confirmationEmailTitle || null,
      confirmationEmailBody: draft.confirmationEmailBody || null,
      schemaJson: {
        sections: cleanedSections,
        consents: consents.map((consent) => ({ ...consent, label: consent.label.trim(), url: consent.url?.trim() || undefined })),
        customScript: customScript || undefined,
      },
    };

    let formId = id ?? null;
    // Kopia robocza — tu zapisujemy id biletów/kodów utworzonych w trakcie, żeby ponowny zapis
    // po częściowym błędzie nie utworzył ich drugi raz.
    const working = tickets.map((t) => ({ ...t }));
    const workingDiscounts = discountCodes.map((c) => ({ ...c }));
    try {
      if (isNew) {
        const created = await api.post<{ form: FormDetails }>('/api/forms', payload);
        formId = created.form.id;
      } else {
        await api.patch(`/api/forms/${id}`, payload);
      }

      const savedById = new Map((form?.ticketTypes ?? []).map((t) => [t.id, t]));
      for (const [index, ticket] of working.entries()) {
        const body = {
          name: ticket.name.trim(),
          priceCents: parsePlnInput(ticket.priceInput) ?? 0,
          capacity: ticket.capacityInput === '' ? null : Number(ticket.capacityInput),
          sortOrder: index + 1,
          isActive: ticket.isActive,
        };
        try {
          if (!ticket.id) {
            const res = await api.post<{ ticket: TicketDto }>(`/api/forms/${formId}/tickets`, body);
            ticket.id = res.ticket.id;
          } else {
            const prev = savedById.get(ticket.id);
            const changed =
              !prev ||
              prev.name !== body.name ||
              prev.priceCents !== body.priceCents ||
              prev.capacity !== body.capacity ||
              prev.sortOrder !== body.sortOrder ||
              prev.isActive !== body.isActive;
            if (changed) await api.patch(`/api/forms/${formId}/tickets/${ticket.id}`, body);
          }
        } catch (error) {
          const reason = error instanceof ApiError ? error.message : 'nieznany błąd';
          throw new ApiError(0, 'TICKET', `Bilet „${body.name || 'bez nazwy'}”: ${reason}`);
        }
      }

      const savedDiscountById = new Map((form?.discountCodes ?? []).map((c) => [c.id, c]));
      for (const code of workingDiscounts) {
        const body = {
          code: code.code.trim().toUpperCase(),
          type: code.type,
          value: code.type === 'PERCENT' ? Number(code.valueInput) : (parsePlnInput(code.valueInput) ?? 0),
          isActive: code.isActive,
        };
        try {
          if (!code.id) {
            const res = await api.post<{ discountCode: DiscountCodeDto }>(
              `/api/forms/${formId}/discount-codes`,
              body,
            );
            code.id = res.discountCode.id;
          } else {
            const prev = savedDiscountById.get(code.id);
            const changed =
              !prev || prev.code !== body.code || prev.type !== body.type || prev.value !== body.value || prev.isActive !== body.isActive;
            if (changed) await api.patch(`/api/forms/${formId}/discount-codes/${code.id}`, body);
          }
        } catch (error) {
          const reason = error instanceof ApiError ? error.message : 'nieznany błąd';
          throw new ApiError(0, 'DISCOUNT_CODE', `Kod „${body.code || 'bez nazwy'}”: ${reason}`);
        }
      }

      if (isNew && formId) {
        toast.success('Utworzono wydarzenie');
        allowNavigationRef.current = true;
        navigate(`/admin/formularze/${formId}`, { replace: true });
        return true;
      }
      hydrate(await fetchForm(formId as string));
      toast.success('Zapisano zmiany');
      return true;
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Błąd zapisu');
      if (isNew && formId) {
        // Wydarzenie powstało, ale coś poszło nie tak z biletami — przechodzimy do edycji,
        // żeby kolejny zapis nie tworzył drugiego wydarzenia.
        allowNavigationRef.current = true;
        navigate(`/admin/formularze/${formId}`, { replace: true });
      } else if (formId) {
        // Część zmian mogła się zapisać: bierzemy stan z serwera jako "zapisany",
        // ale zostawiamy edycje admina, żeby mógł poprawić i zapisać ponownie.
        setTickets(working);
        setDiscountCodes(workingDiscounts);
        const fresh = await fetchForm(formId).catch(() => null);
        if (fresh) {
          setForm(fresh.form);
          setOccupancy(fresh.occupancy);
          setSavedSnapshot(snapshot(stateFromForm(fresh.form)));
        }
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    void persist();
  }

  async function discardChanges() {
    if (!form) return;
    const ok = await confirm({
      title: 'Odrzucić niezapisane zmiany?',
      description: 'Formularz wróci do ostatnio zapisanej wersji.',
      confirmLabel: 'Odrzuć zmiany',
      tone: 'danger',
    });
    if (ok) applyState(stateFromForm(form));
  }

  async function publish() {
    if (!form) return;
    if (dirty && !(await persist())) return;
    try {
      const data = await api.post<{ form: FormDetails }>(`/api/forms/${form.id}/publish`);
      setForm((prev) => (prev ? { ...prev, status: data.form.status } : prev));
      toast.success('Wydarzenie opublikowane — formularz przyjmuje zgłoszenia');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się opublikować');
    }
  }

  async function archive() {
    if (!form) return;
    const ok = await confirm({
      title: 'Zarchiwizować wydarzenie?',
      description: 'Formularz przestanie przyjmować zgłoszenia. Istniejące zgłoszenia i płatności zostaną zachowane.',
      confirmLabel: 'Archiwizuj',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const data = await api.post<{ form: FormDetails }>(`/api/forms/${form.id}/archive`);
      setForm((prev) => (prev ? { ...prev, status: data.form.status } : prev));
      toast.success('Wydarzenie zarchiwizowane');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Błąd operacji');
    }
  }

  async function deleteForever() {
    if (!form) return;
    const ok = await confirm({
      title: 'Usunąć wydarzenie trwale?',
      description:
        'Wydarzenie oraz wszystkie powiązane dane — zgłoszenia, płatności, kody rabatowe i bilety — zostaną nieodwracalnie usunięte z bazy danych. Tej operacji nie można cofnąć.',
      confirmLabel: 'Usuń trwale',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/forms/${form.id}?force=true`);
      toast.success('Wydarzenie usunięte trwale');
      navigate('/admin');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się usunąć wydarzenia');
    }
  }

  async function duplicate() {
    if (!form) return;
    if (dirty && !(await persist())) return;
    try {
      const data = await api.post<{ form: { id: string } }>(`/api/forms/${form.id}/duplicate`);
      toast.success('Utworzono kopię jako szkic — sprawdź daty i opublikuj');
      navigate(`/admin/formularze/${data.form.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się skopiować wydarzenia');
    }
  }

  async function copyPublicLink() {
    if (!form) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/f/${form.slug}`);
      toast.success('Skopiowano link do formularza');
    } catch {
      toast.error('Nie udało się skopiować linku');
    }
  }

  // Odpowiedź uploadu/usunięcia to surowy rekord Form bez ticketTypes — scalamy tylko pola tła.
  function mergeBackgroundFields(patch: Pick<FormDetails, 'backgroundImageDesktopUrl' | 'backgroundImageMobileUrl'>) {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            backgroundImageDesktopUrl: patch.backgroundImageDesktopUrl,
            backgroundImageMobileUrl: patch.backgroundImageMobileUrl,
          }
        : prev,
    );
  }

  async function uploadBackground(variant: 'desktop' | 'mobile', file: File) {
    setBackgroundBusy(variant);
    try {
      const body = new FormData();
      body.append('image', file);
      const data = await api.post<{ form: FormDetails }>(`/api/forms/${id}/background/${variant}`, body);
      mergeBackgroundFields(data.form);
      toast.success('Wgrano grafikę tła');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się wgrać pliku');
    } finally {
      setBackgroundBusy(null);
    }
  }

  async function removeBackground(variant: 'desktop' | 'mobile') {
    const confirmed = await confirm({
      title: 'Usunąć grafikę tła?',
      description: 'Plik zostanie usunięty z wydarzenia. Możesz później wgrać nowy.',
      confirmLabel: 'Usuń grafikę',
      tone: 'danger',
    });
    if (!confirmed) return;
    setBackgroundBusy(variant);
    try {
      const data = await api.delete<{ form: FormDetails }>(`/api/forms/${id}/background/${variant}`);
      mergeBackgroundFields(data.form);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się usunąć grafiki');
    } finally {
      setBackgroundBusy(null);
    }
  }

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  /** Wstawia znacznik w miejscu kursora w ostatnio edytowanym polu (tytuł albo treść). */
  function insertEmailVariable(name: string) {
    const key = emailTargetRef.current;
    const element = key === 'confirmationEmailTitle' ? emailTitleRef.current : emailBodyRef.current;
    const current = draft[key];
    const token = `{{${name}}}`;
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? current.length;
    setField(key, current.slice(0, start) + token + current.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const moreActions: MenuItem[] = form
    ? [
        { label: 'Kopiuj link publiczny', icon: Copy, onSelect: () => void copyPublicLink() },
        ...(canEdit
          ? [
              { label: 'Duplikuj', icon: CopyPlus, onSelect: () => void duplicate() },
              { label: 'Historia zmian', icon: History, onSelect: () => navigate(`/admin/dziennik?formId=${form.id}`) },
              form.status !== 'ARCHIVED'
                ? { label: 'Archiwizuj', icon: Archive, onSelect: () => void archive() }
                : { label: 'Usuń trwale', icon: Trash2, tone: 'danger' as const, onSelect: () => void deleteForever() },
            ]
          : []),
      ]
    : [];

  if (!isNew && loadError) {
    return (
      <div className="card mx-auto max-w-md text-center">
        <p className="font-medium text-slate-900">Nie udało się wczytać wydarzenia</p>
        <p className="mt-1 text-sm text-slate-500">{loadError}</p>
        <Link to="/admin" className="btn-secondary mt-4">
          Wróć do listy
        </Link>
      </div>
    );
  }

  if (!isNew && !form) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-500">
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
        Ładowanie wydarzenia…
      </div>
    );
  }

  const slugChangedOnPublished = form?.status === 'PUBLISHED' && draft.slug !== form.slug;

  const builtinNames = new Set<string>(EMAIL_BUILTIN_VARIABLES.map((variable) => variable.name));
  // Pola z imieniem/nazwiskiem pomijamy — obsługują je wbudowane {{imie}}, {{nazwisko}} i {{imie_nazwisko}}.
  const formFields = flattenSections(sections).filter(
    (field) => field.label.trim() && !/imi[eę]|nazwisko/i.test(field.label),
  );
  // Czytelny znacznik z nazwy pola ({{dieta}}); klucz pola tylko przy kolizji nazw.
  const fieldVariables = formFields.map((field) => {
    const slug = normalizeVariableName(field.label);
    const unique =
      slug !== '' &&
      !builtinNames.has(slug) &&
      formFields.filter((other) => normalizeVariableName(other.label) === slug).length === 1;
    return { name: unique ? slug : field.key, label: field.label };
  });
  const knownNames = knownVariableNames(sections);
  const unknownEmailVariables = [
    ...new Set(
      templateVariableNames(`${draft.confirmationEmailTitle}\n${draft.confirmationEmailBody}`).filter(
        (name) => !knownNames.has(name),
      ),
    ),
  ];

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link
            to="/admin"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Wydarzenia
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-2xl font-semibold">{isNew ? 'Nowe wydarzenie' : form?.title}</h1>
            {form && <StatusBadge meta={FORM_STATUS[form.status]} />}
          </div>
        </div>

        {form && (
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/admin/formularze/${form.id}/zgloszenia`} className="btn-secondary">
              <Users className="h-4 w-4" aria-hidden />
              Zgłoszenia
            </Link>
            <Link to={`/admin/formularze/${form.id}/obecnosc`} className="btn-secondary">
              <ScanLine className="h-4 w-4" aria-hidden />
              Obecność
            </Link>
            {/* Publiczny formularz działa tylko dla opublikowanych wydarzeń — szkic dałby stronę "niedostępny". */}
            {form.status === 'PUBLISHED' && (
              <a className="btn-secondary" href={`/f/${form.slug}`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" aria-hidden />
                Otwórz formularz
              </a>
            )}
            {form.status === 'DRAFT' && canEdit && (
              <button type="button" className="btn-primary" onClick={() => void publish()} disabled={busy}>
                <Globe className="h-4 w-4" aria-hidden />
                Opublikuj
              </button>
            )}
            <Menu
              trigger={<Ellipsis className="h-4 w-4" aria-hidden />}
              triggerLabel="Więcej akcji"
              triggerClassName="btn-secondary px-3"
              align="right"
              items={moreActions}
            />
          </div>
        )}
      </div>

      {!canEdit && (
        <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
          Podgląd ustawień wydarzenia — zmiany może zapisać tylko administrator.
        </p>
      )}

      {form?.status === 'ARCHIVED' && (
        <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Archive className="h-4 w-4 shrink-0" aria-hidden />
          Wydarzenie jest zarchiwizowane — formularz nie przyjmuje zgłoszeń. Dane i zgłoszenia pozostają dostępne.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-8">
        <EditorNav sections={NAV_SECTIONS} />

        <form ref={formRef} onSubmit={onSubmit} className="min-w-0">
          {/* Konto "tylko podgląd" widzi wszystkie ustawienia, ale pola są zablokowane. */}
          <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
            <EditorCard id="podstawowe" icon={Info} title="Podstawowe informacje">
              <div>
                <label className="label" htmlFor="form-title">
                  Tytuł wydarzenia
                </label>
                <input
                  id="form-title"
                  className="input"
                  value={draft.title}
                  placeholder="np. Konferencja Syjon 2026"
                  required
                  onChange={(e) => {
                    const title = e.target.value;
                    setDraft((d) => ({ ...d, title, slug: isNew && !slugTouched ? slugify(title) : d.slug }));
                  }}
                />
              </div>

              <div>
                <label className="label" htmlFor="form-slug">
                  Adres formularza
                </label>
                <div className="flex gap-2">
                  <div className="flex min-w-0 flex-1">
                    <span className="inline-flex items-center rounded-l-xl border border-r-0 border-slate-200 bg-slate-50 px-3 font-mono text-sm text-slate-500">
                      /f/
                    </span>
                    <input
                      id="form-slug"
                      className="input !rounded-l-none font-mono"
                      value={draft.slug}
                      required
                      pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      title="Małe litery, cyfry i pojedyncze myślniki"
                      onChange={(e) => {
                        setSlugTouched(true);
                        setField('slug', e.target.value);
                      }}
                    />
                  </div>
                  {form && (
                    <IconButton
                      icon={Copy}
                      label="Kopiuj link publiczny"
                      className="h-[42px] w-[42px] rounded-xl"
                      onClick={() => void copyPublicLink()}
                    />
                  )}
                </div>
                {slugChangedOnPublished ? (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-700">
                    <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                    Wydarzenie jest opublikowane — zmiana adresu unieważni udostępnione linki.
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Małe litery, cyfry i myślniki.{isNew && !slugTouched ? ' Tworzy się automatycznie z tytułu.' : ''}
                  </p>
                )}
              </div>

              <div>
                <span className="label">Opis</span>
                <RichTextEditor
                  value={draft.description}
                  readOnly={!canEdit}
                  onChange={(html) => setField('description', html)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="label" htmlFor="form-event-date">
                    Data wydarzenia
                  </label>
                  <input
                    id="form-event-date"
                    type="date"
                    className="input"
                    value={draft.eventDate}
                    required
                    onChange={(e) => setField('eventDate', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="form-closes">
                    Zamknięcie zapisów
                  </label>
                  <input
                    id="form-closes"
                    type="date"
                    className="input"
                    value={draft.closesAt}
                    max={draft.eventDate || undefined}
                    required
                    aria-describedby="form-closes-hint"
                    onChange={(e) => setField('closesAt', e.target.value)}
                  />
                  <p id="form-closes-hint" className="mt-1.5 text-xs text-slate-500">
                    Zapisy trwają do końca wybranego dnia.
                  </p>
                </div>
                <div>
                  <label className="label" htmlFor="form-capacity">
                    Limit miejsc
                  </label>
                  <input
                    id="form-capacity"
                    type="number"
                    min={1}
                    className="input"
                    placeholder="Bez limitu"
                    value={draft.capacityTotal}
                    onChange={(e) => setField('capacityTotal', e.target.value)}
                  />
                  <p className="mt-1.5 text-xs text-slate-500">Łącznie dla wszystkich biletów.</p>
                </div>
              </div>

              <div>
                <label className="label" htmlFor="form-location">
                  Miejsce
                </label>
                <div className="relative">
                  <MapPin
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden
                  />
                  <input
                    id="form-location"
                    className="input pl-10"
                    maxLength={300}
                    placeholder="np. Dom rekolekcyjny, ul. Leśna 5, 05-080 Laski"
                    value={draft.location}
                    onChange={(e) => setField('location', e.target.value)}
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  Pokazujemy je na stronie wydarzenia z linkiem do mapy, w e-mailu i w pliku kalendarza.
                </p>
              </div>
            </EditorCard>

            <EditorCard
              id="pola"
              icon={ListChecks}
              title="Pola formularza"
              description="Dodatkowe pytania do uczestników, pogrupowane w sekcje."
            >
              <SectionBuilder sections={sections} onChange={setSections} />
            </EditorCard>

            <EditorCard
              id="bilety"
              icon={Ticket}
              title="Bilety"
              description="Bilet płatny kosztuje minimum 1,00 zł (limit Paynow) albo jest bezpłatny."
            >
              <TicketsEditor
                tickets={tickets}
                onChange={setTickets}
                occupancy={occupancy}
                capacityTotal={form?.capacityTotal ?? null}
                showErrors={showTicketErrors}
              />
            </EditorCard>

            <EditorCard
              id="rabaty"
              icon={TicketPercent}
              title="Kody rabatowe"
              description="Uczestnik wpisuje kod podczas rejestracji, by dostać tańszy bilet — procentowo lub o stałą kwotę."
            >
              <DiscountCodesEditor codes={discountCodes} onChange={setDiscountCodes} showErrors={showDiscountErrors} />
            </EditorCard>

            <EditorCard
              id="zgody"
              icon={ShieldCheck}
              title="Zgody dodatkowe"
              description="Np. zgoda na wizerunek albo na informacje o kolejnych wydarzeniach. Pokazujemy je obok regulaminu, a treść zapisujemy w każdym zgłoszeniu."
            >
              <ConsentsEditor consents={consents} onChange={setConsents} />
            </EditorCard>

            <EditorCard
              id="wyglad"
              icon={Image}
              title="Wygląd"
              description="Grafika w nagłówku strony rejestracji. Bez grafiki wyświetla się gradient marki."
            >
              <BackgroundUploader
                disabled={isNew || !canEdit}
                desktopUrl={form?.backgroundImageDesktopUrl ?? null}
                mobileUrl={form?.backgroundImageMobileUrl ?? null}
                busyVariant={backgroundBusy}
                onUpload={(variant, file) => void uploadBackground(variant, file)}
                onRemove={(variant) => void removeBackground(variant)}
              />
            </EditorCard>

            <EditorCard
              id="email"
              icon={Mail}
              title="E-mail z potwierdzeniem"
              description="Wysyłany po rejestracji na bilet bezpłatny lub po opłaceniu biletu. Dane biletu, kod QR i przycisk dodają się automatycznie. Puste pole = tekst domyślny."
            >
              <div className="space-y-4">
                <div>
                  <label className="label" htmlFor="email-title">
                    Tytuł
                  </label>
                  <input
                    ref={emailTitleRef}
                    id="email-title"
                    className="input"
                    placeholder="Np. {{imie}}, do zobaczenia!"
                    value={draft.confirmationEmailTitle}
                    onFocus={() => (emailTargetRef.current = 'confirmationEmailTitle')}
                    onChange={(e) => setField('confirmationEmailTitle', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="email-body">
                    Treść
                  </label>
                  <textarea
                    ref={emailBodyRef}
                    id="email-body"
                    className="input h-32"
                    placeholder="Np. Cześć {{imie}}! Dziękujemy za rejestrację na {{wydarzenie}}."
                    value={draft.confirmationEmailBody}
                    onFocus={() => (emailTargetRef.current = 'confirmationEmailBody')}
                    onChange={(e) => setField('confirmationEmailBody', e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-xl bg-slate-50 p-4">
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-slate-700">
                  <Braces className="h-4 w-4 text-brand-600" aria-hidden />
                  Pola dynamiczne
                  <span className="font-normal text-slate-500">— kliknij, aby wstawić w miejscu kursora</span>
                </p>
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Dane zgłoszenia</p>
                  <div className="flex flex-wrap gap-1.5">
                    {EMAIL_BUILTIN_VARIABLES.filter((variable) => !HIDDEN_BUILTIN_VARIABLES.has(variable.name)).map(
                      (variable) => (
                        <VariableChip key={variable.name} name={variable.name} label={variable.label} onInsert={insertEmailVariable} />
                      ),
                    )}
                  </div>
                </div>
                {fieldVariables.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Pola formularza</p>
                    <div className="flex flex-wrap gap-1.5">
                      {fieldVariables.map((variable) => (
                        <VariableChip key={variable.name} name={variable.name} label={variable.label} onInsert={insertEmailVariable} />
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-xs text-slate-500">
                  Wielkość liter i polskie znaki nie mają znaczenia — <code className="font-mono">{'{{imię}}'}</code> działa tak
                  samo jak <code className="font-mono">{'{{imie}}'}</code>. Pole bez odpowiedzi zostaje puste.
                </p>
                {unknownEmailVariables.length > 0 && (
                  <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>
                      Nieznane pola:{' '}
                      {unknownEmailVariables.map((name) => (
                        <code key={name} className="mr-1 font-mono">{`{{${name}}}`}</code>
                      ))}
                      — w wysłanym e-mailu będą puste. Sprawdź pisownię lub wybierz pole z listy.
                    </span>
                  </p>
                )}
              </div>
            </EditorCard>

            <EditorCard
              id="zaawansowane"
              icon={Code}
              title="Zaawansowane"
              description="Strona po płatności i własny kod JS formularza."
              collapsible
              defaultOpen={false}
            >
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <CreditCard className="h-4 w-4" aria-hidden />
                  Strona po płatności
                </p>
                <p className="text-xs text-slate-500">Co zobaczy uczestnik po powrocie z Paynow. Puste pole = tekst domyślny.</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                    <p className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                      <CircleCheck className="h-4 w-4" aria-hidden />
                      Płatność się powiodła
                    </p>
                    <div>
                      <label className="label" htmlFor="success-title">
                        Tytuł
                      </label>
                      <input
                        id="success-title"
                        className="input"
                        placeholder="Rejestracja potwierdzona"
                        value={draft.paymentSuccessTitle}
                        onChange={(e) => setField('paymentSuccessTitle', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor="success-body">
                        Treść
                      </label>
                      <textarea
                        id="success-body"
                        className="input h-24"
                        placeholder="Np. Bilet wyślemy mailem. Do zobaczenia!"
                        value={draft.paymentSuccessBody}
                        onChange={(e) => setField('paymentSuccessBody', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/40 p-4">
                    <p className="flex items-center gap-2 text-sm font-medium text-red-800">
                      <CircleX className="h-4 w-4" aria-hidden />
                      Płatność nieudana lub przerwana
                    </p>
                    <div>
                      <label className="label" htmlFor="error-title">
                        Tytuł
                      </label>
                      <input
                        id="error-title"
                        className="input"
                        placeholder="Płatność nie została zakończona"
                        value={draft.paymentErrorTitle}
                        onChange={(e) => setField('paymentErrorTitle', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor="error-body">
                        Treść
                      </label>
                      <textarea
                        id="error-body"
                        className="input h-24"
                        placeholder="Np. Spróbuj ponownie albo napisz do nas na kontakt@…"
                        value={draft.paymentErrorBody}
                        onChange={(e) => setField('paymentErrorBody', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="label" htmlFor="custom-script">
                  Własny kod JS
                </label>
                <textarea
                  id="custom-script"
                  className="input h-32 font-mono text-xs"
                  spellCheck={false}
                  placeholder={"document.querySelector('[data-field-key=\"...\"]').style.display = 'none';"}
                  value={customScript}
                  onChange={(e) => setCustomScript(e.target.value)}
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Wykonuje się na stronie publicznego formularza (np. ukrywanie sekcji). Uczestnik nie widzi tego pola.
                </p>
              </div>
            </EditorCard>
          </fieldset>

          {canEdit && (
            <div className="sticky bottom-4 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/95 py-3 pl-4 pr-3 shadow-card backdrop-blur">
              <span
                aria-live="polite"
                className={`inline-flex items-center gap-2 text-sm ${dirty ? 'text-amber-700' : 'text-slate-500'}`}
              >
                {busy ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <span className={`h-2 w-2 rounded-full ${dirty ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                )}
                {busy
                  ? 'Zapisywanie…'
                  : dirty
                    ? 'Niezapisane zmiany'
                    : isNew
                      ? 'Uzupełnij dane wydarzenia'
                      : 'Wszystkie zmiany zapisane'}
              </span>
              <div className="flex items-center gap-2">
                <kbd className="hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-xs text-slate-400 sm:inline">
                  {IS_MAC ? '⌘S' : 'Ctrl+S'}
                </kbd>
                {dirty && form && (
                  <button type="button" className="btn-ghost" onClick={() => void discardChanges()} disabled={busy}>
                    Odrzuć zmiany
                  </button>
                )}
                <button type="submit" className="btn-primary" disabled={busy || (!dirty && !isNew)}>
                  <Save className="h-4 w-4" aria-hidden />
                  {isNew ? 'Utwórz wydarzenie' : 'Zapisz'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </section>
  );
}
