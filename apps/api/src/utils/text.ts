const SUMMARY_LENGTH = 160;

/** Opis wydarzenia to HTML z edytora — na kafelku pokazujemy sam tekst. */
export function toSummary(html: string | null, maxLength = SUMMARY_LENGTH): string {
  if (!html) return '';
  const text = html
    // Każdy znacznik zastępujemy spacją, żeby akapity nie posklejały się w jeden wyraz.
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}
