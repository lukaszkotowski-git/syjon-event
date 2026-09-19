import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env.js';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    const config = env();
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
      connectionTimeout: 10_000,
      socketTimeout: 10_000,
    });
  }
  return transporter;
}

export interface InlineImage {
  cid: string;
  filename: string;
  content: Buffer;
}

/** Nigdy nie rzuca — awaria SMTP nie może wywrócić rejestracji ani obsługi webhooka. */
export async function sendMail(
  to: string,
  subject: string,
  html: string,
  text: string,
  inlineImages: InlineImage[] = [],
): Promise<boolean> {
  try {
    await getTransporter().sendMail({
      from: env().MAIL_FROM,
      to,
      subject,
      html,
      text,
      // Obrazy jako załączniki CID — Gmail i Outlook blokują obrazki `data:` w treści.
      attachments: inlineImages.map((image) => ({
        cid: image.cid,
        filename: image.filename,
        content: image.content,
        contentType: 'image/png',
      })),
    });
    return true;
  } catch (error) {
    console.error(`[mailer] nie udało się wysłać e-maila do ${to}:`, error);
    return false;
  }
}

/** Bilet z kodem QR osadzonym w wiadomości jako obraz CID. */
export interface TicketQrData {
  cid: string;
  reference: string;
}

interface TicketEmailData {
  formTitle: string;
  eventDate?: Date | null;
  location?: string | null;
  ticketName: string;
  amountCents: number;
  currency: string;
  /** Ustawiane przez organizatora w edytorze formularza — nadpisują domyślny tytuł/treść. */
  customTitle?: string | null;
  customBody?: string | null;
  ticketQr?: TicketQrData | null;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/** Temat z własnego tytułu; nazwę wydarzenia dopisujemy tylko, jeśli tytuł jej jeszcze nie zawiera (np. przez {{wydarzenie}}). */
function customSubject(data: TicketEmailData): string | null {
  const title = data.customTitle?.trim();
  if (!title) return null;
  return title.includes(data.formTitle) ? title : `${title} — ${data.formTitle}`;
}

function resolveTitle(defaultTitle: string, customTitle: string | null | undefined): string {
  return customTitle?.trim() || defaultTitle;
}

/** Własna treść (textarea, zwykły tekst) renderowana jako akapit z zachowanymi złamaniami linii. */
function introHtml(defaultText: string, customBody: string | null | undefined): string {
  const text = customBody?.trim() || defaultText;
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">${escapeHtml(text).replace(/\n/g, '<br />')}</p>`;
}

function introText(defaultText: string, customBody: string | null | undefined): string {
  return customBody?.trim() || defaultText;
}

function baseUrl(): string {
  return env().APP_BASE_URL.replace(/\/+$/, '');
}

function formatAmount(amountCents: number, currency: string): string {
  if (amountCents === 0) return 'Bezpłatny';
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(amountCents / 100);
}

function shellHtml(title: string, bodyHtml: string): string {
  const logoUrl = `${baseUrl()}/logo.png`;
  return `<!doctype html>
<html lang="pl">
  <body style="margin:0;padding:0;background:#effafa;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#effafa;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background-color:#0d3135;background-image:linear-gradient(135deg,#0d3135 0%,#1b5b5f 45%,#30a0a6 100%);padding:28px 32px;text-align:center;">
                <img src="${logoUrl}" alt="Syjon Event" width="56" height="56" style="border-radius:50%;display:block;margin:0 auto 12px;" />
                <span style="color:#ffffff;font-size:20px;font-weight:600;">Syjon Event</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:#0d3135;">
                <h1 style="margin:0 0 16px;font-size:20px;color:#134449;">${escapeHtml(title)}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background:#f4fbfb;color:#5b7a7d;font-size:12px;text-align:center;">
                Wiadomość wygenerowana automatycznie — prosimy na nią nie odpowiadać.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function formatEventDate(date: Date): string {
  return new Intl.DateTimeFormat('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Warsaw',
  }).format(date);
}

/** Link do mapy z adresu — organizator wpisuje sam tekst, bez szukania współrzędnych. */
export function mapUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

function detailRowHtml(label: string, valueHtml: string): string {
  return `<tr><td style="padding:0 16px;border-top:1px solid #dbf3f5;"></td></tr>
    <tr><td style="padding:12px 16px 0;font-size:13px;color:#24757a;">${label}</td></tr>
    <tr><td style="padding:2px 16px 12px;font-size:15px;color:#0d3135;">${valueHtml}</td></tr>`;
}

function whenWhereHtml(data: TicketEmailData): string {
  return [
    data.eventDate ? detailRowHtml('Termin', escapeHtml(formatEventDate(data.eventDate))) : '',
    data.location
      ? detailRowHtml(
          'Miejsce',
          `${escapeHtml(data.location)} · <a href="${mapUrl(data.location)}" style="color:#24757a;">mapa</a>`,
        )
      : '',
  ].join('');
}

function whenWhereText(data: TicketEmailData): string[] {
  return [
    ...(data.eventDate ? [`Termin: ${formatEventDate(data.eventDate)}`] : []),
    ...(data.location ? [`Miejsce: ${data.location} (${mapUrl(data.location)})`] : []),
  ];
}

function ticketDetailsHtml(data: TicketEmailData): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid #dbf3f5;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:12px 16px 0;font-size:13px;color:#24757a;">Wydarzenie</td></tr>
    <tr><td style="padding:2px 16px 12px;font-size:15px;font-weight:600;color:#0d3135;">${escapeHtml(data.formTitle)}</td></tr>
    ${whenWhereHtml(data)}
    <tr><td style="padding:0 16px;border-top:1px solid #dbf3f5;"></td></tr>
    <tr><td style="padding:12px 16px 0;font-size:13px;color:#24757a;">Bilet</td></tr>
    <tr><td style="padding:2px 16px 12px;font-size:15px;color:#0d3135;">${escapeHtml(data.ticketName)} — ${escapeHtml(formatAmount(data.amountCents, data.currency))}</td></tr>
  </table>`;
}

function ticketQrHtml(qr: TicketQrData | null | undefined): string {
  if (!qr) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border:1px solid #dbf3f5;border-radius:12px;">
    <tr><td align="center" style="padding:20px 16px 8px;font-size:13px;font-weight:600;color:#24757a;text-transform:uppercase;letter-spacing:1px;">Twój bilet wstępu</td></tr>
    <tr><td align="center" style="padding:4px 16px;">
      <img src="cid:${qr.cid}" width="220" height="220" alt="Kod QR biletu" style="display:block;margin:0 auto;width:220px;height:220px;" />
    </td></tr>
    <tr><td align="center" style="padding:8px 16px 4px;font-size:14px;color:#0d3135;">Pokaż ten kod przy wejściu na wydarzenie.</td></tr>
    <tr><td align="center" style="padding:0 16px 18px;font-size:12px;color:#5b7a7d;">Nr biletu: <strong style="font-family:monospace;color:#0d3135;">${escapeHtml(qr.reference)}</strong> · kod jest jednorazowy — nie udostępniaj go innym</td></tr>
  </table>`;
}

function ticketQrText(qr: TicketQrData | null | undefined): string[] {
  if (!qr) return [];
  return [
    '',
    `Twój bilet wstępu: kod QR znajdziesz w wersji HTML tej wiadomości. Nr biletu: ${qr.reference}.`,
    'Kod jest jednorazowy — nie udostępniaj go innym.',
  ];
}

function buttonHtml(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px auto 4px;">
    <tr><td style="border-radius:10px;background-color:#30a0a6;">
      <a href="${url}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:10px;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;
}

interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/** Bilet bezpłatny — e-mail wysyłany synchronicznie tuż po rejestracji, może zawierać link ze statusem. */
export function buildFreeConfirmationEmail(data: TicketEmailData & { confirmationUrl: string }): EmailContent {
  const heading = resolveTitle('Rejestracja potwierdzona', data.customTitle);
  const subject = customSubject(data) ?? `Potwierdzenie rejestracji — ${data.formTitle}`;
  const defaultIntro = 'Twoja rejestracja na wydarzenie została potwierdzona. Poniżej znajdziesz szczegóły zgłoszenia.';
  const bodyHtml = [
    introHtml(defaultIntro, data.customBody),
    ticketQrHtml(data.ticketQr),
    ticketDetailsHtml(data),
    buttonHtml(data.confirmationUrl, 'Sprawdź status zgłoszenia'),
    `<p style="margin:16px 0 0;font-size:13px;color:#5b7a7d;">Zachowaj ten link — pod nim zawsze sprawdzisz status swojego zgłoszenia.</p>`,
  ].join('');
  const text = [
    `${heading} — ${data.formTitle}`,
    '',
    introText(defaultIntro, data.customBody),
    '',
    ...whenWhereText(data),
    `Bilet: ${data.ticketName} (${formatAmount(data.amountCents, data.currency)})`,
    ...ticketQrText(data.ticketQr),
    '',
    `Status zgłoszenia: ${data.confirmationUrl}`,
  ].join('\n');
  return { subject, html: shellHtml(heading, bodyHtml), text };
}

/**
 * Bilet płatny — e-mail wysyłany asynchronicznie z webhooka Paynow. Jawny publicToken
 * nie jest już wtedy nigdzie dostępny (przechowujemy tylko jego hash), więc — świadomie —
 * ta wiadomość nie zawiera spersonalizowanego linku do /potwierdzenie/:id, tylko link
 * do publicznej strony wydarzenia.
 */
export function buildPaidConfirmationEmail(data: TicketEmailData & { formSlug: string }): EmailContent {
  const heading = resolveTitle('Zakup potwierdzony', data.customTitle);
  const subject = customSubject(data) ?? `Potwierdzenie zakupu biletu — ${data.formTitle}`;
  const eventUrl = `${baseUrl()}/f/${data.formSlug}`;
  const defaultIntro = 'Twoja płatność została potwierdzona — bilet jest Twój! Poniżej znajdziesz szczegóły zakupu.';
  const bodyHtml = [
    introHtml(defaultIntro, data.customBody),
    ticketQrHtml(data.ticketQr),
    ticketDetailsHtml(data),
    buttonHtml(eventUrl, 'Zobacz stronę wydarzenia'),
  ].join('');
  const text = [
    `${heading} — ${data.formTitle}`,
    '',
    introText(defaultIntro, data.customBody),
    '',
    ...whenWhereText(data),
    `Bilet: ${data.ticketName} (${formatAmount(data.amountCents, data.currency)})`,
    ...ticketQrText(data.ticketQr),
    '',
    `Strona wydarzenia: ${eventUrl}`,
  ].join('\n');
  return { subject, html: shellHtml(heading, bodyHtml), text };
}

export function formatDueDate(date: Date): string {
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeZone: 'Europe/Warsaw' }).format(date);
}

/** Wpłacona zaliczka — bez biletu QR, z kwotą i terminem dopłaty oraz linkiem do niej. */
export function buildDepositConfirmationEmail(
  data: TicketEmailData & { paidCents: number; balanceCents: number; balanceDueAt: Date | null; balanceUrl: string },
): EmailContent {
  const heading = resolveTitle('Zaliczka wpłacona — miejsce zarezerwowane', data.customTitle);
  const subject = customSubject(data) ?? `Zaliczka wpłacona — ${data.formTitle}`;
  const paid = formatAmount(data.paidCents, data.currency);
  const balance = formatAmount(data.balanceCents, data.currency);
  const due = data.balanceDueAt ? formatDueDate(data.balanceDueAt) : null;
  const defaultIntro = `Otrzymaliśmy Twoją zaliczkę — miejsce na wydarzeniu jest zarezerwowane. Aby otrzymać bilet wstępu, dopłać pozostałą kwotę ${balance}${due ? ` do ${due}` : ''}.`;
  const bodyHtml = [
    introHtml(defaultIntro, data.customBody),
    ticketDetailsHtml(data),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid #dbf3f5;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:12px 16px 0;font-size:13px;color:#24757a;">Wpłacono</td></tr>
      <tr><td style="padding:2px 16px 12px;font-size:15px;color:#0d3135;">${escapeHtml(paid)}</td></tr>
      ${detailRowHtml('Do dopłaty', `<strong>${escapeHtml(balance)}</strong>`)}
      ${due ? detailRowHtml('Termin dopłaty', escapeHtml(due)) : ''}
    </table>`,
    buttonHtml(data.balanceUrl, `Dopłać ${balance}`),
    `<p style="margin:16px 0 0;font-size:13px;color:#5b7a7d;">Bilet z kodem QR wyślemy po zaksięgowaniu dopłaty. Zachowaj ten link — pod nim dopłacisz resztę i sprawdzisz status zgłoszenia.</p>`,
  ].join('');
  const text = [
    `${heading} — ${data.formTitle}`,
    '',
    introText(defaultIntro, data.customBody),
    '',
    ...whenWhereText(data),
    `Bilet: ${data.ticketName} (${formatAmount(data.amountCents, data.currency)})`,
    `Wpłacono: ${paid}`,
    `Do dopłaty: ${balance}`,
    ...(due ? [`Termin dopłaty: ${due}`] : []),
    '',
    `Dopłata i status zgłoszenia: ${data.balanceUrl}`,
  ].join('\n');
  return { subject, html: shellHtml(heading, bodyHtml), text };
}

/** Sam bilet — ponowna wysyłka przez organizatora lub nowy kod po unieważnieniu poprzedniego. */
export function buildTicketEmail(
  data: TicketEmailData & { formSlug: string; ticketQr: TicketQrData; reissued: boolean },
): EmailContent {
  const heading = data.reissued ? 'Nowy kod QR biletu' : 'Twój bilet wstępu';
  const subject = `${heading} — ${data.formTitle}`;
  const intro = data.reissued
    ? 'Organizator wystawił dla Ciebie nowy kod QR. Poprzedni kod jest już nieważny — przy wejściu pokaż ten poniżej.'
    : 'Przesyłamy Twój bilet wstępu. Pokaż poniższy kod QR przy wejściu na wydarzenie.';
  const bodyHtml = [
    introHtml(intro, null),
    ticketQrHtml(data.ticketQr),
    ticketDetailsHtml(data),
    buttonHtml(`${baseUrl()}/f/${data.formSlug}`, 'Zobacz stronę wydarzenia'),
  ].join('');
  const text = [
    `${heading} — ${data.formTitle}`,
    '',
    intro,
    '',
    ...whenWhereText(data),
    `Bilet: ${data.ticketName}`,
    ...ticketQrText(data.ticketQr),
  ].join('\n');
  return { subject, html: shellHtml(heading, bodyHtml), text };
}

/** Wiadomość organizatora do uczestników — treść to zwykły tekst z podstawionymi znacznikami. */
export function buildParticipantMessageEmail(data: {
  subject: string;
  body: string;
  formTitle: string;
  formSlug: string;
  eventDate: Date;
  location: string | null;
}): EmailContent {
  const subject = data.subject.includes(data.formTitle) ? data.subject : `${data.subject} — ${data.formTitle}`;
  const bodyHtml = [
    introHtml(data.body, null),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid #dbf3f5;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:12px 16px 0;font-size:13px;color:#24757a;">Wydarzenie</td></tr>
      <tr><td style="padding:2px 16px 12px;font-size:15px;font-weight:600;color:#0d3135;">${escapeHtml(data.formTitle)}</td></tr>
      ${whenWhereHtml({ ...data, ticketName: '', amountCents: 0, currency: 'PLN' })}
    </table>`,
    buttonHtml(`${baseUrl()}/f/${data.formSlug}`, 'Zobacz stronę wydarzenia'),
  ].join('');
  const text = [
    data.body,
    '',
    `Wydarzenie: ${data.formTitle}`,
    ...whenWhereText({ ...data, ticketName: '', amountCents: 0, currency: 'PLN' }),
    `Strona wydarzenia: ${baseUrl()}/f/${data.formSlug}`,
  ].join('\n');
  return { subject, html: shellHtml(data.subject, bodyHtml), text };
}
