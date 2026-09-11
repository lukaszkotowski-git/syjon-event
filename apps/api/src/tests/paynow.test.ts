import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { describe } from 'node:test';
import { computeRequestSignature, computeSignature, verifySignature } from '../paynow/signature.js';
import { decideStatusUpdate } from '../paynow/status.js';

describe('podpis żądania wychodzącego (Paynow v3)', () => {
  const signatureKey = 'test-signature-key';
  const apiKey = 'test-api-key';
  const idempotencyKey = 'idem-1';
  const body = JSON.stringify({ amount: 100, currency: 'PLN' });

  test('podpisuje kopertę z nagłówkami, a nie samo body', () => {
    // Kształt i KOLEJNOŚĆ kluczy koperty są częścią kontraktu Paynow — podpis
    // liczony z samego body kończy się błędem VERIFICATION_FAILED.
    const envelope = `{"headers":{"Api-Key":"${apiKey}","Idempotency-Key":"${idempotencyKey}"},"parameters":{},"body":${JSON.stringify(body)}}`;
    const expected = crypto.createHmac('sha256', signatureKey).update(envelope).digest('base64');

    assert.equal(computeRequestSignature({ signatureKey, apiKey, idempotencyKey, body }), expected);
    assert.notEqual(computeRequestSignature({ signatureKey, apiKey, idempotencyKey, body }), computeSignature(signatureKey, body));
  });

  test('Idempotency-Key zmienia podpis', () => {
    assert.notEqual(
      computeRequestSignature({ signatureKey, apiKey, idempotencyKey, body }),
      computeRequestSignature({ signatureKey, apiKey, idempotencyKey: 'idem-2', body }),
    );
  });

  test('żądanie GET podpisuje pustym body', () => {
    const envelope = `{"headers":{"Api-Key":"${apiKey}","Idempotency-Key":"${idempotencyKey}"},"parameters":{},"body":""}`;
    const expected = crypto.createHmac('sha256', signatureKey).update(envelope).digest('base64');
    assert.equal(computeRequestSignature({ signatureKey, apiKey, idempotencyKey }), expected);
  });
});

describe('podpis Paynow', () => {
  const key = 'test-signature-key';
  const body = JSON.stringify({ paymentId: 'PAY-1', status: 'CONFIRMED', modifiedAt: '2026-09-09T10:00:00Z' });

  test('poprawny podpis surowego body przechodzi weryfikację', () => {
    assert.equal(verifySignature(key, body, computeSignature(key, body)), true);
  });

  test('inne body nie przechodzi', () => {
    assert.equal(verifySignature(key, `${body} `, computeSignature(key, body)), false);
  });

  test('brak podpisu nie przechodzi', () => {
    assert.equal(verifySignature(key, body, undefined), false);
  });

  test('podpis liczony jest z bajtów, nie z re-serializacji JSON', () => {
    const reserialized = JSON.stringify(JSON.parse(body), null, 2);
    assert.notEqual(computeSignature(key, reserialized), computeSignature(key, body));
  });
});

describe('maszyna statusów płatności', () => {
  const t = (iso: string) => new Date(iso);

  test('CONFIRMED jest terminalny — spóźniony REJECTED nie cofa płatności', () => {
    const decision = decideStatusUpdate({
      currentStatus: 'CONFIRMED',
      currentModifiedAt: t('2026-09-09T10:05:00Z'),
      incomingStatus: 'REJECTED',
      incomingModifiedAt: t('2026-09-09T10:01:00Z'),
    });
    assert.deepEqual(decision, { apply: false, reason: 'terminal' });
  });

  test('notyfikacja poza kolejnością jest odrzucana', () => {
    const decision = decideStatusUpdate({
      currentStatus: 'PENDING',
      currentModifiedAt: t('2026-09-09T10:05:00Z'),
      incomingStatus: 'NEW',
      incomingModifiedAt: t('2026-09-09T10:00:00Z'),
    });
    assert.equal(decision.apply, false);
    assert.equal(decision.reason, 'out-of-order');
  });

  test('duplikat tej samej notyfikacji nie zmienia stanu', () => {
    const decision = decideStatusUpdate({
      currentStatus: 'PENDING',
      currentModifiedAt: t('2026-09-09T10:05:00Z'),
      incomingStatus: 'PENDING',
      incomingModifiedAt: t('2026-09-09T10:05:00Z'),
    });
    assert.equal(decision.apply, false);
    assert.equal(decision.reason, 'duplicate');
  });

  test('nowsza notyfikacja aktualizuje stan', () => {
    const decision = decideStatusUpdate({
      currentStatus: 'PENDING',
      currentModifiedAt: t('2026-09-09T10:05:00Z'),
      incomingStatus: 'CONFIRMED',
      incomingModifiedAt: t('2026-09-09T10:07:00Z'),
    });
    assert.deepEqual(decision, { apply: true, reason: 'ok' });
  });

  test('brak modifiedAt po obu stronach nadal pozwala na zmianę statusu', () => {
    const decision = decideStatusUpdate({
      currentStatus: 'NEW',
      currentModifiedAt: null,
      incomingStatus: 'CONFIRMED',
      incomingModifiedAt: null,
    });
    assert.equal(decision.apply, true);
  });
});
