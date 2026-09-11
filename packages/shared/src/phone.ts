/** Normalizacja i walidacja polskiego numeru telefonu (+48 + 9 cyfr). */

export function normalizePlPhone(input: string): string | null {
  const digitsOnly = input.replace(/[\s()-]/g, '');
  const m = /^(?:\+?48)?(\d{9})$/.exec(digitsOnly);
  if (!m || !m[1]) return null;
  // Polskie numery nie zaczynają się od 0 ani 1.
  if (/^[01]/.test(m[1])) return null;
  return `+48${m[1]}`;
}

export function isValidPlPhone(input: string): boolean {
  return normalizePlPhone(input) !== null;
}
