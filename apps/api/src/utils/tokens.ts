import crypto from 'node:crypto';
import { env } from '../env.js';

/** Token publiczny zgłoszenia: w URL potwierdzenia, w bazie tylko jako HMAC. */
export function generatePublicToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function hashPublicToken(token: string): string {
  return crypto.createHmac('sha256', env().SESSION_SECRET).update(token).digest('hex');
}

/** Idempotency-Key Paynow: maksymalnie 45 znaków. */
export function generateIdempotencyKey(): string {
  return crypto.randomBytes(24).toString('base64url').slice(0, 45);
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
