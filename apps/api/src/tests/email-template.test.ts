import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { knownVariableNames, normalizeVariableName, renderTemplate, templateVariableNames } from '@syjonevent/shared';

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
const { emailTemplateValues } = await import('../services/email-variables.js');

const schema = {
  sections: [
    {
      id: 's1',
      name: 'Dane',
      fields: [
        { type: 'text', key: 'pole_1', label: 'Imię', required: true },
        { type: 'text', key: 'pole_2', label: 'Nazwisko', required: true },
        { type: 'select', key: 'pole_3', label: 'Preferencje żywieniowe', required: false, options: ['Wege', 'Zwykła'] },
        { type: 'checkbox', key: 'pole_4', label: 'Nocleg', required: false },
      ],
    },
  ],
};

const submission = {
  id: '3f9a2c1b-0000-4000-8000-000000000000',
  buyerEmail: 'jan@example.com',
  buyerPhone: '+48601234567',
  ticketNameSnapshot: 'Bilet normalny',
  ticketPriceCents: 4900,
  currency: 'PLN',
  payloadJson: { pole_1: 'Jan', pole_2: 'Kowalski', pole_3: 'Wege', pole_4: true },
  schemaSnapshotJson: schema,
};
const form = { title: 'Konferencja Syjon', eventDate: new Date('2026-10-11T16:00:00Z'), location: 'Kościół św. Anny, Warszawa' };

describe('szablon e-maila', () => {
  test('nazwa znacznika ignoruje wielkość liter, polskie znaki i spacje', () => {
    assert.equal(normalizeVariableName(' Imię '), 'imie');
    assert.equal(normalizeVariableName('Preferencje żywieniowe'), 'preferencje_zywieniowe');
    assert.equal(normalizeVariableName('Łódź'), 'lodz');
  });

  test('podstawia wartości, a nieznany znacznik zamienia na pusty tekst', () => {
    assert.equal(renderTemplate('Cześć {{ Imię }}! {{brak}}Do zobaczenia.', { imie: 'Jan' }), 'Cześć Jan! Do zobaczenia.');
  });

  test('wyciąga nazwy znaczników z treści', () => {
    assert.deepEqual(templateVariableNames('{{imię}} i {{ Nazwisko }}, {nie}'), ['imie', 'nazwisko']);
  });

  test('pola formularza są znane po kluczu i po nazwie', () => {
    const known = knownVariableNames(schema.sections as never);
    assert.ok(known.has('pole_3'));
    assert.ok(known.has('preferencje_zywieniowe'));
    assert.ok(known.has('numer_biletu'));
    assert.ok(!known.has('dieta'));
  });

  test('wartości ze zgłoszenia: imię, nazwisko, pola formularza, kwota i data', () => {
    const values = emailTemplateValues(submission as never, form);
    const rendered = renderTemplate(
      '{{imię}} {{nazwisko}} | {{imie_nazwisko}} | {{preferencje żywieniowe}} | {{pole_3}} | {{nocleg}} | {{kwota}} | {{numer_biletu}} | {{wydarzenie}} | {{data_wydarzenia}} | {{miejsce}}',
      values,
    );
    // Intl wstawia twarde spacje (np. w "49,00 zł") — porównujemy po ich znormalizowaniu.
    assert.equal(
      rendered.replace(/[\u00a0\u202f]/g, ' '),
      'Jan Kowalski | Jan Kowalski | Wege | Wege | Tak | 49,00 zł | 3F9A2C1B | Konferencja Syjon | 11 października 2026 | Kościół św. Anny, Warszawa',
    );
  });

  test('jedno pole "Imię i nazwisko" jest dzielone na imię i nazwisko', () => {
    const single = {
      ...submission,
      payloadJson: { name: 'Anna Maria Nowak' },
      schemaSnapshotJson: {
        sections: [{ id: 's1', name: 'Dane', fields: [{ type: 'text', key: 'name', label: 'Imię i nazwisko', required: true }] }],
      },
    };
    const values = emailTemplateValues(single as never, form);
    assert.equal(values.imie, 'Anna');
    assert.equal(values.nazwisko, 'Maria Nowak');
  });
});
