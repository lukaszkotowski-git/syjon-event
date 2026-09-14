import crypto from 'node:crypto';
import { env } from '../env.js';

/**
 * Kod QR biletu: `SE1.` + base64url(id zgłoszenia 16 B | nonce 16 B | HMAC 16 B).
 * Bez sekretu serwera nie da się go podrobić ani zgadnąć, a nowy nonce unieważnia stary kod.
 */
const PREFIX = 'SE1.';
const ID_BYTES = 16;
const NONCE_BYTES = 16;
const MAC_BYTES = 16;

let cachedKey: Buffer | null = null;

// Osobny klucz wyprowadzony z SESSION_SECRET, żeby podpis biletu nie był wymienny z innymi HMAC-ami.
function signingKey(): Buffer {
  cachedKey ??= crypto.createHmac('sha256', env().SESSION_SECRET).update('syjonevent:ticket-qr:v1').digest();
  return cachedKey;
}

function mac(idBytes: Buffer, nonceBytes: Buffer): Buffer {
  return crypto
    .createHmac('sha256', signingKey())
    .update(Buffer.concat([idBytes, nonceBytes]))
    .digest()
    .subarray(0, MAC_BYTES);
}

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function generateTicketNonce(): string {
  return crypto.randomBytes(NONCE_BYTES).toString('base64url');
}

export function encodeTicketCode(submissionId: string, nonce: string): string {
  const idBytes = uuidToBytes(submissionId);
  const nonceBytes = Buffer.from(nonce, 'base64url');
  return PREFIX + Buffer.concat([idBytes, nonceBytes, mac(idBytes, nonceBytes)]).toString('base64url');
}

export type DecodedTicketCode =
  | { ok: true; submissionId: string; nonce: string }
  | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' };

export function decodeTicketCode(raw: string): DecodedTicketCode {
  const code = raw.trim();
  if (!code.startsWith(PREFIX)) return { ok: false, reason: 'MALFORMED' };
  const body = code.slice(PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return { ok: false, reason: 'MALFORMED' };

  const bytes = Buffer.from(body, 'base64url');
  if (bytes.length !== ID_BYTES + NONCE_BYTES + MAC_BYTES) return { ok: false, reason: 'MALFORMED' };

  const idBytes = bytes.subarray(0, ID_BYTES);
  const nonceBytes = bytes.subarray(ID_BYTES, ID_BYTES + NONCE_BYTES);
  const given = bytes.subarray(ID_BYTES + NONCE_BYTES);
  if (!crypto.timingSafeEqual(given, mac(idBytes, nonceBytes))) return { ok: false, reason: 'BAD_SIGNATURE' };

  return { ok: true, submissionId: bytesToUuid(idBytes), nonce: nonceBytes.toString('base64url') };
}

/** Skrót treści skanu do audytu — łączy powtarzające się próby bez zapisywania samego kodu. */
export function hashScannedCode(raw: string): string {
  return crypto.createHash('sha256').update(raw.trim()).digest('hex').slice(0, 32);
}

/** Krótki numer biletu do kontaktu z obsługą i ręcznego wyszukiwania. */
export function ticketReference(submissionId: string): string {
  return submissionId.replace(/-/g, '').slice(0, 8).toUpperCase();
}
