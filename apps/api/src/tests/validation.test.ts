import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  applyDiscount,
  buildAnswersSchema,
  discountCodeInput,
  formSchemaJson,
  normalizePlPhone,
  pickVisibleAnswers,
  resolveConsents,
  ticketTypeInput,
  type FieldDefinition,
} from '@syjonevent/shared';
import { toCsv } from '../utils/csv.js';

describe('telefon +48', () => {
  test('akceptuje warianty zapisu', () => {
    assert.equal(normalizePlPhone('+48 601 234 567'), '+48601234567');
    assert.equal(normalizePlPhone('601-234-567'), '+48601234567');
    assert.equal(normalizePlPhone('48601234567'), '+48601234567');
  });

  test('odrzuca błędne numery', () => {
    assert.equal(normalizePlPhone('12345'), null);
    assert.equal(normalizePlPhone('+49601234567'), null);
    assert.equal(normalizePlPhone('001234567'), null);
  });
});

describe('walidacja odpowiedzi z definicji pól', () => {
  const fields: FieldDefinition[] = [
    { type: 'text', key: 'imie', label: 'Imię', required: true },
    { type: 'select', key: 'rozmiar', label: 'Rozmiar', required: true, options: ['S', 'M', 'L'] },
    { type: 'checkbox', key: 'newsletter', label: 'Newsletter', required: false },
    { type: 'number', key: 'wiek', label: 'Wiek', required: false, min: 16 },
  ];
  const schema = buildAnswersSchema(fields);

  test('poprawne dane przechodzą i normalizują checkbox', () => {
    const parsed = schema.parse({ imie: 'Anna', rozmiar: 'M' });
    assert.equal(parsed.imie, 'Anna');
    assert.equal(parsed.newsletter, false);
  });

  test('brak wymaganego pola jest błędem', () => {
    assert.throws(() => schema.parse({ rozmiar: 'M' }));
  });

  test('wartość spoza opcji selecta jest odrzucana', () => {
    assert.throws(() => schema.parse({ imie: 'Anna', rozmiar: 'XXL' }));
  });

  test('nieznane klucze są odrzucane (brak wstrzykiwania do payload_json)', () => {
    assert.throws(() => schema.parse({ imie: 'Anna', rozmiar: 'M', is_admin: true }));
  });

  test('liczba poniżej minimum jest odrzucana', () => {
    assert.throws(() => schema.parse({ imie: 'Anna', rozmiar: 'M', wiek: 10 }));
  });
});

describe('schemat formularza', () => {
  test('zduplikowane klucze pól są odrzucane (w tej samej sekcji)', () => {
    const result = formSchemaJson.safeParse({
      sections: [
        {
          id: 'sekcja-1',
          name: 'Dane',
          fields: [
            { type: 'text', key: 'imie', label: 'Imię', required: true },
            { type: 'text', key: 'imie', label: 'Imię 2', required: false },
          ],
        },
      ],
    });
    assert.equal(result.success, false);
  });

  test('zduplikowane klucze pól są odrzucane (w różnych sekcjach)', () => {
    const result = formSchemaJson.safeParse({
      sections: [
        { id: 'sekcja-1', name: 'Dane', fields: [{ type: 'text', key: 'imie', label: 'Imię', required: true }] },
        { id: 'sekcja-2', name: 'Więcej', fields: [{ type: 'text', key: 'imie', label: 'Imię 2', required: false }] },
      ],
    });
    assert.equal(result.success, false);
  });

  test('zduplikowane id sekcji jest odrzucane', () => {
    const result = formSchemaJson.safeParse({
      sections: [
        { id: 'sekcja-1', name: 'Dane', fields: [] },
        { id: 'sekcja-1', name: 'Dane 2', fields: [] },
      ],
    });
    assert.equal(result.success, false);
  });

  test('unikalne klucze pól w różnych sekcjach przechodzą', () => {
    const result = formSchemaJson.safeParse({
      sections: [
        { id: 'sekcja-1', name: 'Dane', fields: [{ type: 'text', key: 'imie', label: 'Imię', required: true }] },
        { id: 'sekcja-2', name: 'Więcej', fields: [{ type: 'text', key: 'nazwisko', label: 'Nazwisko', required: true }] },
      ],
    });
    assert.equal(result.success, true);
  });
});

describe('cena biletu', () => {
  test('bilet darmowy jest dozwolony', () => {
    assert.equal(ticketTypeInput.safeParse({ name: 'Wolontariusz', priceCents: 0 }).success, true);
  });

  test('bilet płatny poniżej 1,00 PLN jest odrzucany (limit Paynow)', () => {
    assert.equal(ticketTypeInput.safeParse({ name: 'Grosz', priceCents: 50 }).success, false);
  });

  test('bilet za 1,00 PLN przechodzi', () => {
    assert.equal(ticketTypeInput.safeParse({ name: 'Normalny', priceCents: 100 }).success, true);
  });
});

describe('kody rabatowe', () => {
  test('rabat procentowy liczy się od ceny biletu', () => {
    assert.equal(applyDiscount(10_000, 'PERCENT', 25), 7_500);
  });

  test('rabat kwotowy odejmuje grosze', () => {
    assert.equal(applyDiscount(10_000, 'AMOUNT', 3_000), 7_000);
  });

  test('rabat nie schodzi poniżej zera', () => {
    assert.equal(applyDiscount(1_000, 'AMOUNT', 5_000), 0);
  });

  test('cena poniżej minimum Paynow, ale wciąż dodatnia, staje się darmowa', () => {
    assert.equal(applyDiscount(500, 'AMOUNT', 450), 0); // 50 gr < MIN_PAID_AMOUNT_CENTS
  });

  test('rabat 100% daje darmowy bilet', () => {
    assert.equal(applyDiscount(10_000, 'PERCENT', 100), 0);
  });

  test('walidacja: procent poza zakresem 1–100 jest odrzucany', () => {
    assert.equal(discountCodeInput.safeParse({ code: 'ABC10', type: 'PERCENT', value: 150 }).success, false);
    assert.equal(discountCodeInput.safeParse({ code: 'ABC10', type: 'PERCENT', value: 0 }).success, false);
  });

  test('walidacja: kod jest normalizowany do wielkich liter', () => {
    const result = discountCodeInput.safeParse({ code: 'wolontariusz', type: 'AMOUNT', value: 500 });
    assert.equal(result.success, true);
    assert.equal(result.success && result.data.code, 'WOLONTARIUSZ');
  });

  test('walidacja: zbyt krótki kod jest odrzucany', () => {
    assert.equal(discountCodeInput.safeParse({ code: 'A', type: 'AMOUNT', value: 500 }).success, false);
  });
});

describe('CSV', () => {
  test('escapuje separatory i cudzysłowy', () => {
    const csv = toCsv([
      ['a', 'b'],
      ['x;y', 'cytat "test"'],
    ]);
    assert.ok(csv.startsWith('\uFEFF'));
    assert.ok(csv.includes('"x;y"'));
    assert.ok(csv.includes('"cytat ""test"""'));
  });
});

describe('pola warunkowe', () => {
  const fields: FieldDefinition[] = [
    { key: 'dieta', label: 'Dieta', type: 'select', required: true, options: ['Normalna', 'Specjalna'] },
    { key: 'jaka', label: 'Jaka dieta?', type: 'text', required: true, showIf: { field: 'dieta', value: 'Specjalna' } },
    { key: 'nocleg', label: 'Nocleg', type: 'checkbox', required: false },
    { key: 'pokoj', label: 'Pokój z', type: 'text', required: false, showIf: { field: 'nocleg', value: true } },
  ];

  test('ukryte pole nie jest wymagane i nie trafia do odpowiedzi', () => {
    const { fields: visible, answers } = pickVisibleAnswers(fields, { dieta: 'Normalna', jaka: 'śmieci', nocleg: false });
    assert.deepEqual(
      visible.map((f) => f.key),
      ['dieta', 'nocleg'],
    );
    assert.equal('jaka' in answers, false);
    assert.equal(buildAnswersSchema(visible).safeParse(answers).success, true);
  });

  test('odsłonięte pole wymagane musi być wypełnione', () => {
    const { fields: visible, answers } = pickVisibleAnswers(fields, { dieta: 'Specjalna', nocleg: true });
    assert.deepEqual(
      visible.map((f) => f.key),
      ['dieta', 'jaka', 'nocleg', 'pokoj'],
    );
    assert.equal(buildAnswersSchema(visible).safeParse(answers).success, false);
  });

  test('warunek musi wskazywać wcześniejszą listę lub checkbox z istniejącą wartością', () => {
    const section = (sectionFields: unknown[]) => ({ sections: [{ id: 's', name: 'S', fields: sectionFields }] });
    assert.equal(formSchemaJson.safeParse(section(fields)).success, true);
    // Odwołanie do pola położonego niżej.
    assert.equal(formSchemaJson.safeParse(section([fields[1], fields[0]])).success, false);
    // Opcja, której nie ma na liście.
    assert.equal(
      formSchemaJson.safeParse(section([fields[0], { ...fields[1], showIf: { field: 'dieta', value: 'Wegańska' } }])).success,
      false,
    );
  });
});

describe('zgody dodatkowe', () => {
  const definitions = [
    { key: 'wizerunek', label: 'Zgoda na wizerunek', required: true },
    { key: 'newsletter', label: 'Informacje o wydarzeniach', required: false },
  ];

  test('wymagana zgoda musi być zaznaczona', () => {
    const result = resolveConsents(definitions, { newsletter: true });
    assert.equal(result.ok, false);
  });

  test('zapisuje treść i decyzję dla każdej zgody', () => {
    const result = resolveConsents(definitions, { wizerunek: true });
    assert.deepEqual(result, {
      ok: true,
      consents: [
        { key: 'wizerunek', label: 'Zgoda na wizerunek', accepted: true },
        { key: 'newsletter', label: 'Informacje o wydarzeniach', accepted: false },
      ],
    });
  });
});
