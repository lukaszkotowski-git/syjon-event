import { flattenSections } from '@syjonevent/shared';
import { parseFormSchema } from './registration.js';

/**
 * Formularze są dowolnie konfigurowalne, więc "imię i nazwisko" nie ma stałego klucza pola —
 * szukamy po etykiecie (np. "Imię", "Nazwisko", "Imię i nazwisko"). Brak dopasowania = null.
 */
export function guessDisplayName(schemaSnapshotJson: unknown, payloadJson: unknown): string | null {
  const schema = parseFormSchema(schemaSnapshotJson);
  const payload = (payloadJson ?? {}) as Record<string, unknown>;
  const parts = flattenSections(schema.sections)
    .filter((field) => /imi[eę]|nazwisko/i.test(field.label))
    .map((field) => payload[field.key])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '');
  return parts.length > 0 ? parts.join(' ').trim() : null;
}

/** "jan.kowalski@gmail.com" → "ja•••••••@gmail.com" — do rozróżnienia osób przez obsługę wejścia. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'•'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}
