import { flattenSections, type FormSection } from './fields.js';

/** Pola dostępne w każdym formularzu — niezależne od pytań ustawionych przez organizatora. */
export const EMAIL_BUILTIN_VARIABLES = [
  { name: 'imie', label: 'Imię' },
  { name: 'nazwisko', label: 'Nazwisko' },
  { name: 'imie_nazwisko', label: 'Imię i nazwisko' },
  { name: 'email', label: 'E-mail' },
  { name: 'telefon', label: 'Telefon' },
  { name: 'wydarzenie', label: 'Nazwa wydarzenia' },
  { name: 'data_wydarzenia', label: 'Data wydarzenia' },
  { name: 'bilet', label: 'Rodzaj biletu' },
  { name: 'kwota', label: 'Kwota' },
  { name: 'numer_biletu', label: 'Numer biletu' },
] as const;

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** "Imię i nazwisko" / "imię" / " IMIE " → "imie_i_nazwisko" / "imie" / "imie". */
export function normalizeVariableName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function templateVariableNames(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => normalizeVariableName(match[1] ?? ''));
}

/** Nieznany znacznik zamienia się na pusty tekst — uczestnik nigdy nie zobaczy surowego `{{…}}`. */
export function renderTemplate(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (_match, name: string) => values[normalizeVariableName(name)] ?? '');
}

export interface TemplateVariableOption {
  /** Znacznik wstawiany do treści, np. `imie` albo klucz pola formularza. */
  name: string;
  label: string;
}

/** Pytania z formularza: znacznik to klucz pola, a jako alias działa też nazwa pola (np. {{dieta}}). */
export function formFieldVariables(sections: FormSection[]): TemplateVariableOption[] {
  return flattenSections(sections).map((field) => ({ name: field.key, label: field.label }));
}

/** Wszystkie nazwy, które coś podstawią — do ostrzegania o literówkach w edytorze. */
export function knownVariableNames(sections: FormSection[]): Set<string> {
  const names = new Set<string>(EMAIL_BUILTIN_VARIABLES.map((variable) => variable.name));
  for (const field of flattenSections(sections)) {
    names.add(field.key);
    names.add(normalizeVariableName(field.label));
  }
  return names;
}
