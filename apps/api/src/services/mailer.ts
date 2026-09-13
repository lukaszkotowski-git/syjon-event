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

/** Nigdy nie rzuca — awaria SMTP nie może wywrócić rejestracji ani obsługi webhooka. */
export async function sendMail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  try {
    await getTransporter().sendMail({ from: env().MAIL_FROM, to, subject, html, text });
    return true;
  } catch (error) {
    console.error(`[mailer] nie udało się wysłać e-maila do ${to}:`, error);
    return false;
  }
}

interface TicketEmailData {
  formTitle: string;
  ticketName: string;
  amountCents: number;
  currency: string;
  /** Ustawiane przez organizatora w edytorze formularza — nadpisują domyślny tytuł/treść. */
  customTitle?: string | null;
  customBody?: string | null;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
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

function ticketDetailsHtml(data: TicketEmailData): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid #dbf3f5;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:12px 16px 0;font-size:13px;color:#24757a;">Wydarzenie</td></tr>
    <tr><td style="padding:2px 16px 12px;font-size:15px;font-weight:600;color:#0d3135;">${escapeHtml(data.formTitle)}</td></tr>
    <tr><td style="padding:0 16px;border-top:1px solid #dbf3f5;"></td></tr>
    <tr><td style="padding:12px 16px 0;font-size:13px;color:#24757a;">Bilet</td></tr>
    <tr><td style="padding:2px 16px 12px;font-size:15px;color:#0d3135;">${escapeHtml(data.ticketName)} — ${escapeHtml(formatAmount(data.amountCents, data.currency))}</td></tr>
  </table>`;
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
  const subject = data.customTitle?.trim()
    ? `${heading} — ${data.formTitle}`
    : `Potwierdzenie rejestracji — ${data.formTitle}`;
  const defaultIntro = 'Twoja rejestracja na wydarzenie została potwierdzona. Poniżej znajdziesz szczegóły zgłoszenia.';
  const bodyHtml = [
    introHtml(defaultIntro, data.customBody),
    ticketDetailsHtml(data),
    buttonHtml(data.confirmationUrl, 'Sprawdź status zgłoszenia'),
    `<p style="margin:16px 0 0;font-size:13px;color:#5b7a7d;">Zachowaj ten link — pod nim zawsze sprawdzisz status swojego zgłoszenia.</p>`,
  ].join('');
  const text = [
    `${heading} — ${data.formTitle}`,
    '',
    introText(defaultIntro, data.customBody),
    '',
    `Bilet: ${data.ticketName} (${formatAmount(data.amountCents, data.currency)})`,
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
  const subject = data.customTitle?.trim()
    ? `${heading} — ${data.formTitle}`
    : `Potwierdzenie zakupu biletu — ${data.formTitle}`;
  const eventUrl = `${baseUrl()}/f/${data.formSlug}`;
  const defaultIntro = 'Twoja płatność została potwierdzona — bilet jest Twój! Poniżej znajdziesz szczegóły zakupu.';
  const bodyHtml = [
    introHtml(defaultIntro, data.customBody),
    ticketDetailsHtml(data),
    buttonHtml(eventUrl, 'Zobacz stronę wydarzenia'),
  ].join('');
  const text = [
    `${heading} — ${data.formTitle}`,
    '',
    introText(defaultIntro, data.customBody),
    '',
    `Bilet: ${data.ticketName} (${formatAmount(data.amountCents, data.currency)})`,
    '',
    `Strona wydarzenia: ${eventUrl}`,
  ].join('\n');
  return { subject, html: shellHtml(heading, bodyHtml), text };
}
