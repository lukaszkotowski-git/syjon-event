/** "49,99" / "49.99" / "49" / "1 200,50" → grosze; `null`, gdy tekst nie jest kwotą. */
export function parsePlnInput(input: string): number | null {
  const normalized = input.replace(/\s|zł/gi, '').replace(',', '.');
  if (normalized === '') return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/** Grosze → tekst do pola kwoty, np. 4999 → "49,99", 0 → "0". */
export function centsToPlnInput(cents: number): string {
  if (cents === 0) return '0';
  return (cents / 100).toFixed(2).replace('.', ',');
}

const DIACRITICS: Record<string, string> = { ł: 'l', Ł: 'l' };

/** Tytuł → slug zgodny z walidacją API (małe litery, cyfry, pojedyncze myślniki). */
export function slugify(text: string): string {
  return text
    .replace(/[łŁ]/g, (ch) => DIACRITICS[ch] ?? ch)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/**
 * Normalizuje HTML tak, jak zserializowałaby go przeglądarka — potrzebne do porównań
 * "czy są zmiany", bo contentEditable potrafi zapisać ten sam opis w nieco innej postaci.
 */
export function normalizeHtml(html: string): string {
  if (!html) return '';
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.innerHTML;
}
