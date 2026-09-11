import crypto from 'node:crypto';

/**
 * Paynow używa DWÓCH różnych schematów podpisu — mylenie ich kończy się
 * błędem `VERIFICATION_FAILED`:
 *
 * 1. Żądania wychodzące (API v3) — podpisujemy kopertę JSON zawierającą nagłówki
 *    `Api-Key` i `Idempotency-Key`, parametry query i surowe body. Patrz
 *    `computeRequestSignature`.
 * 2. Notyfikacje przychodzące (webhook) — Paynow podpisuje samo surowe body.
 *    Patrz `computeSignature` / `verifySignature`.
 *
 * W obu przypadkach: HMAC-SHA256 kluczem Signature-Key, wynik w Base64.
 */

/** Podpis notyfikacji przychodzącej — HMAC z SUROWEGO body, bez re-serializacji. */
export function computeSignature(signatureKey: string, rawBody: Buffer | string): string {
  return crypto.createHmac('sha256', signatureKey).update(rawBody).digest('base64');
}

export function verifySignature(
  signatureKey: string,
  rawBody: Buffer | string,
  receivedSignature: string | undefined,
): boolean {
  if (!receivedSignature) return false;
  const expected = computeSignature(signatureKey, rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(receivedSignature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface RequestSignatureInput {
  signatureKey: string;
  apiKey: string;
  idempotencyKey: string;
  /** Surowe body wysyłane w żądaniu; dla GET pusty string. */
  body?: string;
  /** Parametry query — dla naszych wywołań zawsze puste. */
  parameters?: Record<string, string>;
}

/**
 * Podpis żądania wychodzącego (API v3). Kolejność kluczy w kopercie jest częścią
 * kontraktu — JSON.stringify zachowuje kolejność wstawiania, więc `headers`,
 * `parameters`, `body` muszą pozostać dokładnie w tej kolejności.
 */
export function computeRequestSignature(input: RequestSignatureInput): string {
  const payload = {
    headers: {
      'Api-Key': input.apiKey,
      'Idempotency-Key': input.idempotencyKey,
    },
    parameters: input.parameters ?? {},
    body: input.body ?? '',
  };
  return computeSignature(input.signatureKey, JSON.stringify(payload));
}
