import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { depositError, depositSplit } from '@syjonevent/shared';
import { nextPaymentKind, statusAfterConfirmed } from '../services/payments.js';
import { amountDueCents } from '../services/registration.js';

describe('podział na zaliczkę i dopłatę', () => {
  test('zaliczka stała, reszta to dopłata', () => {
    assert.deepEqual(depositSplit(30000, 10000), { depositCents: 10000, balanceCents: 20000 });
  });

  test('rabat zmniejsza dopłatę, a nie zaliczkę', () => {
    assert.deepEqual(depositSplit(25000, 10000), { depositCents: 10000, balanceCents: 15000 });
  });

  test('brak zaliczki, gdy cena po rabacie nie przekracza zaliczki o minimum Paynow', () => {
    assert.equal(depositSplit(10000, 10000), null);
    assert.equal(depositSplit(10050, 10000), null);
    assert.equal(depositSplit(0, 10000), null);
    assert.equal(depositSplit(30000, null), null);
  });

  test('walidacja zaliczki w edytorze biletu', () => {
    assert.equal(depositError(30000, null), null);
    assert.equal(depositError(30000, 10000), null);
    assert.ok(depositError(0, 1000));
    assert.ok(depositError(30000, 50));
    assert.ok(depositError(30000, 30000));
  });
});

describe('płatności dzielone', () => {
  const base = { ticketPriceCents: 30000, depositCents: 10000, paidCents: 0 };

  test('kwota do zapłaty zależy od etapu', () => {
    assert.equal(amountDueCents({ ...base, status: 'RESERVED' }), 10000);
    assert.equal(amountDueCents({ ...base, status: 'DEPOSIT_PAID', paidCents: 10000 }), 20000);
    assert.equal(amountDueCents({ ...base, depositCents: null, status: 'RESERVED' }), 30000);
    assert.equal(amountDueCents({ ...base, status: 'PAID', paidCents: 30000 }), 0);
  });

  test('rodzaj kolejnej płatności', () => {
    assert.equal(nextPaymentKind({ status: 'RESERVED', depositCents: 10000 }), 'DEPOSIT');
    assert.equal(nextPaymentKind({ status: 'RESERVED', depositCents: null }), 'FULL');
    assert.equal(nextPaymentKind({ status: 'DEPOSIT_PAID', depositCents: 10000 }), 'BALANCE');
  });

  test('potwierdzona zaliczka daje DEPOSIT_PAID, dopłata — PAID', () => {
    assert.equal(statusAfterConfirmed('DEPOSIT', 'RESERVED'), 'DEPOSIT_PAID');
    assert.equal(statusAfterConfirmed('DEPOSIT', 'EXPIRED'), 'DEPOSIT_PAID');
    assert.equal(statusAfterConfirmed('BALANCE', 'DEPOSIT_PAID'), 'PAID');
    assert.equal(statusAfterConfirmed('FULL', 'RESERVED'), 'PAID');
  });

  test('ponowna wpłata tej samej części to podwójna wpłata', () => {
    assert.equal(statusAfterConfirmed('DEPOSIT', 'DEPOSIT_PAID'), null);
    assert.equal(statusAfterConfirmed('DEPOSIT', 'PAID'), null);
    assert.equal(statusAfterConfirmed('BALANCE', 'PAID'), null);
    assert.equal(statusAfterConfirmed('FULL', 'PAID'), null);
  });
});
