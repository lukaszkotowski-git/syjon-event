import QRCode from 'qrcode';
import { prisma } from '../prisma.js';
import { encodeTicketCode, generateTicketNonce, ticketReference } from '../utils/ticket-code.js';
import { buildTicketEmail, sendMail, type InlineImage, type TicketQrData } from './mailer.js';

const QR_CID = 'ticket-qr';

/** Pola do zapisania razem ze zmianą statusu na PAID — bilet powstaje w tej samej operacji. */
export function newTicketFields(now = new Date()) {
  return { ticketNonce: generateTicketNonce(), ticketIssuedAt: now };
}

/**
 * Nonce opłaconego zgłoszenia; wystawia go, jeśli zgłoszenie opłacono przed wprowadzeniem biletów QR.
 * Warunek `ticketNonce: null` w UPDATE sprawia, że dwa równoległe wywołania nie nadpiszą sobie kodu.
 */
export async function ensureTicketNonce(submissionId: string): Promise<string | null> {
  await prisma.submission.updateMany({
    where: { id: submissionId, status: 'PAID', ticketNonce: null },
    data: newTicketFields(),
  });
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { status: true, ticketNonce: true },
  });
  return submission?.status === 'PAID' ? submission.ticketNonce : null;
}

/** Nowy nonce — poprzedni kod QR od tej chwili skanuje się jako wygasły. */
export async function reissueTicketNonce(submissionId: string): Promise<string | null> {
  const nonce = generateTicketNonce();
  const updated = await prisma.submission.updateMany({
    where: { id: submissionId, status: 'PAID' },
    data: { ticketNonce: nonce, ticketIssuedAt: new Date() },
  });
  return updated.count === 1 ? nonce : null;
}

export function renderTicketQrPng(submissionId: string, nonce: string): Promise<Buffer> {
  return QRCode.toBuffer(encodeTicketCode(submissionId, nonce), {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 440,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

/** Obraz QR do osadzenia w e-mailu + dane do sekcji biletu w treści. */
export async function ticketEmailAttachment(
  submissionId: string,
  nonce: string,
): Promise<{ ticketQr: TicketQrData; image: InlineImage }> {
  const content = await renderTicketQrPng(submissionId, nonce);
  return {
    ticketQr: { cid: QR_CID, reference: ticketReference(submissionId) },
    image: { cid: QR_CID, filename: `bilet-${ticketReference(submissionId)}.png`, content },
  };
}

/** Wysyła sam bilet (ponownie albo po wystawieniu nowego kodu). Zwraca false, gdy zgłoszenie nie jest opłacone. */
export async function sendTicketEmail(submissionId: string, options: { reissued: boolean }): Promise<boolean> {
  const nonce = await ensureTicketNonce(submissionId);
  if (!nonce) return false;
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    include: { form: true },
  });
  const { ticketQr, image } = await ticketEmailAttachment(submission.id, nonce);
  const { subject, html, text } = buildTicketEmail({
    formTitle: submission.form.title,
    eventDate: submission.form.eventDate,
    location: submission.form.location,
    formSlug: submission.form.slug,
    ticketName: submission.ticketNameSnapshot,
    amountCents: submission.ticketPriceCents,
    currency: submission.currency,
    ticketQr,
    reissued: options.reissued,
  });
  return sendMail(submission.buyerEmail, subject, html, text, [image]);
}
