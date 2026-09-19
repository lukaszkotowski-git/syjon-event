import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Braces, CircleCheck, LoaderCircle, Mail, Send, TriangleAlert, Users } from 'lucide-react';
import type { FormMessageDto } from '@syjonevent/shared';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/Toast';
import { useCanEdit } from '../lib/admin';
import { api, ApiError, formatDateTime } from '../lib/api';
import { plural } from '../lib/format';
import { useDebouncedValue } from '../lib/hooks';

interface FormInfo {
  id: string;
  title: string;
  ticketTypes: { id: string; name: string; isActive: boolean }[];
}

type AudienceStatus = 'PAID' | 'DEPOSIT_PAID' | 'RESERVED';

const VARIABLES = [
  { name: 'imie', label: 'Imię' },
  { name: 'imie_nazwisko', label: 'Imię i nazwisko' },
  { name: 'wydarzenie', label: 'Wydarzenie' },
  { name: 'data_wydarzenia', label: 'Data' },
  { name: 'miejsce', label: 'Miejsce' },
  { name: 'bilet', label: 'Bilet' },
  { name: 'numer_biletu', label: 'Nr biletu' },
];

export default function AdminMessages() {
  const { id } = useParams();
  const toast = useToast();
  const confirm = useConfirm();
  const canEdit = useCanEdit();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [form, setForm] = useState<FormInfo | null>(null);
  const [messages, setMessages] = useState<FormMessageDto[] | null>(null);
  const [statuses, setStatuses] = useState<AudienceStatus[]>(['PAID']);
  const [ticketTypeIds, setTicketTypeIds] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const audienceKey = useDebouncedValue(`${statuses.join(',')}|${ticketTypeIds.join(',')}`, 250);

  useEffect(() => {
    api
      .get<{ form: FormInfo }>(`/api/forms/${id}`)
      .then((data) => setForm(data.form))
      .catch((error) => toast.error(error instanceof ApiError ? error.message : 'Nie udało się wczytać wydarzenia'));
  }, [id, toast]);

  const loadMessages = useCallback(async () => {
    try {
      const data = await api.get<{ messages: FormMessageDto[] }>(`/api/forms/${id}/messages`);
      setMessages(data.messages);
      return data.messages;
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się pobrać wiadomości');
      return null;
    }
  }, [id, toast]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  // Wysyłka idzie w tle — dopóki jakaś wiadomość się wysyła, odświeżamy postęp.
  const sending = messages?.some((m) => !m.finished) ?? false;
  useEffect(() => {
    if (!sending) return;
    const timer = window.setInterval(() => void loadMessages(), 3000);
    return () => window.clearInterval(timer);
  }, [sending, loadMessages]);

  useEffect(() => {
    const [statusPart = '', ticketPart = ''] = audienceKey.split('|');
    if (!statusPart) {
      setRecipientCount(0);
      return;
    }
    const params = new URLSearchParams({ statuses: statusPart, ticketTypeIds: ticketPart });
    api
      .get<{ recipientCount: number }>(`/api/forms/${id}/messages/recipients?${params.toString()}`)
      .then((data) => setRecipientCount(data.recipientCount))
      .catch(() => setRecipientCount(null));
  }, [id, audienceKey]);

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function insertVariable(name: string) {
    const element = bodyRef.current;
    const token = `{{${name}}}`;
    const start = element?.selectionStart ?? body.length;
    const end = element?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!recipientCount) return;
    const ok = await confirm({
      title: `Wysłać wiadomość do ${plural(recipientCount, 'osoby', 'osób', 'osób')}?`,
      description: `„${subject}” trafi na adresy e-mail uczestników. Wysłanej wiadomości nie można cofnąć.`,
      confirmLabel: 'Wyślij',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.post(`/api/forms/${id}/messages`, { subject, body, audience: { statuses, ticketTypeIds } });
      toast.success('Wysyłka rozpoczęta — postęp widać na liście poniżej');
      setSubject('');
      setBody('');
      await loadMessages();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się wysłać wiadomości');
    } finally {
      setBusy(false);
    }
  }

  const tickets = form?.ticketTypes ?? [];

  return (
    <section className="space-y-5">
      <div>
        <Link
          to={`/admin/formularze/${id}/zgloszenia`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Zgłoszenia
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Wiadomość do uczestników</h1>
        {form && <p className="truncate text-sm text-slate-500">{form.title}</p>}
      </div>

      {canEdit && (
        <form onSubmit={send} className="card space-y-5">
          <fieldset className="space-y-2">
            <legend className="label">Do kogo</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['PAID', 'Opłacone zgłoszenia'],
                  ['DEPOSIT_PAID', 'Wpłacona zaliczka — nie dopłacili'],
                  ['RESERVED', 'Rezerwacje czekające na płatność'],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand-200 ${
                    statuses.includes(value) ? 'border-brand-600 bg-brand-50 text-brand-900' : 'border-slate-200 text-slate-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-brand-600"
                    checked={statuses.includes(value)}
                    onChange={() => setStatuses((prev) => toggle(prev, value))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          {tickets.length > 1 && (
            <fieldset className="space-y-2">
              <legend className="label">Bilety</legend>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setTicketTypeIds([])}
                  className={`rounded-xl border px-3 py-2 text-sm transition ${
                    ticketTypeIds.length === 0 ? 'border-brand-600 bg-brand-50 text-brand-900' : 'border-slate-200 text-slate-700'
                  }`}
                >
                  Wszystkie
                </button>
                {tickets.map((ticket) => (
                  <button
                    key={ticket.id}
                    type="button"
                    aria-pressed={ticketTypeIds.includes(ticket.id)}
                    onClick={() => setTicketTypeIds((prev) => toggle(prev, ticket.id))}
                    className={`rounded-xl border px-3 py-2 text-sm transition ${
                      ticketTypeIds.includes(ticket.id)
                        ? 'border-brand-600 bg-brand-50 text-brand-900'
                        : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    {ticket.name}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <p
            className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
              recipientCount ? 'bg-brand-50 text-brand-900' : 'bg-amber-50 text-amber-900'
            }`}
            aria-live="polite"
          >
            <Users className="h-4 w-4" aria-hidden />
            {recipientCount === null
              ? 'Liczę odbiorców…'
              : recipientCount === 0
                ? 'Brak odbiorców dla wybranych filtrów'
                : `Odbiorcy: ${plural(recipientCount, 'osoba', 'osoby', 'osób')}`}
          </p>

          <div>
            <label className="label" htmlFor="message-subject">
              Temat
            </label>
            <input
              id="message-subject"
              className="input"
              required
              maxLength={200}
              placeholder="Np. Zmiana godziny zbiórki"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="message-body">
              Treść
            </label>
            <textarea
              ref={bodyRef}
              id="message-body"
              className="input h-44"
              required
              maxLength={10000}
              placeholder={'Cześć {{imie}}!\n\nZbiórka w sobotę jest o 8:30 zamiast o 9:00.'}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Braces className="h-3.5 w-3.5" aria-hidden />
                Wstaw:
              </span>
              {VARIABLES.map((variable) => (
                <button
                  key={variable.name}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertVariable(variable.name)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:border-brand-300 hover:bg-brand-50"
                >
                  {variable.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Pod treścią dodajemy nazwę, termin i miejsce wydarzenia oraz przycisk do strony wydarzenia.
            </p>
          </div>

          <button type="submit" className="btn-primary" disabled={busy || !recipientCount || !subject.trim() || !body.trim()}>
            <Send className="h-4 w-4" aria-hidden />
            {busy ? 'Wysyłanie…' : 'Wyślij wiadomość'}
          </button>
        </form>
      )}

      <div className="card space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <Mail className="h-5 w-5 text-brand-600" aria-hidden />
          Wysłane wiadomości
        </h2>
        {!messages ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            Ładowanie…
          </p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-slate-500">Nie wysłano jeszcze żadnej wiadomości.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {messages.map((message) => (
              <li key={message.id} className="py-3">
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{message.subject}</span>
                      <span className="block text-xs text-slate-500">
                        {formatDateTime(message.createdAt)}
                        {message.adminEmail && ` · ${message.adminEmail}`}
                      </span>
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                        !message.finished
                          ? 'bg-blue-50 text-blue-700'
                          : message.failedCount > 0
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {!message.finished ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : message.failedCount > 0 ? (
                        <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {message.finished
                        ? `Wysłano ${message.sentCount}/${message.recipientCount}${message.failedCount ? ` · błędy: ${message.failedCount}` : ''}`
                        : `Wysyłanie ${message.sentCount + message.failedCount}/${message.recipientCount}`}
                    </span>
                  </summary>
                  <p className="mt-2 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{message.body}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
