import type { Form, Submission } from '@prisma/client';
import { flattenSections, normalizeVariableName, renderTemplate } from '@syjonevent/shared';
import { ticketReference } from '../utils/ticket-code.js';
import { formatDueDate } from './mailer.js';
import { guessDisplayName } from './participants.js';
import { parseFormSchema } from './registration.js';

function answerText(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Tak' : 'Nie';
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function formatAmount(cents: number, currency: string): string {
  if (cents === 0) return 'Bezpłatny';
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(cents / 100);
}

/** Wartości znaczników {{…}} w tytule i treści e-maila — z odpowiedzi uczestnika i danych zgłoszenia. */
export function emailTemplateValues(
  submission: Pick<
    Submission,
    'id' | 'buyerEmail' | 'buyerPhone' | 'ticketNameSnapshot' | 'ticketPriceCents' | 'currency' | 'payloadJson' | 'schemaSnapshotJson'
  >,
  form: Pick<Form, 'title' | 'eventDate' | 'location'>,
): Record<string, string> {
  const payload = (submission.payloadJson ?? {}) as Record<string, unknown>;
  const fields = flattenSections(parseFormSchema(submission.schemaSnapshotJson).sections);
  const byLabel = new Map(fields.map((field) => [normalizeVariableName(field.label), answerText(payload[field.key])]));

  const fullName = guessDisplayName(submission.schemaSnapshotJson, submission.payloadJson) ?? '';
  const [firstWord = '', ...restWords] = fullName.split(/\s+/).filter(Boolean);
  // Osobne pola "Imię"/"Nazwisko" mają pierwszeństwo; przy jednym polu "Imię i nazwisko" dzielimy po spacji.
  const firstName = byLabel.get('imie') || firstWord;
  const lastName = byLabel.get('nazwisko') || restWords.join(' ');

  const values: Record<string, string> = {
    imie: firstName,
    nazwisko: lastName,
    imie_nazwisko: fullName,
    email: submission.buyerEmail,
    telefon: submission.buyerPhone ?? '',
    wydarzenie: form.title,
    data_wydarzenia: new Intl.DateTimeFormat('pl-PL', {
      dateStyle: 'long',
      timeZone: 'Europe/Warsaw',
    }).format(form.eventDate),
    miejsce: form.location ?? '',
    bilet: submission.ticketNameSnapshot,
    kwota: formatAmount(submission.ticketPriceCents, submission.currency),
    numer_biletu: ticketReference(submission.id),
  };

  // Pola formularza: po kluczu i po nazwie — bez nadpisywania pól wbudowanych.
  for (const field of fields) {
    values[field.key] ??= answerText(payload[field.key]);
    values[normalizeVariableName(field.label)] ??= answerText(payload[field.key]);
  }
  return values;
}

/** Tytuł i treść e-maila po zaliczce — te same znaczniki co w potwierdzeniu plus kwota, termin i link dopłaty. */
export function renderDepositEmailContent(
  form: Pick<Form, 'title' | 'eventDate' | 'location' | 'balanceDueAt' | 'depositEmailTitle' | 'depositEmailBody'>,
  submission: Parameters<typeof emailTemplateValues>[0] & Pick<Submission, 'paidCents'>,
  balanceUrl: string,
): { customTitle: string | null; customBody: string | null } {
  if (!form.depositEmailTitle && !form.depositEmailBody) return { customTitle: null, customBody: null };
  const values = {
    ...emailTemplateValues(submission, form),
    kwota_zaliczki: formatAmount(submission.paidCents, submission.currency),
    kwota_doplaty: formatAmount(submission.ticketPriceCents - submission.paidCents, submission.currency),
    termin_doplaty: form.balanceDueAt ? formatDueDate(form.balanceDueAt) : '',
    link_doplaty: balanceUrl,
  };
  return {
    customTitle: form.depositEmailTitle ? renderTemplate(form.depositEmailTitle, values) : null,
    customBody: form.depositEmailBody ? renderTemplate(form.depositEmailBody, values) : null,
  };
}

/** Tytuł i treść e-maila od organizatora z podstawionymi znacznikami; null = tekst domyślny. */
export function renderCustomEmailContent(
  form: Pick<Form, 'title' | 'eventDate' | 'location' | 'confirmationEmailTitle' | 'confirmationEmailBody'>,
  submission: Parameters<typeof emailTemplateValues>[0],
): { customTitle: string | null; customBody: string | null } {
  if (!form.confirmationEmailTitle && !form.confirmationEmailBody) return { customTitle: null, customBody: null };
  const values = emailTemplateValues(submission, form);
  return {
    customTitle: form.confirmationEmailTitle ? renderTemplate(form.confirmationEmailTitle, values) : null,
    customBody: form.confirmationEmailBody ? renderTemplate(form.confirmationEmailBody, values) : null,
  };
}
