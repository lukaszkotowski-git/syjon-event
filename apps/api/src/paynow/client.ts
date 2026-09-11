import crypto from 'node:crypto';
import { env } from '../env.js';
import { badGateway } from '../http/errors.js';
import { computeRequestSignature, verifySignature } from './signature.js';
import { isPaynowStatus, type PaynowStatus } from './status.js';

export interface CreatePaymentParams {
  amountCents: number;
  currency: string;
  externalId: string;
  description: string;
  buyerEmail: string;
  buyerPhone?: string | null;
  continueUrl: string;
  validitySeconds: number;
  idempotencyKey: string;
}

export interface CreatePaymentResult {
  paymentId: string;
  status: PaynowStatus;
  redirectUrl: string;
}

export class PaynowTransientError extends Error {}

const REQUEST_TIMEOUT_MS = 15_000;

async function paynowFetch(
  path: string,
  init: { method: 'GET' | 'POST'; body?: string; idempotencyKey?: string },
): Promise<{ status: number; text: string; signature: string | undefined }> {
  const cfg = env();
  const body = init.body ?? '';
  // Idempotency-Key jest częścią podpisu v3, więc musi istnieć także dla GET-ów,
  // gdzie nie chroni przed duplikatem i może być losowy.
  const idempotencyKey = init.idempotencyKey ?? crypto.randomUUID();

  const headers: Record<string, string> = {
    'Api-Key': cfg.PAYNOW_API_KEY,
    Signature: computeRequestSignature({
      signatureKey: cfg.PAYNOW_SIGNATURE_KEY,
      apiKey: cfg.PAYNOW_API_KEY,
      idempotencyKey,
      body,
    }),
    'Idempotency-Key': idempotencyKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${cfg.PAYNOW_BASE_URL}${path}`, {
      method: init.method,
      headers,
      body: init.method === 'POST' ? body : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, text, signature: response.headers.get('signature') ?? undefined };
  } catch (error) {
    // Timeout / błąd sieci: nie wiemy, czy płatność powstała.
    // Ponowienie MUSI użyć tego samego Idempotency-Key.
    throw new PaynowTransientError(
      `Brak odpowiedzi z Paynow: ${error instanceof Error ? error.message : 'nieznany błąd'}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function assertResponseSignature(text: string, signature: string | undefined): void {
  // Paynow podpisuje również odpowiedzi. Jeśli nagłówek jest obecny, musi się zgadzać.
  if (signature && !verifySignature(env().PAYNOW_SIGNATURE_KEY, text, signature)) {
    throw badGateway('Niepoprawny podpis odpowiedzi Paynow');
  }
}

export async function createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
  const body = JSON.stringify({
    amount: params.amountCents,
    currency: params.currency,
    externalId: params.externalId,
    description: params.description.slice(0, 250),
    buyer: {
      email: params.buyerEmail,
      // Paynow wymaga prefiksu z plusem ('+48'), samo '48' odrzuca jako VALIDATION_ERROR.
      ...(params.buyerPhone ? { phone: { prefix: '+48', number: params.buyerPhone.replace('+48', '') } } : {}),
    },
    continueUrl: params.continueUrl,
    validityTime: params.validitySeconds,
  });

  const { status, text, signature } = await paynowFetch('/v3/payments', {
    method: 'POST',
    body,
    idempotencyKey: params.idempotencyKey,
  });

  if (status >= 500 || status === 429) {
    throw new PaynowTransientError(`Paynow odpowiedział ${status}`);
  }
  if (status >= 400) {
    // Treść odpowiedzi Paynow (nie nasze dane) — bezpieczna do logowania, kluczowa do diagnozy.
    console.error(`[paynow] POST /v3/payments -> ${status}:`, text);
    throw badGateway(`Paynow odrzucił żądanie płatności (HTTP ${status})`);
  }

  assertResponseSignature(text, signature);

  const parsed = JSON.parse(text) as { paymentId?: string; status?: string; redirectUrl?: string };
  if (!parsed.paymentId || !parsed.redirectUrl) {
    throw badGateway('Niekompletna odpowiedź Paynow przy tworzeniu płatności');
  }

  return {
    paymentId: parsed.paymentId,
    status: isPaynowStatus(parsed.status) ? parsed.status : 'NEW',
    redirectUrl: parsed.redirectUrl,
  };
}

export async function getPaymentStatus(
  paymentId: string,
): Promise<{ status: PaynowStatus; modifiedAt: Date | null; raw: unknown } | null> {
  const { status, text, signature } = await paynowFetch(
    `/v3/payments/${encodeURIComponent(paymentId)}/status`,
    { method: 'GET' },
  );

  if (status === 404) return null;
  if (status >= 500 || status === 429) throw new PaynowTransientError(`Paynow odpowiedział ${status}`);
  if (status >= 400) {
    console.error(`[paynow] GET /v3/payments/.../status -> ${status}:`, text);
    throw badGateway(`Paynow: błąd odczytu statusu (HTTP ${status})`);
  }

  assertResponseSignature(text, signature);

  const parsed = JSON.parse(text) as { status?: string; modifiedAt?: string };
  if (!isPaynowStatus(parsed.status)) {
    throw badGateway(`Nieznany status płatności z Paynow: ${String(parsed.status)}`);
  }

  return {
    status: parsed.status,
    modifiedAt: parsed.modifiedAt ? new Date(parsed.modifiedAt) : null,
    raw: parsed,
  };
}
