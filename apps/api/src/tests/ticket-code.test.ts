import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { describe } from 'node:test';

// Moduł czyta sekret z env() — ustawiamy minimalną konfigurację przed importem.
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://test@localhost/test',
  SESSION_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  APP_BASE_URL: 'http://localhost:5173',
  CORS_ORIGIN: 'http://localhost:5173',
  PAYNOW_API_KEY: 'x',
  PAYNOW_SIGNATURE_KEY: 'x',
  SMTP_HOST: 'localhost',
  SMTP_USER: 'x',
  SMTP_PASSWORD: 'x',
  MAIL_FROM: 'test@example.com',
});
const { decodeTicketCode, encodeTicketCode, generateTicketNonce, ticketReference } = await import(
  '../utils/ticket-code.js'
);
const { maskEmail } = await import('../services/participants.js');

describe('kod QR biletu', () => {
  const submissionId = crypto.randomUUID();
  const nonce = generateTicketNonce();

  test('poprawny kod dekoduje się do id zgłoszenia i nonce', () => {
    const decoded = decodeTicketCode(encodeTicketCode(submissionId, nonce));
    assert.deepEqual(decoded, { ok: true, submissionId, nonce });
  });

  test('kod nie zawiera id zgłoszenia w czytelnej postaci', () => {
    assert.ok(!encodeTicketCode(submissionId, nonce).includes(submissionId));
  });

  test('zmieniony znak w kodzie jest odrzucany jako podrobiony', () => {
    const code = encodeTicketCode(submissionId, nonce);
    const index = code.length - 5;
    const tampered = code.slice(0, index) + (code[index] === 'A' ? 'B' : 'A') + code.slice(index + 1);
    assert.deepEqual(decodeTicketCode(tampered), { ok: false, reason: 'BAD_SIGNATURE' });
  });

  test('kod z podmienionym id innego zgłoszenia nie przechodzi weryfikacji podpisu', () => {
    const other = encodeTicketCode(crypto.randomUUID(), nonce);
    const mine = encodeTicketCode(submissionId, nonce);
    // Id (pierwsze 16 bajtów) z jednego kodu, reszta z drugiego.
    const mixed = Buffer.concat([
      Buffer.from(other.slice(4), 'base64url').subarray(0, 16),
      Buffer.from(mine.slice(4), 'base64url').subarray(16),
    ]);
    assert.deepEqual(decodeTicketCode(`SE1.${mixed.toString('base64url')}`), { ok: false, reason: 'BAD_SIGNATURE' });
  });

  test('nowy nonce daje inny kod — stary nadal ma poprawny podpis, więc serwer może go rozpoznać jako wygasły', () => {
    const oldCode = encodeTicketCode(submissionId, nonce);
    const newCode = encodeTicketCode(submissionId, generateTicketNonce());
    assert.notEqual(oldCode, newCode);
    const decoded = decodeTicketCode(oldCode);
    assert.equal(decoded.ok, true);
  });

  test('dowolny tekst, URL i sam UUID są odrzucane jako zły format', () => {
    for (const raw of ['hello', 'https://example.com', submissionId, 'SE1.', 'SE1.!!!', 'SE1.AAAA']) {
      assert.deepEqual(decodeTicketCode(raw), { ok: false, reason: 'MALFORMED' });
    }
  });

  test('numer biletu to 8 znaków z id', () => {
    assert.equal(ticketReference('3f9a2c1b-0000-4000-8000-000000000000'), '3F9A2C1B');
  });
});

describe('maskowanie e-maila', () => {
  test('zostawia dwa pierwsze znaki i domenę', () => {
    assert.equal(maskEmail('jan.kowalski@gmail.com'), 'ja••••••••••@gmail.com');
  });

  test('krótki adres nadal jest zamaskowany', () => {
    assert.equal(maskEmail('a@b.pl'), 'a•••@b.pl');
  });
});
