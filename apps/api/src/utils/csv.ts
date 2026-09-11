/** Minimalny, poprawny generator CSV (RFC 4180) z BOM dla Excela. */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'boolean' ? (value ? 'tak' : 'nie') : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: unknown[][], delimiter = ';'): string {
  const body = rows.map((row) => row.map(csvEscape).join(delimiter)).join('\r\n');
  return `\uFEFF${body}\r\n`;
}
